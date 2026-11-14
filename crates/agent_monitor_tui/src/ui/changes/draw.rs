//! Paints the TRANSIT page: the header lines, the axis, the arcs, the
//! trunk, the lanes and their board rows, the inspector and the key line.

use std::collections::HashSet;

use chrono::TimeDelta;
use ratatui::Frame;
use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::Style;
use ratatui::text::{Line, Span};
use ratatui::widgets::Paragraph;

use agent_monitor::domain::model::{Commit, Lane, LaneBase, Pr, PrState, RepoGraph, Status};

use super::layout::{self, LaneRow, Scene, Viewport};
use super::{ci_mark, distance, lane_tag, lane_token, review_mark, tab_spans, title_spans};
use crate::app::{App, ChangeRow, SCALES};
use crate::format;
use crate::theme;
use crate::theme::Token;
use crate::ui::Clock;
use crate::ui::panes::pr_line;
use crate::view::LaneSort;

/// Board width at or above this many inner columns: every column.
const WIDE_BOARD_FROM: u16 = 180;
/// The full board's width, with the gap before it.
const WIDE_BOARD: u16 = 58;
/// The short board (tag, PR, CI, age), with the gap.
const SHORT_BOARD: u16 = 33;
/// Rows under the map: a rule, two inspector lines and the key line.
const FOOTER_ROWS: u16 = 4;
/// Columns between labelled ticks on the axis, at least.
const TICK_SPACING: u16 = 18;

/// Which board columns fit.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Board {
    wide: bool,
}

impl Board {
    fn width(self) -> u16 {
        if self.wide { WIDE_BOARD } else { SHORT_BOARD }
    }

    fn tag_width(self) -> usize {
        if self.wide { 17 } else { 15 }
    }
}

/// Draws the page into `area`.
pub fn draw_transit(frame: &mut Frame<'_>, area: Rect, app: &mut App, clock: Clock, focused: bool) {
    let block = theme::pane("8 CHANGES", title_spans(app), focused);
    let inner = block.inner(area);
    frame.render_widget(block, area);
    if inner.width < 40 || inner.height < 8 {
        return;
    }

    let Some(graph) = app.change_repo().cloned() else {
        if app.change_tabs().is_empty() {
            let lines = vec![Line::from(Span::styled(
                "  no repositories yet: agents' working directories in a git checkout show here",
                theme::ink(Token::Rule),
            ))];
            frame.render_widget(Paragraph::new(lines), inner);
        } else {
            draw_other_prs(frame.buffer_mut(), inner, app, clock);
        }
        return;
    };

    let board = Board {
        wide: inner.width >= WIDE_BOARD_FROM,
    };
    let cols = inner.width.saturating_sub(board.width());
    let cursor = app.cursors.changes.clone();
    let lanes: Vec<Lane> = app
        .view
        .sorted_lanes(&graph, &app.filter, cursor.sort)
        .into_iter()
        .cloned()
        .collect();
    let lane_refs: Vec<&Lane> = lanes.iter().collect();
    let landed: Vec<&Lane> = if cursor.hide_landed {
        Vec::new()
    } else {
        graph
            .lanes
            .iter()
            .filter(|lane| lane.landed.is_some())
            .collect()
    };
    let orphans: Vec<Pr> = app
        .view
        .orphan_prs(&graph, &app.filter)
        .into_iter()
        .cloned()
        .collect();
    let ours: HashSet<u32> = app
        .view
        .prs
        .values()
        .filter(|pr| pr.state == PrState::Merged && Some(&pr.repo) == graph.remote.as_ref())
        .map(|pr| pr.number)
        .collect();

    let zoom = cursor
        .zoom
        .unwrap_or_else(|| layout::fit_scale(&lane_refs, clock.now, cols, &SCALES));
    app.cursors.changes.drawn_zoom = zoom;
    let col_secs = SCALES.get(zoom).copied().unwrap_or(900);
    let now = layout::quantize(clock.now, col_secs, cursor.pan);

    // Rows: header, axis, arcs, trunk, the list, the more line, the footer.
    let fixed = 2 + 1 + 1 + FOOTER_ROWS;
    let spare = inner.height.saturating_sub(fixed);
    let arc_room = spare
        .saturating_sub(4)
        .min(u16::try_from(layout::MAX_ARC_ROWS).unwrap_or(3));
    let probe = layout::layout(
        &graph,
        &lane_refs,
        &landed,
        &ours,
        Viewport {
            cols,
            rows: 0,
            col_secs,
            now,
            scroll: 0,
            arc_rows: arc_room,
        },
    );
    let arc_rows = u16::try_from(probe.arc_rows).unwrap_or(0);
    let list_rows = usize::from(spare.saturating_sub(arc_rows));

    // The row under the cursor, as an index into the list (lanes, then orphans).
    let selected = app.change_row();
    let list_index = match &selected {
        Some(ChangeRow::Lane(branch)) => lanes.iter().position(|lane| lane.branch == *branch),
        Some(ChangeRow::Pr(id)) => orphans
            .iter()
            .position(|pr| pr.id == *id)
            .map(|index| index + lanes.len()),
        Some(ChangeRow::Trunk) | None => None,
    };
    let total = lanes.len() + orphans.len();
    let scroll = scroll_into(list_index, app.cursors.changes.scroll, list_rows, total);
    app.cursors.changes.scroll = scroll;
    let scene = layout::layout(
        &graph,
        &lane_refs,
        &landed,
        &ours,
        Viewport {
            cols,
            rows: u16::try_from(list_rows).unwrap_or(0),
            col_secs,
            now,
            scroll: scroll.min(lanes.len()),
            arc_rows,
        },
    );

    let header_y = inner.y;
    let axis_y = inner.y + 1;
    let trunk_y = axis_y + 1 + arc_rows;
    let list_y = trunk_y + 1;
    let footer_y = inner.bottom().saturating_sub(FOOTER_ROWS);
    let map_x = inner.x;
    let board_x = inner.x + cols;

    let painter = Painter {
        app,
        clock,
        graph: &graph,
        lanes: &lanes,
        landed: &landed,
        scene: &scene,
        map_x,
        board_x,
        board,
        inner,
        col_secs,
        now,
    };
    let buffer = frame.buffer_mut();
    painter.header(buffer, header_y, zoom, cursor.sort, cursor.hide_landed);
    painter.axis(buffer, axis_y);
    painter.arcs(buffer, trunk_y);
    painter.trunk(buffer, trunk_y, selected == Some(ChangeRow::Trunk));

    // The list: lanes then pull requests with no lane.
    let rows_y = |index: usize| -> Option<u16> {
        (index >= scroll && index < scroll + list_rows)
            .then(|| list_y + u16::try_from(index - scroll).unwrap_or(0))
    };
    painter.drops(buffer, trunk_y, list_y, list_rows, scroll);
    for row in &scene.lanes {
        let (Some(y), Some(lane)) = (rows_y(row.row), lanes.get(row.index)) else {
            continue;
        };
        let chosen = selected == Some(ChangeRow::Lane(lane.branch.clone()));
        painter.lane(buffer, y, row, lane, chosen);
    }
    for (offset, pr) in orphans.iter().enumerate() {
        let Some(y) = rows_y(lanes.len() + offset) else {
            continue;
        };
        let chosen = selected == Some(ChangeRow::Pr(pr.id.clone()));
        painter.orphan(buffer, y, pr, chosen);
    }
    painter.joints(buffer, list_y, list_rows, scroll);
    let more_y = list_y + u16::try_from(list_rows).unwrap_or(0);
    painter.more(buffer, more_y, scroll, list_rows, total, &orphans);
    painter.footer(buffer, footer_y, selected.as_ref(), &orphans);
}

