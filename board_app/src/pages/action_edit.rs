use anyhow::{Context, Result, anyhow};
use bevy::prelude::Resource;
use bevy_egui::egui;
use rusqlite::params;

use crate::models::action::{ActionRow, ActionType, NamedId};
use crate::{AppRoute, DbState, Route};

/// UI state for the Action Edit page (create form + edit form + association management + errors).
#[derive(Resource, Default)]
pub struct ActionUiState {
    // Create form
    pub new_name: String,
    pub new_stamina_cost: i32,
    pub new_additional_costs: String,
    pub new_action_type: ActionType,
    pub new_rules_description: String,
    pub new_flavor_description: String,

    // Edit form
    pub selected_action_id: Option<i64>,
    pub edit_name: String,
    pub edit_stamina_cost: i32,
    pub edit_additional_costs: String,
    pub edit_action_type: ActionType,
    pub edit_rules_description: String,
    pub edit_flavor_description: String,

    // Association UI
    pub assoc_owner_kind: OwnerKind,
    pub assoc_owner_id: Option<i64>,

    // Cached lookups (optional; refreshed on demand via "Refresh" buttons)
    pub cache_actions: Vec<ActionRow>,
    pub cache_units: Vec<NamedId>,
    pub cache_items: Vec<NamedId>,
    pub cache_levels: Vec<NamedId>,

    pub last_error: Option<String>,
}

/// Which entity type we are associating to an action.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum OwnerKind {
    Unit,
    Item,
    Level,
}

impl Default for OwnerKind {
    fn default() -> Self {
        OwnerKind::Unit
    }
}

impl OwnerKind {
    pub fn as_str(self) -> &'static str {
        match self {
            OwnerKind::Unit => "Unit",
            OwnerKind::Item => "Item",
            OwnerKind::Level => "Level",
        }
    }
}

