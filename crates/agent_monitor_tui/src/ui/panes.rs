//! The numbered panes: 1 AGENTS, 2 TAPE, 3 SPEND, 4 FAILURES, 6 SOURCES and
//! 7 BODY, each drawn in a monitor grid cell or zoomed to a page.

use ratatui::Frame;
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::style::{Color, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Bar, BarChart, BarGroup, Block, Cell, Paragraph, Row, Table, TableState};

use agent_monitor::domain::model::{Agent, AgentKind, SourceState, TapeEvent, TapeKind, Timestamp};

use crate::app::App;
use crate::format;
use crate::keys::{Base, Pane};
use crate::theme;
use crate::ui::Clock;

/// Draws `pane` into `area`; `zoomed` when it fills the page.
pub fn draw(
    frame: &mut Frame<'_>,
    area: Rect,
    app: &mut App,
    clock: Clock,
    pane: Pane,
    zoomed: bool,
) {
    let focused = zoomed || app.mode.base() == Base::Pane(pane);
    match pane {
        Pane::Agents => agents(frame, area, app, clock, focused),
        Pane::Tape => tape(frame, area, app, clock, focused),
        Pane::Spend => spend(frame, area, app, focused),
        Pane::Failures => failures(frame, area, app, clock, focused),
        Pane::Sources => sources(frame, area, app, clock, focused),
        Pane::Body => body(frame, area, app, clock, focused),
        Pane::Transcript | Pane::Children => {}
    }
}

fn count_span(text: String) -> Span<'static> {
    Span::styled(format!(" {text} "), theme::ink(theme::DIM))
}

/// Rows skipped so the cursor row stays visible in `height` rows.
fn scroll(cursor: usize, height: usize) -> usize {
    if height == 0 {
        return 0;
    }
    cursor.saturating_sub(height - 1)
}

fn age_since(clock: Clock, at: Option<Timestamp>) -> String {
    at.map_or_else(|| String::from("—"), |at| format::age(clock.now - at))
}

/// The AGENTS NAME column.
const NAME_WIDTH: u16 = 20;

/// Width of the AGENTS columns that always show, with their spacing.
const FIXED: u16 = 45 + NAME_WIDTH;

/// The AGENTS table's optional columns at a given inner width.
struct AgentColumns {
    /// Narrow: no KIND, STAT or ERR columns; the status square stays.
    compact: bool,
    task: u16,
    tokens: bool,
    spark: u16,
}

impl AgentColumns {
    fn for_width(width: u16) -> Self {
        // The fixed columns and their spacing take 65, `doing` at least 18;
        // what is left goes to tokens, then the sparkline, then the task.
        let compact = width < FIXED + 18;
        let fixed = if compact { FIXED - 18 } else { FIXED };
        let mut rest = width.saturating_sub(fixed + 18);
        let tokens = rest >= 8;
        if tokens {
            rest -= 8;
        }
        let spark = if rest >= 13 { (rest - 1).min(30) } else { 0 };
        if spark > 0 {
            rest -= spark + 1;
        }
        let task = if rest >= 21 { (rest - 1).min(36) } else { 0 };
        Self {
            compact,
            task,
            tokens,
            spark,
        }
    }
}

