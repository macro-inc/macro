use ratatui::Frame;
use ratatui::layout::{Alignment, Constraint, Layout, Rect};
use ratatui::style::{Style, Stylize as _};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, BorderType, Borders, Clear, Padding, Paragraph};

use super::layout::{centered, render_input};
use super::theme::{ACCENT, DIM, ERR, OK, THEME, WARN, focus_marker, focus_style, modal};
use crate::config::IdentityScope;
use crate::tui::agent_catalog::AgentKind;
use crate::tui::quickstart::{Quickstart, QuickstartFocus, QuickstartMode};

pub(crate) fn render_quickstart(
    frame: &mut Frame,
    setup: &Quickstart,
    config_path: &std::path::Path,
) {
    super::theme::render_background(frame);
    let discovered_height = (setup.agents.len() as u16 + 2).clamp(3, 9);
    let area = centered(
        84,
        frame.area().height.saturating_sub(2).min(27),
        frame.area(),
    );
    frame.render_widget(Clear, area);
    let block = modal("Quickstart", ACCENT).padding(Padding::new(2, 2, 1, 1));
    let inner = block.inner(area);
    frame.render_widget(block, area);
    let [
        intro,
        discovered_area,
        custom_area,
        _form_spacer,
        workspace_area,
        scope_area,
        _button_spacer,
        submit_area,
        warning_area,
        _details_spacer,
        details_area,
    ] = Layout::vertical([
        Constraint::Length(3),
        Constraint::Length(discovered_height),
        Constraint::Length(3),
        Constraint::Length(1),
        Constraint::Length(1),
        Constraint::Length(1),
        Constraint::Min(1),
        Constraint::Length(3),
        Constraint::Length(1),
        Constraint::Length(1),
        Constraint::Length(1),
    ])
    .areas(inner);

    let mut intro_lines = vec![
        Line::from(vec![
            Span::styled(
                " MACRO ",
                Style::new().fg(THEME.accent_text).bg(ACCENT).bold(),
            ),
            Span::raw("  "),
            Span::styled("Welcome to macrod.", Style::new().bold()),
        ]),
        Line::styled("Let's get your harness connected.", Style::new().fg(DIM)),
    ];
    if let Some((message, is_error)) = &setup.status {
        intro_lines.push(Line::styled(
            message,
            Style::new().fg(if *is_error { ERR } else { OK }),
        ));
    }
    frame.render_widget(Paragraph::new(intro_lines), intro);
    render_discovered_agents(frame, setup, discovered_area);
    render_quickstart_custom(frame, setup, custom_area);

    let workspace_focused = setup.focus == QuickstartFocus::Workspace;
    frame.render_widget(
        Paragraph::new(Line::from(vec![Span::styled(
            format!("{}{:<14}", focus_marker(workspace_focused), "Workspace"),
            Style::new().fg(DIM),
        )])),
        workspace_area,
    );
    let workspace_value_area = Rect {
        x: workspace_area.x + 16,
        width: workspace_area.width.saturating_sub(16),
        ..workspace_area
    };
    match &setup.mode {
        QuickstartMode::EditWorkspace { buffer } => {
            render_input(frame, buffer, workspace_value_area, Style::new().fg(ACCENT))
        }
        _ => frame.render_widget(
            Paragraph::new(setup.workspace.as_str()).style(focus_style(workspace_focused)),
            workspace_value_area,
        ),
    }

    let scope_focused = setup.focus == QuickstartFocus::Scope;
    let scope = match setup.scope {
        IdentityScope::Private => "Private",
        IdentityScope::Team => "Team",
    };
    frame.render_widget(
        Paragraph::new(Line::from(vec![
            Span::styled(
                format!("{}{:<14}", focus_marker(scope_focused), "Access"),
                Style::new().fg(DIM),
            ),
            Span::styled(scope, focus_style(scope_focused)),
        ])),
        scope_area,
    );
    if setup.scope == IdentityScope::Team {
        frame.render_widget(
            Paragraph::new(
                "Warning: teammates can command agents on this machine. Trust your team.",
            )
            .style(Style::new().fg(WARN))
            .alignment(Alignment::Center),
            warning_area,
        );
    }

    let submit_focused = setup.focus == QuickstartFocus::Submit;
    let button_style = if submit_focused {
        Style::new().fg(THEME.accent_text).bg(ACCENT).bold()
    } else {
        Style::new().fg(ACCENT).bold()
    };
    let button_area = Rect {
        x: submit_area.x + submit_area.width.saturating_sub(22) / 2,
        width: 22.min(submit_area.width),
        ..submit_area
    };
    frame.render_widget(
        Paragraph::new("Create and pair")
            .style(button_style)
            .alignment(Alignment::Center)
            .block(
                Block::default()
                    .borders(Borders::ALL)
                    .border_type(BorderType::Rounded)
                    .border_style(Style::new().fg(ACCENT)),
            ),
        button_area,
    );
    frame.render_widget(
        Paragraph::new(config_path.display().to_string())
            .style(Style::new().fg(DIM))
            .alignment(Alignment::Right),
        details_area,
    );
    let hint = match setup.mode {
        QuickstartMode::EditWorkspace { .. } => " Enter save   Esc cancel ",
        QuickstartMode::CustomAgent { .. } => " Enter save   Esc back ",
        QuickstartMode::Normal if setup.focus == QuickstartFocus::Agent(setup.agents.len()) => {
            " ↑↓/jk select   Enter change   ? guide   q quit "
        }
        QuickstartMode::Normal => " ↑↓/jk select   Enter choose/change   q quit ",
    };
    let footer = Rect {
        x: area.x,
        y: area.bottom(),
        width: area.width,
        height: 1,
    };
    frame.render_widget(
        Paragraph::new(Line::styled(hint, Style::new().fg(DIM))).alignment(Alignment::Center),
        footer,
    );
}

