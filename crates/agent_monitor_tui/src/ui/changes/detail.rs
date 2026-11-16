//! Full-screen details for the selected timeline change.

use ratatui::Frame;
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Cell, Paragraph, Row, Table, TableState, Wrap};

use agent_monitor::domain::model::{CiState, Lane, Mergeable, Pr, ReviewState};

use crate::app::{App, ChangeRow};
use crate::format;
use crate::theme::{self, Token};
use crate::ui::Clock;
use crate::view::pr_state_word;

/// Resolve either a local branch or a pull request with no local checkout.
fn data<'a>(app: &'a App, row: &ChangeRow) -> (Option<&'a Lane>, Option<&'a Pr>) {
    match row {
        ChangeRow::Lane(branch) => {
            let lane = app
                .change_repo()
                .and_then(|graph| graph.lanes.iter().find(|lane| lane.branch == *branch));
            (lane, lane.and_then(|lane| app.view.lane_pr(lane)))
        }
        ChangeRow::Pr(id) => (None, app.view.prs.get(id)),
        ChangeRow::Trunk => (None, None),
    }
}

fn ci(pr: &Pr) -> (&'static str, Token) {
    match pr.ci {
        CiState::Passed => ("passed", Token::Ok),
        CiState::Failed => ("failed", Token::Alert),
        CiState::Running => ("running", Token::Highlight),
        CiState::None => ("none", Token::TextDim),
        CiState::Unknown => ("unknown", Token::TextDim),
    }
}

fn review(pr: &Pr) -> &'static str {
    match pr.review {
        ReviewState::Approved => "approved",
        ReviewState::ChangesRequested => "changes requested",
        ReviewState::ReviewRequired => "requested",
        ReviewState::None => "none",
    }
}

pub(super) fn detail(frame: &mut Frame<'_>, area: Rect, app: &App, clock: Clock) {
    let mut keys = vec![("←→", "COMMIT")];
    if app.change_agent().is_some() {
        keys.insert(0, ("a", "OPEN AGENT"));
    }
    if app.cursors.changes.detail {
        keys.push(("Esc", "BACK"));
    }
    let block = theme::pane(area, "DETAILS", Vec::new(), false);
    let inner = block.inner(area);
    frame.render_widget(block, area);
    let Some(row) = app.change_row() else {
        frame.render_widget(Paragraph::new(" Select a branch or pull request."), inner);
        return;
    };
    let (lane, pr) = data(app, &row);
    let branch = lane
        .map(|lane| lane.branch.as_str())
        .or_else(|| pr.and_then(|pr| pr.branch.as_deref()))
        .or_else(|| {
            if row == ChangeRow::Trunk {
                app.change_repo().map(|graph| graph.trunk.name.as_str())
            } else {
                None
            }
        })
        .unwrap_or("Pull request");
    let mut lines = vec![Line::from(Span::styled(
        branch.to_owned(),
        theme::ink(Token::Text),
    ))];
    if let Some(pr) = pr {
        lines.push(Line::from(format!(
            "#{} {}",
            pr.number,
            pr.title.as_deref().unwrap_or("Untitled")
        )));
        lines.push(Line::from(Span::styled(
            pr.url.clone(),
            theme::ink(Token::InfoDim),
        )));
        lines.push(Line::from(""));
        let (ci, token) = ci(pr);
        lines.push(Line::from(vec![
            Span::styled("CI       ", theme::ink(Token::TextDim)),
            Span::styled(ci, theme::ink(token)),
        ]));
        lines.push(Line::from(format!("Review   {}", review(pr))));
        lines.push(Line::from(format!("PR       {}", pr_state_word(pr.state))));
        if pr.mergeable == Mergeable::Conflicting {
            lines.push(Line::from(Span::styled(
                "Merge conflicts",
                theme::ink(Token::Alert),
            )));
        }
    } else {
        lines.push(Line::from(Span::styled(
            "No pull request",
            theme::ink(Token::TextDim),
        )));
    }
    if let Some(lane) = lane {
        lines.push(Line::from(format!(
            "Sync     {} ahead, {} behind",
            lane.ahead, lane.behind
        )));
        lines.push(Line::from(format!(
            "Local    {} unpushed commits",
            super::layout::unpushed(lane)
        )));
        let names: Vec<String> = lane.agents.iter().map(|id| app.view.name_of(id)).collect();
        if !names.is_empty() {
            lines.push(Line::from(format!("Agents   {}", names.join(", "))));
        }
    } else if matches!(row, ChangeRow::Pr(_)) {
        lines.push(Line::from("No local checkout"));
    }
    let height = lines
        .iter()
        .map(|line| {
            line.width()
                .div_ceil(usize::from(inner.width.max(1)))
                .max(1)
        })
        .sum::<usize>();
    let height = u16::try_from(height)
        .unwrap_or(inner.height)
        .min(inner.height.saturating_sub(4));
    let [summary, actions, commits_area] = Layout::vertical([
        Constraint::Length(height),
        Constraint::Length(1),
        Constraint::Min(0),
    ])
    .areas(inner);
    frame.render_widget(Paragraph::new(lines).wrap(Wrap { trim: false }), summary);
    frame.render_widget(Paragraph::new(theme::hotkeys(&keys)), actions);
    let commits = lane
        .map(|lane| lane.commits.as_slice())
        .or_else(|| {
            if row == ChangeRow::Trunk {
                app.change_repo()
                    .map(|graph| graph.trunk.commits.as_slice())
            } else {
                None
            }
        })
        .unwrap_or_default();
    let selected = app
        .cursors
        .changes
        .commit
        .as_ref()
        .and_then(|oid| commits.iter().position(|commit| commit.oid == *oid))
        .unwrap_or(0);
    let rows = commits.iter().map(|commit| {
        Row::new(vec![
            Cell::from(commit.oid.short().to_owned()).style(theme::ink(Token::InfoDim)),
            Cell::from(commit.subject.clone()),
            Cell::from(format::age(clock.now - commit.at)).style(theme::ink(Token::TextDim)),
        ])
    });
    let table = Table::new(
        rows,
        [
            Constraint::Length(8),
            Constraint::Min(0),
            Constraint::Length(5),
        ],
    )
    .header(Row::new(vec!["COMMIT", "SUBJECT", "AGE"]).style(theme::ink(Token::TextDim)))
    .row_highlight_style(theme::selected());
    frame.render_stateful_widget(
        table,
        commits_area,
        &mut TableState::default().with_selected(if commits.is_empty() {
            None
        } else {
            Some(selected)
        }),
    );
}
