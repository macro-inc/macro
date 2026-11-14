//! One lane's page (`p` on CHANGES): its commits newest first with their
//! subjects and pushed state, where it forks, its pull request, and the
//! agents on it (Enter opens one).

use ratatui::Frame;
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::text::{Line, Span};
use ratatui::widgets::Paragraph;

use agent_monitor::domain::model::{LaneBase, Mergeable, RepoId};

use super::layout::unpushed;
use super::{ci_mark, distance, review_mark};
use crate::app::App;
use crate::format;
use crate::theme;
use crate::theme::Token;
use crate::ui::Clock;
use crate::view::pr_state_word;

/// Width of the right column (pull request and agents).
const SIDE: u16 = 56;

/// Draws the page for `branch` of `repo`.
pub fn draw_lane(
    frame: &mut Frame<'_>,
    area: Rect,
    app: &App,
    clock: Clock,
    repo: &RepoId,
    branch: &str,
) {
    let graph = app.view.repos.get(repo);
    let lane = graph.and_then(|graph| graph.lanes.iter().find(|lane| lane.branch == branch));
    let title = vec![
        Span::styled(" ▸ ", theme::ink(Token::Rule)),
        Span::styled(branch.to_owned(), theme::bold(Token::Text)),
        Span::styled(
            graph.map_or_else(String::new, |graph| format!("  {}", graph.name)),
            theme::ink(Token::TextDim),
        ),
        Span::raw(" "),
    ];
    let block = theme::pane("8 CHANGES", title, true);
    let inner = block.inner(area);
    frame.render_widget(block, area);
    let (Some(graph), Some(lane)) = (graph, lane) else {
        frame.render_widget(
            Paragraph::new(Span::styled("  this lane is gone", theme::ink(Token::Rule))),
            inner,
        );
        return;
    };

    let [left, right] = Layout::horizontal([
        Constraint::Min(0),
        Constraint::Length(SIDE.min(inner.width / 2)),
    ])
    .areas(inner);
    let token = super::lane_token(app, lane);
    let pushed_from = unpushed(lane);
    let subject_width = usize::from(left.width).saturating_sub(24);

    let mut lines = vec![Line::from(Span::styled(
        format!(
            "  {}{}{}",
            format::cell("GRAPH", 7),
            format::cell("COMMIT", 9),
            format::cell("AGE", 6)
        ) + "SUBJECT",
        theme::bold(Token::Rule),
    ))];
    for (position, commit) in lane.commits.iter().enumerate() {
        let pushed = position >= pushed_from;
        let glyph = match (position, pushed) {
            (0, _) if app.view.lane_working(lane) => "▶",
            (_, true) => "●",
            (_, false) => "○",
        };
        let mut spans = vec![
            Span::styled("  ", theme::base()),
            Span::styled(
                format::cell(glyph, 7),
                theme::bold(if pushed { token } else { Token::TextDim }),
            ),
            Span::styled(
                format::cell(commit.oid.short(), 9),
                theme::ink(Token::InfoDim),
            ),
            Span::styled(
                format::cell(&format::age(clock.now - commit.at), 6),
                theme::ink(Token::TextDim),
            ),
            Span::styled(
                format::clip(&commit.subject, subject_width),
                theme::ink(Token::Text),
            ),
        ];
        if !pushed {
            spans.push(Span::styled(
                "  ↑ not pushed",
                theme::bold(Token::Attention),
            ));
        }
        if commit.merge {
            spans.push(Span::styled("  merge", theme::ink(Token::InfoDim)));
        }
        lines.push(Line::from(spans));
        lines.push(Line::from(Span::styled("  │", theme::ink(token))));
    }
    if lane.elided > 0 {
        lines.push(Line::from(Span::styled(
            format!("  ⋮ {} more", lane.elided),
            theme::ink(Token::Rule),
        )));
    }
    let base = match &lane.base {
        LaneBase::Trunk { oid, at } => format!(
            "  ╰─ forks from {} at {} · {} ago · {}",
            graph.trunk.name,
            oid.short(),
            format::age(clock.now - *at),
            distance(lane.ahead, lane.behind)
        ),
        LaneBase::Lane { branch, oid } => format!(
            "  ╰─ stacked on {branch} at {} · {}",
            oid.short(),
            distance(lane.ahead, lane.behind)
        ),
    };
    lines.push(Line::from(Span::styled(base, theme::ink(Token::TextDim))));
    if let Some(worktree) = &lane.worktree {
        lines.push(Line::from(Span::styled(
            format!("     checked out in {}", worktree.display()),
            theme::ink(Token::Rule),
        )));
    }
    frame.render_widget(Paragraph::new(lines), left);

    // The pull request, then the agents.
    let mut side = vec![Line::from(Span::styled(
        "PULL REQUEST",
        theme::bold(Token::Rule),
    ))];
    match app.view.lane_pr(lane) {
        Some(pr) => {
            let (ci, ci_token) = ci_mark(pr.ci);
            let (review, review_token) = review_mark(pr);
            side.push(Line::from(vec![
                Span::styled(format!("#{} ", pr.number), theme::bold(Token::Highlight)),
                Span::styled(pr_state_word(pr.state), theme::ink(Token::Text)),
            ]));
            side.push(Line::from(Span::styled(
                format::clip(&pr.title.clone().unwrap_or_default(), usize::from(SIDE) - 2),
                theme::bold(Token::Text),
            )));
            side.push(Line::from(Span::styled(
                pr.url.clone(),
                theme::ink(Token::InfoDim),
            )));
            side.push(Line::from(vec![
                Span::styled("CI ", theme::ink(Token::TextDim)),
                Span::styled(ci, theme::bold(ci_token)),
                Span::styled("   REVIEW ", theme::ink(Token::TextDim)),
                Span::styled(review, theme::ink(review_token)),
                Span::styled(
                    if pr.mergeable == Mergeable::Conflicting {
                        "   ⚠ conflicts"
                    } else {
                        ""
                    },
                    theme::bold(Token::Alert),
                ),
            ]));
            let opened = pr
                .opened_at
                .map_or_else(|| String::from("—"), |at| format::age(clock.now - at));
            let updated = pr
                .updated_at
                .map_or_else(|| String::from("—"), |at| format::age(clock.now - at));
            side.push(Line::from(Span::styled(
                format!("opened {opened} ago · updated {updated} ago"),
                theme::ink(Token::TextDim),
            )));
        }
        None => side.push(Line::from(Span::styled("none", theme::ink(Token::Rule)))),
    }
    side.push(Line::from(""));
    side.push(Line::from(Span::styled(
        "AGENTS  (ENTER OPENS)",
        theme::bold(Token::Rule),
    )));
    for (index, id) in lane.agents.iter().enumerate() {
        let chosen = index == app.cursors.changes.lane_agent;
        let line = match app.view.agents.get(id) {
            Some(agent) => Line::from(vec![
                theme::status_square(agent.status, clock.blink()),
                Span::raw(" "),
                Span::styled(format::cell(&agent.name, 22), theme::bold(Token::Text)),
                Span::styled(
                    format::cell(agent.kind.label(), 10),
                    theme::ink(Token::TextDim),
                ),
                Span::styled(
                    theme::status_word(agent.status),
                    theme::ink(theme::status_color(agent.status)),
                ),
            ]),
            None => Line::from(Span::styled(
                app.view.name_of(id),
                theme::ink(Token::TextDim),
            )),
        };
        side.push(if chosen {
            line.style(theme::selected())
        } else {
            line
        });
    }
    if lane.agents.is_empty() {
        side.push(Line::from(Span::styled(
            "none on this lane",
            theme::ink(Token::Rule),
        )));
    }
    frame.render_widget(Paragraph::new(side), right);
}
