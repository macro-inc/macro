//! Rendering for the macrod control panel. Pure: reads [`App`], draws frames.

mod layout;
mod modals;
mod pages;
mod quickstart;
mod shell;
mod theme;

use ratatui::Frame;
use ratatui::layout::{Constraint, Direction, Layout};

use super::app::{App, Mode};

pub(crate) use quickstart::render_quickstart;

pub(crate) fn render(frame: &mut Frame, app: &App) {
    theme::render_background(frame);
    let [header, tabs, body, footer] = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3),
            Constraint::Length(1),
            Constraint::Min(3),
            Constraint::Length(1),
        ])
        .areas(frame.area());

    shell::render_header(frame, app, header);
    shell::render_tabs(frame, app, tabs);
    pages::render(frame, app, body);
    shell::render_footer(frame, app, footer);

    match &app.mode {
        Mode::ConfirmDelete => modals::render_confirm_delete(frame, app),
        Mode::Pairing { created, .. } => modals::render_pairing(frame, app, created),
        Mode::AgentPicker { selected } => {
            modals::render_agent_picker(frame, &app.agents, *selected)
        }
        Mode::CustomAgent { buffer } => modals::render_custom_agent(frame, buffer),
        Mode::Normal | Mode::EditSetting { .. } => {}
    }
}