/// Renders the Action Edit page:
/// - Create action
/// - List actions
/// - Select + edit an action
/// - Delete an action
/// - Create/Delete associations between an action and Unit/Item/Level
pub fn render(
    ui: &mut egui::Ui,
    route: &mut AppRoute,
    db: Option<&DbState>,
    state: &mut ActionUiState,
) {
    ui.heading("Action Edit");
    ui.add_space(8.0);

    if ui.button("Back to Main Menu").clicked() {
        route.current = Route::MainMenu;
        return;
    }

    ui.add_space(12.0);

    if let Some(err) = state.last_error.clone() {
        ui.colored_label(egui::Color32::from_rgb(220, 80, 80), err);
        ui.add_space(8.0);
    }

    let Some(db) = db else {
        ui.colored_label(egui::Color32::from_rgb(220, 80, 80), "DB is not available");
        return;
    };

    // Header actions
    ui.horizontal(|ui| {
        if ui.button("Refresh Lists").clicked() {
            state.last_error = None;
            if let Err(e) = refresh_all_caches(db, state) {
                state.last_error = Some(format!("Refresh failed: {e:#}"));
            }
        }

        ui.label("Tip: Select an action in the table to edit it and manage associations.");
    });

    ui.add_space(8.0);

    // Ensure caches are populated at least once
    if state.cache_actions.is_empty()
        && state.cache_units.is_empty()
        && state.cache_items.is_empty()
        && state.cache_levels.is_empty()
    {
        if let Err(e) = refresh_all_caches(db, state) {
            state.last_error = Some(format!("Initial refresh failed: {e:#}"));
        }
    }

    ui.columns(2, |cols| {
        /* ----------------------------- LEFT: Create + List ----------------------------- */
        cols[0].group(|ui| {
            ui.label("Create Action");
            ui.add_space(6.0);

            ui.horizontal(|ui| {
                ui.label("Name");
                ui.text_edit_singleline(&mut state.new_name);
            });

            ui.horizontal(|ui| {
                ui.label("Stamina Cost");
                ui.add(egui::DragValue::new(&mut state.new_stamina_cost).range(0..=999));
            });

            ui.label("Additional Costs");
            ui.add(
                egui::TextEdit::multiline(&mut state.new_additional_costs)
                    .desired_rows(2)
                    .hint_text("e.g. ammo=1, mana=2, discard=1 ..."),
            );

            ui.horizontal(|ui| {
                ui.label("Action Type");
                action_type_combo(ui, "new_action_type", &mut state.new_action_type);
            });

            ui.label("Rules Description");
            ui.add(
                egui::TextEdit::multiline(&mut state.new_rules_description)
                    .desired_rows(3)
                    .hint_text("Mechanical rules / effects..."),
            );

            ui.label("Flavor Description");
            ui.add(
                egui::TextEdit::multiline(&mut state.new_flavor_description)
                    .desired_rows(3)
                    .hint_text("Lore / narrative description..."),
            );

            ui.add_space(8.0);

            let can_create = !state.new_name.trim().is_empty();
            if ui
                .add_enabled(can_create, egui::Button::new("Create"))
                .clicked()
            {
                state.last_error = None;

                match db_action_insert(
                    db,
                    state.new_name.trim(),
                    state.new_stamina_cost,
                    state.new_additional_costs.trim(),
                    state.new_action_type,
                    state.new_rules_description.trim(),
                    state.new_flavor_description.trim(),
                ) {
                    Ok(new_id) => {
                        state.new_name.clear();
                        state.new_stamina_cost = 0;
                        state.new_additional_costs.clear();
                        state.new_action_type = ActionType::Attack;
                        state.new_rules_description.clear();
                        state.new_flavor_description.clear();

                        // Refresh action list and select the newly created one
                        if let Err(e) = refresh_actions(db, state) {
                            state.last_error =
                                Some(format!("Create ok, but refresh failed: {e:#}"));
                        } else {
                            state.selected_action_id = Some(new_id);
                            if let Err(e) = load_action_into_edit_state(db, state, new_id) {
                                state.last_error =
                                    Some(format!("Create ok, but load failed: {e:#}"));
                            }
                        }
                    }
                    Err(e) => state.last_error = Some(format!("Create failed: {e:#}")),
                }
            }
        });

        cols[0].add_space(12.0);

        cols[0].group(|ui| {
            ui.horizontal(|ui| {
                ui.label(format!("Actions: {}", state.cache_actions.len()));
                if ui.button("Refresh Actions").clicked() {
                    state.last_error = None;
                    if let Err(e) = refresh_actions(db, state) {
                        state.last_error = Some(format!("Refresh actions failed: {e:#}"));
                    }
                }
            });

            ui.add_space(6.0);

            egui::ScrollArea::vertical()
                .id_source("action_table_scroll")
                .auto_shrink([false; 2])
                .max_height(420.0)
                .show(ui, |ui| {
                    egui::Grid::new("action_table")
                        .striped(true)
                        .min_col_width(60.0)
                        .show(ui, |ui| {
                            ui.strong("ID");
                            ui.strong("Name");
                            ui.strong("Type");
                            ui.strong("Stam");
                            ui.strong("Actions");
                            ui.end_row();

                            for a in state.cache_actions.clone() {
                                let is_selected = state.selected_action_id == Some(a.id);

                                let id_label = if is_selected {
                                    format!("▶ {}", a.id)
                                } else {
                                    a.id.to_string()
                                };

                                let select_clicked =
                                    ui.selectable_label(is_selected, id_label).clicked();
                                let select_clicked2 =
                                    ui.selectable_label(is_selected, a.name.clone()).clicked();

                                ui.label(a.action_type.as_str());
                                ui.label(a.stamina_cost.to_string());

                                let mut delete_clicked = false;
                                ui.horizontal(|ui| {
                                    if ui.button("Delete").clicked() {
                                        delete_clicked = true;
                                    }
                                });

                                ui.end_row();

                                if select_clicked || select_clicked2 {
                                    state.last_error = None;
                                    state.selected_action_id = Some(a.id);
                                    if let Err(e) = load_action_into_edit_state(db, state, a.id) {
                                        state.last_error =
                                            Some(format!("Load action failed: {e:#}"));
                                    }
                                }

                                if delete_clicked {
                                    state.last_error = None;
                                    if let Err(e) = db_action_delete(db, a.id) {
                                        state.last_error = Some(format!("Delete failed: {e:#}"));
                                    } else {
                                        // If we deleted the selected action, clear selection.
                                        if state.selected_action_id == Some(a.id) {
                                            state.selected_action_id = None;
                                        }
                                        if let Err(e) = refresh_actions(db, state) {
                                            state.last_error = Some(format!(
                                                "Delete ok, but refresh failed: {e:#}"
                                            ));
                                        }
                                    }
                                }
                            }
                        });
                });
        });

        /* ----------------------------- RIGHT: Edit + Associations ----------------------------- */
        cols[1].group(|ui| {
            ui.label("Edit Action");
            ui.add_space(6.0);

            let Some(selected_id) = state.selected_action_id else {
                ui.label("Select an action from the table to edit it.");
                return;
            };

            ui.horizontal(|ui| {
                ui.label(format!("Selected ID: {selected_id}"));
                if ui.button("Reload").clicked() {
                    state.last_error = None;
                    if let Err(e) = load_action_into_edit_state(db, state, selected_id) {
                        state.last_error = Some(format!("Reload failed: {e:#}"));
                    }
                }
            });

            ui.add_space(8.0);

            ui.horizontal(|ui| {
                ui.label("Name");
                ui.text_edit_singleline(&mut state.edit_name);
            });

            ui.horizontal(|ui| {
                ui.label("Stamina Cost");
                ui.add(egui::DragValue::new(&mut state.edit_stamina_cost).range(0..=999));
            });

            ui.label("Additional Costs");
            ui.add(
                egui::TextEdit::multiline(&mut state.edit_additional_costs)
                    .desired_rows(2)
                    .hint_text("e.g. ammo=1, mana=2, discard=1 ..."),
            );

            ui.horizontal(|ui| {
                ui.label("Action Type");
                action_type_combo(ui, "edit_action_type", &mut state.edit_action_type);
            });

            ui.label("Rules Description");
            ui.add(
                egui::TextEdit::multiline(&mut state.edit_rules_description)
                    .desired_rows(3)
                    .hint_text("Mechanical rules / effects..."),
            );

            ui.label("Flavor Description");
            ui.add(
                egui::TextEdit::multiline(&mut state.edit_flavor_description)
                    .desired_rows(3)
                    .hint_text("Lore / narrative description..."),
            );

            ui.add_space(8.0);

            let can_save = !state.edit_name.trim().is_empty();
            if ui
                .add_enabled(can_save, egui::Button::new("Save Changes"))
                .clicked()
            {
                state.last_error = None;
                match db_action_update(
                    db,
                    selected_id,
                    state.edit_name.trim(),
                    state.edit_stamina_cost,
                    state.edit_additional_costs.trim(),
                    state.edit_action_type,
                    state.edit_rules_description.trim(),
                    state.edit_flavor_description.trim(),
                ) {
                    Ok(()) => {
                        if let Err(e) = refresh_actions(db, state) {
                            state.last_error = Some(format!("Save ok, but refresh failed: {e:#}"));
                        }
                    }
                    Err(e) => state.last_error = Some(format!("Save failed: {e:#}")),
                }
            }
        });

        cols[1].add_space(12.0);

        cols[1].group(|ui| {
            ui.label("Associations");
            ui.add_space(6.0);

            let Some(selected_action_id) = state.selected_action_id else {
                ui.label("Select an action to manage associations.");
                return;
            };

            // Owner-kind selection
            ui.horizontal(|ui| {
                ui.label("Associate with");
                egui::ComboBox::from_id_source("assoc_owner_kind")
                    .selected_text(state.assoc_owner_kind.as_str())
                    .show_ui(ui, |ui: &mut egui::Ui| {
                        ui.selectable_value(&mut state.assoc_owner_kind, OwnerKind::Unit, "Unit");
                        ui.selectable_value(&mut state.assoc_owner_kind, OwnerKind::Item, "Item");
                        ui.selectable_value(&mut state.assoc_owner_kind, OwnerKind::Level, "Level");
                    });
            });

            // Refresh entity lists
            ui.horizontal(|ui| {
                if ui.button("Refresh Entities").clicked() {
                    state.last_error = None;
                    let r = match state.assoc_owner_kind {
                        OwnerKind::Unit => refresh_units(db, state),
                        OwnerKind::Item => refresh_items(db, state),
                        OwnerKind::Level => refresh_levels(db, state),
                    };
                    if let Err(e) = r {
                        state.last_error = Some(format!("Refresh entities failed: {e:#}"));
                    }
                }
            });

            // Owner selection dropdown
            let owner_list: &Vec<NamedId> = match state.assoc_owner_kind {
                OwnerKind::Unit => &state.cache_units,
                OwnerKind::Item => &state.cache_items,
                OwnerKind::Level => &state.cache_levels,
            };

            let selected_owner_name = state
                .assoc_owner_id
                .and_then(|id| owner_list.iter().find(|x| x.id == id))
                .map(|x| x.name.clone())
                .unwrap_or_else(|| "<select>".to_string());

            egui::ComboBox::from_id_source("assoc_owner_id")
                .selected_text(selected_owner_name)
                .show_ui(ui, |ui: &mut egui::Ui| {
                    for o in owner_list {
                        ui.selectable_value(&mut state.assoc_owner_id, Some(o.id), &o.name);
                    }
                });

            ui.add_space(6.0);

            let can_associate = state.assoc_owner_id.is_some();
            ui.horizontal(|ui| {
                if ui
                    .add_enabled(can_associate, egui::Button::new("Add Association"))
                    .clicked()
                {
                    state.last_error = None;

                    let owner_id = match state.assoc_owner_id {
                        Some(v) => v,
                        None => {
                            state.last_error = Some("Select an owner first".to_string());
                            return;
                        }
                    };

                    let res = match state.assoc_owner_kind {
                        OwnerKind::Unit => {
                            db_assoc_add_unit_action(db, owner_id, selected_action_id)
                        }
                        OwnerKind::Item => {
                            db_assoc_add_item_action(db, owner_id, selected_action_id)
                        }
                        OwnerKind::Level => {
                            db_assoc_add_level_action(db, owner_id, selected_action_id)
                        }
                    };

                    if let Err(e) = res {
                        state.last_error = Some(format!("Add association failed: {e:#}"));
                    }
                }

                // Associations are listed inline below; no separate window needed.
            });

            ui.add_space(10.0);

            // Inline listing (always visible) for convenience
            ui.label("Current Associations");
            match db_assoc_list_for_action(db, selected_action_id) {
                Ok(rows) => {
                    if rows.is_empty() {
                        ui.weak("None");
                    } else {
                        egui::ScrollArea::vertical()
                            .id_source("assoc_table_scroll")
                            .auto_shrink([false; 2])
                            .max_height(220.0)
                            .show(ui, |ui| {
                                egui::Grid::new("assoc_table")
                                    .striped(true)
                                    .min_col_width(60.0)
                                    .show(ui, |ui| {
                                        ui.strong("Owner Type");
                                        ui.strong("Owner");
                                        ui.strong("Actions");
                                        ui.end_row();

                                        for row in rows {
                                            ui.label(&row.owner_kind);
                                            ui.label(&row.owner_name);

                                            let mut remove_clicked = false;
                                            ui.horizontal(|ui| {
                                                if ui.button("Remove").clicked() {
                                                    remove_clicked = true;
                                                }
                                            });

                                            ui.end_row();

                                            if remove_clicked {
                                                state.last_error = None;
                                                let res = match row.owner_kind.as_str() {
                                                    "Unit" => db_assoc_remove_unit_action(
                                                        db,
                                                        row.owner_id,
                                                        selected_action_id,
                                                    ),
                                                    "Item" => db_assoc_remove_item_action(
                                                        db,
                                                        row.owner_id,
                                                        selected_action_id,
                                                    ),
                                                    "Level" => db_assoc_remove_level_action(
                                                        db,
                                                        row.owner_id,
                                                        selected_action_id,
                                                    ),
                                                    _ => Err(anyhow!(
                                                        "Unknown owner_kind from DB: {}",
                                                        row.owner_kind
                                                    )),
                                                };

                                                if let Err(e) = res {
                                                    state.last_error = Some(format!(
                                                        "Remove association failed: {e:#}"
                                                    ));
                                                }
                                            }
                                        }
                                    });
                            });
                    }
                }
                Err(e) => {
                    state.last_error = Some(format!("Load associations failed: {e:#}"));
                }
            }
        });
    });
}