/// One AGENTS row.
fn agent_row(agent: &Agent, name: String, clock: Clock, columns: &AgentColumns) -> Row<'static> {
    let doing = match (&agent.doing, agent.status) {
        (Some(doing), _) => Span::styled(doing.clone(), theme::ink(theme::CYAN)),
        (None, status) => match (&agent.status_detail, &agent.task) {
            (Some(detail), _) => {
                Span::styled(detail.clone(), theme::ink(theme::status_color(status)))
            }
            (None, Some(task)) => Span::styled(task.clone(), theme::ink(theme::DIM)),
            (None, None) => Span::styled("—", theme::ink(theme::FAINT)),
        },
    };
    let cost_color = match agent.cost {
        agent_monitor::domain::model::Cost::Known(_) => theme::YELLOW,
        agent_monitor::domain::model::Cost::Estimated(_) => theme::AMBER,
        agent_monitor::domain::model::Cost::Unpriced => theme::FAINT,
    };
    let errors = agent.tool_errors + agent.failures;

    let mut cells = vec![Cell::from(theme::status_square(
        agent.status,
        clock.blink(),
    ))];
    if !columns.compact {
        cells.push(Cell::from(Span::styled(
            agent.kind.label(),
            theme::ink(theme::DIM),
        )));
    }
    cells.push(Cell::from(Span::styled(name, theme::bold(theme::AMBER))));
    if !columns.compact {
        cells.push(Cell::from(Span::styled(
            theme::status_word(agent.status),
            theme::ink(theme::status_color(agent.status)),
        )));
    }
    cells.push(Cell::from(doing));
    if columns.task > 0 {
        cells.push(Cell::from(Span::styled(
            agent.task.clone().unwrap_or_default(),
            theme::ink(theme::DIM),
        )));
    }
    cells.extend([
        Cell::from(Line::from(age_since(clock, agent.started)).right_aligned()),
        Cell::from(Line::from(agent.turns.to_string()).right_aligned()),
        Cell::from(
            Line::from(Span::styled(
                agent.tool_calls.to_string(),
                theme::ink(theme::CYAN),
            ))
            .right_aligned(),
        ),
    ]);
    if !columns.compact {
        cells.push(Cell::from(
            Line::from(Span::styled(
                errors.to_string(),
                theme::ink(if errors > 0 { theme::RED } else { theme::FAINT }),
            ))
            .right_aligned(),
        ));
    }
    if columns.tokens {
        cells.push(Cell::from(
            Line::from(Span::styled(
                format::compact(agent.tokens.total()),
                theme::ink(theme::DIM),
            ))
            .right_aligned(),
        ));
    }
    cells.push(Cell::from(
        Line::from(Span::styled(
            format::cost(agent.cost),
            theme::bold(cost_color),
        ))
        .right_aligned(),
    ));
    if columns.spark > 0 {
        let color = if agent.status.is_final() {
            theme::FAINT
        } else {
            theme::GREEN
        };
        cells.push(Cell::from(Line::from(format::activity(
            &agent.activity,
            usize::from(columns.spark),
            color,
        ))));
    }
    Row::new(cells)
}

/// A row's name: a subagent shows under its parent as `parent/name`.
fn row_name(app: &App, agent: &Agent) -> String {
    match (&agent.parent, agent.kind) {
        (Some(parent), AgentKind::Subagent) => {
            format!("{}/{}", app.view.name_of(parent), agent.name)
        }
        _ => agent.name.clone(),
    }
}

fn agents(frame: &mut Frame<'_>, area: Rect, app: &mut App, clock: Clock, focused: bool) {
    let rows: Vec<&Agent> = app.view.sorted_agents(&app.filter);
    let live = rows.iter().filter(|agent| !agent.status.is_final()).count();
    let selected = app
        .cursors
        .agent
        .as_ref()
        .and_then(|id| rows.iter().position(|agent| agent.id == *id))
        .unwrap_or(0);
    let columns = AgentColumns::for_width(area.width.saturating_sub(2));

    let mut extra = vec![count_span(format!(
        "{live} LIVE · {} ROWS / {} ALL",
        rows.len(),
        app.view.agents.len()
    ))];
    extra.push(if app.filter.all {
        Span::styled(" ALL · a HIDES ENDED ", theme::bold(theme::YELLOW))
    } else {
        Span::styled(" a SHOWS ENDED ", theme::ink(theme::FAINT))
    });
    if !app.filter.is_empty() {
        extra.push(Span::styled(" FILTERED ", theme::bold(theme::YELLOW)));
    }
    let block = theme::pane("1 AGENTS", extra, focused);

    let mut header = vec![""];
    let mut widths = vec![Constraint::Length(1)];
    if !columns.compact {
        header.push("KIND");
        widths.push(Constraint::Length(8));
    }
    header.push("NAME");
    widths.push(Constraint::Length(NAME_WIDTH));
    if !columns.compact {
        header.push("STAT");
        widths.push(Constraint::Length(4));
    }
    header.push("DOING");
    widths.push(Constraint::Min(18));
    if columns.task > 0 {
        header.push("TASK");
        widths.push(Constraint::Length(columns.task));
    }
    header.extend(["AGE", "TRN", "TOOLS"]);
    widths.extend([
        Constraint::Length(4),
        Constraint::Length(4),
        Constraint::Length(5),
    ]);
    if !columns.compact {
        header.push("ERR");
        widths.push(Constraint::Length(3));
    }
    if columns.tokens {
        header.push("TOKENS");
        widths.push(Constraint::Length(7));
    }
    header.push("COST");
    widths.push(Constraint::Length(8));
    if columns.spark > 0 {
        header.push("ACTIVITY 60M");
        widths.push(Constraint::Length(columns.spark));
    }

    let table_rows: Vec<Row<'static>> = rows
        .iter()
        .map(|agent| agent_row(agent, row_name(app, agent), clock, &columns))
        .collect();
    let header_row = Row::new(
        header
            .into_iter()
            .map(|title| Cell::from(Span::styled(title, theme::bold(theme::FAINT)))),
    );
    let table = Table::new(table_rows, widths)
        .header(header_row)
        .column_spacing(1)
        .block(block)
        .row_highlight_style(if focused {
            theme::selected()
        } else {
            Style::new()
        });

    let mut state = TableState::default().with_selected(Some(selected));
    frame.render_stateful_widget(table, area, &mut state);
}

