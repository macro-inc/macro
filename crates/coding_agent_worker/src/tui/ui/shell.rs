use ratatui::Frame;
use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style, Stylize as _};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, BorderType, Borders, Paragraph, Tabs};

use super::theme::{ACCENT, DIM, ERR, OK, THEME, WARN};
use crate::tui::app::{App, Mode, Tab};

pub(super) fn render_header(frame: &mut Frame, app: &App, area: Rect) {
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
        Span::styled(
            " macrod ",
            Style::new().fg(THEME.accent_text).bg(ACCENT).bold(),
        ),
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
        .style(Style::new().fg(THEME.text).bg(THEME.surface))
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded)
        .border_style(Style::new().fg(THEME.border));
    frame.render_widget(Paragraph::new(title).block(block), area);
}

pub(super) fn render_tabs(frame: &mut Frame, app: &App, area: Rect) {
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

pub(super) fn render_footer(frame: &mut Frame, app: &App, area: Rect) {
    let line = if let Some((message, is_error)) = &app.status {
        Line::styled(
            format!(" {message}"),
            Style::new().fg(if *is_error { ERR } else { OK }),
        )
    } else {
        let hints: &[(&str, &str)] = match (&app.mode, app.tab) {
            (Mode::EditSetting { .. }, _) => &[("enter", "save"), ("esc", "cancel")],
            (Mode::AgentPicker { .. }, _) => &[
                ("↑↓/jk", "select"),
                ("enter", "choose"),
                ("?", "guide"),
                ("esc", "cancel"),
            ],
            (Mode::CustomAgent { .. }, _) => &[("enter", "save"), ("esc", "back")],
            (Mode::ConfirmDelete, _) => &[("y", "remove"), ("esc", "keep")],
            (Mode::Pairing { .. }, _) => {
                &[("o", "open link"), ("c", "copy code"), ("esc", "abandon")]
            }
            (_, Tab::Config) => &[
                ("↑↓", "select"),
                ("enter", "edit/toggle"),
                ("←→/hl", "tabs"),
                ("q", "quit"),
            ],
            _ => &[
                ("p", "pair"),
                ("d", "remove harness"),
                ("r", "refresh"),
                ("←→/hl", "tabs"),
                ("q", "quit"),
            ],
        };
        let mut spans = Vec::new();
        for (key, action) in hints {
            spans.push(Span::styled(
                format!(" {key} "),
                Style::new().fg(THEME.background).bg(DIM),
            ));
            spans.push(Span::styled(format!(" {action}  "), Style::new().fg(DIM)));
        }
        Line::from(spans)
    };
    frame.render_widget(Paragraph::new(line), area);
}
