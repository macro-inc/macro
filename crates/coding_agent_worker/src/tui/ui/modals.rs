use chrono::Utc;
use ratatui::Frame;
use ratatui::layout::{Alignment, Rect};
use ratatui::style::{Modifier, Style, Stylize as _};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Clear, Paragraph};
use tui_input::Input;

use super::layout::{centered, render_input};
use super::theme::{ACCENT, DIM, ERR, SPINNER, THEME, WARN, modal};
use crate::tui::agent_catalog::DetectedAgent;
use crate::tui::app::App;

pub(super) fn render_agent_picker(frame: &mut Frame, agents: &[DetectedAgent], selected: usize) {
    let height = (agents.len() as u16 + 11).clamp(11, 20);
    let area = centered(62, height, frame.area());
    frame.render_widget(Clear, area);
    let mut lines = vec![
        Line::styled("Detected agents are ready to launch.", Style::new().fg(DIM)),
        Line::raw(""),
    ];
    if agents.is_empty() {
        lines.push(Line::styled(
            "No known agents detected on PATH.",
            Style::new().fg(WARN),
        ));
    } else {
        lines.extend(agents.iter().enumerate().map(|(index, agent)| {
            let marker = if index == selected { "▸ " } else { "  " };
            let style = if index == selected {
                Style::new().fg(ACCENT).bold()
            } else {
                Style::new()
            };
            let detail = agent.note.unwrap_or("");
            Line::from(vec![
                Span::styled(format!("{marker}{:<20}", agent.name), style),
                Span::styled(detail, Style::new().fg(DIM)),
            ])
        }));
    }
    let custom_style = if selected == agents.len() {
        Style::new().fg(ACCENT).bold()
    } else {
        Style::new()
    };
    let marker = if selected == agents.len() {
        "▸ "
    } else {
        "  "
    };
    lines.push(Line::styled(
        format!("{marker}Custom command..."),
        custom_style,
    ));
    lines.push(Line::raw(""));
    lines.push(Line::from(vec![
        Span::styled(" ? ", Style::new().fg(THEME.accent_text).bg(ACCENT)),
        Span::styled(" Bring your own agent guide", Style::new().fg(DIM)),
    ]));
    frame.render_widget(
        Paragraph::new(lines).block(modal("Choose an agent", ACCENT)),
        area,
    );
}

pub(super) fn render_custom_agent(frame: &mut Frame, buffer: &Input) {
    let area = centered(66, 10, frame.area());
    frame.render_widget(Clear, area);
    let block = modal("Custom ACP agent", ACCENT);
    let inner = block.inner(area);
    frame.render_widget(block, area);
    frame.render_widget(
        Paragraph::new("Command to run via ACP").style(Style::new().fg(DIM)),
        Rect { height: 1, ..inner },
    );
    let input_area = Rect {
        y: inner.y + 2,
        height: 1,
        ..inner
    };
    if buffer.value().is_empty() {
        frame.render_widget(
            Paragraph::new("hermes acp").style(Style::new().fg(DIM).italic()),
            input_area,
        );
        frame.set_cursor_position((input_area.x, input_area.y));
    } else {
        render_input(frame, buffer, input_area, Style::new().fg(ACCENT));
    }
}

pub(super) fn render_confirm_delete(frame: &mut Frame, app: &App) {
    let area = centered(52, 9, frame.area());
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
            Span::styled(" y ", Style::new().fg(THEME.background).bg(ERR)),
            Span::raw(" remove   "),
            Span::styled(" esc ", Style::new().fg(THEME.background).bg(DIM)),
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

pub(super) fn render_pairing(
    frame: &mut Frame,
    app: &App,
    created: &harnesses::domain::models::CreatedPairing,
) {
    let url = app.config.macro_api.pairing_approval_url(&created.code);
    let available_width = frame.area().width.saturating_sub(2);
    let desired_width = url.chars().count() as u16 + 12;
    let width = desired_width.min(available_width).max(1);
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
            "  Open the approval page and confirm the code matches,",
            Style::new().fg(DIM),
        ),
        Line::styled("  then pair macrod.", Style::new().fg(DIM)),
        Line::raw(""),
        Line::from(vec![
            Span::raw("  "),
            Span::styled(spinner, Style::new().fg(ACCENT)),
            Span::styled(
                format!(" Waiting for approval · Expires in {minutes} min"),
                Style::new().fg(DIM),
            ),
        ]),
    ];
    frame.render_widget(
        Paragraph::new(text)
            .alignment(Alignment::Left)
            .block(modal("Pair macrod", ACCENT)),
        area,
    );
}
