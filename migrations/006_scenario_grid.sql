-- 006_scenario_grid.sql
-- Add Scenario, Grid, Tile, and tile associations to Unit/Item
--
-- Goals:
-- - A Scenario has: name, description, and is associated with a Grid
-- - A Grid is a container for hex tiles (stored as axial coordinates q,r)
-- - Each tile may optionally reference a Unit or an Item by id
-- - Support saving/loading grids and scenarios
--
-- Notes:
-- - Transactions are managed by the migration runner, so do not include BEGIN/COMMIT.
-- - SQLite types: TEXT for varchar-like fields, INTEGER for ints.
-- - Axial coordinates are used for hex grids: (q, r).
-- - Enforce "at most one occupant" (unit OR item) per tile via CHECK constraint.

PRAGMA foreign_keys = ON;

-- Grid table: represents a saved grid layout
CREATE TABLE IF NOT EXISTS Grid (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL DEFAULT '',
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_grid_name ON Grid(name);

-- Scenario table: represents a playable/editable scenario associated to a grid
CREATE TABLE IF NOT EXISTS Scenario (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  grid_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (grid_id) REFERENCES Grid(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_scenario_name ON Scenario(name);
CREATE INDEX IF NOT EXISTS idx_scenario_grid_id ON Scenario(grid_id);

-- GridTile table: per-tile data for a specific grid.
-- q,r are axial coords. For a 21x21 editor "grid", you can store q in [0..20], r in [0..20]
-- (or any coordinate system you prefer at the app level).
CREATE TABLE IF NOT EXISTS GridTile (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  grid_id INTEGER NOT NULL,
  q INTEGER NOT NULL,
  r INTEGER NOT NULL,

  -- Optional occupant references:
  unit_id INTEGER NULL,
  item_id INTEGER NULL,

  -- Future expansion (terrain, flags, etc.) could go here:
  -- terrain_type TEXT NOT NULL DEFAULT 'Plain',

  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),

  FOREIGN KEY (grid_id) REFERENCES Grid(id) ON DELETE CASCADE,
  FOREIGN KEY (unit_id) REFERENCES Unit(id) ON DELETE SET NULL,
  FOREIGN KEY (item_id) REFERENCES Item(id) ON DELETE SET NULL,

  -- Each (grid_id, q, r) tile is unique
  UNIQUE (grid_id, q, r),

  -- Enforce at most one occupant per tile (either a unit, an item, or empty)
  CHECK (
    (unit_id IS NULL AND item_id IS NULL) OR
    (unit_id IS NOT NULL AND item_id IS NULL) OR
    (unit_id IS NULL AND item_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_gridtile_grid_id ON GridTile(grid_id);
CREATE INDEX IF NOT EXISTS idx_gridtile_unit_id ON GridTile(unit_id);
CREATE INDEX IF NOT EXISTS idx_gridtile_item_id ON GridTile(item_id);
CREATE INDEX IF NOT EXISTS idx_gridtile_coords ON GridTile(grid_id, q, r);
