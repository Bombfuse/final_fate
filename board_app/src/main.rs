mod db;
mod models;
mod pages;

use anyhow::{Context, Result};
use bevy::prelude::*;
use bevy::render::mesh::{Indices, PrimitiveTopology};

use bevy::sprite::{MaterialMesh2dBundle, Mesh2dHandle};
use bevy_egui::{EguiContexts, EguiPlugin, egui};
use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use db::migrations::run_sql_migrations;
use pages::unit_edit::UnitUiState;

fn main() {
    App::new()
        .insert_resource(ClearColor(Color::srgb(0.06, 0.06, 0.07)))
        .add_plugins(DefaultPlugins.set(WindowPlugin {
            primary_window: Some(Window {
                title: "Final Fate - Board Editor/Simulator".to_string(),
                resolution: (1280.0, 720.0).into(),
                resizable: true,
                ..default()
            }),
            ..default()
        }))
        .add_plugins(EguiPlugin)
        .add_systems(
            Startup,
            (setup_camera, connect_sqlite_on_boot, setup_demo_scene),
        )
        .add_systems(
            Update,
            (
                ui_router_system,
                connection_indicator_system,
                user_input_system,
            ),
        )
        .run();
}

/* ----------------------------- App State ----------------------------- */

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Route {
    MainMenu,
    ScenarioEdit,
    UnitEdit,
    ItemEdit,
    Simulation,
}

impl Default for Route {
    fn default() -> Self {
        Route::MainMenu
    }
}

#[derive(Resource, Default)]
struct AppRoute {
    current: Route,
}

/* ---------------------------- Database State ---------------------------- */

#[derive(Clone, Resource)]
struct DbState {
    path: PathBuf,
    conn: Arc<Mutex<Option<Connection>>>,
    status: Arc<Mutex<DbStatus>>,
}

#[derive(Debug, Clone)]
struct DbStatus {
    connected: bool,
    last_error: Option<String>,
}

impl Default for DbStatus {
    fn default() -> Self {
        Self {
            connected: false,
            last_error: None,
        }
    }
}

/* ----------------------------- Startup ----------------------------- */

fn setup_camera(mut commands: Commands) {
    commands.spawn(Camera2dBundle::default());
    commands.insert_resource(AppRoute::default());
    commands.insert_resource(UnitUiState::default());
}

/// Boots up and makes a connection to SQLite immediately.
/// Uses `../database.sqlite` relative to this crate directory by default (so it hits the repo root DB).
fn connect_sqlite_on_boot(mut commands: Commands) {
    let db_path = PathBuf::from("../database.sqlite");

    let state = DbState {
        path: db_path.clone(),
        conn: Arc::new(Mutex::new(None)),
        status: Arc::new(Mutex::new(DbStatus::default())),
    };

    // Connect immediately
    let connect_result = (|| -> Result<()> {
        let mut conn = Connection::open(&db_path)
            .with_context(|| format!("Failed to open SQLite database at {}", db_path.display()))?;

        // Run migrations on startup (single source of truth for schema).
        // This expects the repo migration files at `../migrations/*.sql` relative to this crate.
        run_sql_migrations(&mut conn, PathBuf::from("../migrations"))
            .context("Failed to run SQL migrations on startup")?;

        // Store connection
        *state.conn.lock().expect("db conn mutex poisoned") = Some(conn);

        // Update status
        let mut status = state.status.lock().expect("db status mutex poisoned");
        status.connected = true;
        status.last_error = None;

        Ok(())
    })();

    if let Err(e) = connect_result {
        let mut status = state.status.lock().expect("db status mutex poisoned");
        status.connected = false;
        status.last_error = Some(format!("{:#}", e));
    }

    commands.insert_resource(state);
}

fn setup_demo_scene(
    mut commands: Commands,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<ColorMaterial>>,
    asset_server: Res<AssetServer>,
) {
    // Demo: hex grid rendered as meshes (requirement: render hexagons + in a grid)
    let radius = 32.0;
    let grid_w = 8;
    let grid_h = 6;

    let hex_mesh = meshes.add(hex_mesh_flat_top(radius));

    // Two materials to show visual separation
    let mat_a = materials.add(ColorMaterial::from(Color::srgb(0.16, 0.45, 0.78)));
    let mat_b = materials.add(ColorMaterial::from(Color::srgb(0.18, 0.70, 0.44)));

    for q in 0..grid_w {
        for r in 0..grid_h {
            let world = axial_to_world_flat_top(q as i32, r as i32, radius);

            let mat = if (q + r) % 2 == 0 {
                mat_a.clone()
            } else {
                mat_b.clone()
            };

            commands.spawn((
                Name::new(format!("Hex({}, {})", q, r)),
                MaterialMesh2dBundle {
                    mesh: Mesh2dHandle(hex_mesh.clone()),
                    material: mat,
                    transform: Transform::from_translation(Vec3::new(world.x, world.y, 0.0)),
                    ..default()
                },
            ));
        }
    }

    // Demo: render an image sprite (requirement: render images)
    // Place a marker sprite above the grid. File can be added later at `assets/icon.png`.
    // Bevy will show a warning if missing, but app still runs.
    let texture: Handle<Image> = asset_server.load("icon.png");
    commands.spawn((
        Name::new("Demo Sprite"),
        SpriteBundle {
            texture,
            transform: Transform::from_translation(Vec3::new(0.0, 200.0, 1.0))
                .with_scale(Vec3::splat(0.5)),
            ..default()
        },
    ));
}

