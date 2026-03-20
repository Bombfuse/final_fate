-- 005_action.sql
-- Add Action table and association tables to Unit / Item / Level
--
-- Actions can be associated with any of:
-- - Unit
-- - Item
-- - Level
--
-- Note: transactions are managed by the migration runner, so this file should
-- not contain BEGIN/COMMIT (avoids nested transaction errors).

PRAGMA foreign_keys = ON;

-- Main Action table
CREATE TABLE IF NOT EXISTS Action (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  stamina_cost INTEGER NOT NULL DEFAULT 0,
  additional_costs TEXT NOT NULL DEFAULT '',
  action_type TEXT NOT NULL,
  rules_description TEXT NOT NULL DEFAULT '',
  flavor_description TEXT NOT NULL DEFAULT ''
);

-- Basic lookup helpers
CREATE INDEX IF NOT EXISTS idx_action_name ON Action(name);
CREATE INDEX IF NOT EXISTS idx_action_type ON Action(action_type);

-- Association: Action <-> Unit
CREATE TABLE IF NOT EXISTS UnitAction (
  unit_id INTEGER NOT NULL,
  action_id INTEGER NOT NULL,
  PRIMARY KEY (unit_id, action_id),
  FOREIGN KEY (unit_id) REFERENCES Unit(id) ON DELETE CASCADE,
  FOREIGN KEY (action_id) REFERENCES Action(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_unitaction_unit_id ON UnitAction(unit_id);
CREATE INDEX IF NOT EXISTS idx_unitaction_action_id ON UnitAction(action_id);

-- Association: Action <-> Item
CREATE TABLE IF NOT EXISTS ItemAction (
  item_id INTEGER NOT NULL,
  action_id INTEGER NOT NULL,
  PRIMARY KEY (item_id, action_id),
  FOREIGN KEY (item_id) REFERENCES Item(id) ON DELETE CASCADE,
  FOREIGN KEY (action_id) REFERENCES Action(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_itemaction_item_id ON ItemAction(item_id);
CREATE INDEX IF NOT EXISTS idx_itemaction_action_id ON ItemAction(action_id);

-- Association: Action <-> Level
CREATE TABLE IF NOT EXISTS LevelAction (
  level_id INTEGER NOT NULL,
  action_id INTEGER NOT NULL,
  PRIMARY KEY (level_id, action_id),
  FOREIGN KEY (level_id) REFERENCES Level(id) ON DELETE CASCADE,
  FOREIGN KEY (action_id) REFERENCES Action(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_levelaction_level_id ON LevelAction(level_id);
CREATE INDEX IF NOT EXISTS idx_levelaction_action_id ON LevelAction(action_id);
