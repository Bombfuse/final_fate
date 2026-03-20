//! SQLite migration runner.
//!
//! This module provides a minimal "apply-only" migration system:
//! - Reads `*.sql` files from a directory
//! - Applies them in lexical filename order
//! - Records applied migrations in `schema_migrations`
//!
//! Assumptions / conventions:
//! - Filenames are ordered (e.g. `001_init.sql`, `002_unit.sql`, ...)
//! - Migration files should NOT include `BEGIN`/`COMMIT` (we run them in a transaction)
//! - Migrations are idempotent where reasonable (e.g. `CREATE TABLE IF NOT EXISTS`)

use anyhow::{Context, Result};
use rusqlite::{Connection, OptionalExtension, params};
use std::path::{Path, PathBuf};
use std::{fs, io};

/// Apply any migrations that have not yet been applied.
///
/// This creates a `schema_migrations` table if necessary, then:
/// - resolves `migrations_dir` against multiple candidate locations
/// - scans for `*.sql` files
/// - sorts by filename
/// - applies each file once (tracked by filename in `schema_migrations`)
pub fn run_sql_migrations(conn: &mut Connection, migrations_dir: PathBuf) -> Result<()> {
    conn.execute_batch(
        r#"
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS schema_migrations (
            id TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        );
        "#,
    )?;

    let resolved_dir = resolve_migrations_dir(&migrations_dir).with_context(|| {
        format!(
            "Failed to resolve migrations dir from: {}",
            migrations_dir.display()
        )
    })?;

    let mut entries: Vec<_> = fs::read_dir(&resolved_dir)
        .with_context(|| format!("Failed to read migrations dir: {}", resolved_dir.display()))?
        .collect::<std::result::Result<Vec<_>, io::Error>>()?;

    entries.sort_by_key(|e| e.file_name());

    for entry in entries {
        let path = entry.path();

        if path.extension().and_then(|s| s.to_str()) != Some("sql") {
            continue;
        }

        let file_name = entry.file_name();
        let id = file_name.to_string_lossy().to_string();

        let already_applied: Option<String> = conn
            .query_row(
                "SELECT id FROM schema_migrations WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .optional()?;

        if already_applied.is_some() {
            continue;
        }

        let sql = fs::read_to_string(&path)
            .with_context(|| format!("Failed to read migration file: {}", path.display()))?;

        // Apply within a transaction for safety.
        let tx = conn.transaction()?;
        tx.execute_batch(&sql)
            .with_context(|| format!("Migration failed: {} (from {})", id, path.display()))?;
        tx.execute(
            "INSERT INTO schema_migrations (id) VALUES (?1)",
            params![id],
        )?;
        tx.commit()?;
    }

    Ok(())
}

/// Resolve a migrations directory robustly by trying multiple candidate paths.
///
/// Why: the app may be launched from different working directories (IDE, `cargo run`,
/// double-clicked binary, etc.). The input path might be relative to the crate root
/// (as used in code), or relative to the process working directory.
///
/// Strategy:
/// - If the provided path exists, use it.
/// - Else, try resolving it relative to the current working directory.
/// - Else, try common repo-relative fallbacks.
fn resolve_migrations_dir(input: &Path) -> Result<PathBuf> {
    // 1) As provided (may already be absolute or correct relative to CWD).
    if input.is_dir() {
        return Ok(input.to_path_buf());
    }

    // 2) Relative to current working directory.
    let cwd = std::env::current_dir().context("Failed to read current working directory")?;
    let cwd_joined = cwd.join(input);
    if cwd_joined.is_dir() {
        return Ok(cwd_joined);
    }

    // 3) Common fallbacks when running from repo root or from the crate dir.
    //    These keep behavior stable without hardcoding an absolute path.
    let candidates = [
        PathBuf::from("migrations"),
        PathBuf::from("../migrations"),
        PathBuf::from("../../migrations"),
        PathBuf::from("final_fate/migrations"),
        PathBuf::from("../final_fate/migrations"),
    ];

    for cand in candidates {
        if cand.is_dir() {
            return Ok(cand);
        }
        let joined = cwd.join(&cand);
        if joined.is_dir() {
            return Ok(joined);
        }
    }

    anyhow::bail!(
        "Migrations directory not found. Tried: {}, {}, plus fallbacks relative to CWD {}",
        input.display(),
        cwd_joined.display(),
        cwd.display()
    );
}