/// The other pull requests tab: the tab strip, then pull requests in no
/// mapped repository as PRS rows (no graph to draw them on), and the keys.
fn draw_other_prs(buffer: &mut Buffer, inner: Rect, app: &mut App, clock: Clock) {
    let right = inner.right();
    let width = usize::from(inner.width);
    write(buffer, inner.x, inner.y, right, &tab_spans(app));
    let prs: Vec<Pr> = app
        .view
        .unmapped_prs(&app.filter)
        .into_iter()
        .cloned()
        .collect();
    let note = if app.view.repos.is_empty() {
        "  no repository mapped: pull requests only"
    } else {
        "  pull requests in no mapped repository"
    };
    write(
        buffer,
        inner.x,
        inner.y + 1,
        right,
        &[Span::styled(note, theme::ink(Token::Rule))],
    );

    let list_y = inner.y + 2;
    let footer_y = inner.bottom().saturating_sub(2);
    let rows = usize::from(footer_y.saturating_sub(list_y));
    let selected = app.change_row();
    let cursor = prs
        .iter()
        .position(|pr| selected == Some(ChangeRow::Pr(pr.id.clone())));
    let scroll = scroll_into(cursor, app.cursors.changes.scroll, rows, prs.len());
    app.cursors.changes.scroll = scroll;
    for (offset, pr) in prs.iter().skip(scroll).take(rows).enumerate() {
        let y = list_y + u16::try_from(offset).unwrap_or(0);
        let chosen = Some(offset + scroll) == cursor;
        let line = pr_line(app, clock, pr, width, width >= 64, chosen);
        buffer.set_line(inner.x, y, &line, inner.width);
    }
    if prs.len() > scroll + rows {
        write(
            buffer,
            inner.x,
            footer_y.saturating_sub(1),
            right,
            &[Span::styled(
                format!(" ▼ {} more", prs.len() - scroll - rows),
                theme::ink(Token::TextDim),
            )],
        );
    }

    for x in inner.left()..right {
        put(buffer, x, footer_y, "┄", theme::ink(Token::InfoFaint));
    }
    let mut keys = Vec::new();
    for (key, what) in [("↑↓", "PR"), ("ENTER", "AGENT"), ("[ ]", "REPO")] {
        keys.push(Span::styled(
            format!(" {key}"),
            theme::bold(Token::Highlight),
        ));
        keys.push(Span::styled(
            format!(" {what} "),
            theme::ink(Token::TextDim),
        ));
    }
    write(buffer, inner.x, footer_y + 1, right, &keys);
}

/// The scroll that keeps `cursor` in view, clamped to the list.
fn scroll_into(cursor: Option<usize>, current: usize, rows: usize, total: usize) -> usize {
    let scroll = layout::scroll_for(cursor, current, rows);
    scroll.min(total.saturating_sub(rows))
}

/// Sets one cell.
pub(super) fn put(buffer: &mut Buffer, x: u16, y: u16, symbol: &str, style: Style) {
    if let Some(cell) = buffer.cell_mut((x, y)) {
        cell.set_symbol(symbol).set_style(style);
    }
}

/// The symbol at a cell.
fn symbol_at(buffer: &Buffer, x: u16, y: u16) -> String {
    buffer
        .cell((x, y))
        .map_or_else(String::new, |cell| cell.symbol().to_owned())
}

