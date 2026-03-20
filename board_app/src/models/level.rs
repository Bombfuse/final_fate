//! Level-related data models.
//!
//! Levels are identical in shape to Items, but stored separately for independent editing and lookup.

/// Represents a row from the `Level` table.
///
/// Notes:
/// - Uses `i64` for `id` to align with SQLite INTEGER / `rusqlite::Connection::last_insert_rowid()`.
/// - Uses `i32` for stats since they're small bounded integers in the UI.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LevelRow {
    pub id: i64,
    pub name: String,
    pub strength: i32,
    pub agility: i32,
    pub focus: i32,
    pub intelligence: i32,
    pub charisma: i32,
    pub knowledge: i32,
    pub rules_description: String,
    pub flavor_description: String,
}

impl LevelRow {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        id: i64,
        name: String,
        strength: i32,
        agility: i32,
        focus: i32,
        intelligence: i32,
        charisma: i32,
        knowledge: i32,
        rules_description: String,
        flavor_description: String,
    ) -> Self {
        Self {
            id,
            name,
            strength,
            agility,
            focus,
            intelligence,
            charisma,
            knowledge,
            rules_description,
            flavor_description,
        }
    }
}
