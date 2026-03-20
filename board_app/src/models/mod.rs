//! Data models used by the application.
//!
//! Keep these structs focused on representing domain/data shapes.
//! Database access/query code should live in `crate::db` (or page-specific
//! adapters until fully refactored).

pub mod action;
pub mod item;
pub mod level;
pub mod unit;

// Future models:
// pub mod scenario;
// pub mod campaign;
