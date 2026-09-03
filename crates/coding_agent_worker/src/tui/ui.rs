//! Rendering for the macrod control panel. Pure: reads [`App`], draws frames.

use chrono::{DateTime, Utc};
use harnesses::domain::models::HarnessOwner;
use ratatui::Frame;
use ratatui::layout::{Alignment, Constraint, Direction, Layout, Rect};
use ratatui::style::{Color, Modifier, Style, Stylize as _};
use ratatui::text::{Line, Span};
use ratatui::widgets::{
    Block, BorderType, Borders, Cell, Clear, List, ListItem, Padding, Paragraph, Row, Table, Tabs,
    Wrap,
};

use super::config_form::FIELDS;
use super::{App, Mode, Tab};

const ACCENT: Color = Color::Cyan;
const OK: Color = Color::Green;
const WARN: Color = Color::Yellow;
const ERR: Color = Color::Red;
const DIM: Color = Color::DarkGray;
const SPINNER: [&str; 8] = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧"];

pub(crate) fn render(frame: &mut Frame, app: &App) {
    let [header, tabs, body, footer] = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3),
            Constraint::Length(1),
            Constraint::Min(3),
            Constraint::Length(1),
        ])
        .areas(frame.area());

    render_header(frame, app, header);
    render_tabs(frame, app, tabs);
    match app.tab {
        Tab::Overview => render_overview(frame, app, body),
        Tab::Sessions => render_sessions(frame, app, body),
        Tab::Config => render_config(frame, app, body),
        Tab::Logs => render_logs(frame, app, body),
    }
    render_footer(frame, app, footer);

    match &app.mode {
        Mode::ConfirmDelete => render_confirm_delete(frame, app),
        Mode::Pairing { created, .. } => render_pairing(frame, app, created),
        Mode::Normal | Mode::EditField { .. } => {}
    }
}

fn render_header(frame: &mut Frame, app: &App, area: Rect) {
    let (dot, dot_style, state) = match &app.snapshot.harness {
        Some(harness) if harness.connected => ("●", Style::new().fg(OK), "connected"),
        Some(_) => ("●", Style::new().fg(WARN), "paired, runtime not dialed in"),
        None if app.paired() => ("○", Style::new().fg(WARN), "paired, unreachable"),
        None => ("○", Style::new().fg(DIM), "not paired"),
    };
    let name = app
        .snapshot
        .harness
        .as_ref()
        .map(|harness| harness.name.clone())
        .or_else(|| app.config.identity.name.clone())
        .unwrap_or_else(|| "macrod".to_owned());

    let serving: Vec<Span> = if app.serving() {
        vec![Span::styled("  ⏵ serving SSE", Style::new().fg(OK))]
    } else if app.paired() {
        vec![Span::styled("  ⏸ daemon stopped", Style::new().fg(ERR))]
    } else {
        Vec::new()
    };
    let mut spans = vec![
        Span::styled(" macrod ", Style::new().fg(Color::Black).bg(ACCENT).bold()),
        Span::raw(" "),
        Span::styled(name, Style::new().bold()),
        Span::raw("  "),
        Span::styled(dot, dot_style),
        Span::raw(" "),
        Span::styled(state, Style::new().fg(DIM)),
    ];
    spans.extend(serving);
    spans.push(Span::styled(
        format!("  pid {}", app.pid),
        Style::new().fg(DIM),
    ));
    let title = Line::from(spans);
    let block = Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded)
        .border_style(Style::new().fg(DIM));
    frame.render_widget(Paragraph::new(title).block(block), area);
}

fn render_tabs(frame: &mut Frame, app: &App, area: Rect) {
    let titles = Tab::ALL
        .iter()
        .enumerate()
        .map(|(index, tab)| Line::from(format!(" {} {} ", index + 1, tab.title())));
    let selected = Tab::ALL.iter().position(|tab| *tab == app.tab).unwrap_or(0);
    let tabs = Tabs::new(titles)
        .select(selected)
        .style(Style::new().fg(DIM))
        .highlight_style(Style::new().fg(ACCENT).add_modifier(Modifier::BOLD))
        .divider("│");
    frame.render_widget(tabs, area);
}

