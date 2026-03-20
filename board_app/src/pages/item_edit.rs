use anyhow::{Context, Result};
use bevy::prelude::Resource;
use bevy_egui::egui;
use rusqlite::params;

use crate::models::item::ItemRow;
use crate::{AppRoute, DbState, Route};

/// UI state for the Item Edit page (create form + transient errors).
#[derive(Resource, Default)]
pub struct ItemUiState {
    pub new_name: String,
    pub new_strength: i32,
    pub new_agility: i32,
    pub new_focus: i32,
    pub new_intelligence: i32,
    pub new_charisma: i32,
    pub new_knowledge: i32,
    pub new_rules_description: String,
    pub new_flavor_description: String,
    pub last_error: Option<String>,
}

/// Renders the Item Edit page:
/// - lists all items in a table
/// - create new item form
/// - delete action per row
pub fn render(
    ui: &mut egui::Ui,
    route: &mut AppRoute,
    db: Option<&DbState>,
    state: &mut ItemUiState,
) {
    ui.heading("Item Edit");
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

    // Create new item form
    ui.group(|ui| {
        ui.label("Create Item");
        ui.add_space(6.0);

        ui.horizontal(|ui| {
            ui.label("Name");
            ui.text_edit_singleline(&mut state.new_name);
        });

        ui.horizontal(|ui| {
            ui.label("STR");
            ui.add(egui::DragValue::new(&mut state.new_strength).range(0..=999));
            ui.label("AGI");
            ui.add(egui::DragValue::new(&mut state.new_agility).range(0..=999));
            ui.label("FOC");
            ui.add(egui::DragValue::new(&mut state.new_focus).range(0..=999));
        });

        ui.horizontal(|ui| {
            ui.label("INT");
            ui.add(egui::DragValue::new(&mut state.new_intelligence).range(0..=999));
            ui.label("CHA");
            ui.add(egui::DragValue::new(&mut state.new_charisma).range(0..=999));
            ui.label("KNO");
            ui.add(egui::DragValue::new(&mut state.new_knowledge).range(0..=999));
        });

        ui.add_space(6.0);
        ui.label("Rules Description");
        ui.add(
            egui::TextEdit::multiline(&mut state.new_rules_description)
                .desired_rows(3)
                .hint_text("Mechanical rules / effects..."),
        );

        ui.add_space(6.0);
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

            let Some(db) = db else {
                state.last_error = Some("DB is not available".to_string());
                return;
            };

            match db_item_insert(
                db,
                state.new_name.trim(),
                state.new_strength,
                state.new_agility,
                state.new_focus,
                state.new_intelligence,
                state.new_charisma,
                state.new_knowledge,
                state.new_rules_description.trim(),
                state.new_flavor_description.trim(),
            ) {
                Ok(_new_id) => {
                    state.new_name.clear();
                    state.new_strength = 0;
                    state.new_agility = 0;
                    state.new_focus = 0;
                    state.new_intelligence = 0;
                    state.new_charisma = 0;
                    state.new_knowledge = 0;
                    state.new_rules_description.clear();
                    state.new_flavor_description.clear();
                }
                Err(e) => {
                    state.last_error = Some(format!("Create failed: {e:#}"));
                }
            }
        }
    });

    ui.add_space(12.0);

    // List items in a table
    let items = match db {
        Some(db) => match db_item_list(db) {
            Ok(rows) => rows,
            Err(e) => {
                state.last_error = Some(format!("List failed: {e:#}"));
                Vec::new()
            }
        },
        None => {
            state.last_error = Some("DB is not available".to_string());
            Vec::new()
        }
    };

    ui.label(format!("Items: {}", items.len()));
    ui.add_space(6.0);

    egui::ScrollArea::vertical()
        .auto_shrink([false; 2])
        .show(ui, |ui| {
            egui::Grid::new("item_table")
                .striped(true)
                .min_col_width(60.0)
                .show(ui, |ui| {
                    ui.strong("ID");
                    ui.strong("Name");
                    ui.strong("STR");
                    ui.strong("AGI");
                    ui.strong("FOC");
                    ui.strong("INT");
                    ui.strong("CHA");
                    ui.strong("KNO");
                    ui.strong("Rules");
                    ui.strong("Flavor");
                    ui.strong("Actions");
                    ui.end_row();

                    for it in items {
                        ui.label(it.id.to_string());
                        ui.label(&it.name);
                        ui.label(it.strength.to_string());
                        ui.label(it.agility.to_string());
                        ui.label(it.focus.to_string());
                        ui.label(it.intelligence.to_string());
                        ui.label(it.charisma.to_string());
                        ui.label(it.knowledge.to_string());

                        // Keep table compact: show truncated previews with hover-tooltips
                        let rules_preview = truncate_preview(&it.rules_description, 32);
                        let flavor_preview = truncate_preview(&it.flavor_description, 32);

                        ui.label(rules_preview).on_hover_text(it.rules_description);
                        ui.label(flavor_preview).on_hover_text(it.flavor_description);

                        let mut delete_clicked = false;
                        ui.horizontal(|ui| {
                            if ui.button("Delete").clicked() {
                                delete_clicked = true;
                            }
                        });

                        ui.end_row();

                        if delete_clicked {
                            state.last_error = None;

                            let Some(db) = db else {
                                state.last_error = Some("DB is not available".to_string());
                                continue;
                            };

                            if let Err(e) = db_item_delete(db, it.id) {
                                state.last_error = Some(format!("Delete failed: {e:#}"));
                            }
                        }
                    }
                });
        });
}

