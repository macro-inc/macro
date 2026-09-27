//! Rendering for `macrod herdr-pane`. Pure: reads [`PaneView`], draws frames.

use ratatui::Frame;
use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Modifier, Style, Stylize as _};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, BorderType, Borders, Clear, Paragraph};

use super::theme::{self, ACCENT, DIM, ERR, OK, SPINNER, THEME, WARN};
use crate::herdr::wire::AgentState;
use crate::tui::herdr_pane::{Entry, PaneView, PendingPermission};

pub(crate) fn render_herdr_pane(frame: &mut Frame, view: &PaneView) {
    theme::render_background(frame);
    let permission_height = view
        .permission
        .as_ref()
        .map_or(0, |permission| permission.options.len().max(1) as u16 + 4);
    let [header, body, permission, input, footer] = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(1),
            Constraint::Min(3),
            Constraint::Length(permission_height),
            Constraint::Length(3),
            Constraint::Length(1),
        ])
        .areas(frame.area());

    render_header(frame, view, header);
    render_transcript(frame, view, body);
    if let Some(pending) = &view.permission {
        render_permission(frame, pending, permission);
    }
    render_input(frame, view, input);
    render_footer(frame, view, footer);
}

fn spinner(view: &PaneView) -> &'static str {
    SPINNER[view.tick % SPINNER.len()]
}

fn render_header(frame: &mut Frame, view: &PaneView, area: Rect) {
    let (state, color) = match (view.connected, view.state) {
        (false, _) => ("disconnected".to_owned(), ERR),
        (true, AgentState::Idle) => ("ready".to_owned(), OK),
        (true, AgentState::Working) => (format!("{} working", spinner(view)), WARN),
        (true, AgentState::Blocked) => ("needs permission".to_owned(), ERR),
    };
    let mut spans = vec![
        Span::styled(
            " ◆ Macro agent ",
            Style::new().fg(THEME.accent_text).bg(ACCENT).bold(),
        ),
        Span::raw("  "),
        Span::styled(state, Style::new().fg(color).bold()),
    ];
    if let Some(url) = &view.web_url {
        spans.push(Span::styled(format!("  ·  {url}"), Style::new().fg(DIM)));
    } else {
        spans.push(Span::styled(
            format!("  ·  acp {}", view.session),
            Style::new().fg(DIM),
        ));
    }
    frame.render_widget(Paragraph::new(Line::from(spans)), area);
}

/// Greedy word wrap by character count; long words are split.
pub(crate) fn wrap(text: &str, width: usize) -> Vec<String> {
    let width = width.max(1);
    let mut out = Vec::new();
    for raw in text.split('\n') {
        let mut line = String::new();
        let mut len = 0;
        for word in raw.split(' ') {
            let word_len = word.chars().count();
            if len > 0 && len + 1 + word_len > width {
                out.push(std::mem::take(&mut line));
                len = 0;
            }
            if len > 0 {
                line.push(' ');
                len += 1;
            }
            let mut rest: Vec<char> = word.chars().collect();
            while len + rest.len() > width {
                let take = width - len;
                line.extend(rest.drain(..take));
                out.push(std::mem::take(&mut line));
                len = 0;
            }
            len += rest.len();
            line.extend(rest);
        }
        out.push(line);
    }
    out
}

fn push_wrapped(
    lines: &mut Vec<Line<'static>>,
    text: &str,
    width: usize,
    first: Span<'static>,
    style: Style,
) {
    let indent = first.content.chars().count();
    for (index, chunk) in wrap(text.trim_end(), width.saturating_sub(indent))
        .into_iter()
        .enumerate()
    {
        let lead = if index == 0 {
            first.clone()
        } else {
            Span::raw(" ".repeat(indent))
        };
        lines.push(Line::from(vec![lead, Span::styled(chunk, style)]));
    }
}

fn transcript_lines(view: &PaneView, width: usize) -> Vec<Line<'static>> {
    let mut lines = Vec::new();
    for entry in &view.transcript.entries {
        match entry {
            Entry::User(text) => {
                lines.push(Line::default());
                push_wrapped(
                    &mut lines,
                    text,
                    width,
                    Span::styled("› ", Style::new().fg(ACCENT).bold()),
                    Style::new().fg(THEME.text).bold(),
                );
                lines.push(Line::default());
            }
            Entry::Agent(text) => push_wrapped(
                &mut lines,
                text,
                width,
                Span::styled("● ", Style::new().fg(THEME.text)),
                Style::new().fg(THEME.text),
            ),
            Entry::Thought(text) => push_wrapped(
                &mut lines,
                text,
                width,
                Span::styled("∴ ", Style::new().fg(DIM)),
                Style::new().fg(DIM).add_modifier(Modifier::ITALIC),
            ),
            Entry::Tool { title, status, .. } => {
                let (icon, color) = match status.as_str() {
                    "completed" => ("✓ ".to_owned(), OK),
                    "failed" => ("✗ ".to_owned(), ERR),
                    "in_progress" => (format!("{} ", spinner(view)), WARN),
                    _ => ("○ ".to_owned(), DIM),
                };
                push_wrapped(
                    &mut lines,
                    title,
                    width,
                    Span::styled(icon, Style::new().fg(color).bold()),
                    Style::new().fg(THEME.muted),
                );
            }
            Entry::Plan(steps) => {
                lines.push(Line::from(Span::styled(
                    "Plan",
                    Style::new().fg(ACCENT).bold(),
                )));
                for (step, status) in steps {
                    let (icon, color) = match status.as_str() {
                        "completed" => ("  ☑ ", OK),
                        "in_progress" => ("  ◐ ", WARN),
                        _ => ("  ☐ ", DIM),
                    };
                    push_wrapped(
                        &mut lines,
                        step,
                        width,
                        Span::styled(icon, Style::new().fg(color)),
                        Style::new().fg(THEME.muted),
                    );
                }
            }
            Entry::Stopped(reason) => lines.push(Line::from(Span::styled(
                format!("  turn ended: {reason}"),
                Style::new().fg(WARN),
            ))),
            Entry::Notice { text, error } => push_wrapped(
                &mut lines,
                text,
                width,
                Span::styled("· ", Style::new().fg(if *error { ERR } else { DIM })),
                Style::new().fg(if *error { ERR } else { DIM }),
            ),
        }
    }
    lines
}

