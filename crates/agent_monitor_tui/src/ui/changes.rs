//! Changes: a branch list with selected details, plus a separate timeline tab.
//! The monitor keeps the compact summary. Both full-page presentations share
//! repository, search and selection state; the timeline owns time controls.

mod branches;
mod compact;
mod draw;
mod lane;
mod layout;
mod page;
#[cfg(test)]
mod test;

pub use draw::draw_transit;
pub use lane::draw_lane;

use ratatui::Frame;
use ratatui::layout::Rect;
use ratatui::text::Span;

use agent_monitor::domain::model::{CiState, Lane, Pr, PrState, RepoGraph, ReviewState};

use crate::app::{App, ChangeTab};
use crate::theme;
use crate::theme::Token;
use crate::ui::Clock;
use crate::view::{Attention, Filter};

/// Draws the Changes page when zoomed, otherwise the monitor summary.
pub fn draw(
    frame: &mut Frame<'_>,
    area: Rect,
    app: &mut App,
    clock: Clock,
    focused: bool,
    zoomed: bool,
) {
    if zoomed {
        page::draw(frame, area, app, clock);
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

/// The tab strip: `REPO`, each mapped repository with its open lanes (✕
/// when one fails CI), then the other pull requests tab; the shown tab is a
/// chip.
fn tab_spans(app: &App) -> Vec<Span<'static>> {
    let current = app.change_tab();
    let mut spans = vec![Span::styled("REPO ", theme::ink(Token::TextDim))];
    for tab in app.change_tabs() {
        let (text, failing) = match &tab {
            ChangeTab::Repo(id) => {
                let Some(graph) = app.view.repos.get(id) else {
                    continue;
                };
                let lanes = graph
                    .lanes
                    .iter()
                    .filter(|lane| lane.landed.is_none())
                    .count();
                let failing = graph
                    .lanes
                    .iter()
                    .any(|lane| app.view.attention(lane) == Some(Attention::Failing));
                (format!(" {} {lanes}", repo_short(graph)), failing)
            }
            ChangeTab::OtherPrs => {
                let prs = app.view.unmapped_prs(&Filter::default());
                let open = prs.iter().filter(|pr| !pr.state.is_final()).count();
                let failing = prs
                    .iter()
                    .any(|pr| !pr.state.is_final() && pr.ci == CiState::Failed);
                (format!(" other PRs {open}"), failing)
            }
        };
        let text = format!("{text}{} ", if failing { " ✕" } else { "" });
        let style = if current.as_ref() == Some(&tab) {
            theme::chip(Token::Text)
        } else if failing {
            theme::ink(Token::Alert)
        } else {
            theme::ink(Token::TextDim)
        };
        spans.push(Span::styled(text, style));
    }
    spans
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