/// A tape kind's short tag and colour.
pub fn tape_tag(kind: TapeKind) -> (&'static str, Color) {
    match kind {
        TapeKind::Spawned => ("SPWN", theme::GREEN),
        TapeKind::Status => ("STAT", theme::YELLOW),
        TapeKind::TurnStart => ("TURN", theme::AMBER),
        TapeKind::TurnEnd => ("TEND", theme::DIM),
        TapeKind::ToolStart => ("TOOL", theme::CYAN),
        TapeKind::ToolEnd => ("TOK ", theme::CYAN),
        TapeKind::ToolError => ("TERR", theme::RED),
        TapeKind::Failure => ("FAIL", theme::RED),
        TapeKind::Finished => ("DONE", theme::GREEN),
        TapeKind::Removed => ("GONE", theme::FAINT),
    }
}

/// One tape line: time, agent, tag, text.
pub fn tape_line(
    app: &App,
    clock: Clock,
    event: &TapeEvent,
    name_width: usize,
    highlight: bool,
) -> Line<'static> {
    let (tag, tag_color) = tape_tag(event.kind);
    let text_color = match event.kind {
        TapeKind::ToolStart | TapeKind::ToolEnd => theme::CYAN,
        TapeKind::ToolError | TapeKind::Failure => theme::RED,
        _ => theme::severity_color(event.severity),
    };
    // An error flickers for a moment as it lands.
    let text = match event.kind {
        TapeKind::ToolError | TapeKind::Failure => theme::glitch(
            &event.text,
            (clock.now - event.at).num_milliseconds(),
            clock.now.timestamp_millis(),
        ),
        _ => event.text.clone(),
    };
    let line = Line::from(vec![
        Span::styled(clock.time_of(event.at), theme::ink(theme::DIM)),
        Span::raw(" "),
        Span::styled(
            format::cell(&app.view.name_of(&event.agent), name_width),
            theme::ink(theme::AMBER),
        ),
        Span::raw(" "),
        Span::styled(tag, theme::bold(tag_color)),
        Span::raw(" "),
        Span::styled(text, theme::ink(text_color)),
    ]);
    if highlight {
        line.style(theme::selected())
    } else {
        line
    }
}

fn tape(frame: &mut Frame<'_>, area: Rect, app: &mut App, clock: Clock, focused: bool) {
    let events: Vec<&TapeEvent> = app.view.tape_newest_first(&app.filter).collect();
    let cursor = app
        .cursors
        .tape
        .and_then(|seq| events.iter().position(|event| event.seq == seq))
        .unwrap_or(0);

    let mut extra = vec![count_span(format!("{} LINES", events.len()))];
    if cursor > 0 {
        extra.push(Span::styled(
            format!(" +{cursor} NEW "),
            theme::bold(theme::BG).bg(theme::YELLOW),
        ));
    } else {
        extra.push(Span::styled(" ▼ FOLLOWING ", theme::ink(theme::GREEN)));
    }
    let block = theme::pane("2 TAPE", extra, focused);
    let inner = block.inner(area);
    let height = usize::from(inner.height);
    let skip = scroll(cursor, height);

    let lines: Vec<Line<'static>> = events
        .iter()
        .enumerate()
        .skip(skip)
        .take(height)
        .map(|(index, event)| tape_line(app, clock, event, 14, focused && index == cursor))
        .collect();
    frame.render_widget(Paragraph::new(lines).block(block), area);
}