fn render_transcript(frame: &mut Frame, view: &PaneView, area: Rect) {
    let inner = Rect {
        x: area.x + 1,
        width: area.width.saturating_sub(2),
        ..area
    };
    let lines = transcript_lines(view, usize::from(inner.width));
    if lines.is_empty() {
        frame.render_widget(
            Paragraph::new(Line::from(Span::styled(
                "Waiting for the first prompt. Type below, or prompt this agent from Macro.",
                Style::new().fg(DIM),
            ))),
            inner,
        );
        return;
    }
    let height = usize::from(inner.height);
    let max_scroll = lines.len().saturating_sub(height);
    let scroll = view.scroll.min(max_scroll);
    let start = lines.len().saturating_sub(height + scroll);
    let visible: Vec<Line<'static>> = lines.into_iter().skip(start).take(height).collect();
    frame.render_widget(Paragraph::new(visible), inner);
}

fn render_permission(frame: &mut Frame, pending: &PendingPermission, area: Rect) {
    frame.render_widget(Clear, area);
    let title = pending
        .title
        .clone()
        .unwrap_or_else(|| "The agent asks permission".to_owned());
    let block = Block::default()
        .style(Style::new().fg(THEME.text).bg(THEME.surface))
        .title(" Permission ")
        .title_style(Style::new().fg(ERR).bold())
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded)
        .border_style(Style::new().fg(ERR));
    let mut lines = vec![Line::from(Span::styled(title, Style::new().bold()))];
    if pending.options.is_empty() {
        lines.push(Line::from(Span::styled(
            "No options offered; Esc dismisses.",
            Style::new().fg(DIM),
        )));
    }
    for (index, option) in pending.options.iter().enumerate() {
        let selected = index == pending.selected;
        let color = if option.kind.starts_with("allow") {
            OK
        } else {
            ERR
        };
        lines.push(Line::from(vec![
            Span::styled(
                if selected { "▸ " } else { "  " },
                Style::new().fg(ACCENT).bold(),
            ),
            Span::styled(format!("{} ", index + 1), Style::new().fg(DIM)),
            Span::styled(
                option.name.clone(),
                if selected {
                    Style::new().fg(color).bold()
                } else {
                    Style::new().fg(color)
                },
            ),
        ]));
    }
    frame.render_widget(Paragraph::new(lines).block(block), area);
}

fn render_input(frame: &mut Frame, view: &PaneView, area: Rect) {
    let focused = view.connected && view.permission.is_none();
    let border = if focused { ACCENT } else { THEME.border };
    let block = Block::default()
        .style(Style::new().fg(THEME.text).bg(THEME.surface))
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded)
        .border_style(Style::new().fg(border));
    let inner = block.inner(area);
    let width = usize::from(inner.width.saturating_sub(2));
    let scroll = view.input.visual_scroll(width);
    let text = if view.input.value().is_empty() {
        Line::from(vec![
            Span::styled("› ", Style::new().fg(ACCENT).bold()),
            Span::styled(
                if view.state == AgentState::Idle {
                    "Prompt the agent"
                } else {
                    "Queue a follow-up"
                },
                Style::new().fg(DIM),
            ),
        ])
    } else {
        Line::from(vec![
            Span::styled("› ", Style::new().fg(ACCENT).bold()),
            Span::raw(view.input.value().chars().skip(scroll).collect::<String>()),
        ])
    };
    frame.render_widget(Paragraph::new(text).block(block), area);
    if focused {
        let cursor = view.input.visual_cursor().saturating_sub(scroll);
        let x = inner.x + 2 + u16::try_from(cursor).unwrap_or(u16::MAX);
        frame.set_cursor_position((x.min(inner.right().saturating_sub(1)), inner.y));
    }
}

fn render_footer(frame: &mut Frame, view: &PaneView, area: Rect) {
    let hints = if view.permission.is_some() {
        "↑↓ choose · enter/1-9 answer · esc dismiss"
    } else if view.state == AgentState::Idle {
        "enter send · pgup/pgdn scroll · ctrl+c close"
    } else {
        "enter send · esc interrupt · pgup/pgdn scroll"
    };
    frame.render_widget(
        Paragraph::new(Line::from(Span::styled(
            format!(" {hints}"),
            Style::new().fg(DIM),
        ))),
        area,
    );
}
