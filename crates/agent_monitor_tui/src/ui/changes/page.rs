//! A compact repository toolbar above the Changes timeline.

use ratatui::Frame;
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::text::Line;
use ratatui::widgets::Paragraph;

use crate::app::{App, ChangeTab};
use crate::keys::Mode;
use crate::theme;
use crate::ui::Clock;
use crate::view::LaneSort;

pub(super) fn draw(frame: &mut Frame<'_>, area: Rect, app: &mut App, clock: Clock) {
    let name = match app.change_tab() {
        Some(ChangeTab::Repo(id)) => app
            .view
            .repos
            .get(&id)
            .map_or("No repository", |graph| graph.name.as_str()),
        Some(ChangeTab::OtherPrs) => "Other PRs",
        None => "No repository",
    };
    let repo = format!("REPO: {name}");
    let scope = if app.cursors.changes.hide_landed {
        "LANDED: hide"
    } else {
        "LANDED: show"
    };
    let sort = match app.cursors.changes.sort {
        LaneSort::Attention => "SORT: attention",
        LaneSort::Fork => "SORT: fork",
    };
    let mut keys = vec![("[ ]", repo.as_str()), ("m", scope)];
    if app.change_repo().is_some() {
        keys.push(("s", sort));
    }
    keys.push(("/", "SEARCH"));
    let mut lines = Vec::new();
    let mut line = Line::default();
    for key in keys {
        let group = theme::hotkeys(&[key]);
        if line.width() > 0 && line.width() + group.width() > usize::from(area.width) {
            lines.push(line);
            line = Line::default();
        }
        line.spans.extend(group.spans);
    }
    lines.push(line);
    let height = u16::try_from(lines.len()).unwrap_or(1);
    let [toolbar, body] =
        Layout::vertical([Constraint::Length(height), Constraint::Min(0)]).areas(area);
    frame.render_widget(Paragraph::new(lines), toolbar);
    let body = if matches!(app.mode, Mode::Filter { .. }) || !app.filter.find.is_empty() {
        crate::ui::filters::draw(frame, body, app)
    } else {
        body
    };
    if app.cursors.changes.detail {
        super::detail::detail(frame, body, app, clock);
    } else {
        super::draw_transit(frame, body, app, clock, true);
    }
}