/* ----------------------------- UI helpers ----------------------------- */

fn action_type_combo(ui: &mut egui::Ui, id_salt: &str, value: &mut ActionType) {
    egui::ComboBox::from_id_source(id_salt)
        .selected_text(value.as_str())
        .show_ui(ui, |ui: &mut egui::Ui| {
            for t in ActionType::all() {
                ui.selectable_value(value, *t, t.as_str());
            }
        });
}

// (removed) unused `show_associations_window` helper — associations are listed inline in the page UI.

/* ----------------------------- Cache refresh ----------------------------- */

fn refresh_all_caches(db: &DbState, state: &mut ActionUiState) -> Result<()> {
    refresh_actions(db, state)?;
    refresh_units(db, state)?;
    refresh_items(db, state)?;
    refresh_levels(db, state)?;
    Ok(())
}

fn refresh_actions(db: &DbState, state: &mut ActionUiState) -> Result<()> {
    state.cache_actions = db_action_list(db)?;
    Ok(())
}

fn refresh_units(db: &DbState, state: &mut ActionUiState) -> Result<()> {
    state.cache_units = db_named_list(db, "Unit")?;
    Ok(())
}

fn refresh_items(db: &DbState, state: &mut ActionUiState) -> Result<()> {
    state.cache_items = db_named_list(db, "Item")?;
    Ok(())
}

