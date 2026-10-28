#[cfg(test)]
mod test;

use ratatui::Frame;
use ratatui::layout::{Constraint, Layout, Rect};
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
    let team_warning = app.config.identity.scope == IdentityScope::Team;
    let bypass_warning = app.config.identity.allow_permission_bypass;
    let [content, warnings] = Layout::vertical([
        Constraint::Min(0),
        Constraint::Length(u16::from(team_warning) + if bypass_warning { 2 } else { 0 }),
    ])
    .areas(inner);
    let selected_height = if settings[app.selected_setting] == Setting::PermissionBypass {
        3
    } else {
        1
    };
    let scroll = (row_of(app.selected_setting) + selected_height).saturating_sub(content.height);
    let visible_row = |offset: u16, height: u16| {
        let offset = offset.checked_sub(scroll)?;
        let row = Rect {
            y: content.y + offset,
            height,
            ..content
        }
        .intersection(content);
        if row.is_empty() { None } else { Some(row) }
    };
    if let Some(start) = herdr_start
        && let Some(row) = visible_row(row_of(start) - 1, 1)
    {
        frame.render_widget(
            Paragraph::new(section("Herdr", "each session in its own tab", inner.width)),
            row,
        );
    }
    for (index, setting) in settings.iter().enumerate() {
        let selected = index == app.selected_setting;
        let height = if *setting == Setting::PermissionBypass {
            3
        } else {
            1
        };
        let Some(row) = visible_row(row_of(index), height) else {
            continue;
        };
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
                row,
            );
            continue;
        }
        frame.render_widget(
            Paragraph::new(format!("{}{:<14}", focus_marker(selected), setting.label()))
                .style(focus_style(selected)),
            row,
        );
        let value_area = Rect {
            x: row.x + 16,
            width: row.width.saturating_sub(16),
            ..row
        }
        .intersection(row);
        if value_area.is_empty() {
            continue;
        }
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
    let [team_warning_area, bypass_warning_area] = Layout::vertical([
        Constraint::Length(u16::from(team_warning)),
        Constraint::Length(if bypass_warning { 2 } else { 0 }),
    ])
    .areas(warnings);
    if bypass_warning {
        frame.render_widget(
            Paragraph::new("Warning: agents can run commands and edit files without approval.\nApplies at next pairing.")
                .style(Style::new().fg(WARN)),
            bypass_warning_area,
        );
    }
    if team_warning {
        frame.render_widget(
            Paragraph::new(
                "Warning: teammates can command agents on this machine. Trust your team.",
            )
            .style(Style::new().fg(WARN)),
            team_warning_area,
        );
    }
}
