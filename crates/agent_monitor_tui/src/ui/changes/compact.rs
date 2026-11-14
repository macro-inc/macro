//! The compact CHANGES list for the monitor grid and narrow terminals: one
//! row per lane, lanes needing attention first, with a short track of the
//! lane's last twelve hours in place of the map.

use std::collections::HashSet;

use ratatui::Frame;
use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::Style;
use ratatui::text::{Line, Span};
use ratatui::widgets::Paragraph;

use agent_monitor::domain::model::{Lane, PrState};

use super::layout::{self, Viewport};
use super::{ci_mark, distance, lane_tag, lane_token, review_mark, title_spans};
use crate::app::{App, ChangeRow};
use crate::format;
use crate::theme;
use crate::theme::Token;
use crate::ui::Clock;
use crate::ui::panes::pr_line;
use crate::view::{Attention, LaneSort};

/// Track cells and what each stands for: 16 × 45 minutes = 12 hours.
const TRACK_CELLS: u16 = 16;
const TRACK_SECS: i64 = 45 * 60;

/// Draws the list into `area`.
pub fn draw(
    frame: &mut Frame<'_>,
    area: Rect,
    app: &mut App,
    clock: Clock,
    focused: bool,
    zoomed: bool,
) {
    let block = theme::pane("8 CHANGES", title_spans(app), focused || zoomed);
    let inner = block.inner(area);
    frame.render_widget(block, area);
    let width = usize::from(inner.width);
    let height = usize::from(inner.height);
    if height == 0 {
        return;
    }

    let Some(graph) = app.change_repo().cloned() else {
        // No repository mapped: the pull requests alone, as a list.
        let prs = app.view.sorted_prs(&app.filter);
        let mut lines: Vec<Line<'_>> = prs
            .iter()
            .take(height)
            .map(|pr| pr_line(app, clock, pr, width, width >= 64, false))
            .collect();
        if lines.is_empty() {
            lines.push(Line::from(Span::styled(
                "  no repositories or pull requests yet",
                theme::ink(Token::Rule),
            )));
        }
        frame.render_widget(Paragraph::new(lines), inner);
        return;
    };

    let lanes: Vec<Lane> = app
        .view
        .sorted_lanes(&graph, &app.filter, LaneSort::Attention)
        .into_iter()
        .cloned()
        .collect();
    let refs: Vec<&Lane> = lanes.iter().collect();
    let landed: Vec<&Lane> = graph
        .lanes
        .iter()
        .filter(|lane| lane.landed.is_some())
        .collect();
    let scene = layout::layout(
        &graph,
        &refs,
        &[],
        &HashSet::new(),
        Viewport {
            cols: TRACK_CELLS,
            rows: 0,
            col_secs: TRACK_SECS,
            now: layout::quantize(clock.now, TRACK_SECS, 0),
            scroll: 0,
            arc_rows: 0,
        },
    );

    let show_rev = width >= 70;
    let show_track = width >= 60;
    let show_main = width >= 84;
    let buffer = frame.buffer_mut();
    let mut header = vec![Span::styled(
        format::cell("  LANE", 18),
        theme::bold(Token::Rule),
    )];
    header.push(Span::styled(
        format::cell("PR", 8),
        theme::bold(Token::Rule),
    ));
    header.push(Span::styled(
        format::cell("CI", 3),
        theme::bold(Token::Rule),
    ));
    if show_rev {
        header.push(Span::styled(
            format::cell("REV", 7),
            theme::bold(Token::Rule),
        ));
    }
    if show_track {
        header.push(Span::styled(
            format::cell("12h ········ NOW", 18),
            theme::bold(Token::Rule),
        ));
    }
    if show_main {
        header.push(Span::styled(
            format::cell("±MAIN", 11),
            theme::bold(Token::Rule),
        ));
    }
    header.push(Span::styled("AGE", theme::bold(Token::Rule)));
    write(buffer, inner.x, inner.y, inner.right(), &header);

    let selected = app.change_row();
    let rows = height.saturating_sub(2);
    let cursor = match &selected {
        Some(ChangeRow::Lane(branch)) => lanes.iter().position(|lane| lane.branch == *branch),
        _ => None,
    };
    let scroll = layout::scroll_for(cursor, app.cursors.changes.scroll, rows)
        .min(lanes.len().saturating_sub(rows));
    app.cursors.changes.scroll = scroll;

    for (offset, (index, lane)) in lanes.iter().enumerate().skip(scroll).take(rows).enumerate() {
        let y = inner.y + 1 + u16::try_from(offset).unwrap_or(0);
        let pr = app.view.lane_pr(lane);
        let working = app.view.lane_working(lane);
        let (mark, mark_token) = match app.view.attention(lane) {
            Some(Attention::Failing) => ("✕ ", Token::Alert),
            Some(Attention::Conflicts) => ("⚠ ", Token::Alert),
            Some(Attention::ChangesRequested) => ("! ", Token::Attention),
            None if working => ("▶ ", Token::Ok),
            None => ("  ", Token::Rule),
        };
        let mut spans = vec![
            Span::styled(mark, theme::bold(mark_token)),
            Span::styled(
                format::cell(&lane_tag(app, lane), 16),
                theme::bold(if working { Token::Text } else { Token::TextDim }),
            ),
        ];
        match pr {
            Some(pr) => {
                let (ci, ci_token) = ci_mark(pr.ci);
                spans.push(Span::styled(
                    format::cell(&format!("#{}", pr.number), 8),
                    theme::bold(Token::Highlight),
                ));
                spans.push(Span::styled(format::cell(ci, 3), theme::bold(ci_token)));
                if show_rev {
                    let (review, token) = review_mark(pr);
                    spans.push(Span::styled(format::cell(review, 7), theme::ink(token)));
                }
            }
            None => {
                spans.push(Span::styled(format::cell("—", 8), theme::ink(Token::Rule)));
                spans.push(Span::styled(format::cell("·", 3), theme::ink(Token::Rule)));
                if show_rev {
                    spans.push(Span::styled(format::cell("—", 7), theme::ink(Token::Rule)));
                }
            }
        }
        let track_x = write(buffer, inner.x, y, inner.right(), &spans);
        let mut x = track_x;
        if show_track {
            if let Some(row) = scene.lanes.get(index) {
                track(
                    buffer,
                    track_x,
                    y,
                    row,
                    lane,
                    lane_token(app, lane),
                    working,
                );
            }
            x = track_x + TRACK_CELLS + 2;
        }
        let mut tail = Vec::new();
        if show_main {
            tail.push(Span::styled(
                format::cell(&distance(lane.ahead, lane.behind), 11),
                theme::ink(Token::TextDim),
            ));
        }
        let age = lane
            .tip()
            .map_or_else(|| String::from("—"), |tip| format::age(clock.now - tip.at));
        tail.push(Span::styled(
            format::right(&age, 4),
            theme::ink(Token::Text),
        ));
        write(buffer, x, y, inner.right(), &tail);
        if selected == Some(ChangeRow::Lane(lane.branch.clone())) && (focused || zoomed) {
            for column in inner.left()..inner.right() {
                if let Some(cell) = buffer.cell_mut((column, y)) {
                    cell.set_bg(Token::Selection.color());
                }
            }
        }
    }

    // The last line: what landed, and pull requests with no lane.
    let y = inner.bottom().saturating_sub(1);
    let mut spans = Vec::new();
    for lane in landed.iter().take(4) {
        let pr = app.view.lane_pr(lane);
        let age = pr
            .and_then(|pr| pr.closed_at)
            .map_or_else(String::new, |at| {
                format!(" {}", format::age(clock.now - at))
            });
        let name = pr.map_or_else(|| lane.branch.clone(), |pr| format!("#{}", pr.number));
        spans.push(Span::styled("◆ ", theme::bold(Token::Ok)));
        spans.push(Span::styled(
            format!("{name} landed{age}   "),
            theme::ink(Token::TextDim),
        ));
    }
    let orphans = app.view.orphan_prs(&graph, &app.filter);
    let open_orphans = orphans
        .iter()
        .filter(|pr| pr.state != PrState::Merged)
        .count();
    if open_orphans > 0 {
        spans.push(Span::styled(
            format!("+{open_orphans} PRs without a local branch"),
            theme::ink(Token::Rule),
        ));
    }
    if lanes.len() > rows {
        spans.push(Span::styled(
            format!("   ▼ {} more", lanes.len() - rows),
            theme::ink(Token::Rule),
        ));
    }
    write(buffer, inner.x + 1, y, inner.right(), &spans);
}