/// Writes `spans` from `x`, no further than `right`; returns where it stopped.
pub(super) fn write(buffer: &mut Buffer, x: u16, y: u16, right: u16, spans: &[Span<'_>]) -> u16 {
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

/// Paints the selection background over a whole row.
fn select_row(buffer: &mut Buffer, area: Rect, y: u16) {
    for x in area.left()..area.right() {
        if let Some(cell) = buffer.cell_mut((x, y)) {
            cell.set_bg(Token::Selection.color());
        }
    }
}

/// A time span as the axis writes it: `-45m`, `-6h`, `-2d`.
fn ago(seconds: i64) -> String {
    match seconds {
        0 => String::from("NOW"),
        1..3_600 => format!("-{}m", seconds / 60),
        3_600..172_800 => format!("-{}h", seconds / 3_600),
        _ => format!("-{}d", seconds / 86_400),
    }
}

/// The scale as the header writes it.
fn scale_word(seconds: i64) -> String {
    match seconds {
        ..3_600 => format!("{}m", seconds / 60),
        3_600..259_200 => format!("{}h", seconds / 3_600),
        _ => format!("{}d", seconds / 86_400),
    }
}

struct Painter<'a> {
    app: &'a App,
    clock: Clock,
    graph: &'a RepoGraph,
    lanes: &'a [Lane],
    landed: &'a [&'a Lane],
    scene: &'a Scene,
    map_x: u16,
    board_x: u16,
    board: Board,
    inner: Rect,
    col_secs: i64,
    now: chrono::DateTime<chrono::Utc>,
}

