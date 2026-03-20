-- 001_init.sql
-- Initial schema for SQLite
--
-- Note: transactions are managed by the migration runner, so this file should
-- not contain BEGIN/COMMIT (avoids nested transaction errors).

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS Campaigns (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
