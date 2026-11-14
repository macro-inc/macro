//! The 5 TREE page: every agent under its parent, with the selected agent's
//! card beside the tree.

use std::collections::{BTreeMap, HashSet};

use ratatui::Frame;
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::text::{Line, Span};
use tui_tree_widget::{Tree, TreeItem};

use agent_monitor::domain::model::{Agent, AgentId};

use crate::app::App;
use crate::format;
use crate::theme;
use crate::ui::Clock;
use crate::ui::wall::draw_card;
use crate::view::Filter;

/// Width the tree text pads names to.
const NAME_WIDTH: usize = 16;

/// Draws the tree page.
pub fn draw(frame: &mut Frame<'_>, area: Rect, app: &mut App, clock: Clock) {
    // The tree is the history view: ended agents stay under their parents.
    let filter = Filter {
        all: true,
        ..app.filter.clone()
    };
    let agents: Vec<Agent> = app
        .view
        .sorted_agents(&filter)
        .into_iter()
        .cloned()
        .collect();
    let shown: HashSet<&AgentId> = agents.iter().map(|agent| &agent.id).collect();

    // Children under the parent that lists them or that they name, so a
    // tree survives either side of the link being missing.
    let mut children: BTreeMap<&AgentId, Vec<&Agent>> = BTreeMap::new();
    let mut roots: Vec<&Agent> = Vec::new();
    for agent in &agents {
        match agent
            .parent
            .as_ref()
            .filter(|parent| shown.contains(parent))
        {
            Some(parent) => children.entry(parent).or_default().push(agent),
            None => roots.push(agent),
        }
    }

    let mut opened = Vec::new();
    let mut path = Vec::new();
    let items: Vec<TreeItem<'static, String>> = roots
        .iter()
        .map(|agent| item(agent, &children, clock, &mut path, &mut opened, 0))
        .collect();
    for node in opened {
        if let Some(last) = node.last()
            && app.cursors.tree_seen.insert(last.clone())
        {
            app.cursors.tree.open(node);
        }
    }
    if app.cursors.tree.selected().is_empty() {
        app.cursors.tree.select_first();
    }

    let [tree_area, side] = if area.width >= 120 {
        Layout::horizontal([Constraint::Min(0), Constraint::Length(44)]).areas(area)
    } else {
        Layout::horizontal([Constraint::Min(0), Constraint::Length(0)]).areas(area)
    };

    let block = theme::pane(
        "5 TREE",
        vec![Span::styled(
            format!(
                " {} AGENTS · {} ROOTS · ←→ FOLD · ENTER OPEN ",
                agents.len(),
                roots.len()
            ),
            theme::ink(theme::DIM),
        )],
        true,
    );
    match Tree::new(&items) {
        Ok(tree) => {
            let tree = tree
                .block(block)
                .highlight_style(theme::selected())
                .node_closed_symbol("▸ ")
                .node_open_symbol("▾ ")
                .node_no_children_symbol("· ");
            frame.render_stateful_widget(tree, tree_area, &mut app.cursors.tree);
        }
        Err(error) => {
            frame.render_widget(
                ratatui::widgets::Paragraph::new(Span::styled(
                    error.to_string(),
                    theme::ink(theme::RED),
                ))
                .block(block),
                tree_area,
            );
        }
    }

    if side.width == 0 {
        return;
    }
    let selected = app
        .cursors
        .tree
        .selected()
        .last()
        .and_then(|id| agents.iter().find(|agent| agent.id.as_str() == id));
    if let Some(agent) = selected {
        let card_height = side.height.min(16);
        let [card, rest] =
            Layout::vertical([Constraint::Length(card_height), Constraint::Min(0)]).areas(side);
        draw_card(frame, card, app, clock, agent, true);
        frame.render_widget(
            ratatui::widgets::Paragraph::new(details(agent, clock)).block(theme::pane(
                "DETAIL",
                Vec::new(),
                false,
            )),
            rest,
        );
    }
}

/// Key facts about an agent, one per line.
fn details(agent: &Agent, clock: Clock) -> Vec<Line<'static>> {
    let field = |label: &str, value: String| {
        Line::from(vec![
            Span::styled(format::cell(label, 9), theme::ink(theme::FAINT)),
            Span::styled(value, theme::ink(theme::AMBER)),
        ])
    };
    let or_dash = |value: Option<String>| value.unwrap_or_else(|| String::from("—"));
    vec![
        field("ID", agent.id.to_string()),
        field("TASK", or_dash(agent.task.clone())),
        field("PROGRAM", or_dash(agent.program.clone())),
        field("MODEL", or_dash(agent.model.clone())),
        field("BRANCH", or_dash(agent.branch.clone())),
        field("TERMINAL", or_dash(agent.terminal.clone())),
        field(
            "STARTED",
            or_dash(agent.started.map(|at| clock.time_of(at))),
        ),
        field("CHILDREN", agent.children.len().to_string()),
        field("TOKENS", format::thousands(agent.tokens.total())),
    ]
}

fn item(
    agent: &Agent,
    children: &BTreeMap<&AgentId, Vec<&Agent>>,
    clock: Clock,
    path: &mut Vec<String>,
    opened: &mut Vec<Vec<String>>,
    depth: usize,
) -> TreeItem<'static, String> {
    path.push(agent.id.to_string());
    let kids: Vec<TreeItem<'static, String>> = children
        .get(&agent.id)
        .map(|kids| {
            kids.iter()
                .map(|kid| item(kid, children, clock, path, opened, depth + 1))
                .collect()
        })
        .unwrap_or_default();
    if !kids.is_empty() {
        opened.push(path.clone());
    }
    path.pop();

    // The widget indents two columns per level; the name gives them back so
    // the columns after it line up.
    let name_width = NAME_WIDTH.saturating_sub(depth * 2).max(6);
    let started = agent
        .started
        .map_or_else(|| String::from("--:--:--"), |at| clock.time_of(at));
    let age = agent
        .started
        .map_or_else(|| String::from("—"), |at| format::age(clock.now - at));
    let line = Line::from(vec![
        theme::status_square(agent.status, clock.blink()),
        Span::raw(" "),
        Span::styled(format::cell(agent.kind.label(), 9), theme::ink(theme::DIM)),
        Span::styled(
            format::cell(&agent.name, name_width),
            theme::bold(theme::AMBER),
        ),
        Span::styled(
            format!(" {} ", theme::status_word(agent.status)),
            theme::ink(theme::status_color(agent.status)),
        ),
        Span::styled(started, theme::ink(theme::FAINT)),
        Span::styled(format::right(&age, 5), theme::ink(theme::DIM)),
        Span::styled(
            format::right(&format::cost(agent.cost), 9),
            theme::bold(theme::YELLOW),
        ),
        Span::styled(
            format!(" {:>3}▸", agent.children.len()),
            theme::ink(theme::FAINT),
        ),
        Span::raw("  "),
        match &agent.doing {
            Some(doing) => Span::styled(doing.clone(), theme::ink(theme::CYAN)),
            None => Span::styled(
                agent.task.clone().unwrap_or_default(),
                theme::ink(theme::DIM),
            ),
        },
    ]);

    let id = agent.id.to_string();
    match TreeItem::new(id.clone(), line.clone(), kids) {
        Ok(item) => item,
        // Duplicate child ids cannot happen (ids are unique map keys); show the
        // row without children rather than failing the frame.
        Err(_) => TreeItem::new_leaf(id, line),
    }
}
