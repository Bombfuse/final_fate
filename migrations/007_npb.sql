-- 007_npb.sql
-- Add migration to support NPB flag per grid tile unit placement and behavior definitions
--
-- Requirements:
-- - When a unit is placed on a grid tile, it can be tagged as NPB (non-player-behavior).
-- - NPB units follow behaviors defined for them in the database.
-- - NPB is a per-placement attribute (per tile placement), not an intrinsic property of a Unit.
--
-- This migration adds:
-- 1) `grid_unit_is_npb` flag to `GridTile` (only meaningful when `unit_id` is not NULL).
-- 2) Tables to define reusable behavior definitions and attach them to units:
--    - `BehaviorDefinition`
--    - `UnitBehavior`
--
-- Notes:
-- - Transactions are managed by the migration runner; do not include BEGIN/COMMIT.
-- - Uses TEXT for description fields; INTEGER for boolean flags (0/1).
-- - SQLite doesn't have a native BOOLEAN type.
-- - Keeps schema flexible: behaviors are stored as a "kind" + JSON config blob.
--
-- Compatibility:
-- - `ALTER TABLE ... ADD COLUMN` is supported by SQLite.
-- - CHECK constraints on existing tables cannot be easily altered in SQLite; we rely on app logic:
--   - `grid_unit_is_npb` should be treated as 0 when `unit_id` is NULL.
--   - `grid_unit_is_npb` should be ignored when `item_id` is set.

PRAGMA foreign_keys = ON;

--------------------------------------------------------------------------------
-- 1) Per-tile NPB flag for unit placements
--------------------------------------------------------------------------------

ALTER TABLE GridTile
ADD COLUMN grid_unit_is_npb INTEGER NOT NULL DEFAULT 0;

-- Helpful index when querying NPB placements for a grid
CREATE INDEX IF NOT EXISTS idx_gridtile_grid_unit_is_npb
ON GridTile(grid_id, grid_unit_is_npb);

-- Helpful index when querying NPB placements by unit_id
CREATE INDEX IF NOT EXISTS idx_gridtile_unit_is_npb
ON GridTile(unit_id, grid_unit_is_npb);

--------------------------------------------------------------------------------
-- 2) Behavior definitions and unit-to-behavior assignments
--------------------------------------------------------------------------------

-- Stores reusable behavior templates.
-- `kind` is a short identifier like:
-- - "AggressiveMelee"
-- - "Patrol"
-- - "Guard"
-- - "FleeWhenLowHP"
-- `config_json` stores behavior parameters (weights, ranges, priorities, etc.)
CREATE TABLE IF NOT EXISTS BehaviorDefinition (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  config_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_behaviordef_name
ON BehaviorDefinition(name);

CREATE INDEX IF NOT EXISTS idx_behaviordef_kind
ON BehaviorDefinition(kind);

-- Assigns one or more behaviors to a unit, optionally ordered by priority.
-- This allows composing multiple behavior rules.
CREATE TABLE IF NOT EXISTS UnitBehavior (
  unit_id INTEGER NOT NULL,
  behavior_definition_id INTEGER NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (unit_id, behavior_definition_id),
  FOREIGN KEY (unit_id) REFERENCES Unit(id) ON DELETE CASCADE,
  FOREIGN KEY (behavior_definition_id) REFERENCES BehaviorDefinition(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_unitbehavior_unit_id
ON UnitBehavior(unit_id);

CREATE INDEX IF NOT EXISTS idx_unitbehavior_behavior_definition_id
ON UnitBehavior(behavior_definition_id);

CREATE INDEX IF NOT EXISTS idx_unitbehavior_priority
ON UnitBehavior(unit_id, priority);
