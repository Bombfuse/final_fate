//! Action-related data models.
//!
//! Actions can be associated with Units, Items, and Levels (see association tables):
//! - `UnitAction`
//! - `ItemAction`
//! - `LevelAction`

/// Represents a row from the `Action` table.
///
/// Notes:
/// - Uses `i64` for `id` to align with SQLite INTEGER / `rusqlite::Connection::last_insert_rowid()`.
/// - `action_type` is represented as [`ActionType`] in code, but stored as TEXT in SQLite.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ActionRow {
    pub id: i64,
    pub name: String,
    pub stamina_cost: i32,
    pub additional_costs: String,
    pub action_type: ActionType,
    pub rules_description: String,
    pub flavor_description: String,
}

/// Discrete action categories.
///
/// Stored in SQLite as TEXT:
/// - `Attack`
/// - `Environment`
/// - `Interact`
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ActionType {
    Attack,
    Environment,
    Interact,
}

impl Default for ActionType {
    fn default() -> Self {
        ActionType::Attack
    }
}

impl ActionType {
    /// Returns the canonical DB string representation.
    pub fn as_str(self) -> &'static str {
        match self {
            ActionType::Attack => "Attack",
            ActionType::Environment => "Environment",
            ActionType::Interact => "Interact",
        }
    }

    /// Parses the DB string representation.
    ///
    /// Returns `None` if the value is not recognized.
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "Attack" => Some(ActionType::Attack),
            "Environment" => Some(ActionType::Environment),
            "Interact" => Some(ActionType::Interact),
            _ => None,
        }
    }

    /// Convenience list for populating UI dropdowns.
    pub const fn all() -> &'static [ActionType] {
        &[
            ActionType::Attack,
            ActionType::Environment,
            ActionType::Interact,
        ]
    }
}

/// Indicates what kind of entity an action is associated with.
/// Useful for UI and generic association handling.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ActionOwnerKind {
    Unit,
    Item,
    Level,
}

impl ActionOwnerKind {
    pub fn as_str(self) -> &'static str {
        match self {
            ActionOwnerKind::Unit => "Unit",
            ActionOwnerKind::Item => "Item",
            ActionOwnerKind::Level => "Level",
        }
    }
}

/// A generic association between an action and an owning entity (Unit/Item/Level).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ActionAssociation {
    pub owner_kind: ActionOwnerKind,
    pub owner_id: i64,
    pub action_id: i64,
}

/// A minimal "lookup row" used by association UIs (id + name).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NamedId {
    pub id: i64,
    pub name: String,
}
