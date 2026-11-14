//! The quote board: eight cells of board numbers.

use ratatui::Frame;
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::style::Color;
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, BorderType, Borders, Paragraph};

use agent_monitor::domain::model::Status;

use crate::app::App;
use crate::format;
use crate::theme;

/// One quote cell: a label, a value in a colour, and a sub-line.
struct Quote {
    label: &'static str,
    value: String,
    color: Color,
    sub: Line<'static>,
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
    let tokens_hour: u64 = totals.tokens_per_min.iter().map(|value| u64::from(*value)).sum();
    let sub = |text: String| Line::from(Span::styled(text, theme::ink(theme::DIM)));
    let red_if = |value: u32| if value > 0 { theme::RED } else { theme::GREEN };

    [
        Quote {
            label: "WORKING",
            value: totals.working.to_string(),
            color: theme::GREEN,
            sub: sub(format!("of {live} live · {idle} idle")),
        },
        Quote {
            label: "WAITING",
            value: totals.waiting.to_string(),
            color: theme::YELLOW,
            sub: sub(String::from("on a person")),
        },
        Quote {
            label: "BLOCKED",
            value: totals.blocked.to_string(),
            color: if totals.blocked > 0 { theme::RED } else { theme::AMBER },
            sub: sub(String::from("permission / stuck")),
        },
        Quote {
            label: "TURNS 24H",
            value: format::thousands(u64::from(totals.turns_24h)),
            color: theme::AMBER,
            sub: sub(format!("{}/h avg", totals.turns_24h / 24)),
        },
        Quote {
            label: "TOOLS 24H",
            value: format::thousands(u64::from(totals.tools_24h)),
            color: theme::CYAN,
            sub: sub(format!("{error_rate:.1}% failed")),
        },
        Quote {
            label: "ERR 24H",
            value: format::thousands(u64::from(totals.errors_24h + totals.failed_24h)),
            color: red_if(totals.errors_24h + totals.failed_24h),
            sub: sub(format!("{} agents failed", totals.failed_24h)),
        },
        Quote {
            label: "TOK/MIN",
            value: format::compact(u64::from(tokens_now)),
            color: theme::YELLOW,
            sub: {
                let mut spans = format::spark(
                    totals.tokens_per_min.iter().map(|value| u64::from(*value)),
                    14,
                    theme::GREEN,
                );
                spans.push(Span::styled(format!(" {}/h", format::compact(tokens_hour)), theme::ink(theme::DIM)));
                Line::from(spans)
            },
        },
        Quote {
            label: "DAY",
            value: format::cost(totals.cost_today),
            color: theme::YELLOW,
            sub: Line::from(format::spark(
                totals.cost_by_hour.iter().map(|usd| {
                    // Cents, for bar heights only.
                    (f64::from(*usd) * 100.0).round().max(0.0) as u64
                }),
                24,
                theme::STRIP,
            )),
        },
    ]
}

/// Draws the board: eight boxed cells, or one line when `area` is one row.
pub fn draw(frame: &mut Frame<'_>, area: Rect, app: &App) {
    let quotes = quotes(app);

    if area.height < 4 {
        let mut spans = Vec::new();
        for quote in &quotes {
            spans.push(Span::styled(format!(" {} ", quote.label), theme::ink(theme::DIM)));
            spans.push(Span::styled(quote.value.clone(), theme::bold(quote.color)));
            spans.push(Span::styled(" │", theme::ink(theme::FAINT)));
        }
        frame.render_widget(Paragraph::new(Line::from(spans)), area);
        return;
    }

    let cells = Layout::horizontal([Constraint::Ratio(1, 8); 8]).split(area);
    for (quote, cell) in quotes.into_iter().zip(cells.iter()) {
        let block = Block::default()
            .borders(Borders::ALL)
            .border_type(BorderType::Plain)
            .border_style(theme::ink(theme::FAINT))
            .title(Span::styled(format!(" {} ", quote.label), theme::bold(theme::STRIP)))
            .style(theme::base());
        let lines = vec![
            Line::from(Span::styled(quote.value, theme::bold(quote.color))),
            quote.sub,
        ];
        frame.render_widget(Paragraph::new(lines).block(block), *cell);
    }
}