impl Painter<'_> {
    fn x(&self, col: u16) -> u16 {
        self.map_x + col
    }

    fn fresh_age(&self, oid: &agent_monitor::domain::model::Oid) -> Option<i64> {
        let at = self.app.view.fresh.get(oid)?;
        let age = (self.clock.now - *at).num_milliseconds();
        (0..theme::GLITCH_MS).contains(&age).then_some(age)
    }

    fn header(&self, buffer: &mut Buffer, y: u16, zoom: usize, sort: LaneSort, hide_landed: bool) {
        let right = self.inner.right();
        let mut spans = tab_spans(self.app);
        spans.push(Span::styled("   ", theme::base()));
        let trunk = &self.graph.trunk;
        spans.push(Span::styled(trunk.name.clone(), theme::bold(Token::Accent)));
        if let Some(head) = trunk.commits.first() {
            spans.push(Span::styled(
                format!(" {}", head.oid.short()),
                theme::ink(Token::InfoDim),
            ));
        }
        if let Some(fetched) = trunk.fetched_at {
            spans.push(Span::styled(
                format!(" · fetched {} ago", format::age(self.clock.now - fetched)),
                theme::ink(Token::TextDim),
            ));
        }
        if let Some(local) = &trunk.local {
            let tone = if local.behind > 0 {
                Token::Attention
            } else {
                Token::TextDim
            };
            spans.push(Span::styled(" · local ", theme::ink(Token::TextDim)));
            spans.push(Span::styled(
                format!("{} −{}", local.name, local.behind),
                theme::ink(tone),
            ));
        }
        let end = write(buffer, self.inner.x, y, right, &spans);

        let secs = SCALES.get(zoom).copied().unwrap_or(900);
        let window = secs * i64::from(self.scene.cols);
        let tail = vec![
            Span::styled("1 col = ", theme::ink(Token::TextDim)),
            Span::styled(scale_word(secs), theme::bold(Token::Highlight)),
            Span::styled("  ◂ ", theme::ink(Token::Rule)),
            Span::styled(scale_word(window), theme::ink(Token::Text)),
            Span::styled(" ▸  SORT ", theme::ink(Token::Rule)),
            Span::styled(
                match sort {
                    LaneSort::Fork => "fork",
                    LaneSort::Attention => "attention",
                },
                theme::ink(Token::Text),
            ),
            Span::styled("  LANDED ", theme::ink(Token::Rule)),
            Span::styled(
                if hide_landed { "hidden" } else { "shown" },
                theme::ink(Token::Text),
            ),
            Span::styled(" ", theme::base()),
        ];
        let width: u16 = tail
            .iter()
            .map(|span| u16::try_from(span.width()).unwrap_or(0))
            .sum();
        let start = right.saturating_sub(width);
        if start > end + 1 {
            write(buffer, start, y, right, &tail);
        }
    }

    fn axis(&self, buffer: &mut Buffer, y: u16) {
        let cols = self.scene.cols;
        let rule = theme::ink(Token::InfoFaint);
        for col in 0..cols {
            put(buffer, self.x(col), y, "┄", rule);
        }
        // Ticks every whole number of a round unit, labelled.
        let unit = tick_unit(self.col_secs);
        let mut last_label_end: Option<u16> = None;
        for col in 0..cols {
            let back = i64::from(cols - 1 - col) * self.col_secs;
            let end = self.now - TimeDelta::seconds(back);
            let into = end.timestamp().rem_euclid(unit);
            if into >= self.col_secs || col + 7 > cols {
                continue;
            }
            let tick = end.timestamp() - into;
            let label = ago(self.now.timestamp() - tick);
            if last_label_end.is_some_and(|end| col < end + TICK_SPACING / 3) {
                continue;
            }
            put(buffer, self.x(col), y, "┼", theme::ink(Token::InfoDim));
            let end = write(
                buffer,
                self.x(col) + 1,
                y,
                self.x(cols.saturating_sub(4)),
                &[Span::styled(label, theme::ink(Token::TextDim))],
            );
            last_label_end = Some(end - self.map_x);
        }
        let now_label = if self.app.cursors.changes.pan == 0 {
            "NOW"
        } else {
            "◂"
        };
        write(
            buffer,
            self.x(cols.saturating_sub(3)),
            y,
            self.board_x,
            &[Span::styled(now_label, theme::bold(Token::Highlight))],
        );

        let heads: &[(&str, usize)] = if self.board.wide {
            &[
                ("LANE", 18),
                ("PR", 8),
                ("CI", 3),
                ("REV", 7),
                ("±MAIN", 11),
                ("↑", 5),
                ("AGE", 4),
            ]
        } else {
            &[("LANE", 16), ("PR", 8), ("CI", 3), ("AGE", 4)]
        };
        let mut x = self.board_x + 1;
        for (head, width) in heads {
            let text = format::cell(head, *width);
            x = write(
                buffer,
                x,
                y,
                self.inner.right(),
                &[Span::styled(text, theme::bold(Token::Rule))],
            );
        }
    }

    fn arcs(&self, buffer: &mut Buffer, trunk_y: u16) {
        for arc in &self.scene.arcs {
            let Some(lane) = self.landed.get(arc.index) else {
                continue;
            };
            let y = trunk_y.saturating_sub(1 + u16::try_from(arc.row).unwrap_or(0));
            let tone = if arc.crossing {
                Token::Ghost
            } else {
                Token::Rule
            };
            let style = theme::ink(tone);
            // A fresh landing draws itself from its fork to its squash commit.
            let reach = self
                .fresh_age(&arc.oid)
                .map_or(1.0, |age| age as f64 / theme::GLITCH_MS as f64);
            let span = f64::from(arc.to - arc.from + 1);
            let shown = (span * reach).ceil() as u16;
            let last = arc.from + shown.saturating_sub(1);
            for leg_y in (y + 1)..trunk_y {
                let cross = |buffer: &Buffer, x| match symbol_at(buffer, x, leg_y).as_str() {
                    "─" => "┼",
                    _ => "│",
                };
                let x = self.x(arc.from);
                let glyph = cross(buffer, x);
                put(buffer, x, leg_y, glyph, style);
                if last >= arc.to {
                    let x = self.x(arc.to);
                    let glyph = cross(buffer, x);
                    put(buffer, x, leg_y, glyph, style);
                }
            }
            for col in arc.from..=last.min(arc.to) {
                let glyph = if col == arc.from {
                    "╭"
                } else if col == arc.to {
                    "╮"
                } else if symbol_at(buffer, self.x(col), y) == "│" {
                    "┼"
                } else {
                    "─"
                };
                put(buffer, self.x(col), y, glyph, style);
            }
            // The label rides inside the arc.
            let pr = self.app.view.lane_pr(lane);
            let mut label = vec![Span::styled(" ", style)];
            if let Some(pr) = pr {
                label.push(Span::styled(
                    format!("#{}", pr.number),
                    theme::bold(Token::Ok),
                ));
                label.push(Span::styled(" ", style));
            }
            label.push(Span::styled(
                lane.branch.clone(),
                theme::ink(Token::TextDim),
            ));
            label.push(Span::styled(" ", style));
            if arc.to > arc.from + 6 && last >= arc.to {
                write(
                    buffer,
                    self.x(arc.from + 2),
                    y,
                    self.x(arc.to.saturating_sub(1)),
                    &label,
                );
            }
        }
    }

    fn trunk(&self, buffer: &mut Buffer, y: u16, chosen: bool) {
        let line = theme::bold(Token::Accent);
        let cols = self.scene.cols;
        let cursor = match &self.app.cursors.changes.commit {
            Some(oid) if chosen => Some(oid.clone()),
            _ => None,
        };
        for (col, cell) in self.scene.trunk.iter().enumerate() {
            let col = u16::try_from(col).unwrap_or(0);
            let (glyph, style) = if cell.fork_down && cell.arc_up {
                ("╋", line)
            } else if cell.fork_down {
                ("┳", line)
            } else if cell.arc_up {
                ("┻", line)
            } else if cell.landed {
                ("◆", theme::bold(Token::Ok))
            } else if cell.commits > 1 {
                ("◉", theme::bold(Token::Text))
            } else if cell.commits == 1 {
                ("●", theme::bold(Token::Text))
            } else {
                ("━", line)
            };
            let glyph = match &cursor {
                Some(cursor) if cell.held.contains(cursor) => "◈",
                _ => glyph,
            };
            put(buffer, self.x(col), y, glyph, style);
        }
        if self.app.cursors.changes.pan == 0 {
            put(buffer, self.x(cols.saturating_sub(1)), y, "▶", line);
        }
        // The local trunk branch and what lies left of the window.
        let mut label = Vec::new();
        if self.scene.trunk_left {
            label.push(Span::styled("«", theme::bold(Token::Accent)));
        }
        if let Some(local) = &self.graph.trunk.local
            && local.behind > 0
        {
            label.push(Span::styled(
                format!("{} −{} ", local.name, local.behind),
                theme::ink(Token::TextDim),
            ));
        }
        write(buffer, self.map_x, y, self.x(cols / 3), &label);

        // Its board row: who sits on the trunk.
        let agents = self.graph.trunk_agents.len();
        let mut spans = vec![Span::styled(
            format::cell(&self.graph.trunk.name, self.board.tag_width()),
            theme::bold(Token::Accent),
        )];
        if agents > 0 {
            let working = self
                .graph
                .trunk_agents
                .iter()
                .filter_map(|id| self.app.view.agents.get(id))
                .filter(|agent| agent.status == Status::Working)
                .count();
            let noun = if agents == 1 { "agent" } else { "agents" };
            spans.push(Span::styled(
                format!(" {agents} {noun}"),
                theme::ink(Token::TextDim),
            ));
            if working > 0 {
                spans.push(Span::styled(
                    format!(" · {working} ▶"),
                    theme::ink(Token::Ok),
                ));
            }
        }
        write(buffer, self.board_x + 1, y, self.inner.right(), &spans);
        if chosen {
            select_row(buffer, self.inner, y);
        }
    }

    /// Fork lines from the trunk or a parent lane down to each lane.
    fn drops(&self, buffer: &mut Buffer, trunk_y: u16, list_y: u16, rows: usize, scroll: usize) {
        let bottom = list_y + u16::try_from(rows).unwrap_or(0);
        let y_of = |row: usize| -> Option<u16> {
            (row >= scroll).then(|| list_y + u16::try_from(row - scroll).unwrap_or(u16::MAX))
        };
        for drop in &self.scene.drops {
            let Some(to) = y_of(drop.to) else {
                continue;
            };
            let from = match drop.from {
                None => trunk_y,
                Some(parent) => y_of(parent).unwrap_or(list_y.saturating_sub(1)),
            };
            let token = self
                .lanes
                .get(drop.to)
                .map_or(Token::TextDim, |lane| lane_token(self.app, lane));
            let style = theme::ink(token);
            for y in (from + 1)..to.min(bottom) {
                put(buffer, self.x(drop.col), y, "│", style);
            }
        }
    }

    /// Where a stacked lane leaves its base lane, the base's track turns
    /// down: `┬`.
    fn joints(&self, buffer: &mut Buffer, list_y: u16, rows: usize, scroll: usize) {
        for drop in &self.scene.drops {
            let Some(parent) = drop.from else {
                continue;
            };
            if parent < scroll
                || parent >= scroll + rows
                || drop.to <= parent + 1 && drop.to < scroll
            {
                continue;
            }
            let y = list_y + u16::try_from(parent - scroll).unwrap_or(0);
            let x = self.x(drop.col);
            if matches!(symbol_at(buffer, x, y).as_str(), "─" | "┄" | "›") {
                let token = self
                    .lanes
                    .get(drop.to)
                    .map_or(Token::TextDim, |lane| lane_token(self.app, lane));
                put(buffer, x, y, "┬", theme::ink(token));
            }
        }
    }

    fn lane(&self, buffer: &mut Buffer, y: u16, row: &LaneRow, lane: &Lane, chosen: bool) {
        let token = lane_token(self.app, lane);
        let working = self.app.view.lane_working(lane);
        let pr = self.app.view.lane_pr(lane);
        let failing = token == Token::Alert;
        let line = theme::ink(token);
        let cols = self.scene.cols;

        // The track from its fork (or the left edge) to its tip. A lane
        // wholly left of the window is its distance and its tip at the edge.
        let mut row = row.clone();
        let first = row.stations.first().map_or(row.tip, |station| station.col);
        let start = match row.start {
            Some(start) => {
                put(buffer, self.x(start), y, "╰", line);
                start + 1
            }
            None => {
                let label = format!("«{}", lane.behind);
                let limit = if row.stations.is_empty() {
                    self.x(cols)
                } else {
                    self.x(first)
                };
                let end = write(
                    buffer,
                    self.map_x,
                    y,
                    limit,
                    &[Span::styled(label, theme::ink(Token::TextDim))],
                );
                let end = end - self.map_x;
                if row.stations.is_empty() {
                    row.tip = end;
                }
                end
            }
        };
        let row = &row;
        for col in start..row.tip {
            if symbol_at(buffer, self.x(col), y) != "│" {
                put(buffer, self.x(col), y, "─", line);
            }
        }
        let cursor = if chosen {
            self.app.cursors.changes.commit.clone()
        } else {
            None
        };
        for station in &row.stations {
            let pushed = station.pushed;
            let glyph = match (station.commits > 1, pushed) {
                (false, true) => "●",
                (true, true) => "◉",
                (false, false) => "○",
                (true, false) => "◎",
            };
            let style = if !pushed {
                theme::bold(Token::TextDim)
            } else if token == Token::TextDim {
                theme::bold(Token::Text)
            } else {
                theme::bold(token)
            };
            let glyph = match self.fresh_age(&station.oid) {
                Some(age) => theme::glitch(glyph, age, self.clock.now.timestamp_millis()),
                None => glyph.to_owned(),
            };
            let glyph = if cursor
                .as_ref()
                .is_some_and(|cursor| station.held.contains(cursor))
            {
                String::from("◈")
            } else {
                glyph
            };
            put(buffer, self.x(station.col), y, &glyph, style);
        }
        // The tip says who is on it.
        let tip_glyph = if failing && pr.is_some() {
            Some((
                "✕",
                if self.clock.blink() {
                    theme::ink(Token::Rule)
                } else {
                    theme::bold(Token::Alert)
                },
            ))
        } else if working {
            Some(("▶", theme::bold(Token::Ok)))
        } else if lane.commits.is_empty() {
            Some(("○", theme::ink(Token::TextDim)))
        } else {
            None
        };
        let tip_col = if lane.commits.is_empty() && row.start.is_some() {
            (row.tip + 1).min(cols.saturating_sub(1))
        } else {
            row.tip
        };
        if let Some((glyph, style)) = tip_glyph
            && cursor.is_none()
        {
            put(buffer, self.x(tip_col), y, glyph, style);
        }

        // The leader to the board: chevrons march toward a working agent's tag.
        let fresh = lane.tip().and_then(|tip| self.fresh_age(&tip.oid));
        let phase =
            u16::try_from(self.clock.now.timestamp_millis().rem_euclid(1_000) / 250).unwrap_or(0);
        let runner = fresh.map(|age| {
            let span = i64::from(cols.saturating_sub(tip_col)) + 4;
            tip_col + u16::try_from(age * span / theme::GLITCH_MS).unwrap_or(0)
        });
        for col in (tip_col + 1)..cols {
            let x = self.x(col);
            let (glyph, style) = if Some(col) == runner {
                ("━", theme::bold(Token::Highlight))
            } else if working && (col + 4 - phase) % 4 == 0 {
                ("›", theme::ink(Token::Ok))
            } else {
                ("┄", theme::ink(Token::InfoFaint))
            };
            put(buffer, x, y, glyph, style);
        }

        self.board_row(buffer, y, lane, pr, fresh);
        if chosen {
            select_row(buffer, self.inner, y);
            put(
                buffer,
                self.inner.x.saturating_sub(1),
                y,
                "▌",
                theme::bold(Token::Highlight),
            );
        }
    }

    fn board_row(
        &self,
        buffer: &mut Buffer,
        y: u16,
        lane: &Lane,
        pr: Option<&Pr>,
        fresh: Option<i64>,
    ) {
        let working = self.app.view.lane_working(lane);
        let tag_width = self.board.tag_width();
        let mut spans = Vec::new();
        if working {
            spans.push(Span::styled("▶ ", theme::bold(Token::Ok)));
        } else {
            spans.push(Span::styled("  ", theme::base()));
        }
        spans.push(Span::styled(
            format::cell(&lane_tag(self.app, lane), tag_width - 2),
            theme::bold(if working { Token::Text } else { Token::TextDim }),
        ));
        spans.push(Span::raw(" "));
        match pr {
            Some(pr) => {
                let (ci, ci_token) = ci_mark(pr.ci);
                let open = !pr.state.is_final();
                let number_token = if pr.ci == agent_monitor::domain::model::CiState::Failed && open
                {
                    Token::Alert
                } else if open {
                    Token::Highlight
                } else {
                    Token::TextDim
                };
                spans.push(Span::styled(
                    format::cell(&format!("#{}", pr.number), 7),
                    theme::bold(number_token),
                ));
                spans.push(Span::raw(" "));
                spans.push(Span::styled(format::cell(ci, 2), theme::bold(ci_token)));
                if self.board.wide {
                    let (review, review_token) = review_mark(pr);
                    spans.push(Span::raw(" "));
                    spans.push(Span::styled(
                        format::cell(review, 5),
                        theme::ink(review_token),
                    ));
                    let conflict =
                        pr.mergeable == agent_monitor::domain::model::Mergeable::Conflicting;
                    spans.push(Span::styled(
                        if conflict { "⚠" } else { " " },
                        theme::bold(Token::Alert),
                    ));
                }
            }
            None => {
                spans.push(Span::styled(format::cell("—", 7), theme::ink(Token::Rule)));
                spans.push(Span::raw(" "));
                spans.push(Span::styled(format::cell("·", 2), theme::ink(Token::Rule)));
                if self.board.wide {
                    spans.push(Span::raw(" "));
                    spans.push(Span::styled(format::cell("—", 6), theme::ink(Token::Rule)));
                }
            }
        }
        if self.board.wide {
            spans.push(Span::raw(" "));
            spans.push(Span::styled(
                format::cell(&distance(lane.ahead, lane.behind), 10),
                theme::ink(Token::TextDim),
            ));
            let unpushed = layout::unpushed(lane);
            spans.push(Span::raw(" "));
            if unpushed > 0 {
                spans.push(Span::styled(
                    format::cell(&format!("↑{unpushed}"), 4),
                    theme::bold(Token::Attention),
                ));
            } else {
                spans.push(Span::styled(format::cell("·", 4), theme::ink(Token::Rule)));
            }
        }
        spans.push(Span::raw(" "));
        let age = lane.tip().map_or_else(
            || String::from("—"),
            |tip| format::age(self.clock.now - tip.at),
        );
        let age = match fresh {
            Some(fresh) => theme::glitch(&age, fresh, self.clock.now.timestamp_millis()),
            None => age,
        };
        spans.push(Span::styled(
            format::right(&age, 4),
            theme::ink(Token::Text),
        ));
        write(buffer, self.board_x + 1, y, self.inner.right(), &spans);
    }

    fn orphan(&self, buffer: &mut Buffer, y: u16, pr: &Pr, chosen: bool) {
        let note = if pr.state == PrState::Merged {
            "◆ landed · no local branch"
        } else {
            "no local branch"
        };
        let note_token = if pr.state == PrState::Merged {
            Token::Ok
        } else {
            Token::Rule
        };
        let x = write(
            buffer,
            self.map_x + 1,
            y,
            self.board_x,
            &[Span::styled(
                format::clip(
                    &pr.title.clone().unwrap_or_default(),
                    usize::from(self.scene.cols / 2),
                ),
                theme::ink(Token::TextDim),
            )],
        );
        let x = write(
            buffer,
            x + 1,
            y,
            self.board_x,
            &[Span::styled(note, theme::ink(note_token))],
        );
        for col in (x + 1)..self.board_x {
            put(buffer, col, y, "┄", theme::ink(Token::Ghost));
        }
        let mut spans = vec![Span::styled("  ", theme::base())];
        let agent = crate::view::ViewState::pr_agent(pr).map_or_else(
            || pr.branch.clone().unwrap_or_default(),
            |id| self.app.view.name_of(id),
        );
        spans.push(Span::styled(
            format::cell(&agent, self.board.tag_width() - 2),
            theme::ink(Token::TextDim),
        ));
        spans.push(Span::raw(" "));
        spans.push(Span::styled(
            format::cell(&format!("#{}", pr.number), 7),
            theme::bold(Token::TextDim),
        ));
        let (ci, token) = ci_mark(pr.ci);
        spans.push(Span::raw(" "));
        spans.push(Span::styled(format::cell(ci, 2), theme::bold(token)));
        write(buffer, self.board_x + 1, y, self.inner.right(), &spans);
        if chosen {
            select_row(buffer, self.inner, y);
        }
    }

    fn more(
        &self,
        buffer: &mut Buffer,
        y: u16,
        scroll: usize,
        rows: usize,
        total: usize,
        orphans: &[Pr],
    ) {
        let below = total.saturating_sub(scroll + rows);
        let above = scroll;
        let hidden_failing = self
            .lanes
            .iter()
            .enumerate()
            .filter(|(index, _)| *index < scroll || *index >= scroll + rows)
            .filter(|(_, lane)| {
                self.app.view.attention(lane) == Some(crate::view::Attention::Failing)
            })
            .count();
        let mut spans = Vec::new();
        if above > 0 {
            spans.push(Span::styled(
                format!(" ▲ {above} more"),
                theme::ink(Token::TextDim),
            ));
        }
        if below > 0 {
            spans.push(Span::styled(
                format!(" ▼ {below} more"),
                theme::ink(Token::TextDim),
            ));
        }
        if hidden_failing > 0 {
            spans.push(Span::styled(
                format!(" · ✕ {hidden_failing} off screen"),
                theme::bold(Token::Alert),
            ));
        }
        if self.graph.hidden_lanes > 0 {
            spans.push(Span::styled(
                format!(" · {} quieter branches not mapped", self.graph.hidden_lanes),
                theme::ink(Token::Rule),
            ));
        }
        if self.scene.hidden_arcs > 0 {
            spans.push(Span::styled(
                format!(" · ◆ {} more landed", self.scene.hidden_arcs),
                theme::ink(Token::Rule),
            ));
        }
        if !orphans.is_empty() && below == 0 && above == 0 && spans.is_empty() {
            return;
        }
        write(buffer, self.inner.x, y, self.inner.right(), &spans);
    }

    fn footer(&self, buffer: &mut Buffer, y: u16, selected: Option<&ChangeRow>, orphans: &[Pr]) {
        let right = self.inner.right();
        for x in self.inner.left()..right {
            put(buffer, x, y, "┄", theme::ink(Token::InfoFaint));
        }
        let (first, second) = self.inspector(selected, orphans);
        write(buffer, self.inner.x, y + 1, right, &first);
        write(buffer, self.inner.x, y + 2, right, &second);
        let mut keys = Vec::new();
        for (key, what) in [
            ("↑↓", "LANE"),
            ("←→", "COMMIT"),
            ("ENTER", "AGENT"),
            ("p", "LANE PAGE"),
            ("n N", "NEXT ✕"),
            ("+ −", "ZOOM"),
            ("< >", "PAN"),
            ("HOME", "NOW"),
            ("[ ]", "REPO"),
            ("m", "LANDED"),
            ("s", "SORT"),
        ] {
            keys.push(Span::styled(
                format!(" {key}"),
                theme::bold(Token::Highlight),
            ));
            keys.push(Span::styled(
                format!(" {what} "),
                theme::ink(Token::TextDim),
            ));
        }
        write(buffer, self.inner.x, y + 3, right, &keys);
    }

    /// The inspector's two lines for the row under the cursor.
    fn inspector(
        &self,
        selected: Option<&ChangeRow>,
        orphans: &[Pr],
    ) -> (Vec<Span<'static>>, Vec<Span<'static>>) {
        match selected {
            Some(ChangeRow::Lane(branch)) => {
                let Some(lane) = self.lanes.iter().find(|lane| lane.branch == *branch) else {
                    return (Vec::new(), Vec::new());
                };
                (
                    self.lane_summary(lane),
                    self.commit_strip(&lane.commits, lane),
                )
            }
            Some(ChangeRow::Trunk) => {
                let trunk = &self.graph.trunk;
                let mut first = vec![
                    Span::styled(" ▌", theme::bold(Token::Highlight)),
                    Span::styled(trunk.name.clone(), theme::bold(Token::Accent)),
                    Span::styled(
                        format!("  {} commits in view", trunk.commits.len()),
                        theme::ink(Token::TextDim),
                    ),
                ];
                if !self.graph.trunk_agents.is_empty() {
                    let names: Vec<String> = self
                        .graph
                        .trunk_agents
                        .iter()
                        .take(6)
                        .map(|id| self.app.view.name_of(id))
                        .collect();
                    first.push(Span::styled(
                        format!(
                            "  on {}: {}",
                            trunk
                                .local
                                .as_ref()
                                .map_or("trunk", |local| local.name.as_str()),
                            names.join(", ")
                        ),
                        theme::ink(Token::Text),
                    ));
                }
                (first, self.trunk_strip())
            }
            Some(ChangeRow::Pr(id)) => {
                let Some(pr) = orphans.iter().find(|pr| pr.id == *id) else {
                    return (Vec::new(), Vec::new());
                };
                let mut first = vec![Span::styled(" ▌", theme::bold(Token::Highlight))];
                first.extend(pr_spans(pr));
                let second = vec![Span::styled(
                    format!(
                        "  {} · no local branch here",
                        pr.branch.clone().unwrap_or_default()
                    ),
                    theme::ink(Token::TextDim),
                )];
                (first, second)
            }
            None => (Vec::new(), Vec::new()),
        }
    }

    fn lane_summary(&self, lane: &Lane) -> Vec<Span<'static>> {
        let mut spans = vec![
            Span::styled(" ▌", theme::bold(Token::Highlight)),
            Span::styled(lane.branch.clone(), theme::bold(Token::Text)),
        ];
        if !lane.aliases.is_empty() {
            spans.push(Span::styled(
                format!(" ={}", lane.aliases.join(",")),
                theme::ink(Token::InfoDim),
            ));
        }
        spans.push(Span::raw("  "));
        match self.app.view.lane_pr(lane) {
            Some(pr) => spans.extend(pr_spans(pr)),
            None => spans.push(Span::styled("no pull request", theme::ink(Token::Rule))),
        }
        let base = match &lane.base {
            LaneBase::Trunk { oid, .. } => {
                format!("  from {} {}", self.graph.trunk.name, oid.short())
            }
            LaneBase::Lane { branch, .. } => format!("  stacked on {branch}"),
        };
        spans.push(Span::styled(base, theme::ink(Token::TextDim)));
        let agents: Vec<String> = lane
            .agents
            .iter()
            .filter_map(|id| self.app.view.agents.get(id))
            .map(|agent| format!("{} {}", agent.name, theme::status_word(agent.status)))
            .collect();
        if !agents.is_empty() {
            spans.push(Span::styled(
                format!("  {}", agents.join(" · ")),
                theme::ink(Token::Text),
            ));
        }
        spans
    }

    /// The lane's commits, oldest to newest, with the cursor commit bracketed.
    fn commit_strip(&self, commits: &[Commit], lane: &Lane) -> Vec<Span<'static>> {
        let unpushed = layout::unpushed(lane);
        let cursor = self.app.cursors.changes.commit.clone();
        let mut spans = vec![Span::raw("  ")];
        if lane.elided > 0 {
            spans.push(Span::styled(
                format!("⋮ {} more  ", lane.elided),
                theme::ink(Token::Rule),
            ));
        }
        let budget = usize::from(self.inner.width).saturating_sub(4);
        let mut parts: Vec<Vec<Span<'static>>> = Vec::new();
        for (position, commit) in commits.iter().enumerate() {
            let pushed = position >= unpushed;
            let chosen = cursor
                .as_ref()
                .map_or(position == 0, |oid| *oid == commit.oid);
            let glyph = if pushed { "●" } else { "○" };
            let mut part = vec![
                Span::styled(
                    format!("{glyph} "),
                    theme::bold(if pushed { Token::Text } else { Token::TextDim }),
                ),
                Span::styled(
                    format!("{} ", commit.oid.short()),
                    theme::ink(Token::InfoDim),
                ),
                Span::styled(
                    format!("{} ", format::age(self.clock.now - commit.at)),
                    theme::ink(Token::TextDim),
                ),
                Span::styled(format::clip(&commit.subject, 48), theme::ink(Token::Text)),
            ];
            if !pushed {
                part.push(Span::styled(" ↑", theme::bold(Token::Attention)));
            }
            if chosen {
                part.insert(0, Span::styled("⟦", theme::bold(Token::Highlight)));
                part.push(Span::styled("⟧", theme::bold(Token::Highlight)));
                for span in &mut part {
                    span.style = span.style.bg(Token::Selection.color());
                }
            }
            part.push(Span::raw("   "));
            parts.push(part);
        }
        // Keep the cursor commit in view, newest on the right.
        parts.reverse();
        let chosen_index = commits
            .iter()
            .position(|commit| cursor.as_ref().is_some_and(|oid| *oid == commit.oid))
            .map_or(parts.len().saturating_sub(1), |position| {
                parts.len() - 1 - position
            });
        let widths: Vec<usize> = parts
            .iter()
            .map(|part| part.iter().map(Span::width).sum())
            .collect();
        let mut start = 0;
        while start < chosen_index && widths[start..=chosen_index].iter().sum::<usize>() > budget {
            start += 1;
        }
        if start > 0 {
            spans.push(Span::styled("… ", theme::ink(Token::Rule)));
        }
        for part in parts.into_iter().skip(start) {
            spans.extend(part);
        }
        spans
    }

    fn trunk_strip(&self) -> Vec<Span<'static>> {
        let cursor = self.app.cursors.changes.commit.clone();
        let mut spans = vec![Span::raw("  ")];
        let start = cursor
            .as_ref()
            .and_then(|oid| {
                self.graph
                    .trunk
                    .commits
                    .iter()
                    .position(|commit| commit.oid == *oid)
            })
            .unwrap_or(0);
        for (position, commit) in self
            .graph
            .trunk
            .commits
            .iter()
            .enumerate()
            .skip(start)
            .take(4)
        {
            let chosen = position == start;
            let landed = self
                .landed
                .iter()
                .any(|lane| lane.landed.as_ref() == Some(&commit.oid));
            let glyph = if landed { "◆" } else { "●" };
            let mut part = vec![
                Span::styled(
                    format!("{glyph} "),
                    theme::bold(if landed { Token::Ok } else { Token::Text }),
                ),
                Span::styled(
                    format!("{} ", commit.oid.short()),
                    theme::ink(Token::InfoDim),
                ),
                Span::styled(
                    format!("{} ", format::age(self.clock.now - commit.at)),
                    theme::ink(Token::TextDim),
                ),
                Span::styled(format::clip(&commit.subject, 56), theme::ink(Token::Text)),
                Span::raw("   "),
            ];
            if chosen {
                for span in &mut part {
                    span.style = span.style.bg(Token::Selection.color());
                }
            }
            spans.extend(part);
        }
        spans
    }
}

