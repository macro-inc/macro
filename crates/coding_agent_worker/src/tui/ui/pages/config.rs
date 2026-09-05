use ratatui::Frame;
use ratatui::layout::Rect;
use ratatui::style::{Style, Stylize as _};
use ratatui::widgets::Paragraph;

use super::super::layout::render_input;
use super::super::theme::{ACCENT, DIM, WARN, card, focus_marker, focus_style};
use crate::config::IdentityScope;
use crate::tui::app::{App, Mode};
use crate::tui::config_form::SETTINGS;

pub(super) fn render(frame: &mut Frame, app: &App, area: Rect) {
    let block = card(format!("macrod.toml  ·  {}", app.config_path.display()));
    let inner = block.inner(area);
    frame.render_widget(block, area);
    for (index, setting) in SETTINGS.iter().enumerate() {
        let selected = index == app.selected_setting;
        let row = Rect {
            y: inner.y + index as u16,
            height: 1,
            ..inner
        };
        frame.render_widget(
            Paragraph::new(format!("{}{:<16}", focus_marker(selected), setting.label()))
                .style(focus_style(selected)),
            row,
        );
        let value_area = Rect {
            x: row.x + 18,
            width: row.width.saturating_sub(18),
            ..row
        };
        match &app.mode {
            Mode::EditSetting {
                index: edit_index,
                buffer,
            } if *edit_index == index => {
                render_input(frame, buffer, value_area, Style::new().fg(ACCENT));
            }
            _ => {
                let shown = app.form.display(*setting, &app.config);
                let style = if shown.is_empty() {
                    Style::new().fg(DIM).italic()
                } else {
                    Style::new()
                };
                frame.render_widget(
                    Paragraph::new(if shown.is_empty() { "(unset)" } else { &shown }).style(style),
                    value_area,
                );
            }
        }
    }
    if app.config.identity.scope == IdentityScope::Team {
        let warning = Rect {
            x: inner.x,
            y: inner.y + SETTINGS.len() as u16 + 1,
            width: inner.width,
            height: 1,
        };
        frame.render_widget(
            Paragraph::new(
                "Warning: teammates can command agents on this machine. Trust your team.",
            )
            .style(Style::new().fg(WARN)),
            warning,
        );
    }
}
