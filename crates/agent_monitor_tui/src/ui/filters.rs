//! Persistent, shared row filters above the pages they affect.

use ratatui::Frame;
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::text::{Line, Span};
use ratatui::widgets::Paragraph;

use crate::app::App;
use crate::keys::{FilterField, Mode};
use crate::theme::{self, Token};

/// Draws page controls and returns the remaining content area.
pub(super) fn draw(frame: &mut Frame<'_>, area: Rect, app: &App) -> Rect {
    if !app.page().has_filters() {
        return area;
    }
    let [words, search, body] = Layout::vertical([
        Constraint::Length(1),
        Constraint::Length(1),
        Constraint::Min(0),
    ])
    .areas(area);
    field(frame, words, app, FilterField::Words, "FILTER", "f");
    field(frame, search, app, FilterField::Search, "SEARCH", "/");
    body
}

fn field(frame: &mut Frame<'_>, area: Rect, app: &App, field: FilterField, label: &str, key: &str) {
    if area.is_empty() {
        return;
    }
    let editing = matches!(&app.mode, Mode::Filter { field: active, .. } if *active == field);
    let value = match field {
        FilterField::Words => app.filter.words.join(" "),
        FilterField::Search => app.filter.find.clone(),
    };
    let mut spans = theme::hotkeys(&[(key, label)]).spans;
    if editing {
        if let Mode::Filter { input, .. } = &app.mode {
            // Keep the real insertion position in view, including wide characters.
            let available = usize::from(area.width)
                .saturating_sub(Line::from(spans.clone()).width())
                .max(1);
            let scroll = input.visual_scroll(available.saturating_sub(1));
            let prefix = u16::try_from(Line::from(spans.clone()).width()).unwrap_or(area.width);
            let input_area = Rect::new(
                area.x + prefix.min(area.width),
                area.y,
                area.width.saturating_sub(prefix),
                1,
            );
            frame.render_widget(Paragraph::new(Line::from(spans)), area);
            frame.render_widget(
                Paragraph::new(input.value())
                    .style(theme::bold(Token::Highlight))
                    .scroll((0, u16::try_from(scroll).unwrap_or(u16::MAX))),
                input_area,
            );
            if input_area.width > 0 {
                let cursor =
                    u16::try_from(input.visual_cursor().saturating_sub(scroll)).unwrap_or(0);
                frame
                    .set_cursor_position((input_area.x + cursor.min(input_area.width - 1), area.y));
            }
        }
        return;
    }
    spans.push(Span::styled(
        if value.is_empty() {
            String::from("any")
        } else {
            value
        },
        theme::ink(Token::Text),
    ));
    if field == FilterField::Words {
        spans.push(Span::styled("  ", theme::ink(Token::TextDim)));
        if app.page().filters_agents() {
            let ended = if app.filter.all {
                "ENDED: SHOW"
            } else {
                "ENDED: HIDE"
            };
            spans.extend(theme::hotkeys(&[("a", ended)]).spans);
        }
        spans.extend(theme::hotkeys(&[("x", "CLEAR")]).spans);
    } else if area.width >= 100 {
        spans.push(Span::styled(
            "  · filters shared across list pages",
            theme::ink(Token::TextDim),
        ));
    }
    frame.render_widget(Paragraph::new(Line::from(spans)), area);
}
