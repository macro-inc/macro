use ratatui::Frame;
use ratatui::layout::{Alignment, Constraint, Layout, Rect};
use ratatui::style::{Style, Stylize as _};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, BorderType, Borders, Clear, Padding, Paragraph};

use super::layout::{centered, render_input};
use super::modals::agent_groups;
use super::theme::{ACCENT, DIM, ERR, OK, THEME, WARN, focus_marker, focus_style, modal};
use crate::tui::agent_catalog::AgentKind;
use crate::tui::quickstart::{Quickstart, QuickstartFocus, QuickstartMode};

pub(crate) fn render_quickstart(
    frame: &mut Frame,
    setup: &Quickstart,
    config_path: &std::path::Path,
) {
    super::theme::render_background(frame);
    let discovered_height = (discovered_lines(setup, 0).len() as u16 + 2).clamp(3, 12);
    let area = centered(
        84,
        frame.area().height.saturating_sub(2).min(38),
        frame.area(),
    );
    frame.render_widget(Clear, area);
    let vertical_padding = u16::from(area.height >= 24);
    let block =
        modal("Quickstart", ACCENT).padding(Padding::new(2, 2, vertical_padding, vertical_padding));
    let inner = block.inner(area);
    frame.render_widget(block, area);
    let intro_height = if setup.status.is_some() { 3 } else { 2 };
    // Custom, workspace, the web note, and submit occupy eight fixed rows.
    let form_height = intro_height + discovered_height + 8;
    let [
        intro,
        discovered_area,
        custom_area,
        _form_spacer,
        workspace_area,
        web_note_area,
        _button_spacer,
        submit_area,
        _details_spacer,
        details_area,
    ] = Layout::vertical([
        Constraint::Length(intro_height),
        Constraint::Length(discovered_height),
        Constraint::Length(3),
        Constraint::Fill(1),
        Constraint::Length(1),
        Constraint::Length(1),
        Constraint::Fill(1),
        Constraint::Length(3),
        Constraint::Fill(1),
        Constraint::Length(u16::from(inner.height > form_height)),
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

    frame.render_widget(
        Paragraph::new("Name, access, and permissions are set on the web.")
            .style(Style::new().fg(DIM)),
        Rect {
            x: web_note_area.x + 16,
            width: web_note_area.width.saturating_sub(16),
            ..web_note_area
        },
    );

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

    frame.render_widget(Paragraph::new(discovered_lines(setup, inner.width)), inner);
}

fn discovered_lines(setup: &Quickstart, width: u16) -> Vec<Line<'_>> {
    agent_groups(&setup.agents, width, |index, agent| {
        let focused = setup.focus == QuickstartFocus::Agent(index);
        let chosen = setup
            .selected_agent
            .as_ref()
            .is_some_and(|selected| selected.kind == agent.kind);
        Line::from(vec![
            Span::styled(focus_marker(focused), Style::new().fg(ACCENT)),
            Span::styled(if chosen { "● " } else { "○ " }, Style::new().fg(ACCENT)),
            Span::styled(format!("{:<22}", agent.short_name()), focus_style(focused)),
            Span::styled(agent.note.unwrap_or(""), Style::new().fg(DIM)),
        ])
    })
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
