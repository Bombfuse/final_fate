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
use std::path::PathBuf;
use std::{fs, io};

/// Apply any migrations that have not yet been applied.
///
/// This creates a `schema_migrations` table if necessary, then:
/// - scans `migrations_dir` for `*.sql` files
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

    let mut entries: Vec<_> = fs::read_dir(&migrations_dir)
        .with_context(|| {
            format!(
                "Failed to read migrations dir: {}",
                migrations_dir.display()
            )
        })?
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