/// A pull request's number, title, CI, review and conflicts.
fn pr_spans(pr: &Pr) -> Vec<Span<'static>> {
    let (ci, ci_token) = ci_mark(pr.ci);
    let (review, review_token) = review_mark(pr);
    let mut spans = vec![
        Span::styled(format!("#{} ", pr.number), theme::bold(Token::Highlight)),
        Span::styled(
            format::clip(&pr.title.clone().unwrap_or_default(), 64),
            theme::ink(Token::Text),
        ),
        Span::styled(format!("   {ci} CI"), theme::bold(ci_token)),
        Span::styled(format!("  {review}"), theme::ink(review_token)),
    ];
    if pr.mergeable == agent_monitor::domain::model::Mergeable::Conflicting {
        spans.push(Span::styled("  ⚠ conflicts", theme::bold(Token::Alert)));
    }
    spans.push(Span::styled(
        format!("  {}", crate::view::pr_state_word(pr.state)),
        theme::ink(Token::TextDim),
    ));
    spans
}

/// The unit axis ticks fall on, for a scale.
fn tick_unit(col_secs: i64) -> i64 {
    match col_secs {
        ..=60 => 15 * 60,
        61..=300 => 3_600,
        301..=900 => 6 * 3_600,
        901..=3_600 => 12 * 3_600,
        3_601..=14_400 => 86_400,
        _ => 7 * 86_400,
    }
}
