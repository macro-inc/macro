use ratatui::Frame;
use ratatui::layout::{Constraint, Rect};
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Cell, Paragraph, Row, Table};

use super::super::layout::{ago, status_style};
use super::super::theme::{ACCENT, DIM, card};
use crate::tui::app::App;

pub(super) fn render(frame: &mut Frame, app: &App, area: Rect) {
    if app.snapshot.sessions.is_empty() {
        let message = if app.paired() {
            "No sessions yet - @mention a bound agent in a channel."
        } else {
            "Sessions appear here once paired."
        };
        frame.render_widget(
            Paragraph::new(Line::styled(message, Style::new().fg(DIM))).block(card("Sessions")),
            area,
        );
        return;
    }

    let header = Row::new(["Agent", "Session", "Status", "Model", "Owner", "Updated"])
        .style(Style::new().fg(DIM).add_modifier(Modifier::BOLD));
    let rows = app.snapshot.sessions.iter().map(|session| {
        Row::new(vec![
            Cell::from(Span::styled(
                format!("@{}", session.bot_handle),
                Style::new().fg(ACCENT),
            )),
            Cell::from(session.name.clone()),
            Cell::from(Span::styled(
                session.status.clone(),
                status_style(&session.status),
            )),
            Cell::from(session.model.clone()),
            Cell::from(Span::styled(session.owner_id.clone(), Style::new().fg(DIM))),
            Cell::from(ago(session.modified_at)),
        ])
    });
    let table = Table::new(
        rows,
        [
            Constraint::Length(14),
            Constraint::Min(18),
            Constraint::Length(14),
            Constraint::Length(12),
            Constraint::Min(16),
            Constraint::Length(10),
        ],
    )
    .header(header)
    .column_spacing(2)
    .block(card(format!("Sessions ({})", app.snapshot.sessions.len())));
    frame.render_widget(table, area);
}
