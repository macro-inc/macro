#[cfg(test)]
mod test;

use harnesses::domain::models::HarnessOwner;
use ratatui::Frame;
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::style::{Style, Stylize as _};
use ratatui::text::{Line, Span};
use ratatui::widgets::Paragraph;

use super::super::layout::render_input;
use super::super::theme::{ACCENT, DIM, WARN, card, focus_marker, focus_style, section};
use crate::tui::app::{App, Mode};
use crate::tui::config_form::settings;

pub(super) fn render(frame: &mut Frame, app: &App, area: Rect) {
    let block = card(format!("macrod.toml  ·  {}", app.config_path.display()));
    let inner = block.inner(area);
    frame.render_widget(block, area);
    let runtime = runtime_lines(app, inner.width);
    let [content, _spacer, runtime_area] = Layout::vertical([
        Constraint::Min(0),
        Constraint::Length(1),
        Constraint::Length(runtime.len() as u16),
    ])
    .areas(inner);
    frame.render_widget(Paragraph::new(runtime), runtime_area);

    let settings = settings(&app.config);
    let herdr_start = settings.iter().position(|setting| setting.is_herdr());
    // A blank line and header precede Herdr.
    let row_of = |index: usize| -> u16 {
        index as u16
            + if herdr_start.is_some_and(|start| index >= start) {
                2
            } else {
                0
            }
    };
    let scroll = (row_of(app.selected_setting) + 1).saturating_sub(content.height);
    let visible_row = |offset: u16| {
        let offset = offset.checked_sub(scroll)?;
        let row = Rect {
            y: content.y + offset,
            height: 1,
            ..content
        }
        .intersection(content);
        if row.is_empty() { None } else { Some(row) }
    };
    if let Some(start) = herdr_start
        && let Some(row) = visible_row(row_of(start) - 1)
    {
        frame.render_widget(
            Paragraph::new(section("Herdr", "each session in its own tab", inner.width)),
            row,
        );
    }
    for (index, setting) in settings.iter().enumerate() {
        let selected = index == app.selected_setting;
        let Some(row) = visible_row(row_of(index)) else {
            continue;
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
}

/// The runtime settings the web owns, read-only from the server's snapshot.
fn runtime_lines(app: &App, width: u16) -> Vec<Line<'static>> {
    let mut lines = vec![section("Runtime", "set on the web", width)];
    let row = |label: &str, value: Span<'static>| {
        Line::from(vec![
            Span::styled(format!("  {label:<14}"), Style::new().fg(DIM)),
            value,
        ])
    };
    match &app.snapshot.harness {
        Some(harness) => {
            lines.push(row("Name", Span::raw(harness.name.clone())));
            lines.push(row(
                "Access",
                match harness.owner {
                    HarnessOwner::User { .. } => Span::raw("Private"),
                    HarnessOwner::Team { .. } => Span::styled(
                        "Team · teammates can command agents on this machine",
                        Style::new().fg(WARN),
                    ),
                },
            ));
            lines.push(row(
                "Full Access",
                if harness.allow_permission_bypass {
                    Span::styled(
                        "On · agents run commands and edit files without approval",
                        Style::new().fg(WARN),
                    )
                } else {
                    Span::raw("Off (always prompt)")
                },
            ));
        }
        None => lines.push(Line::styled(
            "  Shown once this harness is paired and reachable.",
            Style::new().fg(DIM),
        )),
    }
    lines.push(Line::from(vec![
        Span::styled("  Change these on the web: ", Style::new().fg(DIM)),
        Span::styled(app.config.macro_api.settings_url(), Style::new().fg(ACCENT)),
    ]));
    lines
}
