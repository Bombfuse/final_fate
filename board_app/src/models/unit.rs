//! Unit-related data models.

/// Represents a row from the `Unit` table.
///
/// Notes:
/// - Uses `i64` for `id` to align with SQLite INTEGER / `rusqlite::Connection::last_insert_rowid()`.
/// - Uses `i32` for stats since they're small bounded integers in the UI.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnitRow {
    pub id: i64,
    pub name: String,
    pub strength: i32,
    pub agility: i32,
    pub focus: i32,
    pub intelligence: i32,
    pub charisma: i32,
    pub knowledge: i32,
}

impl UnitRow {
    pub fn new(
        id: i64,
        name: String,
        strength: i32,
        agility: i32,
        focus: i32,
        intelligence: i32,
        charisma: i32,
        knowledge: i32,
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
        }
    }
}
