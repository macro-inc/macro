//! 8 CHANGES: a live map of the git graph agents commit to, with pull
//! requests drawn on it (TRANSIT). Time runs left to right to a NOW edge;
//! the trunk is the heavy line, work in flight hangs below it in lanes, and
//! landed work arcs above it. Each lane's row continues to the right as a
//! board row (agent, PR, CI, review, distance from the trunk, unpushed,
//! age), and an inspector under the map shows the row under the cursor.
//! Under 100 columns, and in the monitor grid, a compact list with a short
//! track per lane stands in. `p` opens a lane's own page ([`lane`]).

mod compact;
mod draw;
mod lane;
mod layout;
#[cfg(test)]
mod test;

pub use draw::draw_transit;
pub use lane::draw_lane;

use ratatui::Frame;
use ratatui::layout::Rect;
use ratatui::text::Span;

use agent_monitor::domain::model::{CiState, Lane, Pr, PrState, RepoGraph, ReviewState};

use crate::app::App;
use crate::theme;
use crate::theme::Token;
use crate::ui::Clock;

/// Width under which the zoomed page draws the compact list.
pub const TRANSIT_MIN_WIDTH: u16 = 100;

/// Draws 8 CHANGES into `area`: the map when zoomed and wide enough, else
/// the compact list.
pub fn draw(
    frame: &mut Frame<'_>,
    area: Rect,
    app: &mut App,
    clock: Clock,
    focused: bool,
    zoomed: bool,
) {
    if zoomed && area.width >= TRANSIT_MIN_WIDTH {
        draw_transit(frame, area, app, clock, focused);
    } else {
        compact::draw(frame, area, app, clock, focused, zoomed);
    }
}

/// The title's counts: lanes, open pull requests, failing, landed.
fn title_spans(app: &App) -> Vec<Span<'static>> {
    let lanes: usize = app
        .view
        .repos
        .values()
        .map(|graph| {
            graph
                .lanes
                .iter()
                .filter(|lane| lane.landed.is_none())
                .count()
        })
        .sum();
    let open = app
        .view
        .prs
        .values()
        .filter(|pr| !pr.state.is_final())
        .count();
    let failing = app
        .view
        .prs
        .values()
        .filter(|pr| !pr.state.is_final() && pr.ci == CiState::Failed)
        .count();
    let landed = app
        .view
        .prs
        .values()
        .filter(|pr| pr.state == PrState::Merged)
        .count();
    let mut spans = vec![
        Span::styled(" ▸ ", theme::ink(Token::Rule)),
        Span::styled(lanes.to_string(), theme::bold(Token::Text)),
        Span::styled(" LANES · ", theme::ink(Token::TextDim)),
        Span::styled(open.to_string(), theme::bold(Token::Text)),
        Span::styled(" PRS OPEN", theme::ink(Token::TextDim)),
    ];
    if failing > 0 {
        spans.push(Span::styled(" · ", theme::ink(Token::TextDim)));
        spans.push(Span::styled(
            format!("✕ {failing} FAILING"),
            theme::bold(Token::Alert),
        ));
    }
    if landed > 0 {
        spans.push(Span::styled(" · ", theme::ink(Token::TextDim)));
        spans.push(Span::styled(
            format!("◆ {landed} LANDED"),
            theme::bold(Token::Ok),
        ));
    }
    spans.push(Span::raw(" "));
    spans
}

/// A pull request's CI as the board writes it: ✓ passed, ◌ running,
/// ✕ failed, · none.
fn ci_mark(ci: CiState) -> (&'static str, Token) {
    match ci {
        CiState::Passed => ("✓", Token::Ok),
        CiState::Running => ("◌", Token::Highlight),
        CiState::Failed => ("✕", Token::Alert),
        CiState::None => ("·", Token::TextDim),
        CiState::Unknown => ("·", Token::Rule),
    }
}

/// A review decision (or a draft) as the board writes it.
fn review_mark(pr: &Pr) -> (&'static str, Token) {
    if pr.state == PrState::Draft {
        return ("draft", Token::TextDim);
    }
    match pr.review {
        ReviewState::Approved => ("APPR", Token::Ok),
        ReviewState::ChangesRequested => ("CHG", Token::Alert),
        ReviewState::ReviewRequired => ("REQ", Token::Attention),
        ReviewState::None => ("—", Token::Rule),
    }
}

/// How a lane is drawn: by state, never by identity.
fn lane_token(app: &App, lane: &Lane) -> Token {
    let pr = app.view.lane_pr(lane).filter(|pr| !pr.state.is_final());
    if pr.is_some_and(|pr| pr.ci == CiState::Failed) {
        Token::Alert
    } else if app.view.lane_working(lane) {
        Token::Ok
    } else if pr.is_some_and(|pr| pr.ci == CiState::Running) {
        Token::Highlight
    } else {
        Token::TextDim
    }
}

/// A lane's tag on the board: its first agent's name (◇ for a manager), else
/// its branch.
fn lane_tag(app: &App, lane: &Lane) -> String {
    match app.view.lane_agent(lane) {
        Some(agent) if agent.kind == agent_monitor::domain::model::AgentKind::Manager => {
            format!("{} ◇", agent.name)
        }
        Some(agent) => agent.name.clone(),
        None => lane.branch.clone(),
    }
}

/// A repository's tab name: the repository's own name.
fn repo_short(graph: &RepoGraph) -> &str {
    graph
        .remote
        .as_ref()
        .map_or(graph.name.as_str(), |remote| remote.name())
}

/// `−` for behind, as the board writes distances.
fn distance(ahead: u32, behind: u32) -> String {
    format!("+{ahead} −{behind}")
}
