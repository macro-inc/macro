use ratatui::Frame;
use ratatui::style::{Color, Style, Stylize as _};
use ratatui::widgets::{Block, BorderType, Borders, Padding};

pub(super) struct Theme {
    pub(super) background: Color,
    pub(super) surface: Color,
    pub(super) text: Color,
    pub(super) muted: Color,
    pub(super) border: Color,
    pub(super) accent: Color,
    pub(super) accent_text: Color,
    pub(super) success: Color,
    pub(super) warning: Color,
    pub(super) error: Color,
}

// Macro orange is the product's `--color-orange` token (#f97316). Keeping the
// complete palette here makes a future brand or contrast adjustment one edit.
pub(super) const THEME: Theme = Theme {
    background: Color::Rgb(21, 17, 14),
    surface: Color::Rgb(33, 26, 20),
    text: Color::Rgb(255, 248, 240),
    muted: Color::Rgb(199, 185, 171),
    border: Color::Rgb(128, 106, 85),
    accent: Color::Rgb(249, 115, 22),
    accent_text: Color::Rgb(24, 13, 5),
    success: Color::Rgb(74, 222, 128),
    warning: Color::Rgb(255, 178, 36),
    error: Color::Rgb(255, 107, 107),
};

pub(super) const ACCENT: Color = THEME.accent;
pub(super) const OK: Color = THEME.success;
pub(super) const WARN: Color = THEME.warning;
pub(super) const ERR: Color = THEME.error;
pub(super) const DIM: Color = THEME.muted;
pub(super) const SPINNER: [&str; 8] = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧"];

pub(super) fn card(title: impl Into<String>) -> Block<'static> {
    Block::default()
        .style(Style::new().fg(THEME.text).bg(THEME.surface))
        .title(format!(" {} ", title.into()))
        .title_style(Style::new().fg(ACCENT).bold())
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded)
        .border_style(Style::new().fg(THEME.border))
        .padding(Padding::horizontal(1))
}

pub(super) fn modal(title: &str, color: Color) -> Block<'static> {
    Block::default()
        .style(Style::new().fg(THEME.text).bg(THEME.surface))
        .padding(Padding::new(1, 1, 1, 1))
        .title(format!(" {title} "))
        .title_style(Style::new().fg(color).bold())
        .borders(Borders::ALL)
        .border_type(BorderType::Double)
        .border_style(Style::new().fg(color))
}

pub(super) fn render_background(frame: &mut Frame) {
    frame.render_widget(
        Block::default().style(Style::new().fg(THEME.text).bg(THEME.background)),
        frame.area(),
    );
}

pub(super) fn focus_marker(focused: bool) -> &'static str {
    if focused { "▸ " } else { "  " }
}

pub(super) fn focus_style(focused: bool) -> Style {
    if focused {
        Style::new().fg(ACCENT).bold()
    } else {
        Style::new()
    }
}
