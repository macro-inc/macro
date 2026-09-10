mod config;
mod logs;
mod overview;
mod sessions;

use ratatui::Frame;
use ratatui::layout::Rect;

use crate::tui::app::{App, Tab};

pub(super) fn render(frame: &mut Frame, app: &App, area: Rect) {
    match app.tab {
        Tab::Overview => overview::render(frame, app, area),
        Tab::Sessions => sessions::render(frame, app, area),
        Tab::Config => config::render(frame, app, area),
        Tab::Logs => logs::render(frame, app, area),
    }
}
