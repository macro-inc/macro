use ratatui::Frame;
use ratatui::layout::Rect;
use ratatui::style::Style;
use ratatui::text::Line;
use ratatui::widgets::Paragraph;

use super::super::theme::{DIM, ERR, WARN, card};
use crate::tui::app::App;

pub(super) fn render(frame: &mut Frame, app: &App, area: Rect) {
    let capacity = area.height.saturating_sub(2) as usize;
    let lines: Vec<Line> = app
        .logs
        .tail(capacity.max(1))
        .into_iter()
        .map(|line| {
            let style = if line.contains("ERROR") {
                Style::new().fg(ERR)
            } else if line.contains("WARN") {
                Style::new().fg(WARN)
            } else {
                Style::new().fg(DIM)
            };
            Line::styled(line, style)
        })
        .collect();
    let body: Vec<Line> = if lines.is_empty() {
        vec![Line::styled(
            "Nothing logged yet - triggers and dials show up here.",
            Style::new().fg(DIM),
        )]
    } else {
        lines
    };
    frame.render_widget(Paragraph::new(body).block(card("Daemon logs")), area);
}