fn spend(frame: &mut Frame<'_>, area: Rect, app: &mut App, focused: bool) {
    let totals = &app.view.totals;
    let block = theme::pane(
        "3 SPEND TODAY",
        vec![Span::styled(
            format!(" {} ", format::cost(totals.cost_today)),
            theme::bold(theme::YELLOW),
        )],
        focused,
    );
    let inner = block.inner(area);
    frame.render_widget(block, area);
    if inner.height < 3 {
        return;
    }

    let chart_height = (inner.height / 2).clamp(3, 12);
    let [chart_area, axis_area, table_area] = Layout::vertical([
        Constraint::Length(chart_height),
        Constraint::Length(1),
        Constraint::Min(0),
    ])
    .areas(inner);

    let bar_width = (inner.width / 24).max(1);
    let bars: Vec<Bar<'_>> = totals
        .cost_by_hour
        .iter()
        .map(|usd| {
            // Cents: BarChart takes integers.
            let cents = (f64::from(*usd) * 100.0).round().max(0.0) as u64;
            Bar::default()
                .value(cents)
                .text_value(String::new())
                .style(theme::ink(if cents > 0 {
                    theme::STRIP
                } else {
                    theme::GHOST
                }))
        })
        .collect();
    let chart = BarChart::default()
        .data(BarGroup::default().bars(&bars))
        .bar_width(bar_width)
        .bar_gap(0)
        .block(Block::default());
    frame.render_widget(chart, chart_area);

    let mut axis = String::new();
    for hour in (0..24).step_by(6) {
        let label = format!("{hour:02}");
        axis.push_str(&format::cell(&label, usize::from(bar_width) * 6));
    }
    frame.render_widget(
        Paragraph::new(Span::styled(axis, theme::ink(theme::FAINT))),
        axis_area,
    );

    let kinds = app.view.spend_by_kind();
    let total: f64 = kinds.iter().filter_map(|(_, cost)| cost.usd()).sum();
    let width = usize::from(table_area.width);
    let bar_room = width.saturating_sub(8 + 9 + 5 + 2);
    let mut lines = vec![Line::from(Span::styled(
        format::cell("KIND        USD    %", width),
        theme::bold(theme::FAINT),
    ))];
    for (index, (kind, cost)) in kinds.iter().enumerate() {
        let usd = cost.usd().unwrap_or(0.0);
        let share = if total > 0.0 { usd / total } else { 0.0 };
        // Display rounding of a share in [0, 1].
        let filled = ((share * bar_room as f64).round() as usize).min(bar_room);
        let line = Line::from(
            vec![
                Span::styled(format::cell(kind.label(), 8), theme::ink(theme::AMBER)),
                Span::styled(
                    format::right(&format::cost(*cost), 9),
                    theme::bold(theme::YELLOW),
                ),
                Span::styled(
                    format::right(&format!("{:.0}", share * 100.0), 4),
                    theme::ink(theme::DIM),
                ),
                Span::raw(" "),
            ]
            .into_iter()
            .chain(theme::meter(filled, bar_room, theme::STRIP))
            .collect::<Vec<_>>(),
        );
        lines.push(if focused && index == app.cursors.spend {
            line.style(theme::selected())
        } else {
            line
        });
    }
    frame.render_widget(Paragraph::new(lines), table_area);
}

