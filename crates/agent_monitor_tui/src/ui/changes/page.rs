//! The Changes page shell: view tabs, repository controls and local filters.

use ratatui::Frame;
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::text::{Line, Span};
use ratatui::widgets::Paragraph;

use crate::app::{App, ChangeTab, ChangesView};
use crate::theme::{self, Token};
use crate::ui::Clock;
use crate::view::LaneSort;

pub(super) fn draw(frame: &mut Frame<'_>, area: Rect, app: &mut App, clock: Clock) {
    let [tabs, repo, controls, rest] = Layout::vertical([
        Constraint::Length(1),
        Constraint::Length(1),
        Constraint::Length(1),
        Constraint::Min(0),
    ])
    .areas(area);
    let mut spans = Vec::new();
    for (label, key, view) in [
        ("BRANCHES", "b", ChangesView::Branches),
        ("TIMELINE", "t", ChangesView::Timeline),
    ] {
        let mut style = theme::ink(Token::TextDim);
        if app.cursors.changes.view == view {
            style = style.bg(Token::Selection.color());
        }
        spans.push(Span::styled(format!(" {label} "), style));
        spans.push(Span::styled(format!("[{key}] "), theme::ink(Token::Frame)));
    }
    frame.render_widget(Paragraph::new(Line::from(spans)), tabs);
    let name = match app.change_tab() {
        Some(ChangeTab::Repo(id)) => app
            .view
            .repos
            .get(&id)
            .map_or("No repository", |graph| graph.name.as_str()),
        Some(ChangeTab::OtherPrs) => "Other PRs",
        None => "No repository",
    };
    let mut spans = vec![Span::styled(
        format!(" REPO: {name}  "),
        theme::ink(Token::Text),
    )];
    spans.extend(theme::hotkeys(&[("[ ]", "PREV/NEXT")]).spans);
    frame.render_widget(Paragraph::new(Line::from(spans)), repo);
    let branches = app.cursors.changes.view == ChangesView::Branches;
    let scope = match (branches, app.cursors.changes.hide_landed) {
        (true, true) => "SHOW: active",
        (true, false) => "SHOW: all",
        (false, true) => "LANDED: hidden",
        (false, false) => "LANDED: shown",
    };
    let sort = match (branches, app.cursors.changes.sort) {
        (_, LaneSort::Attention) => "SORT: attention",
        (true, LaneSort::Fork) => "SORT: branch",
        (false, LaneSort::Fork) => "SORT: fork",
    };
    frame.render_widget(
        Paragraph::new(
            theme::hotkeys(&[("m", scope), ("s", sort), ("n N", "ATTENTION")]).left_aligned(),
        ),
        controls,
    );
    let rest = crate::ui::filters::draw(frame, rest, app);
    if app.cursors.changes.detail {
        super::branches::detail(frame, rest, app, clock);
    } else if branches || app.change_repo().is_none() {
        super::branches::draw(frame, rest, app, clock);
    } else {
        let [controls, body] =
            Layout::vertical([Constraint::Length(1), Constraint::Min(0)]).areas(rest);
        frame.render_widget(
            Paragraph::new(
                theme::hotkeys(&[
                    ("+ -", "ZOOM"),
                    ("< >", "PAN"),
                    ("Home", "NOW"),
                    ("Enter", "INSPECT"),
                ])
                .left_aligned(),
            ),
            controls,
        );
        super::draw_transit(frame, body, app, clock, true);
    }
}
