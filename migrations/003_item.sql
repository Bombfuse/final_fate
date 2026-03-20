-- 003_item.sql
-- Add Item table
--
-- Note: transactions are managed by the migration runner, so this file should
-- not contain BEGIN/COMMIT (avoids nested transaction errors).

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS Item (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  strength INTEGER NOT NULL DEFAULT 0,
  agility INTEGER NOT NULL DEFAULT 0,
  focus INTEGER NOT NULL DEFAULT 0,
  intelligence INTEGER NOT NULL DEFAULT 0,
  charisma INTEGER NOT NULL DEFAULT 0,
  knowledge INTEGER NOT NULL DEFAULT 0,
  rules_description TEXT NOT NULL DEFAULT '',
  flavor_description TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_item_name ON Item(name);
