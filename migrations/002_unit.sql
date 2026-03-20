-- 002_unit.sql
-- Add Unit table
--
-- Note: transactions are managed by the migration runner (if any), so this file
-- should not contain BEGIN/COMMIT (avoids nested transaction errors).

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS Unit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  strength INTEGER NOT NULL DEFAULT 0,
  agility INTEGER NOT NULL DEFAULT 0,
  focus INTEGER NOT NULL DEFAULT 0,
  intelligence INTEGER NOT NULL DEFAULT 0,
  charisma INTEGER NOT NULL DEFAULT 0,
  knowledge INTEGER NOT NULL DEFAULT 0
);

-- Helpful index for listing/searching by name
CREATE INDEX IF NOT EXISTS idx_unit_name ON Unit(name);