fn truncate_preview(s: &str, max_chars: usize) -> String {
    let s = s.trim();
    if s.chars().count() <= max_chars {
        return s.to_string();
    }

    let mut out = String::with_capacity(max_chars + 1);
    for (i, ch) in s.chars().enumerate() {
        if i >= max_chars {
            break;
        }
        out.push(ch);
    }
    out.push('…');
    out
}

/* ----------------------------- DB helpers ----------------------------- */

fn db_item_list(db: &DbState) -> Result<Vec<ItemRow>> {
    let mut conn_guard = db.conn.lock().expect("db conn mutex poisoned");
    let conn = conn_guard
        .as_mut()
        .context("SQLite connection is not available")?;

    let mut stmt = conn.prepare(
        r#"
        SELECT
          id,
          name,
          strength,
          agility,
          focus,
          intelligence,
          charisma,
          knowledge,
          rules_description,
          flavor_description
        FROM Item
        ORDER BY name ASC, id ASC
        "#,
    )?;

    let rows = stmt
        .query_map([], |row| {
            Ok(ItemRow {
                id: row.get(0)?,
                name: row.get(1)?,
                strength: row.get(2)?,
                agility: row.get(3)?,
                focus: row.get(4)?,
                intelligence: row.get(5)?,
                charisma: row.get(6)?,
                knowledge: row.get(7)?,
                rules_description: row.get(8)?,
                flavor_description: row.get(9)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;

    Ok(rows)
}

#[allow(clippy::too_many_arguments)]
fn db_item_insert(
    db: &DbState,
    name: &str,
    strength: i32,
    agility: i32,
    focus: i32,
    intelligence: i32,
    charisma: i32,
    knowledge: i32,
    rules_description: &str,
    flavor_description: &str,
) -> Result<i64> {
    let mut conn_guard = db.conn.lock().expect("db conn mutex poisoned");
    let conn = conn_guard
        .as_mut()
        .context("SQLite connection is not available")?;

    conn.execute(
        r#"
        INSERT INTO Item (
            name,
            strength,
            agility,
            focus,
            intelligence,
            charisma,
            knowledge,
            rules_description,
            flavor_description
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
        "#,
        params![
            name,
            strength,
            agility,
            focus,
            intelligence,
            charisma,
            knowledge,
            rules_description,
            flavor_description
        ],
    )?;

    Ok(conn.last_insert_rowid())
}

fn db_item_delete(db: &DbState, id: i64) -> Result<()> {
    let mut conn_guard = db.conn.lock().expect("db conn mutex poisoned");
    let conn = conn_guard
        .as_mut()
        .context("SQLite connection is not available")?;

    conn.execute("DELETE FROM Item WHERE id = ?1", params![id])?;
    Ok(())
}