fn render_overview(frame: &mut Frame, app: &App, area: Rect) {
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

fn render_sessions(frame: &mut Frame, app: &App, area: Rect) {
    if app.snapshot.sessions.is_empty() {
        let message = if app.paired() {
            "No sessions yet - @mention a bound agent in a channel."
        } else {
            "Sessions appear here once paired."
        };
        frame.render_widget(
            Paragraph::new(Line::styled(message, Style::new().fg(DIM))).block(card("Sessions")),
            area,
        );
        return;
    }

    let header = Row::new(["Agent", "Session", "Status", "Model", "Owner", "Updated"])
        .style(Style::new().fg(DIM).add_modifier(Modifier::BOLD));
    let rows = app.snapshot.sessions.iter().map(|session| {
        Row::new(vec![
            Cell::from(Span::styled(
                format!("@{}", session.bot_handle),
                Style::new().fg(ACCENT),
            )),
            Cell::from(session.name.clone()),
            Cell::from(Span::styled(
                session.status.clone(),
                status_style(&session.status),
            )),
            Cell::from(session.model.clone()),
            Cell::from(Span::styled(session.owner_id.clone(), Style::new().fg(DIM))),
            Cell::from(ago(session.modified_at)),
        ])
    });
    let table = Table::new(
        rows,
        [
            Constraint::Length(14),
            Constraint::Min(18),
            Constraint::Length(14),
            Constraint::Length(12),
            Constraint::Min(16),
            Constraint::Length(10),
        ],
    )
    .header(header)
    .column_spacing(2)
    .block(card(format!("Sessions ({})", app.snapshot.sessions.len())));
    frame.render_widget(table, area);
}

fn render_config(frame: &mut Frame, app: &App, area: Rect) {
    let editing = match &app.mode {
        Mode::EditField { index, buffer } => Some((*index, buffer.as_str())),
        _ => None,
    };

    let items: Vec<ListItem> = FIELDS
        .iter()
        .enumerate()
        .map(|(index, definition)| {
            let selected = index == app.selected_field;
            let marker = if selected { "▸ " } else { "  " };
            let label_style = if selected {
                Style::new().fg(ACCENT).bold()
            } else {
                Style::new()
            };
            let value: Span = match editing {
                Some((edit_index, buffer)) if edit_index == index => Span::styled(
                    format!("{buffer}▏"),
                    Style::new().fg(Color::Black).bg(ACCENT),
                ),
                _ => {
                    let shown = app.form.display(definition);
                    if shown.is_empty() {
                        Span::styled("(unset)", Style::new().fg(DIM).italic())
                    } else {
                        Span::raw(shown)
                    }
                }
            };
            ListItem::new(Line::from(vec![
                Span::styled(format!("{marker}{:<22}", definition.label), label_style),
                value,
            ]))
        })
        .collect();

    frame.render_widget(
        List::new(items).block(card(format!(
            "macro.toml  ·  {}",
            app.config_path.display()
        ))),
        area,
    );
}

fn render_logs(frame: &mut Frame, app: &App, area: Rect) {
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

fn render_footer(frame: &mut Frame, app: &App, area: Rect) {
    let line = if let Some((message, is_error)) = &app.status {
        Line::styled(
            format!(" {message}"),
            Style::new().fg(if *is_error { ERR } else { OK }),
        )
    } else {
        let hints: &[(&str, &str)] = match (&app.mode, app.tab) {
            (Mode::EditField { .. }, _) => &[("enter", "save"), ("esc", "cancel")],
            (Mode::ConfirmDelete, _) => &[("y", "remove"), ("esc", "keep")],
            (Mode::Pairing { .. }, _) => {
                &[("o", "open link"), ("c", "copy code"), ("esc", "abandon")]
            }
            (_, Tab::Config) => &[
                ("↑↓", "select"),
                ("enter", "edit/toggle"),
                ("tab", "next tab"),
                ("q", "quit"),
            ],
            _ => &[
                ("p", "pair"),
                ("d", "remove harness"),
                ("r", "refresh"),
                ("tab", "next tab"),
                ("q", "quit"),
            ],
        };
        let mut spans = Vec::new();
        for (key, action) in hints {
            spans.push(Span::styled(
                format!(" {key} "),
                Style::new().fg(Color::Black).bg(DIM),
            ));
            spans.push(Span::styled(format!(" {action}  "), Style::new().fg(DIM)));
        }
        Line::from(spans)
    };
    frame.render_widget(Paragraph::new(line), area);
}

fn render_confirm_delete(frame: &mut Frame, app: &App) {
    let area = centered(52, 8, frame.area());
    frame.render_widget(Clear, area);
    let name = app
        .snapshot
        .harness
        .as_ref()
        .map(|harness| harness.name.as_str())
        .unwrap_or("this harness");
    let text = vec![
        Line::raw(""),
        Line::from(vec![
            Span::raw("Remove "),
            Span::styled(name, Style::new().bold()),
            Span::raw("?"),
        ]),
        Line::styled(
            "Agents bound to it stop running until it is re-paired.",
            Style::new().fg(DIM),
        ),
        Line::raw(""),
        Line::from(vec![
            Span::styled(" y ", Style::new().fg(Color::Black).bg(ERR)),
            Span::raw(" remove   "),
            Span::styled(" esc ", Style::new().fg(Color::Black).bg(DIM)),
            Span::raw(" keep"),
        ]),
    ];
    frame.render_widget(
        Paragraph::new(text)
            .alignment(Alignment::Center)
            .block(modal("Remove harness", ERR)),
        area,
    );
}

fn render_pairing(
    frame: &mut Frame,
    app: &App,
    created: &harnesses::domain::models::CreatedPairing,
) {
    let url = app.config.macro_api.pairing_approval_url(&created.code);
    let width = (url.len() as u16 + 6).clamp(56, frame.area().width.saturating_sub(4));
    let area = centered(width, 12, frame.area());
    frame.render_widget(Clear, area);
    let minutes = (created.expires_at - Utc::now()).num_minutes().max(0);
    let spinner = SPINNER[app.spinner % SPINNER.len()];

    // The code and the URL are rendered as plain contiguous runs on their own
    // lines, left-aligned: that keeps them selectable for copy-paste and lets
    // terminals linkify the URL for cmd/ctrl+click.
    let text = vec![
        Line::raw(""),
        Line::from(vec![
            Span::styled("  code  ", Style::new().fg(DIM)),
            Span::styled(
                created.code.clone(),
                Style::new().fg(ACCENT).add_modifier(Modifier::BOLD),
            ),
            Span::styled("   (c to copy)", Style::new().fg(DIM)),
        ]),
        Line::from(vec![
            Span::styled("  link  ", Style::new().fg(DIM)),
            Span::styled(url, Style::new().underlined()),
        ]),
        Line::raw(""),
        Line::styled(
            "  The browser opened to the approval page with the code",
            Style::new().fg(DIM),
        ),
        Line::styled(
            "  pre-filled - confirm it matches, then approve.",
            Style::new().fg(DIM),
        ),
        Line::raw(""),
        Line::from(vec![
            Span::raw("  "),
            Span::styled(spinner, Style::new().fg(ACCENT)),
            Span::styled(
                format!(" waiting for approval · expires in {minutes} min"),
                Style::new().fg(DIM),
            ),
        ]),
    ];
    frame.render_widget(
        Paragraph::new(text)
            .alignment(Alignment::Left)
            .block(modal("Pair this daemon", ACCENT)),
        area,
    );
}

fn card(title: impl Into<String>) -> Block<'static> {
    Block::default()
        .title(format!(" {} ", title.into()))
        .title_style(Style::new().fg(ACCENT).bold())
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded)
        .border_style(Style::new().fg(DIM))
        .padding(Padding::horizontal(1))
}

