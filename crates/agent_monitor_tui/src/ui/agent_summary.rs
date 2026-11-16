//! Separate fleet status and activity summaries inside the AGENTS pane.

use ratatui::Frame;
use ratatui::layout::Rect;
use ratatui::text::{Line, Span};
use ratatui::widgets::Paragraph;

use agent_monitor::domain::model::Status;

use crate::app::App;
use crate::format;
use crate::theme::{self, Token};

/// Draw status on the first row and activity on the second.
pub fn draw(frame: &mut Frame<'_>, area: Rect, app: &App) {
    let totals = &app.view.totals;
    let idle = app
        .view
        .agents
        .values()
        .filter(|agent| agent.status == Status::Idle)
        .count();
    let mut status = vec![Span::styled("STATUS  ", theme::ink(Token::Rule))];
    for (label, value, color) in [
        ("WORKING", totals.working as usize, Token::Ok),
        ("WAITING", totals.waiting as usize, Token::Attention),
        ("BLOCKED", totals.blocked as usize, Token::Alert),
        ("IDLE", idle, Token::TextDim),
    ] {
        status.push(Span::styled(
            format!("{label} "),
            theme::ink(Token::TextDim),
        ));
        status.push(Span::styled(format!("{value}  "), theme::bold(color)));
    }
    let mut activity = vec![Span::styled("24H     ", theme::ink(Token::Rule))];
    for (label, value, color) in [
        ("TURNS", u64::from(totals.turns_24h), Token::Text),
        ("TOOLS", u64::from(totals.tools_24h), Token::Info),
    ] {
        activity.push(Span::styled(
            format!("{label} "),
            theme::ink(Token::TextDim),
        ));
        activity.push(Span::styled(
            format!("{}  ", format::compact(value)),
            theme::bold(color),
        ));
    }
    activity.push(Span::styled("│ TOK/MIN ", theme::ink(Token::TextDim)));
    activity.push(Span::styled(
        format::compact(u64::from(
            totals.tokens_per_min.last().copied().unwrap_or(0),
        )),
        theme::bold(Token::Highlight),
    ));
    frame.render_widget(
        Paragraph::new(vec![Line::from(status), Line::from(activity)]),
        area,
    );
}
