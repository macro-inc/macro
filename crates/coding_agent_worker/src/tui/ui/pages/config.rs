use ratatui::Frame;
use ratatui::layout::Rect;
use ratatui::style::{Style, Stylize as _};
use ratatui::widgets::{Block, BorderType, Borders, Padding, Paragraph};

use super::super::layout::render_input;
use super::super::theme::{ACCENT, DIM, WARN, card, focus_marker, focus_style, section};
use crate::config::IdentityScope;
use crate::tui::app::{App, Mode};
use crate::tui::config_form::{Setting, settings};

pub(super) fn render(frame: &mut Frame, app: &App, area: Rect) {
    let block = card(format!("macrod.toml  ·  {}", app.config_path.display()));
    let inner = block.inner(area);
    frame.render_widget(block, area);
    let settings = settings(&app.config);
    let herdr_start = settings.iter().position(|setting| setting.is_herdr());
    let permission_index = settings
        .iter()
        .position(|setting| *setting == Setting::PermissionBypass);
    // Full Access gets a bordered row; a blank line and header precede Herdr.
    let row_of = |index: usize| -> u16 {
        index as u16
            + if permission_index.is_some_and(|permission| index > permission) {
                2
            } else {
                0
            }
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
        if *setting == Setting::PermissionBypass {
            frame.render_widget(
                Paragraph::new(app.form.display(*setting, &app.config))
                    .style(focus_style(selected).bold())
                    .block(
                        Block::default()
                            .title(format!(
                                "{}{} · Suggested ",
                                focus_marker(selected),
                                setting.label()
                            ))
                            .borders(Borders::ALL)
                            .border_type(BorderType::Rounded)
                            .padding(Padding::horizontal(1)),
                    ),
                Rect {
                    y: inner.y + row_of(index),
                    height: 3,
                    ..inner
                },
            );
            continue;
        }
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