/// A lane's short track: its fork, commits and tip in 16 cells.
fn track(
    buffer: &mut Buffer,
    x: u16,
    y: u16,
    row: &layout::LaneRow,
    lane: &Lane,
    token: Token,
    working: bool,
) {
    let line = theme::ink(token);
    let first = row.stations.first().map_or(row.tip, |station| station.col);
    let start = match row.start {
        Some(start) => {
            put(buffer, x + start, y, "╰", line);
            start + 1
        }
        None => {
            put(buffer, x, y, "«", theme::ink(Token::TextDim));
            1
        }
    };
    for col in start..first.max(start) {
        put(buffer, x + col, y, "─", line);
    }
    for col in first..row.tip {
        put(buffer, x + col, y, "─", line);
    }
    for station in &row.stations {
        let glyph = match (station.commits > 1, station.pushed) {
            (false, true) => "●",
            (true, true) => "◉",
            (false, false) => "○",
            (true, false) => "◎",
        };
        let style = if station.pushed && token != Token::TextDim {
            theme::bold(token)
        } else if station.pushed {
            theme::bold(Token::Text)
        } else {
            theme::bold(Token::TextDim)
        };
        put(buffer, x + station.col, y, glyph, style);
    }
    if working {
        let tip = if lane.commits.is_empty() {
            row.tip + 1
        } else {
            row.tip
        };
        put(
            buffer,
            x + tip.min(TRACK_CELLS - 1),
            y,
            "▶",
            theme::bold(Token::Ok),
        );
    }
}

fn put(buffer: &mut Buffer, x: u16, y: u16, symbol: &str, style: Style) {
    if let Some(cell) = buffer.cell_mut((x, y)) {
        cell.set_symbol(symbol).set_style(style);
    }
}

fn write(buffer: &mut Buffer, x: u16, y: u16, right: u16, spans: &[Span<'_>]) -> u16 {
    let mut x = x;
    for span in spans {
        for character in span.content.chars() {
            if x >= right {
                return x;
            }
            put(buffer, x, y, &character.to_string(), span.style);
            x += 1;
        }
    }
    x
}
