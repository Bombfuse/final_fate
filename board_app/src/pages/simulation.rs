use anyhow::{Context, Result};
use bevy::prelude::Resource;
use bevy_egui::egui;
use rusqlite::params;

use crate::models::scenario::{AxialCoord, EditableGrid, TileOccupant, UnitPlacement};
use crate::{AppRoute, DbState, Route};

/// Simulation page state:
/// - lists scenarios from the DB
/// - allows selecting one and loading its associated grid
/// - renders the loaded grid (pointy-top, odd-r offset) with occupant icons
#[derive(Resource, Default)]
pub struct SimulationUiState {
    pub cache_scenarios: Vec<NamedScenario>,
    pub selected_scenario_id: Option<i64>,
    pub loaded: Option<LoadedScenario>,
    pub hex_radius: f32,
    pub last_error: Option<String>,
    pub last_info: Option<String>,
    pub did_initial_refresh: bool,
}

#[derive(Debug, Clone)]
pub struct NamedScenario {
    pub id: i64,
    pub name: String,
}

#[derive(Debug, Clone)]
pub struct LoadedScenario {
    pub scenario_id: i64,
    pub scenario_name: String,
    pub scenario_description: String,
    pub grid: EditableGrid,
}

pub fn render(
    ui: &mut egui::Ui,
    route: &mut AppRoute,
    db: Option<&DbState>,
    state: &mut SimulationUiState,
) {
    ui.heading("Simulation");
    ui.add_space(8.0);

    if ui.button("Back to Main Menu").clicked() {
        route.current = Route::MainMenu;
        return;
    }

    ui.add_space(8.0);

    if let Some(err) = state.last_error.take() {
        ui.colored_label(egui::Color32::from_rgb(220, 80, 80), err);
    }
    if let Some(info) = state.last_info.take() {
        ui.colored_label(egui::Color32::from_rgb(90, 200, 120), info);
    }

    let Some(db) = db else {
        ui.colored_label(egui::Color32::from_rgb(220, 80, 80), "DB is not available");
        return;
    };

    // Initial refresh once.
    if !state.did_initial_refresh {
        state.did_initial_refresh = true;
        if let Err(e) = refresh_scenarios(db, state) {
            state.last_error = Some(format!("Failed to load scenarios: {e:#}"));
        }
    }

    ui.horizontal(|ui| {
        if ui.button("Refresh Scenarios").clicked() {
            state.last_error = None;
            if let Err(e) = refresh_scenarios(db, state) {
                state.last_error = Some(format!("Refresh failed: {e:#}"));
            }
        }

        ui.separator();
        ui.label("Hex size");
        ui.add(egui::DragValue::new(&mut state.hex_radius).range(8.0..=40.0));
    });

    ui.add_space(10.0);

    ui.columns(2, |cols| {
        // LEFT: scenario selection + load
        cols[0].group(|ui| {
            ui.label("Choose Scenario");
            ui.add_space(6.0);

            let selected_name = state
                .selected_scenario_id
                .and_then(|id| state.cache_scenarios.iter().find(|s| s.id == id))
                .map(|s| s.name.clone())
                .unwrap_or_else(|| "<select>".to_string());

            egui::ComboBox::from_id_source("simulation_scenario_select")
                .selected_text(selected_name)
                .show_ui(ui, |ui| {
                    for s in &state.cache_scenarios {
                        ui.selectable_value(&mut state.selected_scenario_id, Some(s.id), &s.name);
                    }
                });

            ui.add_space(8.0);

            let can_load = state.selected_scenario_id.is_some();
            if ui
                .add_enabled(can_load, egui::Button::new("Start Simulation"))
                .clicked()
            {
                state.last_error = None;
                let sid = match state.selected_scenario_id {
                    Some(v) => v,
                    None => {
                        state.last_error = Some("Select a scenario first".to_string());
                        return;
                    }
                };

                match load_scenario(db, sid) {
                    Ok(loaded) => {
                        state.loaded = Some(loaded.clone());
                        state.last_info = Some(format!("Loaded scenario #{}.", loaded.scenario_id));
                    }
                    Err(e) => state.last_error = Some(format!("Load failed: {e:#}")),
                }
            }

            ui.add_space(10.0);
            ui.separator();
            ui.add_space(10.0);

            if let Some(loaded) = state.loaded.as_ref() {
                ui.label("Loaded");
                ui.add_space(6.0);
                ui.weak(format!(
                    "Scenario: #{} {}",
                    loaded.scenario_id, loaded.scenario_name
                ));
                ui.weak(format!(
                    "Grid: {}x{} (id={})",
                    loaded.grid.width,
                    loaded.grid.height,
                    loaded
                        .grid
                        .grid_id
                        .map(|id| id.to_string())
                        .unwrap_or_else(|| "?".to_string())
                ));

                ui.add_space(6.0);
                ui.label("Description");
                ui.add(
                    egui::TextEdit::multiline(&mut loaded.scenario_description.clone())
                        .desired_rows(6)
                        .interactive(false),
                );
            } else {
                ui.weak("No scenario loaded yet.");
            }
        });

        // RIGHT: render loaded grid
        cols[1].group(|ui| {
            ui.label("Grid View");
            ui.add_space(6.0);

            let Some(loaded) = state.loaded.as_ref() else {
                ui.weak("Start a simulation to load and view a scenario grid.");
                return;
            };

            let avail = ui.available_size();
            let desired = egui::vec2(avail.x, avail.y.max(520.0));
            let (rect, _response) = ui.allocate_exact_size(desired, egui::Sense::hover());

            let painter = ui.painter_at(rect);
            painter.rect_filled(rect, 6.0, egui::Color32::from_rgb(18, 18, 20));

            let radius = state.hex_radius;
            let border_color = egui::Color32::from_rgb(55, 55, 60);
            let fill_color = egui::Color32::from_rgb(28, 28, 32);

            let grid_px =
                hex_grid_bounds_pointy_top_odd_r(loaded.grid.width, loaded.grid.height, radius);
            let origin = egui::pos2(
                rect.center().x - grid_px.x * 0.5,
                rect.center().y - grid_px.y * 0.5,
            );

            for r in 0..loaded.grid.height {
                for q in 0..loaded.grid.width {
                    let c = AxialCoord::new(q, r);
                    let center = offset_to_world_pointy_top_odd_r_ui(origin, c, radius);

                    draw_hex_pointy_top(&painter, center, radius, fill_color, border_color);

                    if let Some(occ) = loaded.grid.get(c).flatten() {
                        match occ {
                            TileOccupant::Unit(_placement) => {
                                // NPB is a per-tile flag; render with the same person icon for now.
                                // (If you want, we can tint NPB units differently later.)
                                draw_person_icon(&painter, center, radius)
                            }
                            TileOccupant::Item(_iid) => draw_item_icon(&painter, center, radius),
                        }
                    }
                }
            }
        });
    });
}

