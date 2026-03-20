use bevy_egui::egui;

use crate::{AppRoute, Route};

/// Renders a shared placeholder page with a title and a "Back to Main Menu" button.
pub fn render(ui: &mut egui::Ui, route: &mut AppRoute, title: &str) {
    ui.vertical(|ui| {
        ui.heading(title);
        ui.add_space(8.0);
        ui.label("Empty page (placeholder).");
        ui.add_space(16.0);

        if ui.button("Back to Main Menu").clicked() {
            route.current = Route::MainMenu;
        }
    });
}
