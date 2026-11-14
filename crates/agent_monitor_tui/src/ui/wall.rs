//! The wall: a card per agent, sized to the terminal, paging when agents
//! outnumber cards.

use ratatui::Frame;
use ratatui::layout::{Margin, Rect};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, BorderType, Borders, Paragraph};

use agent_monitor::domain::model::{Agent, Cost};

use crate::app::App;
use crate::format;
use crate::theme;
use crate::ui::Clock;
use crate::ui::panes::tape_tag;

/// The smallest card.
const CARD_WIDTH: u16 = 38;
const CARD_HEIGHT: u16 = 10;

/// Draws the wall page.
pub fn draw(frame: &mut Frame<'_>, area: Rect, app: &mut App, clock: Clock) {
    let agents: Vec<Agent> = app
        .view
        .sorted_agents(&app.filter)
        .into_iter()
        .cloned()
        .collect();
    // The border takes one cell on every side.
    let inner = area.inner(Margin::new(1, 1));
    let columns = (inner.width / CARD_WIDTH).max(1);
    let rows = (inner.height / CARD_HEIGHT).max(1);
    let per_page = usize::from(columns * rows);
    app.cursors.wall_columns = usize::from(columns);

    let selected = app.cursors.wall.min(agents.len().saturating_sub(1));
    let page = selected / per_page;
    let pages = agents.len().div_ceil(per_page).max(1);

    let block = theme::pane(
        "WALL",
        vec![Span::styled(
            format!(
                " {} AGENTS · PAGE {}/{} · ←→↑↓ MOVE · ENTER OPEN ",
                agents.len(),
                page + 1,
                pages
            ),
            theme::ink(theme::DIM),
        )],
        true,
    );
    frame.render_widget(block, area);

    let card_width = inner.width / columns;
    let card_height = (inner.height / rows).max(CARD_HEIGHT.min(inner.height));
    for (slot, agent) in agents
        .iter()
        .skip(page * per_page)
        .take(per_page)
        .enumerate()
    {
        let slot = u16::try_from(slot).unwrap_or(0);
        let card = Rect {
            x: inner.x + (slot % columns) * card_width,
            y: inner.y + (slot / columns) * card_height,
            width: card_width,
            height: card_height,
        };
        if card.bottom() > inner.bottom() {
            break;
        }
        let index = page * per_page + usize::from(slot);
        draw_card(frame, card, app, clock, agent, index == selected);
    }
}

/// One agent card: name strip, status, open tool, sparkline, counts and its
/// last tape lines.
pub fn draw_card(
    frame: &mut Frame<'_>,
    area: Rect,
    app: &App,
    clock: Clock,
    agent: &Agent,
    selected: bool,
) {
    let border = if selected {
        theme::YELLOW
    } else {
        theme::FAINT
    };
    let title = Line::from(vec![
        theme::status_square(agent.status, clock.blink()),
        Span::styled(format!(" {} ", agent.name), theme::strip()),
        Span::styled(format!(" {} ", agent.kind.label()), theme::ink(theme::DIM)),
    ]);
    let block = Block::default()
        .borders(Borders::ALL)
        .border_type(if selected {
            BorderType::Thick
        } else {
            BorderType::Plain
        })
        .border_style(theme::ink(border))
        .title(title)
        .style(theme::base());
    let inner = block.inner(area);
    let width = usize::from(inner.width);

    let status_color = theme::status_color(agent.status);
    let model = agent.model.clone().unwrap_or_default();
    let doing = match &agent.doing {
        Some(doing) => Span::styled(format!("▶ {doing}"), theme::ink(theme::CYAN)),
        None => Span::styled(
            agent.task.clone().unwrap_or_else(|| String::from("—")),
            theme::ink(theme::DIM),
        ),
    };
    let cost_color = if let Cost::Unpriced = agent.cost {
        theme::FAINT
    } else {
        theme::YELLOW
    };
    let started = agent
        .started
        .map_or_else(|| String::from("—"), |at| format::duration(clock.now - at));

    let mut lines = vec![
        Line::from(vec![
            Span::styled(theme::status_word(agent.status), theme::bold(status_color)),
            Span::styled(
                format!(" {}", agent.status_detail.clone().unwrap_or_default()),
                theme::ink(status_color),
            ),
            Span::styled(
                format!("  {}", format::clip(&model, 18)),
                theme::ink(theme::FAINT),
            ),
        ]),
        Line::from(doing),
        Line::from(format::activity(&agent.activity, width, theme::GREEN)),
        Line::from(vec![
            Span::styled("TRN ", theme::ink(theme::FAINT)),
            Span::styled(agent.turns.to_string(), theme::bold(theme::AMBER)),
            Span::styled(" TLS ", theme::ink(theme::FAINT)),
            Span::styled(agent.tool_calls.to_string(), theme::bold(theme::CYAN)),
            Span::styled(" ERR ", theme::ink(theme::FAINT)),
            Span::styled(
                agent.tool_errors.to_string(),
                theme::bold(if agent.tool_errors > 0 {
                    theme::RED
                } else {
                    theme::FAINT
                }),
            ),
            Span::styled(" ", theme::ink(theme::FAINT)),
            Span::styled(format::cost(agent.cost), theme::bold(cost_color)),
            Span::styled(format!(" {started}"), theme::ink(theme::DIM)),
        ]),
    ];
    let room = usize::from(inner.height).saturating_sub(lines.len());
    for event in app.view.agent_tape(&agent.id, room) {
        let (tag, color) = tape_tag(event.kind);
        lines.push(Line::from(vec![
            Span::styled(clock.time_of(event.at), theme::ink(theme::FAINT)),
            Span::styled(format!(" {tag} "), theme::ink(color)),
            Span::styled(event.text.clone(), theme::ink(theme::DIM)),
        ]));
    }

    frame.render_widget(Paragraph::new(lines).block(block), area);
}
