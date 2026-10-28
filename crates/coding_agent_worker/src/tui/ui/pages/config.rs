use ratatui::Frame;
use ratatui::layout::Rect;
use ratatui::style::{Style, Stylize as _};
use ratatui::widgets::Paragraph;

use super::super::layout::render_input;
use super::super::theme::{ACCENT, DIM, WARN, card, focus_marker, focus_style, section};
use crate::config::IdentityScope;
use crate::tui::app::{App, Mode};
use crate::tui::config_form::settings;

pub(super) fn render(frame: &mut Frame, app: &App, area: Rect) {
    let block = card(format!("macrod.toml  ·  {}", app.config_path.display()));
    let inner = block.inner(area);
    frame.render_widget(block, area);
    let settings = settings(&app.config);
    let herdr_start = settings.iter().position(|setting| setting.is_herdr());
    // A blank line and a header sit above the herdr group.
    let row_of = |index: usize| -> u16 {
        index as u16
            + if herdr_start.is_some_and(|start| index >= start) {
                2
            } else {
                0
            }
    };
    if let Some(start) = herdr_start {
        frame.render_widget(
            Paragraph::new(section("Herdr", "each session in its own tab", inner.width)),
            Rect {
                y: inner.y + row_of(start) - 1,
                height: 1,
                ..inner
            },
        );
    }
    for (index, setting) in settings.iter().enumerate() {
        let selected = index == app.selected_setting;
        let row = Rect {
            y: inner.y + row_of(index),
            height: 1,
            ..inner
        };
        frame.render_widget(
            Paragraph::new(format!("{}{:<14}", focus_marker(selected), setting.label()))
                .style(focus_style(selected)),
            row,
        );
        let value_area = Rect {
            x: row.x + 16,
            width: row.width.saturating_sub(16),
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
    if app.config.identity.allow_permission_bypass {
        frame.render_widget(
            Paragraph::new("Warning: agents can run commands and edit files without approval.\nApplies at next pairing.")
                .style(Style::new().fg(WARN)),
            Rect { y: inner.y + row_of(settings.len()) + 2, height: 2, ..inner },
        );
    }
    if app.config.identity.scope == IdentityScope::Team {
        let warning = Rect {
            x: inner.x,
            y: inner.y + row_of(settings.len()) + 1,
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
