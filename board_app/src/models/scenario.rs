//! Scenario + Grid data models.
//!
//! These correspond to the SQLite schema added by migration `006_scenario_grid.sql`:
//! - `Scenario` references a `Grid` via `grid_id`
//! - `Grid` contains `GridTile` rows with axial coordinates (q, r)
//! - each tile can optionally reference either a `Unit` or an `Item` (but not both)
//!
//! Note: These are plain data models. DB query/CRUD code should live under `crate::db`.

/// Represents a row from the `Scenario` table.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScenarioRow {
    pub id: i64,
    pub name: String,
    pub description: String,
    pub grid_id: i64,
    pub created_at: String,
    pub updated_at: String,
}

/// Represents a row from the `Grid` table.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GridRow {
    pub id: i64,
    pub name: String,
    pub width: i32,
    pub height: i32,
    pub created_at: String,
    pub updated_at: String,
}

/// The occupant placed on a tile (if any).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum TileOccupant {
    Unit(i64),
    Item(i64),
}

impl TileOccupant {
    pub fn unit_id(self) -> Option<i64> {
        match self {
            TileOccupant::Unit(id) => Some(id),
            _ => None,
        }
    }

    pub fn item_id(self) -> Option<i64> {
        match self {
            TileOccupant::Item(id) => Some(id),
            _ => None,
        }
    }
}

/// Axial hex coordinates.
///
/// Commonly used for hex grids:
/// - q: column-like axis
/// - r: row-like axis
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct AxialCoord {
    pub q: i32,
    pub r: i32,
}

impl AxialCoord {
    pub const fn new(q: i32, r: i32) -> Self {
        Self { q, r }
    }
}

/// Represents a row from the `GridTile` table.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GridTileRow {
    pub id: i64,
    pub grid_id: i64,
    pub coord: AxialCoord,
    /// Exactly one of unit_id/item_id should be set at a time (or neither).
    pub occupant: Option<TileOccupant>,
    pub created_at: String,
    pub updated_at: String,
}

impl GridTileRow {
    /// Helper to construct from nullable unit_id/item_id values.
    ///
    /// If both are non-null, the DB CHECK constraint should prevent that; if it happens anyway,
    /// callers should treat it as invalid data.
    pub fn from_nullable_occupant(
        id: i64,
        grid_id: i64,
        q: i32,
        r: i32,
        unit_id: Option<i64>,
        item_id: Option<i64>,
        created_at: String,
        updated_at: String,
    ) -> Self {
        let occupant = match (unit_id, item_id) {
            (Some(uid), None) => Some(TileOccupant::Unit(uid)),
            (None, Some(iid)) => Some(TileOccupant::Item(iid)),
            _ => None,
        };

        Self {
            id,
            grid_id,
            coord: AxialCoord { q, r },
            occupant,
            created_at,
            updated_at,
        }
    }
}

/// In-memory grid representation for editing.
///
/// This is useful for the Scenario Edit page:
/// - fixed editor size (e.g. 21x21) can be represented as width/height
/// - tile occupancy can be stored in a map keyed by axial coordinate
///
/// Keep this lightweight; persistence should go through DB-layer functions.
#[derive(Debug, Clone, Default)]
pub struct EditableGrid {
    pub grid_id: Option<i64>,
    pub name: String,
    pub width: i32,
    pub height: i32,
    pub tiles: std::collections::HashMap<AxialCoord, Option<TileOccupant>>,
}

impl EditableGrid {
    pub fn new(width: i32, height: i32) -> Self {
        Self {
            grid_id: None,
            name: String::new(),
            width,
            height,
            tiles: std::collections::HashMap::new(),
        }
    }

    pub fn in_bounds(&self, c: AxialCoord) -> bool {
        c.q >= 0 && c.r >= 0 && c.q < self.width && c.r < self.height
    }

    pub fn get(&self, c: AxialCoord) -> Option<Option<TileOccupant>> {
        if !self.in_bounds(c) {
            return None;
        }
        Some(self.tiles.get(&c).copied().flatten())
    }

    pub fn set(&mut self, c: AxialCoord, occupant: Option<TileOccupant>) {
        if !self.in_bounds(c) {
            return;
        }
        self.tiles.insert(c, occupant);
    }

    pub fn clear(&mut self, c: AxialCoord) {
        if !self.in_bounds(c) {
            return;
        }
        self.tiles.insert(c, None);
    }
}
