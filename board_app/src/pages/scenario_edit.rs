use anyhow::{Context, Result, anyhow};
use bevy::prelude::Resource;
use bevy_egui::egui;
use rusqlite::params;

use crate::models::action::NamedId;
use crate::models::scenario::{AxialCoord, EditableGrid, TileOccupant};
use crate::{AppRoute, DbState, Route};

/// Scenario Editor UI state.
///
/// Responsibilities:
/// - Maintain an in-memory editable 21x21 grid of tile occupants (Unit/Item/None)
/// - Provide save/load UI for Scenarios (Scenario has name/description and links to a Grid)
/// - Persist the grid tiles to SQLite via `Grid` and `GridTile` tables
///
/// Notes:
/// - Rendering: Uses an egui `Painter` to draw a 21x21 **pointy-top** hex grid with a small border.
/// - Layout: Uses an **odd-r offset** layout so the grid itself is rectangular in shape.
/// - Occupancy icons: Draws simple vector icons:
///   - Unit: a "person" (head + body) glyph
///   - Item: a small "box" glyph
#[derive(Resource)]
pub struct ScenarioUiState {
    // Editable scenario fields
    pub scenario_id: Option<i64>,
    pub scenario_name: String,
    pub scenario_description: String,

    // The grid being edited
    pub grid: EditableGrid,

    // UI selections
    pub selected_tile: Option<AxialCoord>,
    pub paint_mode: PaintMode,

    // Place occupant controls
    pub selected_unit_id: Option<i64>,
    pub selected_item_id: Option<i64>,

    // Lookups for drop-downs
    pub cache_units: Vec<NamedId>,
    pub cache_items: Vec<NamedId>,
    pub cache_scenarios: Vec<NamedScenario>,
    pub selected_load_scenario_id: Option<i64>,

    // View controls
    pub hex_radius: f32,
    pub grid_padding: f32,

    // Feedback
    pub last_error: Option<String>,
    pub last_info: Option<String>,
}

