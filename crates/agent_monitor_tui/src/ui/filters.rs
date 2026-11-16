//! Controls specific to the current list page.

use ratatui::Frame;
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::text::{Line, Span};
use ratatui::widgets::Paragraph;

use crate::app::App;
use crate::keys::{Mode, Page, Pane};
use crate::theme::{self, Token};

/// Draws only the controls relevant to this page.
pub(super) fn draw(frame: &mut Frame<'_>, area: Rect, app: &App) -> Rect {
    if !app.page().has_filters() {
        return area;
    }
    let area = if app.page().filters_agent_rows() {
        let [controls, rest] =
            Layout::vertical([Constraint::Length(1), Constraint::Min(0)]).areas(area);
        let kind = format!(
            "KIND: {}",
            app.filter.kind.map_or("all", |kind| kind.label())
        );
        let status = app.filter.status.map_or_else(
            || String::from("STATUS: all"),
            |status| format!("STATUS: {status:?}"),
        );
        let mut keys = vec![("t", kind.as_str()), ("s", status.as_str())];
        if app.page().filters_agents() {
            keys.push((
                "a",
                if app.filter.all {
                    "ENDED: show"
                } else {
                    "ENDED: hide"
                },
            ));
        }
        frame.render_widget(
            Paragraph::new(theme::hotkeys(&keys).left_aligned()),
            controls,
        );
        rest
    } else {
        area
    };
    let [search, body] = Layout::vertical([Constraint::Length(1), Constraint::Min(0)]).areas(area);
    search_field(frame, search, app);
    body
}

fn search_field(frame: &mut Frame<'_>, area: Rect, app: &App) {
    if area.is_empty() {
        return;
    }
    let label = match app.page() {
        Page::Zoom(Pane::Tape) => "EVENT TEXT",
        Page::Zoom(Pane::Failures) => "FAILURE TEXT",
        Page::Zoom(Pane::Changes) => "BRANCH / PR",
        _ => "NAME / TASK",
    };
    let mut spans = theme::hotkeys(&[("x", "CLEAR"), ("/", label)]).spans;
    if let Mode::Filter { input, .. } = &app.mode {
        let prefix = u16::try_from(Line::from(spans.clone()).width())
            .unwrap_or(area.width)
            .min(area.width);
        let input_area = Rect::new(area.x + prefix, area.y, area.width - prefix, 1);
        let scroll = input.visual_scroll(usize::from(input_area.width.saturating_sub(1)));
        frame.render_widget(Paragraph::new(Line::from(spans)), area);
        frame.render_widget(
            Paragraph::new(input.value())
                .style(theme::bold(Token::Highlight))
                .scroll((0, u16::try_from(scroll).unwrap_or(u16::MAX))),
            input_area,
        );
        if input_area.width > 0 {
            let cursor = u16::try_from(input.visual_cursor().saturating_sub(scroll)).unwrap_or(0);
            frame.set_cursor_position((input_area.x + cursor.min(input_area.width - 1), area.y));
        }
    } else {
        spans.push(Span::styled(
            if app.filter.find.is_empty() {
                "any"
            } else {
                &app.filter.find
            },
            theme::ink(Token::Text),
        ));
        frame.render_widget(Paragraph::new(Line::from(spans)), area);
    }
}
