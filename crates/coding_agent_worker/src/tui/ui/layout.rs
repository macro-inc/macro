use chrono::{DateTime, Utc};
use ratatui::Frame;
use ratatui::layout::Rect;
use ratatui::style::Style;
use ratatui::text::{Line, Span};
use ratatui::widgets::Paragraph;
use tui_input::Input;

use super::theme::{DIM, ERR, OK, WARN};

pub(super) fn render_input(frame: &mut Frame, input: &Input, area: Rect, style: Style) {
    let width = area.width.saturating_sub(1).max(1) as usize;
    let scroll = input.visual_scroll(width);
    frame.render_widget(
        Paragraph::new(input.value())
            .style(style)
            .scroll((0, scroll as u16)),
        area,
    );
    let cursor = input.visual_cursor().max(scroll) - scroll;
    frame.set_cursor_position((area.x + cursor as u16, area.y));
}

pub(super) fn field<'a>(label: &str, value: Span<'a>) -> Line<'a> {
    Line::from(vec![
        Span::styled(format!("{label:<16}"), Style::new().fg(DIM)),
        value,
    ])
}

pub(super) fn status_style(status: &str) -> Style {
    // The session status vocabulary: `event` is a live session, `no_messages`
    // one that never heard anything, `disconnected` one whose runtime is gone.
    match status {
        "event" => Style::new().fg(OK),
        "no_messages" => Style::new().fg(DIM),
        "disconnected" => Style::new().fg(ERR),
        _ => Style::new().fg(WARN),
    }
}

pub(super) fn ago(when: DateTime<Utc>) -> String {
    let seconds = (Utc::now() - when).num_seconds().max(0);
    match seconds {
        0..=59 => format!("{seconds}s ago"),
        60..=3599 => format!("{}m ago", seconds / 60),
        3600..=86_399 => format!("{}h ago", seconds / 3600),
        _ => format!("{}d ago", seconds / 86_400),
    }
}

pub(super) fn centered(width: u16, height: u16, area: Rect) -> Rect {
    let width = width.min(area.width.saturating_sub(2));
    let height = height.min(area.height.saturating_sub(2));
    Rect {
        x: area.x + (area.width.saturating_sub(width)) / 2,
        y: area.y + (area.height.saturating_sub(height)) / 2,
        width,
        height,
    }
}