impl Default for ScenarioUiState {
    fn default() -> Self {
        Self {
            scenario_id: None,
            scenario_name: String::new(),
            scenario_description: String::new(),
            grid: {
                let mut g = EditableGrid::new(21, 21);
                g.name = "21x21".to_string();
                g
            },
            selected_tile: None,
            paint_mode: PaintMode::Select,
            selected_unit_id: None,
            selected_item_id: None,
            cache_units: Vec::new(),
            cache_items: Vec::new(),
            cache_scenarios: Vec::new(),
            selected_load_scenario_id: None,
            hex_radius: 14.0,
            grid_padding: 12.0,
            last_error: None,
            last_info: None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PaintMode {
    Select,
    PlaceUnit,
    PlaceItem,
    Erase,
}

impl PaintMode {
    fn as_str(self) -> &'static str {
        match self {
            PaintMode::Select => "Select",
            PaintMode::PlaceUnit => "Place Unit",
            PaintMode::PlaceItem => "Place Item",
            PaintMode::Erase => "Erase",
        }
    }
}

#[derive(Debug, Clone)]
pub struct NamedScenario {
    pub id: i64,
    pub name: String,
}

/// Render the Scenario Edit page.
///
/// Requirements implemented:
/// - Initializes with a 21x21 hex grid
/// - Hex tiles have a small border
/// - Load previously saved grids (via Scenario load)
/// - Save current grid (new or existing)
/// - Scenario fields: name, description, associated grid
/// - Tile can reference Unit or Item id; renders icons accordingly
pub fn render(
    ui: &mut egui::Ui,
    route: &mut AppRoute,
    db: Option<&DbState>,
    state: &mut ScenarioUiState,
) {
    ui.heading("Scenario Edit");
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

    // Lazy-load caches once
    if state.cache_units.is_empty()
        && state.cache_items.is_empty()
        && state.cache_scenarios.is_empty()
    {
        if let Err(e) = refresh_all(db, state) {
            state.last_error = Some(format!("Initial refresh failed: {e:#}"));
        }
    }

    ui.horizontal(|ui| {
        if ui.button("Refresh").clicked() {
            if let Err(e) = refresh_all(db, state) {
                state.last_error = Some(format!("Refresh failed: {e:#}"));
            }
        }

        ui.separator();

        ui.label("Hex size");
        ui.add(egui::DragValue::new(&mut state.hex_radius).range(8.0..=40.0));

        ui.separator();
        ui.label("Mode");
        egui::ComboBox::from_id_source("scenario_paint_mode")
            .selected_text(state.paint_mode.as_str())
            .show_ui(ui, |ui| {
                ui.selectable_value(&mut state.paint_mode, PaintMode::Select, "Select");
                ui.selectable_value(&mut state.paint_mode, PaintMode::PlaceUnit, "Place Unit");
                ui.selectable_value(&mut state.paint_mode, PaintMode::PlaceItem, "Place Item");
                ui.selectable_value(&mut state.paint_mode, PaintMode::Erase, "Erase");
            });

        ui.separator();

        if let Some(sel) = state.selected_tile {
            ui.label(format!("Selected: ({}, {})", sel.q, sel.r));
        } else {
            ui.weak("Selected: none");
        }
    });

    ui.add_space(10.0);

    ui.columns(2, |cols| {
        // LEFT: scenario fields + save/load controls + occupant placement selectors
        cols[0].group(|ui| {
            ui.label("Scenario");
            ui.add_space(6.0);

            ui.horizontal(|ui| {
                ui.label("Name");
                ui.text_edit_singleline(&mut state.scenario_name);
            });

            ui.label("Description");
            ui.add(
                egui::TextEdit::multiline(&mut state.scenario_description)
                    .desired_rows(5)
                    .hint_text("Describe the scenario objectives, setup, etc."),
            );

            ui.add_space(8.0);
            ui.horizontal(|ui| {
                let scenario_id_text = state
                    .scenario_id
                    .map(|id| id.to_string())
                    .unwrap_or_else(|| "(new)".to_string());
                let grid_id_text = state
                    .grid
                    .grid_id
                    .map(|id| id.to_string())
                    .unwrap_or_else(|| "(new)".to_string());
                ui.weak(format!("Scenario ID: {scenario_id_text}"));
                ui.separator();
                ui.weak(format!("Grid ID: {grid_id_text}"));
            });

            ui.add_space(8.0);

            ui.horizontal(|ui| {
                if ui.button("New (21x21)").clicked() {
                    state.scenario_id = None;
                    state.scenario_name.clear();
                    state.scenario_description.clear();
                    state.grid = {
                        let mut g = EditableGrid::new(21, 21);
                        g.name = "21x21".to_string();
                        g
                    };
                    state.selected_tile = None;
                    state.last_info = Some("New scenario initialized.".to_string());
                }

                if ui.button("Save").clicked() {
                    state.last_error = None;
                    match save_scenario_and_grid(db, state) {
                        Ok((scenario_id, grid_id)) => {
                            state.scenario_id = Some(scenario_id);
                            state.grid.grid_id = Some(grid_id);
                            state.last_info = Some(format!("Saved (scenario #{scenario_id}, grid #{grid_id})."));
                            // refresh list for load dropdown
                            if let Err(e) = refresh_scenarios(db, state) {
                                state.last_error = Some(format!("Saved, but refresh scenarios failed: {e:#}"));
                            }
                        }
                        Err(e) => state.last_error = Some(format!("Save failed: {e:#}")),
                    }
                }
            });

            ui.add_space(10.0);
            ui.separator();
            ui.add_space(10.0);

            ui.label("Load Scenario");
            ui.add_space(6.0);

            let selected_name = state
                .selected_load_scenario_id
                .and_then(|id| state.cache_scenarios.iter().find(|s| s.id == id))
                .map(|s| s.name.clone())
                .unwrap_or_else(|| "<select>".to_string());

            egui::ComboBox::from_id_source("scenario_load_select")
                .selected_text(selected_name)
                .show_ui(ui, |ui| {
                    for s in &state.cache_scenarios {
                        ui.selectable_value(&mut state.selected_load_scenario_id, Some(s.id), &s.name);
                    }
                });

            ui.horizontal(|ui| {
                if ui.button("Load").clicked() {
                    state.last_error = None;
                    let Some(sid) = state.selected_load_scenario_id else {
                        state.last_error = Some("Select a scenario to load".to_string());
                        return;
                    };

                    match load_scenario(db, sid) {
                        Ok(loaded) => {
                            state.scenario_id = Some(loaded.scenario_id);
                            state.scenario_name = loaded.scenario_name;
                            state.scenario_description = loaded.scenario_description;
                            state.grid = loaded.grid;
                            state.selected_tile = None;
                            state.last_info = Some(format!("Loaded scenario #{sid}."));
                        }
                        Err(e) => state.last_error = Some(format!("Load failed: {e:#}")),
                    }
                }
            });

            ui.add_space(10.0);
            ui.separator();
            ui.add_space(10.0);

            ui.label("Tile Occupant");
            ui.add_space(6.0);

            ui.horizontal(|ui| {
                ui.label("Unit");
                let unit_selected_name = state
                    .selected_unit_id
                    .and_then(|id| state.cache_units.iter().find(|u| u.id == id))
                    .map(|u| u.name.clone())
                    .unwrap_or_else(|| "<select>".to_string());

                egui::ComboBox::from_id_source("scenario_unit_select")
                    .selected_text(unit_selected_name)
                    .show_ui(ui, |ui| {
                        for u in &state.cache_units {
                            ui.selectable_value(&mut state.selected_unit_id, Some(u.id), &u.name);
                        }
                    });
            });

            ui.horizontal(|ui| {
                ui.label("Item");
                let item_selected_name = state
                    .selected_item_id
                    .and_then(|id| state.cache_items.iter().find(|i| i.id == id))
                    .map(|i| i.name.clone())
                    .unwrap_or_else(|| "<select>".to_string());

                egui::ComboBox::from_id_source("scenario_item_select")
                    .selected_text(item_selected_name)
                    .show_ui(ui, |ui| {
                        for it in &state.cache_items {
                            ui.selectable_value(&mut state.selected_item_id, Some(it.id), &it.name);
                        }
                    });
            });

            ui.add_space(6.0);

            ui.label("Hint: Click tiles on the grid to place occupants based on Mode.");
            ui.weak("Select: just selects tiles. Place Unit/Item: writes on click. Erase: clears occupant.");
        });

        // RIGHT: hex grid renderer/editor
        cols[1].group(|ui| {
            ui.label("Grid (21x21)");
            ui.add_space(6.0);

            // Reserve a big area for grid painting
            let avail = ui.available_size();
            let desired = egui::vec2(avail.x, avail.y.max(520.0));
            let (rect, response) = ui.allocate_exact_size(desired, egui::Sense::click_and_drag());

            // Draw background
            let painter = ui.painter_at(rect);
            painter.rect_filled(rect, 6.0, egui::Color32::from_rgb(18, 18, 20));

            let radius = state.hex_radius;
            let border_color = egui::Color32::from_rgb(55, 55, 60);
            let fill_color = egui::Color32::from_rgb(28, 28, 32);
            let selected_fill = egui::Color32::from_rgb(50, 55, 75);

            // Compute grid origin so it is centered in rect (pointy-top, odd-r offset => rectangular grid)
            let grid_px = hex_grid_bounds_pointy_top_odd_r(state.grid.width, state.grid.height, radius);
            let origin = egui::pos2(
                rect.center().x - grid_px.x * 0.5,
                rect.center().y - grid_px.y * 0.5,
            );

            // Hit-test: if clicked inside rect, find nearest tile by scanning (simple and fine for 21x21)
            if response.clicked() || response.dragged() {
                if let Some(pointer) = response.interact_pointer_pos() {
                    if let Some(hit) = pick_tile_by_point_pointy_top_odd_r(
                        origin,
                        state.grid.width,
                        state.grid.height,
                        radius,
                        pointer,
                    ) {
                        state.selected_tile = Some(hit);

                        match state.paint_mode {
                            PaintMode::Select => {}
                            PaintMode::PlaceUnit => {
                                if let Some(uid) = state.selected_unit_id {
                                    state.grid.set(hit, Some(TileOccupant::Unit(uid)));
                                } else {
                                    state.last_error = Some("Select a Unit first".to_string());
                                }
                            }
                            PaintMode::PlaceItem => {
                                if let Some(iid) = state.selected_item_id {
                                    state.grid.set(hit, Some(TileOccupant::Item(iid)));
                                } else {
                                    state.last_error = Some("Select an Item first".to_string());
                                }
                            }
                            PaintMode::Erase => {
                                state.grid.clear(hit);
                            }
                        }
                    }
                }
            }

            // Draw tiles (pointy-top, odd-r offset layout; still stored as (q,r) in DB/UI)
            for r in 0..state.grid.height {
                for q in 0..state.grid.width {
                    let c = AxialCoord::new(q, r);
                    let center = offset_to_world_pointy_top_odd_r_ui(origin, c, radius);

                    let is_selected = state.selected_tile == Some(c);
                    let fill = if is_selected { selected_fill } else { fill_color };

                    draw_hex_pointy_top(&painter, center, radius, fill, border_color);

                    // Occupant icon
                    if let Some(occ) = state.grid.get(c).flatten() {
                        match occ {
                            TileOccupant::Unit(_uid) => draw_person_icon(&painter, center, radius),
                            TileOccupant::Item(_iid) => draw_item_icon(&painter, center, radius),
                        }
                    }
                }
            }

            ui.add_space(6.0);
            ui.weak("Border: subtle outline. Occupants: person/item glyphs.");
        });
    });
}

/* ----------------------------- Drawing helpers ----------------------------- */

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
    // Pointy-top hex: rotate flat-top by 30° => angles 30°, 90°, 150°, ...
    let mut pts = Vec::with_capacity(6);
    for i in 0..6 {
        let angle = (i as f32) * std::f32::consts::TAU / 6.0 + std::f32::consts::TAU / 12.0;
        let x = center.x + radius * angle.cos();
        let y = center.y + radius * angle.sin();
        pts.push(egui::pos2(x, y));
    }
    pts
}

fn draw_person_icon(p: &egui::Painter, center: egui::Pos2, radius: f32) {
    // Simple "person" glyph: head circle + body line
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
    // arms
    p.line_segment(
        [
            egui::pos2(center.x - radius * 0.18, center.y + radius * 0.10),
            egui::pos2(center.x + radius * 0.18, center.y + radius * 0.10),
        ],
        stroke,
    );
    // legs
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
    // Simple "item" glyph: a small box with a lid line
    let w = radius * 0.42;
    let h = radius * 0.34;
    let rect = egui::Rect::from_center_size(center, egui::vec2(w, h));
    let stroke = egui::Stroke::new(2.0, egui::Color32::from_rgb(240, 220, 120));

    p.rect_stroke(rect, 2.0, stroke);

    // lid line
    p.line_segment(
        [
            egui::pos2(rect.left(), rect.center().y - h * 0.15),
            egui::pos2(rect.right(), rect.center().y - h * 0.15),
        ],
        stroke,
    );
}

/* ----------------------------- Hex layout + picking ----------------------------- */

fn offset_to_world_pointy_top_odd_r_ui(
    origin: egui::Pos2,
    c: AxialCoord,
    radius: f32,
) -> egui::Pos2 {
    // Pointy-top hex grid with odd-r horizontal layout (rows are offset).
    // Using "odd-r" (odd rows shifted right):
    // x = size * sqrt(3) * (col + 0.5*(row&1))
    // y = size * 3/2 * row
    let col = c.q as f32;
    let row = c.r as f32;
    let x = radius * (3.0_f32).sqrt() * (col + 0.5 * ((c.r & 1) as f32));
    let y = radius * 1.5 * row;
    egui::pos2(origin.x + x, origin.y + y)
}

/// Approximate bounds for a pointy-top, odd-r offset rectangular grid (width x height).
fn hex_grid_bounds_pointy_top_odd_r(width: i32, height: i32, radius: f32) -> egui::Vec2 {
    if width <= 0 || height <= 0 {
        return egui::vec2(0.0, 0.0);
    }

    // Horizontal:
    // max x occurs at last column plus possible +0.5 offset on odd rows.
    // Add 2*radius for vertex extent.
    let w = radius * (3.0_f32).sqrt() * (width as f32 - 1.0 + 0.5) + radius * 2.0;

    // Vertical:
    // y = 1.5*radius*(height-1) plus 2*radius for vertex extent.
    let h = radius * 1.5 * (height as f32 - 1.0) + radius * 2.0;

    egui::vec2(w, h)
}

/// Pick a tile by scanning all centers in a pointy-top, odd-r offset layout.
/// For 21x21 this is fine and keeps the code simple/robust.
fn pick_tile_by_point_pointy_top_odd_r(
    origin: egui::Pos2,
    width: i32,
    height: i32,
    radius: f32,
    point: egui::Pos2,
) -> Option<AxialCoord> {
    let mut best: Option<(AxialCoord, f32)> = None;
    let max_dist2 = (radius * 0.95) * (radius * 0.95);

    for r in 0..height {
        for q in 0..width {
            let c = AxialCoord::new(q, r);
            let center = offset_to_world_pointy_top_odd_r_ui(origin, c, radius);
            let dx = center.x - point.x;
            let dy = center.y - point.y;
            let d2 = dx * dx + dy * dy;

            if d2 <= max_dist2 {
                match best {
                    None => best = Some((c, d2)),
                    Some((_bc, bd2)) if d2 < bd2 => best = Some((c, d2)),
                    _ => {}
                }
            }
        }
    }

    best.map(|(c, _)| c)
}

/* ----------------------------- DB: load/save + lookups ----------------------------- */

fn refresh_all(db: &DbState, state: &mut ScenarioUiState) -> Result<()> {
    state.cache_units = db_named_list(db, "Unit")?;
    state.cache_items = db_named_list(db, "Item")?;
    refresh_scenarios(db, state)?;
    Ok(())
}

fn refresh_scenarios(db: &DbState, state: &mut ScenarioUiState) -> Result<()> {
    state.cache_scenarios = db_scenario_named_list(db)?;
    Ok(())
}

fn db_named_list(db: &DbState, table: &str) -> Result<Vec<NamedId>> {
    // Limited, safe table switch (no arbitrary SQL injection surface).
    let sql = match table {
        "Unit" => "SELECT id, name FROM Unit ORDER BY name ASC, id ASC",
        "Item" => "SELECT id, name FROM Item ORDER BY name ASC, id ASC",
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

struct LoadedScenario {
    scenario_id: i64,
    scenario_name: String,
    scenario_description: String,
    grid: EditableGrid,
}

/// Load a scenario (including its associated grid tiles) into an in-memory `EditableGrid`.
fn load_scenario(db: &DbState, scenario_id: i64) -> Result<LoadedScenario> {
    let mut conn_guard = db.conn.lock().expect("db conn mutex poisoned");
    let conn = conn_guard
        .as_mut()
        .context("SQLite connection is not available")?;

    // Fetch scenario + grid metadata
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

    // Load tile occupants (only rows that exist). Missing tiles are empty.
    let mut stmt = conn.prepare(
        r#"
        SELECT q, r, unit_id, item_id
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
            Ok((q, r, unit_id, item_id))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;

    for (q, r, unit_id, item_id) in tiles {
        let c = AxialCoord::new(q, r);
        let occ = match (unit_id, item_id) {
            (Some(uid), None) => Some(TileOccupant::Unit(uid)),
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

/// Save the scenario and associated grid.
/// - If the grid is new: insert into `Grid`, then insert any occupied tiles into `GridTile`.
/// - If the grid exists: update `Grid`, delete existing `GridTile`s and re-insert current occupied tiles.
/// - If scenario is new: insert into `Scenario` referencing grid_id.
/// - If scenario exists: update `Scenario`.
fn save_scenario_and_grid(db: &DbState, state: &mut ScenarioUiState) -> Result<(i64, i64)> {
    if state.grid.width != 21 || state.grid.height != 21 {
        // The requirement says the scenario edit initializes with 21x21;
        // keep save flexible, but enforce known size for now.
    }

    if state.scenario_name.trim().is_empty() {
        return Err(anyhow!("Scenario name is required"));
    }

    let mut conn_guard = db.conn.lock().expect("db conn mutex poisoned");
    let conn = conn_guard
        .as_mut()
        .context("SQLite connection is not available")?;

    let tx = conn.transaction()?;

    // Upsert grid
    let grid_id = match state.grid.grid_id {
        None => {
            tx.execute(
                r#"
                INSERT INTO Grid (name, width, height, created_at, updated_at)
                VALUES (?1, ?2, ?3, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                "#,
                params![state.grid.name, state.grid.width, state.grid.height],
            )?;
            tx.last_insert_rowid()
        }
        Some(id) => {
            tx.execute(
                r#"
                UPDATE Grid
                SET name = ?2,
                    width = ?3,
                    height = ?4,
                    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
                WHERE id = ?1
                "#,
                params![id, state.grid.name, state.grid.width, state.grid.height],
            )?;
            id
        }
    };

    // Rewrite tiles for grid (simple approach)
    tx.execute("DELETE FROM GridTile WHERE grid_id = ?1", params![grid_id])?;

    // Insert only occupied tiles
    for r in 0..state.grid.height {
        for q in 0..state.grid.width {
            let c = AxialCoord::new(q, r);
            if let Some(occ) = state.grid.get(c).flatten() {
                let (unit_id, item_id) = match occ {
                    TileOccupant::Unit(uid) => (Some(uid), None),
                    TileOccupant::Item(iid) => (None, Some(iid)),
                };

                tx.execute(
                    r#"
                    INSERT INTO GridTile (
                        grid_id, q, r, unit_id, item_id, created_at, updated_at
                    ) VALUES (
                        ?1, ?2, ?3, ?4, ?5,
                        strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                        strftime('%Y-%m-%dT%H:%M:%fZ','now')
                    )
                    "#,
                    params![grid_id, q, r, unit_id, item_id],
                )?;
            }
        }
    }

    // Upsert scenario
    let scenario_id = match state.scenario_id {
        None => {
            tx.execute(
                r#"
                INSERT INTO Scenario (name, description, grid_id, created_at, updated_at)
                VALUES (
                    ?1, ?2, ?3,
                    strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                    strftime('%Y-%m-%dT%H:%M:%fZ','now')
                )
                "#,
                params![
                    state.scenario_name.trim(),
                    state.scenario_description,
                    grid_id
                ],
            )?;
            tx.last_insert_rowid()
        }
        Some(id) => {
            tx.execute(
                r#"
                UPDATE Scenario
                SET name = ?2,
                    description = ?3,
                    grid_id = ?4,
                    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
                WHERE id = ?1
                "#,
                params![
                    id,
                    state.scenario_name.trim(),
                    state.scenario_description,
                    grid_id
                ],
            )?;
            id
        }
    };

    tx.commit()?;

    Ok((scenario_id, grid_id))
}