fn failures(frame: &mut Frame<'_>, area: Rect, app: &mut App, clock: Clock, focused: bool) {
    let rows = app.view.failures(&app.filter);
    let totals = &app.view.totals;
    // The board's count, so the two always agree; rows give the detail.
    let count = totals.errors_24h + totals.failed_24h;
    let color = if count == 0 && rows.is_empty() {
        theme::GREEN
    } else {
        theme::RED
    };
    let block = theme::pane(
        "4 FAILURES",
        vec![
            Span::styled(format!(" {count} 24H "), theme::bold(color)),
            Span::styled(
                format!("{} TOOL · {} AGENT ", totals.errors_24h, totals.failed_24h),
                theme::ink(theme::DIM),
            ),
        ],
        focused,
    );
    let inner = block.inner(area);
    let height = usize::from(inner.height);
    let cursor = app.cursors.failure.min(rows.len().saturating_sub(1));
    let skip = scroll(cursor, height);

    let mut lines: Vec<Line<'static>> = rows
        .iter()
        .enumerate()
        .skip(skip)
        .take(height)
        .map(|(index, row)| {
            let kind = app
                .view
                .agents
                .get(&row.agent)
                .map_or("", |agent| agent.kind.label());
            let line = Line::from(vec![
                Span::styled(
                    format::right(&format::age(clock.now - row.at), 4),
                    theme::ink(theme::DIM),
                ),
                Span::raw(" "),
                Span::styled(
                    format::cell(
                        if row.what == "tool" {
                            "✕ tool"
                        } else {
                            "▲ agent"
                        },
                        8,
                    ),
                    theme::bold(theme::RED),
                ),
                Span::styled(format::cell(kind, 9), theme::ink(theme::DIM)),
                Span::styled(
                    format::cell(&app.view.name_of(&row.agent), 14),
                    theme::ink(theme::AMBER),
                ),
                Span::raw(" "),
                Span::styled(
                    theme::glitch(
                        &row.detail,
                        (clock.now - row.at).num_milliseconds(),
                        clock.now.timestamp_millis(),
                    ),
                    theme::ink(theme::RED),
                ),
            ]);
            if focused && index == cursor {
                line.style(theme::selected())
            } else {
                line
            }
        })
        .collect();
    if lines.is_empty() {
        lines.push(Line::from(Span::styled(
            "  ◆ ALL CLEAR // no failures in the last 24 hours",
            theme::ink(theme::GREEN),
        )));
    }
    frame.render_widget(Paragraph::new(lines).block(block), area);
}

fn sources(frame: &mut Frame<'_>, area: Rect, app: &mut App, clock: Clock, focused: bool) {
    let rows = app.view.source_rows();
    let healthy = rows
        .iter()
        .filter(|row| {
            row.health
                .is_none_or(|health| health.state == SourceState::Healthy)
        })
        .count();
    let color = if healthy == rows.len() {
        theme::GREEN
    } else {
        theme::RED
    };
    let block = theme::pane(
        "6 SOURCES",
        vec![Span::styled(
            format!(" {healthy}/{} OK ", rows.len()),
            theme::bold(color),
        )],
        focused,
    );
    let width = usize::from(block.inner(area).width);
    let name_width = width.saturating_sub(2 + 5 + 7 + 5).clamp(6, 18);

    let mut lines = vec![Line::from(Span::styled(
        format!(
            "  {}  AGT  ITEMS LAST",
            format::cell("SOURCE", name_width.saturating_sub(1))
        ),
        theme::bold(theme::FAINT),
    ))];
    for (index, row) in rows.iter().enumerate() {
        let (dot, color) = match row.health.map(|health| health.state) {
            Some(SourceState::Healthy) => ("●", theme::GREEN),
            Some(SourceState::Starting) => ("◐", theme::YELLOW),
            Some(SourceState::Unhealthy) => ("●", theme::RED),
            Some(SourceState::Absent) => ("○", theme::FAINT),
            None => ("◆", theme::AMBER),
        };
        let items = row.health.map_or_else(
            || String::from("—"),
            |health| format::thousands(u64::from(health.items)),
        );
        let last = age_since(clock, row.health.and_then(|health| health.last_event));
        let mut spans = vec![
            Span::styled(format!("{dot} "), theme::bold(color)),
            Span::styled(
                format::cell(row.source.name(), name_width),
                theme::ink(theme::AMBER),
            ),
            Span::styled(
                format::right(&row.agents.to_string(), 5),
                theme::bold(theme::YELLOW),
            ),
            Span::styled(format::right(&items, 7), theme::ink(theme::AMBER)),
            Span::styled(format::right(&last, 5), theme::ink(theme::DIM)),
        ];
        let restarts = row.health.map_or(0, |health| health.restarts);
        if restarts > 0 {
            spans.push(Span::styled(
                format!(" ↻{restarts}"),
                theme::ink(theme::RED),
            ));
        }
        let line = Line::from(spans);
        lines.push(if focused && index == app.cursors.source {
            line.style(theme::selected())
        } else {
            line
        });

        let Some(health) = row.health else { continue };
        if let Some(progress) = health.indexing {
            let total = progress.total.max(1);
            let room = width.saturating_sub(16);
            let done = u64::from(progress.done.min(total));
            let filled =
                usize::try_from(done * u64::try_from(room).unwrap_or(0) / u64::from(total))
                    .unwrap_or(0)
                    .min(room);
            let mut spans = vec![Span::styled("  idx ", theme::ink(theme::FAINT))];
            spans.extend(theme::meter(filled, room, theme::YELLOW));
            lines.push(Line::from(
                spans
                    .into_iter()
                    .chain([Span::styled(
                        format!(" {}/{}", progress.done, progress.total),
                        theme::ink(theme::DIM),
                    )])
                    .collect::<Vec<_>>(),
            ));
        }
        if let Some(detail) = &health.detail
            && health.state != SourceState::Healthy
        {
            lines.push(Line::from(Span::styled(
                format!("  {detail}"),
                theme::ink(color),
            )));
        }
    }
    if rows.is_empty() {
        lines.push(Line::from(Span::styled(
            "  waiting for the collector",
            theme::ink(theme::DIM),
        )));
    }
    frame.render_widget(Paragraph::new(lines).block(block), area);
}

