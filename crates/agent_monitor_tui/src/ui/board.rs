//! The quote board: eight cells of board numbers.

use ratatui::Frame;
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::text::{Line, Span};
use ratatui::widgets::Paragraph;

use agent_monitor::domain::model::Status;

use crate::app::App;
use crate::format;
use crate::theme;
use crate::theme::Token;

/// One quote cell: a label, a value in a colour, and a sub-line.
struct Quote {
    label: &'static str,
    value: String,
    color: Token,
    sub: Line<'static>,
    /// A share of the live agents, drawn as a meter after the value.
    share: Option<f64>,
}

fn quotes(app: &App) -> [Quote; 8] {
    let totals = &app.view.totals;
    let live = app
        .view
        .agents
        .values()
        .filter(|agent| !agent.status.is_final())
        .count();
    let idle = app
        .view
        .agents
        .values()
        .filter(|agent| agent.status == Status::Idle)
        .count();
    let error_rate = if totals.tools_24h == 0 {
        0.0
    } else {
        f64::from(totals.errors_24h) * 100.0 / f64::from(totals.tools_24h)
    };
    let tokens_now = totals.tokens_per_min.last().copied().unwrap_or(0);
    let tokens_hour: u64 = totals
        .tokens_per_min
        .iter()
        .map(|value| u64::from(*value))
        .sum();
    let sub = |text: String| Line::from(Span::styled(text, theme::ink(Token::TextDim)));
    let red_if = |value: u32| if value > 0 { Token::Alert } else { Token::Ok };
    let of_live = |count: u32| {
        if live == 0 {
            0.0
        } else {
            f64::from(count) / live as f64
        }
    };

    [
        Quote {
            label: "WORKING",
            value: totals.working.to_string(),
            color: Token::Ok,
            sub: sub(format!("of {live} live · {idle} idle")),
            share: Some(of_live(totals.working)),
        },
        Quote {
            label: "WAITING",
            value: totals.waiting.to_string(),
            color: if totals.waiting > 0 {
                Token::Attention
            } else {
                Token::Text
            },
            sub: sub(String::from("on a person")),
            share: Some(of_live(totals.waiting)),
        },
        Quote {
            label: "BLOCKED",
            value: totals.blocked.to_string(),
            color: if totals.blocked > 0 {
                Token::Alert
            } else {
                Token::Text
            },
            sub: sub(String::from("permission / stuck")),
            share: Some(of_live(totals.blocked)),
        },
        Quote {
            label: "TURNS 24H",
            value: format::thousands(u64::from(totals.turns_24h)),
            color: Token::Text,
            sub: sub(format!("{}/h avg", totals.turns_24h / 24)),
            share: None,
        },
        Quote {
            label: "TOOLS 24H",
            value: format::thousands(u64::from(totals.tools_24h)),
            color: Token::Info,
            sub: sub(format!("{error_rate:.1}% failed")),
            share: None,
        },
        Quote {
            label: "ERR 24H",
            value: format::thousands(u64::from(totals.errors_24h + totals.failed_24h)),
            color: red_if(totals.errors_24h + totals.failed_24h),
            sub: sub(format!("{} agents failed", totals.failed_24h)),
            share: None,
        },
        Quote {
            label: "TOK/MIN",
            value: format::compact(u64::from(tokens_now)),
            color: Token::Highlight,
            sub: {
                let mut spans = format::spark(
                    totals.tokens_per_min.iter().map(|value| u64::from(*value)),
                    14,
                    Token::Trace,
                );
                spans.push(Span::styled(
                    format!(" {}/h", format::compact(tokens_hour)),
                    theme::ink(Token::TextDim),
                ));
                Line::from(spans)
            },
            share: None,
        },
        Quote {
            label: "DAY",
            value: format::cost(totals.cost_today),
            color: Token::Highlight,
            sub: Line::from(format::spark(
                totals.cost_by_hour.iter().map(|usd| {
                    // Cents, for bar heights only.
                    (f64::from(*usd) * 100.0).round().max(0.0) as u64
                }),
                24,
                Token::Accent,
            )),
            share: None,
        },
    ]
}

/// Widest meter on a board cell.
const BOARD_METER: usize = 12;

/// Draws the board: eight boxed cells, or one line when `area` is one row.
pub fn draw(frame: &mut Frame<'_>, area: Rect, app: &App) {
    let quotes = quotes(app);

    if area.height < 4 {
        let mut spans = Vec::new();
        for quote in &quotes {
            spans.push(Span::styled(
                format!(" {} ", quote.label),
                theme::ink(Token::TextDim),
            ));
            spans.push(Span::styled(quote.value.clone(), theme::bold(quote.color)));
            spans.push(Span::styled(" ╱", theme::ink(Token::Rule)));
        }
        frame.render_widget(Paragraph::new(Line::from(spans)), area);
        return;
    }

    let cells = Layout::horizontal([Constraint::Ratio(1, 8); 8]).split(area);
    for (index, (quote, cell)) in quotes.into_iter().zip(cells.iter()).enumerate() {
        let block = theme::frame(Token::Frame)
            .title(Line::from(vec![Span::styled(
                format!(" {} ", quote.label),
                theme::bold(Token::Accent),
            )]))
            .title(
                Line::from(Span::styled(
                    format!(" Q{} ", index + 1),
                    theme::ink(Token::InfoDim),
                ))
                .right_aligned(),
            );
        let mut value = vec![Span::styled(quote.value, theme::bold(quote.color))];
        if let Some(share) = quote.share {
            let used = value.iter().map(Span::width).sum::<usize>() + 1;
            let room = usize::from(cell.width.saturating_sub(2))
                .saturating_sub(used)
                .min(BOARD_METER);
            // Display rounding of a share in [0, 1].
            let filled = (share.clamp(0.0, 1.0) * room as f64).round() as usize;
            value.push(Span::raw(" "));
            value.extend(theme::meter(filled, room, quote.color));
        }
        let lines = vec![Line::from(value), quote.sub];
        frame.render_widget(Paragraph::new(lines).block(block), *cell);
    }
}