fn modal(title: &str, color: Color) -> Block<'static> {
    Block::default()
        .title(format!(" {title} "))
        .title_style(Style::new().fg(color).bold())
        .borders(Borders::ALL)
        .border_type(BorderType::Double)
        .border_style(Style::new().fg(color))
}

fn field<'a>(label: &str, value: Span<'a>) -> Line<'a> {
    Line::from(vec![
        Span::styled(format!("{label:<16}"), Style::new().fg(DIM)),
        value,
    ])
}

fn status_style(status: &str) -> Style {
    // The session status vocabulary: `event` is a live session, `no_messages`
    // one that never heard anything, `disconnected` one whose runtime is gone.
    match status {
        "event" => Style::new().fg(OK),
        "no_messages" => Style::new().fg(DIM),
        "disconnected" => Style::new().fg(ERR),
        _ => Style::new().fg(WARN),
    }
}

fn ago(when: DateTime<Utc>) -> String {
    let seconds = (Utc::now() - when).num_seconds().max(0);
    match seconds {
        0..=59 => format!("{seconds}s ago"),
        60..=3599 => format!("{}m ago", seconds / 60),
        3600..=86_399 => format!("{}h ago", seconds / 3600),
        _ => format!("{}d ago", seconds / 86_400),
    }
}

fn centered(width: u16, height: u16, area: Rect) -> Rect {
    let width = width.min(area.width.saturating_sub(2));
    let height = height.min(area.height.saturating_sub(2));
    Rect {
        x: area.x + (area.width.saturating_sub(width)) / 2,
        y: area.y + (area.height.saturating_sub(height)) / 2,
        width,
        height,
    }
}