fn body(frame: &mut Frame<'_>, area: Rect, app: &mut App, clock: Clock, focused: bool) {
    let block = theme::pane(
        "7 BODY",
        vec![
            Span::styled(" BIOSCAN ", theme::bold(theme::CYAN)),
            count_span(app.view.body.title().to_owned()),
        ],
        focused,
    );
    let inner = block.inner(area);
    frame.render_widget(block, area);
    app.view.body.render(inner, frame.buffer_mut());
    scanner(frame, inner, app, clock);
}

/// The scanner readout over the BODY figure: crosshair corners with a label
/// in each, and tick marks down both edges.
fn scanner(frame: &mut Frame<'_>, area: Rect, app: &App, clock: Clock) {
    if area.width < 24 || area.height < 6 {
        return;
    }
    let rule = theme::ink(theme::CYAN_DIM);
    let label = theme::bold(theme::CYAN);
    let tokens = app.view.totals.tokens_per_min.last().copied().unwrap_or(0);
    let rec = if clock.blink() { "○" } else { "●" };

    let corner = |x: u16, y: u16, spans: Vec<Span<'static>>, right: bool| {
        let line = Line::from(spans);
        let width = u16::try_from(line.width()).unwrap_or(0).min(area.width);
        let x = if right { x.saturating_sub(width) } else { x };
        (Rect::new(x, y, width, 1), line)
    };
    let readouts = [
        corner(
            area.x,
            area.y,
            vec![
                Span::styled("┌╴", rule),
                Span::styled("SCAN", label),
                Span::styled(format!(" 0x{:03X}", app.view.seq % 0x1000), rule),
            ],
            false,
        ),
        corner(
            area.right(),
            area.y,
            vec![
                Span::styled("REC ", theme::ink(theme::DIM)),
                Span::styled(rec, theme::bold(theme::RED)),
                Span::styled("╶┐", rule),
            ],
            true,
        ),
        corner(
            area.x,
            area.bottom() - 1,
            vec![
                Span::styled("└╴", rule),
                Span::styled("SUBJ ", theme::ink(theme::DIM)),
                Span::styled(
                    format!("{:02}", app.view.totals.working),
                    theme::bold(theme::GREEN),
                ),
                Span::styled(" LIVE", theme::ink(theme::DIM)),
            ],
            false,
        ),
        corner(
            area.right(),
            area.bottom() - 1,
            vec![
                Span::styled("TOK/M ", theme::ink(theme::DIM)),
                Span::styled(
                    format::compact(u64::from(tokens)),
                    theme::bold(theme::YELLOW),
                ),
                Span::styled("╶┘", rule),
            ],
            true,
        ),
    ];
    for (rect, line) in readouts {
        frame.render_widget(Paragraph::new(line), rect);
    }

    // Tick marks down both edges, a long one every fourth row.
    let buffer = frame.buffer_mut();
    for y in area.y + 2..area.bottom().saturating_sub(2) {
        let long = (y - area.y).is_multiple_of(4);
        let (left, right, width) = if long {
            ("╶─", "─╴", 2)
        } else {
            ("╶", "╴", 1)
        };
        for (x, mark) in [(area.x, left), (area.right() - width, right)] {
            for (offset, symbol) in mark.chars().enumerate() {
                let x = x + u16::try_from(offset).unwrap_or(0);
                if let Some(cell) = buffer.cell_mut((x, y))
                    && cell.symbol() == " "
                {
                    cell.set_char(symbol).set_fg(theme::CYAN_DARK);
                }
            }
        }
    }
}