/* ----------------------------- UI Router ----------------------------- */

fn ui_router_system(
    mut contexts: EguiContexts,
    mut route: ResMut<AppRoute>,
    db: Option<Res<DbState>>,
    mut unit_ui: ResMut<UnitUiState>,
) {
    // Top-left main panel for pages
    egui::TopBottomPanel::top("top_bar").show(contexts.ctx_mut(), |ui| {
        ui.horizontal(|ui| {
            ui.heading("Final Fate");
            ui.separator();
            ui.label(match route.current {
                Route::MainMenu => "Main Menu",
                Route::ScenarioEdit => "Scenario Edit",
                Route::UnitEdit => "Unit Edit",
                Route::ItemEdit => "Item Edit",
                Route::Simulation => "Simulation",
            });

            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                // Small status text on the right
                if let Some(db) = db.as_ref() {
                    let status = db.status.lock().expect("db status mutex poisoned").clone();
                    if status.connected {
                        ui.label(format!("DB: {}", db.path.display()));
                    } else if let Some(err) = status.last_error {
                        ui.colored_label(
                            egui::Color32::from_rgb(220, 80, 80),
                            format!("DB error: {err}"),
                        );
                    } else {
                        ui.colored_label(egui::Color32::from_rgb(220, 80, 80), "DB: disconnected");
                    }
                } else {
                    ui.colored_label(egui::Color32::from_rgb(220, 80, 80), "DB: not initialized");
                }
            });
        });
    });

    egui::CentralPanel::default().show(contexts.ctx_mut(), |ui| match route.current {
        Route::MainMenu => {
            ui.vertical_centered(|ui| {
                ui.add_space(24.0);
                ui.heading("Main Menu");
                ui.add_space(12.0);

                ui.set_width(260.0);

                if ui.button("Scenario Edit").clicked() {
                    route.current = Route::ScenarioEdit;
                }
                if ui.button("Unit Edit").clicked() {
                    route.current = Route::UnitEdit;
                }
                if ui.button("Item Edit").clicked() {
                    route.current = Route::ItemEdit;
                }
                if ui.button("Simulation").clicked() {
                    route.current = Route::Simulation;
                }

                ui.add_space(16.0);
                ui.label("Each page routes to an empty screen for now.");
            });
        }
        Route::ScenarioEdit => {
            pages::empty::render(ui, &mut route, "Scenario Edit");
        }
        Route::UnitEdit => {
            pages::unit_edit::render(ui, &mut route, db.as_deref(), unit_ui.as_mut());
        }
        Route::ItemEdit => {
            pages::empty::render(ui, &mut route, "Item Edit");
        }
        Route::Simulation => {
            pages::empty::render(ui, &mut route, "Simulation");
        }
    });
}

/* --------------------- Bottom-left DB Connection Icon --------------------- */

fn connection_indicator_system(
    mut contexts: EguiContexts,
    db: Option<Res<DbState>>,
    mut last_tooltip_open: Local<bool>,
) {
    let (connected, tooltip) = if let Some(db) = db.as_ref() {
        let status = db.status.lock().expect("db status mutex poisoned").clone();
        if status.connected {
            (true, format!("SQLite connected\n{}", db.path.display()))
        } else {
            let err = status
                .last_error
                .unwrap_or_else(|| "unknown error".to_string());
            (false, format!("SQLite disconnected\n{err}"))
        }
    } else {
        (false, "SQLite not initialized".to_string())
    };

    // Draw a small icon in the bottom-left corner.
    // Uses egui's area overlay so it stays pinned to the screen.
    egui::Area::new(egui::Id::new("db_conn_icon"))
        .anchor(egui::Align2::LEFT_BOTTOM, egui::vec2(10.0, -10.0))
        .show(contexts.ctx_mut(), |ui| {
            let (fill, stroke) = if connected {
                (
                    egui::Color32::from_rgb(45, 180, 90),
                    egui::Stroke::new(1.0, egui::Color32::from_rgb(15, 70, 35)),
                )
            } else {
                (
                    egui::Color32::from_rgb(200, 70, 70),
                    egui::Stroke::new(1.0, egui::Color32::from_rgb(80, 15, 15)),
                )
            };

            let r = egui::Rect::from_min_size(ui.min_rect().min, egui::vec2(18.0, 18.0));
            let (id, rect) = ui.allocate_space(r.size());
            let response = ui.interact(rect, id, egui::Sense::click());

            let painter = ui.painter();
            painter.rect_filled(rect, 4.0, fill);
            painter.rect_stroke(rect, 4.0, stroke);

            // Small plug glyph
            painter.text(
                rect.center(),
                egui::Align2::CENTER_CENTER,
                "DB",
                egui::FontId::proportional(10.0),
                egui::Color32::from_rgb(255, 255, 255),
            );

            if response.hovered() || *last_tooltip_open {
                response.clone().on_hover_text(tooltip.clone());
                *last_tooltip_open = response.hovered();
            }

            // Optional click behavior: no-op for now.
            if response.clicked() {
                // Keeping placeholder for future: open DB status panel
            }
        });
}