fn refresh_levels(db: &DbState, state: &mut ActionUiState) -> Result<()> {
    state.cache_levels = db_named_list(db, "Level")?;
    Ok(())
}

/* ----------------------------- DB helpers: Actions ----------------------------- */

fn db_action_list(db: &DbState) -> Result<Vec<ActionRow>> {
    let mut conn_guard = db.conn.lock().expect("db conn mutex poisoned");
    let conn = conn_guard
        .as_mut()
        .context("SQLite connection is not available")?;

    let mut stmt = conn.prepare(
        r#"
        SELECT
          id,
          name,
          stamina_cost,
          additional_costs,
          action_type,
          rules_description,
          flavor_description
        FROM Action
        ORDER BY name ASC, id ASC
        "#,
    )?;

    let rows = stmt
        .query_map([], |row| {
            let action_type_str: String = row.get(4)?;
            let action_type = ActionType::from_str(&action_type_str).ok_or_else(|| {
                rusqlite::Error::FromSqlConversionFailure(
                    4,
                    rusqlite::types::Type::Text,
                    Box::new(std::io::Error::new(
                        std::io::ErrorKind::InvalidData,
                        format!("Unknown action_type: {action_type_str}"),
                    )),
                )
            })?;

            Ok(ActionRow {
                id: row.get(0)?,
                name: row.get(1)?,
                stamina_cost: row.get(2)?,
                additional_costs: row.get(3)?,
                action_type,
                rules_description: row.get(5)?,
                flavor_description: row.get(6)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;

    Ok(rows)
}

fn db_action_get(db: &DbState, id: i64) -> Result<ActionRow> {
    let mut conn_guard = db.conn.lock().expect("db conn mutex poisoned");
    let conn = conn_guard
        .as_mut()
        .context("SQLite connection is not available")?;

    let mut stmt = conn.prepare(
        r#"
        SELECT
          id,
          name,
          stamina_cost,
          additional_costs,
          action_type,
          rules_description,
          flavor_description
        FROM Action
        WHERE id = ?1
        "#,
    )?;

    let row = stmt.query_row(params![id], |row| {
        let action_type_str: String = row.get(4)?;
        let action_type = ActionType::from_str(&action_type_str).ok_or_else(|| {
            rusqlite::Error::FromSqlConversionFailure(
                4,
                rusqlite::types::Type::Text,
                Box::new(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    format!("Unknown action_type: {action_type_str}"),
                )),
            )
        })?;

        Ok(ActionRow {
            id: row.get(0)?,
            name: row.get(1)?,
            stamina_cost: row.get(2)?,
            additional_costs: row.get(3)?,
            action_type,
            rules_description: row.get(5)?,
            flavor_description: row.get(6)?,
        })
    })?;

    Ok(row)
}

fn db_action_insert(
    db: &DbState,
    name: &str,
    stamina_cost: i32,
    additional_costs: &str,
    action_type: ActionType,
    rules_description: &str,
    flavor_description: &str,
) -> Result<i64> {
    let mut conn_guard = db.conn.lock().expect("db conn mutex poisoned");
    let conn = conn_guard
        .as_mut()
        .context("SQLite connection is not available")?;

    conn.execute(
        r#"
        INSERT INTO Action (
            name,
            stamina_cost,
            additional_costs,
            action_type,
            rules_description,
            flavor_description
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6)
        "#,
        params![
            name,
            stamina_cost,
            additional_costs,
            action_type.as_str(),
            rules_description,
            flavor_description
        ],
    )?;

    Ok(conn.last_insert_rowid())
}

fn db_action_update(
    db: &DbState,
    id: i64,
    name: &str,
    stamina_cost: i32,
    additional_costs: &str,
    action_type: ActionType,
    rules_description: &str,
    flavor_description: &str,
) -> Result<()> {
    let mut conn_guard = db.conn.lock().expect("db conn mutex poisoned");
    let conn = conn_guard
        .as_mut()
        .context("SQLite connection is not available")?;

    let changed = conn.execute(
        r#"
        UPDATE Action
        SET
            name = ?2,
            stamina_cost = ?3,
            additional_costs = ?4,
            action_type = ?5,
            rules_description = ?6,
            flavor_description = ?7
        WHERE id = ?1
        "#,
        params![
            id,
            name,
            stamina_cost,
            additional_costs,
            action_type.as_str(),
            rules_description,
            flavor_description
        ],
    )?;

    if changed == 0 {
        return Err(anyhow!("Action not found: id={id}"));
    }

    Ok(())
}

fn db_action_delete(db: &DbState, id: i64) -> Result<()> {
    let mut conn_guard = db.conn.lock().expect("db conn mutex poisoned");
    let conn = conn_guard
        .as_mut()
        .context("SQLite connection is not available")?;

    conn.execute("DELETE FROM Action WHERE id = ?1", params![id])?;
    Ok(())
}

fn load_action_into_edit_state(db: &DbState, state: &mut ActionUiState, id: i64) -> Result<()> {
    let row = db_action_get(db, id)?;

    state.edit_name = row.name;
    state.edit_stamina_cost = row.stamina_cost;
    state.edit_additional_costs = row.additional_costs;
    state.edit_action_type = row.action_type;
    state.edit_rules_description = row.rules_description;
    state.edit_flavor_description = row.flavor_description;

    Ok(())
}

/* ----------------------------- DB helpers: Named lists ----------------------------- */

fn db_named_list(db: &DbState, table: &str) -> Result<Vec<NamedId>> {
    // This is intentionally limited to known tables; we do not accept arbitrary user input.
    let sql = match table {
        "Unit" => "SELECT id, name FROM Unit ORDER BY name ASC, id ASC",
        "Item" => "SELECT id, name FROM Item ORDER BY name ASC, id ASC",
        "Level" => "SELECT id, name FROM Level ORDER BY name ASC, id ASC",
        _ => return Err(anyhow!("Unsupported table for named list: {table}")),
    };

    let mut conn_guard = db.conn.lock().expect("db conn mutex poisoned");
    let conn = conn_guard
        .as_mut()
        .context("SQLite connection is not available")?;

    let mut stmt = conn.prepare(sql)?;
    let rows = stmt
        .query_map([], |row| {
            Ok(NamedId {
                id: row.get(0)?,
                name: row.get(1)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;

    Ok(rows)
}

/* ----------------------------- DB helpers: Associations ----------------------------- */

#[derive(Debug, Clone)]
struct AssocRow {
    owner_kind: String, // "Unit" | "Item" | "Level"
    owner_id: i64,
    owner_name: String,
}

fn db_assoc_add_unit_action(db: &DbState, unit_id: i64, action_id: i64) -> Result<()> {
    let mut conn_guard = db.conn.lock().expect("db conn mutex poisoned");
    let conn = conn_guard
        .as_mut()
        .context("SQLite connection is not available")?;
    conn.execute(
        "INSERT OR IGNORE INTO UnitAction (unit_id, action_id) VALUES (?1, ?2)",
        params![unit_id, action_id],
    )?;
    Ok(())
}

fn db_assoc_add_item_action(db: &DbState, item_id: i64, action_id: i64) -> Result<()> {
    let mut conn_guard = db.conn.lock().expect("db conn mutex poisoned");
    let conn = conn_guard
        .as_mut()
        .context("SQLite connection is not available")?;
    conn.execute(
        "INSERT OR IGNORE INTO ItemAction (item_id, action_id) VALUES (?1, ?2)",
        params![item_id, action_id],
    )?;
    Ok(())
}

fn db_assoc_add_level_action(db: &DbState, level_id: i64, action_id: i64) -> Result<()> {
    let mut conn_guard = db.conn.lock().expect("db conn mutex poisoned");
    let conn = conn_guard
        .as_mut()
        .context("SQLite connection is not available")?;
    conn.execute(
        "INSERT OR IGNORE INTO LevelAction (level_id, action_id) VALUES (?1, ?2)",
        params![level_id, action_id],
    )?;
    Ok(())
}

fn db_assoc_remove_unit_action(db: &DbState, unit_id: i64, action_id: i64) -> Result<()> {
    let mut conn_guard = db.conn.lock().expect("db conn mutex poisoned");
    let conn = conn_guard
        .as_mut()
        .context("SQLite connection is not available")?;
    conn.execute(
        "DELETE FROM UnitAction WHERE unit_id = ?1 AND action_id = ?2",
        params![unit_id, action_id],
    )?;
    Ok(())
}

fn db_assoc_remove_item_action(db: &DbState, item_id: i64, action_id: i64) -> Result<()> {
    let mut conn_guard = db.conn.lock().expect("db conn mutex poisoned");
    let conn = conn_guard
        .as_mut()
        .context("SQLite connection is not available")?;
    conn.execute(
        "DELETE FROM ItemAction WHERE item_id = ?1 AND action_id = ?2",
        params![item_id, action_id],
    )?;
    Ok(())
}

fn db_assoc_remove_level_action(db: &DbState, level_id: i64, action_id: i64) -> Result<()> {
    let mut conn_guard = db.conn.lock().expect("db conn mutex poisoned");
    let conn = conn_guard
        .as_mut()
        .context("SQLite connection is not available")?;
    conn.execute(
        "DELETE FROM LevelAction WHERE level_id = ?1 AND action_id = ?2",
        params![level_id, action_id],
    )?;
    Ok(())
}

fn db_assoc_list_for_action(db: &DbState, action_id: i64) -> Result<Vec<AssocRow>> {
    let mut conn_guard = db.conn.lock().expect("db conn mutex poisoned");
    let conn = conn_guard
        .as_mut()
        .context("SQLite connection is not available")?;

    // Use UNION ALL to create a unified view across owner kinds.
    // This yields: owner_kind, owner_id, owner_name
    let mut stmt = conn.prepare(
        r#"
        SELECT 'Unit' AS owner_kind, u.id AS owner_id, u.name AS owner_name
        FROM UnitAction ua
        JOIN Unit u ON u.id = ua.unit_id
        WHERE ua.action_id = ?1
        UNION ALL
        SELECT 'Item' AS owner_kind, i.id AS owner_id, i.name AS owner_name
        FROM ItemAction ia
        JOIN Item i ON i.id = ia.item_id
        WHERE ia.action_id = ?1
        UNION ALL
        SELECT 'Level' AS owner_kind, l.id AS owner_id, l.name AS owner_name
        FROM LevelAction la
        JOIN Level l ON l.id = la.level_id
        WHERE la.action_id = ?1
        ORDER BY owner_kind ASC, owner_name ASC, owner_id ASC
        "#,
    )?;

    let rows = stmt
        .query_map(params![action_id], |row| {
            Ok(AssocRow {
                owner_kind: row.get(0)?,
                owner_id: row.get(1)?,
                owner_name: row.get(2)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;

    Ok(rows)
}
