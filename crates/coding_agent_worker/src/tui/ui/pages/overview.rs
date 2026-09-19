use harnesses::domain::models::HarnessOwner;
use ratatui::Frame;
use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Style, Stylize as _};
use ratatui::text::{Line, Span};
use ratatui::widgets::{List, ListItem, Paragraph, Wrap};

use super::super::layout::{ago, field};
use super::super::theme::{ACCENT, DIM, WARN, card};
use crate::tui::app::App;

pub(super) fn render(frame: &mut Frame, app: &App, area: Rect) {
    let [left, right] = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(55), Constraint::Percentage(45)])
        .areas(area);

    let mut lines: Vec<Line> = Vec::new();
    match &app.snapshot.harness {
        Some(harness) => {
            let scope = match &harness.owner {
                HarnessOwner::User { .. } => Span::styled("private", Style::new().fg(WARN)),
                HarnessOwner::Team { .. } => Span::styled("team", Style::new().fg(ACCENT)),
            };
            lines.push(field(
                "Name",
                Span::styled(&harness.name, Style::new().bold()),
            ));
            lines.push(field("Scope", scope));
            lines.push(field(
                "Id",
                Span::styled(harness.id.to_string(), Style::new().fg(DIM)),
            ));
            lines.push(field(
                "Last connected",
                Span::raw(
                    harness
                        .last_connected_at
                        .map(ago)
                        .unwrap_or_else(|| "never".to_owned()),
                ),
            ));
            lines.push(field("Registered by", Span::raw(&harness.created_by)));
            if app.serving() {
                lines.push(field(
                    "Harness proc",
                    match &app.harness_process {
                        Some((pid, name)) => Span::raw(format!("{name} · pid {pid}")),
                        None => Span::styled(
                            "not spawned - starts on the first trigger",
                            Style::new().fg(DIM).italic(),
                        ),
                    },
                ));
            }
            lines.push(Line::raw(""));
            lines.push(Line::styled(
                if app.serving() {
                    "Serving from this window; the dot turns green once a session dials in."
                } else {
                    "The daemon is not running; check the Logs tab for why."
                },
                Style::new().fg(DIM),
            ));
        }
        None if app.paired() => {
            lines.push(Line::styled(
                "Credentials on disk, but the server does not know this harness.",
                Style::new().fg(WARN),
            ));
            lines.push(Line::raw("It was likely removed. Press p to pair again."));
        }
        None => {
            lines.push(Line::styled(
                "This daemon is not paired yet.",
                Style::new().bold(),
            ));
            lines.push(Line::raw(""));
            lines.push(Line::from(vec![
                Span::raw("Press "),
                Span::styled("p", Style::new().fg(ACCENT).bold()),
                Span::raw(" to pair it with "),
                Span::styled(&app.config.macro_api.web_url, Style::new().fg(DIM)),
            ]));
        }
    }
    frame.render_widget(
        Paragraph::new(lines)
            .wrap(Wrap { trim: false })
            .block(card("Harness")),
        left,
    );

    let agents: Vec<ListItem> = if app.snapshot.agents.is_empty() {
        vec![ListItem::new(Line::styled(
            if app.paired() {
                "No agents bound yet - create one in Settings → Agents."
            } else {
                "Agents appear here once paired."
            },
            Style::new().fg(DIM),
        ))]
    } else {
        app.snapshot
            .agents
            .iter()
            .map(|agent| {
                ListItem::new(Line::from(vec![
                    Span::styled(format!("@{}", agent.handle), Style::new().fg(ACCENT).bold()),
                    Span::raw("  "),
                    Span::raw(agent.name.clone()),
                ]))
            })
            .collect()
    };
    frame.render_widget(
        List::new(agents).block(card(format!(
            "Bound agents ({})",
            app.snapshot.agents.len()
        ))),
        right,
    );
}
