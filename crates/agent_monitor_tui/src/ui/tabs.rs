//! Page navigation, present above every view.

use ratatui::Frame;
use ratatui::layout::Rect;
use ratatui::text::{Line, Span};
use ratatui::widgets::Paragraph;

use crate::keys::{Page, Pane};
use crate::theme::{self, Token};

/// Draws left-aligned tabs, wrapping on narrow terminals.
pub(super) fn draw(frame: &mut Frame<'_>, area: Rect, page: &Page) -> Rect {
    let active = match page {
        Page::Agent(_) => Page::Zoom(Pane::Agents),
        Page::Lane(..) => Page::Zoom(Pane::Changes),
        _ => page.clone(),
    };
    let tabs = [
        ("MONITOR", "0", Page::Monitor),
        ("AGENTS", "1", Page::Zoom(Pane::Agents)),
        ("TAPE", "2", Page::Zoom(Pane::Tape)),
        ("SPEND", "3", Page::Zoom(Pane::Spend)),
        ("FAILURES", "4", Page::Zoom(Pane::Failures)),
        ("TREE", "5", Page::Tree),
        ("SOURCES", "6", Page::Zoom(Pane::Sources)),
        ("BODY", "7", Page::Zoom(Pane::Body)),
        ("CHANGES", "8", Page::Zoom(Pane::Changes)),
        ("WALL", "w", Page::Wall),
    ];
    let mut lines = Vec::new();
    let mut line = Line::default();
    for (label, key, target) in tabs {
        let style = if active == target {
            theme::selected().fg(Token::Highlight.color())
        } else {
            theme::ink(Token::TextDim)
        };
        let tab = Span::styled(format!(" {label} "), style);
        let key = Span::styled(format!("[{key}] "), theme::ink(Token::Frame));
        if line.width() > 0 && line.width() + tab.width() + key.width() > usize::from(area.width) {
            lines.push(line);
            line = Line::default();
        }
        line.spans.extend([tab, key]);
    }
    lines.push(line);
    let height = u16::try_from(lines.len())
        .unwrap_or(area.height)
        .min(area.height);
    frame.render_widget(
        Paragraph::new(lines),
        Rect::new(area.x, area.y, area.width, height),
    );
    Rect::new(
        area.x,
        area.y + height,
        area.width,
        area.height.saturating_sub(height),
    )
}