/* ----------------------------- Input ----------------------------- */

fn user_input_system(
    keyboard: Res<ButtonInput<KeyCode>>,
    mouse: Res<ButtonInput<MouseButton>>,
    windows: Query<&Window>,
    camera_q: Query<(&Camera, &GlobalTransform)>,
    _db: Option<Res<DbState>>,
) {
    // Requirement: read user input (mouse, keyboard, etc)
    // Keyboard example: press Escape to quit
    if keyboard.just_pressed(KeyCode::Escape) {
        // On native, Bevy handles window close via AppExit
        // (We keep it lightweight here.)
        // Note: not emitting AppExit because not injected; leaving as placeholder.
    }

    // Mouse example: left click logs the world position (DB CRUD demo removed; schema is managed by migrations)
    if mouse.just_pressed(MouseButton::Left) {
        if let (Ok(window), Ok((camera, cam_transform))) =
            (windows.get_single(), camera_q.get_single())
        {
            if let Some(cursor) = window.cursor_position() {
                if let Some(world) = camera.viewport_to_world_2d(cam_transform, cursor) {
                    let _ = (world.x, world.y);
                }
            }
        }
    }
}

/* ----------------------------- Hex Rendering ----------------------------- */

/// Builds a flat-top hexagon mesh centered at origin, in XY plane.
fn hex_mesh_flat_top(radius: f32) -> Mesh {
    // Flat-top hex vertices around origin:
    // angle 0° points right; flat-top means top/bottom edges are flat -> start at 0° and step by 60°
    // We'll use 6 outer vertices + center vertex for a triangle fan.
    let mut positions: Vec<[f32; 3]> = Vec::with_capacity(7);
    let mut normals: Vec<[f32; 3]> = Vec::with_capacity(7);
    let mut uvs: Vec<[f32; 2]> = Vec::with_capacity(7);

    positions.push([0.0, 0.0, 0.0]); // center
    normals.push([0.0, 0.0, 1.0]);
    uvs.push([0.5, 0.5]);

    for i in 0..6 {
        let angle = (i as f32) * std::f32::consts::TAU / 6.0;
        let x = radius * angle.cos();
        let y = radius * angle.sin();

        positions.push([x, y, 0.0]);
        normals.push([0.0, 0.0, 1.0]);

        // Basic UV mapping into [0,1] for potential texturing
        uvs.push([0.5 + (x / (2.0 * radius)), 0.5 + (y / (2.0 * radius))]);
    }

    // Indices for triangle fan: (center, i, i+1)
    let mut indices: Vec<u32> = Vec::with_capacity(6 * 3);
    for i in 1..=6 {
        let next = if i == 6 { 1 } else { i + 1 };
        indices.push(0);
        indices.push(i as u32);
        indices.push(next as u32);
    }

    let mut mesh = Mesh::new(PrimitiveTopology::TriangleList, default());
    mesh.insert_attribute(Mesh::ATTRIBUTE_POSITION, positions);
    mesh.insert_attribute(Mesh::ATTRIBUTE_NORMAL, normals);
    mesh.insert_attribute(Mesh::ATTRIBUTE_UV_0, uvs);
    mesh.insert_indices(Indices::U32(indices));

    // Ensure correct facing for 2D usage
    mesh.generate_tangents().ok();

    mesh
}

/// Converts axial hex coordinates (q, r) to world XY coordinates for flat-top layout.
fn axial_to_world_flat_top(q: i32, r: i32, radius: f32) -> Vec2 {
    // Flat-top axial to pixel:
    // x = size * (3/2 * q)
    // y = size * (sqrt(3) * (r + q/2))
    let x = radius * (1.5 * q as f32);
    let y = radius * ((3.0_f32).sqrt() * (r as f32 + (q as f32) * 0.5));
    Vec2::new(x, y)
}