fn render_discovered_agents(frame: &mut Frame, setup: &Quickstart, area: Rect) {
    let block = Block::default()
        .title(" Discovered ")
        .title_style(Style::new().fg(DIM))
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded)
        .border_style(Style::new().fg(THEME.border))
        .padding(Padding::horizontal(1));
    let inner = block.inner(area);
    frame.render_widget(block, area);

    if setup.agents.is_empty() {
        frame.render_widget(
            Paragraph::new("No supported agent harnesses found on PATH")
                .style(Style::new().fg(WARN)),
            Rect { height: 1, ..inner },
        );
        return;
    }

    for (index, agent) in setup.agents.iter().enumerate() {
        let focused = setup.focus == QuickstartFocus::Agent(index);
        let chosen = setup
            .selected_agent
            .as_ref()
            .is_some_and(|selected| selected.kind == agent.kind);
        let row = Rect {
            y: inner.y + index as u16,
            height: 1,
            ..inner
        };
        frame.render_widget(
            Paragraph::new(Line::from(vec![
                Span::styled(focus_marker(focused), Style::new().fg(ACCENT)),
                Span::styled(if chosen { "● " } else { "○ " }, Style::new().fg(ACCENT)),
                Span::styled(format!("{:<20}", agent.name), focus_style(focused)),
                Span::styled(agent.note.unwrap_or(""), Style::new().fg(DIM)),
            ])),
            row,
        );
    }
}

fn render_quickstart_custom(frame: &mut Frame, setup: &Quickstart, area: Rect) {
    let block = Block::default()
        .title(" Custom ")
        .title_style(Style::new().fg(DIM))
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded)
        .border_style(Style::new().fg(THEME.border))
        .padding(Padding::horizontal(1));
    let inner = block.inner(area);
    frame.render_widget(block, area);

    let index = setup.agents.len();
    let focused = setup.focus == QuickstartFocus::Agent(index);
    let chosen = setup
        .selected_agent
        .as_ref()
        .is_some_and(|agent| agent.kind == AgentKind::Custom);
    let row = Rect { height: 1, ..inner };
    frame.render_widget(
        Paragraph::new(Line::from(vec![
            Span::styled(focus_marker(focused), Style::new().fg(ACCENT)),
            Span::styled(if chosen { "● " } else { "○ " }, Style::new().fg(ACCENT)),
        ])),
        row,
    );
    let value_area = Rect {
        x: row.x + 4,
        width: row.width.saturating_sub(4),
        ..row
    };
    match &setup.mode {
        QuickstartMode::CustomAgent { buffer } if buffer.value().is_empty() => {
            frame.render_widget(
                Paragraph::new("hermes acp").style(Style::new().fg(DIM).italic()),
                value_area,
            );
            frame.set_cursor_position((value_area.x, value_area.y));
        }
        QuickstartMode::CustomAgent { buffer } => {
            render_input(frame, buffer, value_area, Style::new().fg(ACCENT))
        }
        _ => {
            let value = setup
                .selected_agent
                .as_ref()
                .filter(|agent| agent.kind == AgentKind::Custom)
                .map(|agent| format!("Custom: {}", agent.launch.command))
                .unwrap_or_else(|| "Custom command...".to_owned());
            frame.render_widget(
                Paragraph::new(value).style(focus_style(focused)),
                value_area,
            );
        }
    }
}