/* ----------------------------- DB helpers ----------------------------- */

fn refresh_scenarios(db: &DbState, state: &mut SimulationUiState) -> Result<()> {
    state.cache_scenarios = db_scenario_named_list(db)?;
    // If selected scenario no longer exists, clear selection.
    if let Some(sel) = state.selected_scenario_id {
        if !state.cache_scenarios.iter().any(|s| s.id == sel) {
            state.selected_scenario_id = None;
        }
    }
    Ok(())
}

fn db_scenario_named_list(db: &DbState) -> Result<Vec<NamedScenario>> {
    let mut conn_guard = db.conn.lock().expect("db conn mutex poisoned");
    let conn = conn_guard
        .as_mut()
        .context("SQLite connection is not available")?;

    let mut stmt = conn.prepare("SELECT id, name FROM Scenario ORDER BY name ASC, id ASC")?;
    let rows = stmt
        .query_map([], |row| {
            Ok(NamedScenario {
                id: row.get(0)?,
                name: row.get(1)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;

    Ok(rows)
}

fn load_scenario(db: &DbState, scenario_id: i64) -> Result<LoadedScenario> {
    let mut conn_guard = db.conn.lock().expect("db conn mutex poisoned");
    let conn = conn_guard
        .as_mut()
        .context("SQLite connection is not available")?;

    let (s_name, s_desc, grid_id): (String, String, i64) = conn.query_row(
        "SELECT name, description, grid_id FROM Scenario WHERE id = ?1",
        params![scenario_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )?;

    let (grid_name, width, height): (String, i32, i32) = conn.query_row(
        "SELECT name, width, height FROM Grid WHERE id = ?1",
        params![grid_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )?;

    let mut grid = EditableGrid::new(width, height);
    grid.grid_id = Some(grid_id);
    grid.name = grid_name;

    let mut stmt = conn.prepare(
        r#"
        SELECT q, r, unit_id, item_id, grid_unit_is_npb
        FROM GridTile
        WHERE grid_id = ?1
        "#,
    )?;

    let tiles = stmt
        .query_map(params![grid_id], |row| {
            let q: i32 = row.get(0)?;
            let r: i32 = row.get(1)?;
            let unit_id: Option<i64> = row.get(2)?;
            let item_id: Option<i64> = row.get(3)?;
            let is_npb_i: i32 = row.get(4)?;
            Ok((q, r, unit_id, item_id, is_npb_i != 0))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;

    for (q, r, unit_id, item_id, is_npb) in tiles {
        let c = AxialCoord::new(q, r);
        let occ = match (unit_id, item_id) {
            (Some(uid), None) => Some(TileOccupant::Unit(UnitPlacement::new(uid, is_npb))),
            (None, Some(iid)) => Some(TileOccupant::Item(iid)),
            _ => None,
        };
        grid.set(c, occ);
    }

    Ok(LoadedScenario {
        scenario_id,
        scenario_name: s_name,
        scenario_description: s_desc,
        grid,
    })
}

/* ----------------------------- Rendering helpers ----------------------------- */

fn draw_hex_pointy_top(
    p: &egui::Painter,
    center: egui::Pos2,
    radius: f32,
    fill: egui::Color32,
    border: egui::Color32,
) {
    let pts = hex_points_pointy_top(center, radius);
    p.add(egui::Shape::convex_polygon(
        pts.clone(),
        fill,
        egui::Stroke::NONE,
    ));
    p.add(egui::Shape::closed_line(
        pts,
        egui::Stroke::new(1.0, border),
    ));
}

fn hex_points_pointy_top(center: egui::Pos2, radius: f32) -> Vec<egui::Pos2> {
    // Pointy-top: angles 30°, 90°, 150°, ...
    let mut pts = Vec::with_capacity(6);
    for i in 0..6 {
        let angle = (i as f32) * std::f32::consts::TAU / 6.0 + std::f32::consts::TAU / 12.0;
        pts.push(egui::pos2(
            center.x + radius * angle.cos(),
            center.y + radius * angle.sin(),
        ));
    }
    pts
}

fn offset_to_world_pointy_top_odd_r_ui(
    origin: egui::Pos2,
    c: AxialCoord,
    radius: f32,
) -> egui::Pos2 {
    // Pointy-top, odd-r offset: rows are offset horizontally.
    // x = size * sqrt(3) * (col + 0.5*(row&1))
    // y = size * 3/2 * row
    let col = c.q as f32;
    let row = c.r as f32;
    let x = radius * (3.0_f32).sqrt() * (col + 0.5 * ((c.r & 1) as f32));
    let y = radius * 1.5 * row;
    egui::pos2(origin.x + x, origin.y + y)
}

fn hex_grid_bounds_pointy_top_odd_r(width: i32, height: i32, radius: f32) -> egui::Vec2 {
    if width <= 0 || height <= 0 {
        return egui::vec2(0.0, 0.0);
    }

    // Horizontal: last col plus possible +0.5 offset on odd rows; +2*radius for vertex extent.
    let w = radius * (3.0_f32).sqrt() * (width as f32 - 1.0 + 0.5) + radius * 2.0;

    // Vertical: 1.5*radius*(height-1) plus 2*radius for vertex extent.
    let h = radius * 1.5 * (height as f32 - 1.0) + radius * 2.0;

    egui::vec2(w, h)
}

fn draw_person_icon(p: &egui::Painter, center: egui::Pos2, radius: f32) {
    let head_r = radius * 0.18;
    let head_center = egui::pos2(center.x, center.y - radius * 0.18);
    let stroke = egui::Stroke::new(2.0, egui::Color32::from_rgb(230, 230, 240));

    p.circle_stroke(head_center, head_r, stroke);
    p.line_segment(
        [
            egui::pos2(center.x, center.y - radius * 0.02),
            egui::pos2(center.x, center.y + radius * 0.26),
        ],
        stroke,
    );
    p.line_segment(
        [
            egui::pos2(center.x - radius * 0.18, center.y + radius * 0.10),
            egui::pos2(center.x + radius * 0.18, center.y + radius * 0.10),
        ],
        stroke,
    );
    p.line_segment(
        [
            egui::pos2(center.x, center.y + radius * 0.26),
            egui::pos2(center.x - radius * 0.14, center.y + radius * 0.40),
        ],
        stroke,
    );
    p.line_segment(
        [
            egui::pos2(center.x, center.y + radius * 0.26),
            egui::pos2(center.x + radius * 0.14, center.y + radius * 0.40),
        ],
        stroke,
    );
}

fn draw_item_icon(p: &egui::Painter, center: egui::Pos2, radius: f32) {
    let w = radius * 0.42;
    let h = radius * 0.34;
    let rect = egui::Rect::from_center_size(center, egui::vec2(w, h));
    let stroke = egui::Stroke::new(2.0, egui::Color32::from_rgb(240, 220, 120));

    p.rect_stroke(rect, 2.0, stroke);
    p.line_segment(
        [
            egui::pos2(rect.left(), rect.center().y - h * 0.15),
            egui::pos2(rect.right(), rect.center().y - h * 0.15),
        ],
        stroke,
    );
}
