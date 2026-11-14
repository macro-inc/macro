//! The monitor palette: black, amber ink, yellow for live, cyan for tools, red
//! for errors, green for ok, and macrod's orange for title strips. Square
//! borders only.

use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, BorderType, Borders};

use agent_monitor::domain::model::{Severity, Status};

/// The background.
pub const BG: Color = Color::Rgb(0, 0, 0);
/// The ink.
pub const AMBER: Color = Color::Rgb(255, 165, 43);
/// Secondary ink.
pub const DIM: Color = Color::Rgb(194, 123, 28);
/// Rules, borders and quiet labels.
pub const FAINT: Color = Color::Rgb(122, 80, 22);
/// Barely there: empty bars and grid dots.
pub const GHOST: Color = Color::Rgb(58, 38, 10);
/// Title strips: macrod's accent.
pub const STRIP: Color = Color::Rgb(249, 115, 22);
/// Live values.
pub const YELLOW: Color = Color::Rgb(255, 225, 77);
/// Tools.
pub const CYAN: Color = Color::Rgb(79, 211, 255);
/// Errors.
pub const RED: Color = Color::Rgb(255, 59, 59);
/// Ok.
pub const GREEN: Color = Color::Rgb(34, 229, 92);
/// Highlighted row background.
pub const SELECT: Color = Color::Rgb(70, 40, 0);
/// Text on a strip.
pub const INK_ON_STRIP: Color = Color::Rgb(0, 0, 0);

/// Plain ink on black.
pub fn base() -> Style {
    Style::new().fg(AMBER).bg(BG)
}

/// A colour on black.
pub fn ink(color: Color) -> Style {
    Style::new().fg(color)
}

/// Bold colour.
pub fn bold(color: Color) -> Style {
    Style::new().fg(color).add_modifier(Modifier::BOLD)
}

/// Black on orange, the title strip style.
pub fn strip() -> Style {
    Style::new()
        .fg(INK_ON_STRIP)
        .bg(STRIP)
        .add_modifier(Modifier::BOLD)
}

/// The selected row.
pub fn selected() -> Style {
    Style::new().bg(SELECT).add_modifier(Modifier::BOLD)
}

/// A pane: square border, an orange numbered title strip, and extra title
/// spans after it. A focused pane gets a yellow border.
pub fn pane(title: &str, extra: Vec<Span<'static>>, focused: bool) -> Block<'static> {
    let mut spans = vec![Span::styled(format!(" {title} "), strip())];
    spans.extend(extra);
    let border = if focused { YELLOW } else { FAINT };
    Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Plain)
        .border_style(Style::new().fg(border))
        .title(Line::from(spans))
        .style(base())
}

/// The colour of a status square.
pub fn status_color(status: Status) -> Color {
    match status {
        Status::Working => GREEN,
        Status::Waiting => YELLOW,
        Status::Blocked | Status::Failed => RED,
        Status::Idle => DIM,
        Status::Done => FAINT,
        Status::Stopped => GHOST,
    }
}

/// The status word in a row.
pub fn status_word(status: Status) -> &'static str {
    match status {
        Status::Working => "WORK",
        Status::Blocked => "BLCK",
        Status::Waiting => "WAIT",
        Status::Idle => "IDLE",
        Status::Done => "DONE",
        Status::Failed => "FAIL",
        Status::Stopped => "STOP",
    }
}

/// The status square: working blinks between filled and hollow on `blink`.
pub fn status_square(status: Status, blink: bool) -> Span<'static> {
    let glyph = match status {
        Status::Working if blink => "□",
        Status::Working | Status::Blocked | Status::Waiting | Status::Failed => "■",
        Status::Idle => "▪",
        Status::Done | Status::Stopped => "·",
    };
    Span::styled(glyph, bold(status_color(status)))
}

/// The colour of a tape line.
pub fn severity_color(severity: Severity) -> Color {
    match severity {
        Severity::Info => AMBER,
        Severity::Notice => YELLOW,
        Severity::Warning => STRIP,
        Severity::Error => RED,
    }
}
