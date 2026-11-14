//! The agent drill-in: header, stats, a timeline strip, the transcript tail
//! and the children list.

use std::collections::HashMap;

use chrono::TimeDelta;
use ratatui::Frame;
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::style::Color;
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, BorderType, Borders, Paragraph};

use agent_monitor::domain::model::{
    Agent, AgentId, TapeKind, Timestamp, TranscriptItem, TranscriptItemKind,
};

use crate::app::App;
use crate::format;
use crate::keys::{Base, Pane};
use crate::theme;
use crate::ui::Clock;
use crate::ui::panes::tape_line;

/// Gaps longer than this are squeezed to one column in the timeline.
const SQUEEZE: TimeDelta = TimeDelta::seconds(120);

/// Characters of a tool call's arguments or result shown when expanded.
const EXPANDED_CHARS: usize = 600;

/// Draws the drill-in page for `id`.
pub fn draw(frame: &mut Frame<'_>, area: Rect, app: &mut App, clock: Clock, id: &AgentId) {
    let Some(agent) = app.view.agents.get(id).cloned() else {
        let block = theme::pane("AGENT", Vec::new(), true);
        let text = format!("  {id} is gone. ESC goes back.");
        frame.render_widget(
            Paragraph::new(Span::styled(text, theme::ink(theme::RED))).block(block),
            area,
        );
        return;
    };

    let [header, stats, timeline, lower] = Layout::vertical([
        Constraint::Length(4),
        Constraint::Length(4),
        Constraint::Length(4),
        Constraint::Min(0),
    ])
    .areas(area);

    draw_header(frame, header, &agent, clock);
    draw_stats(frame, stats, &agent, clock);
    draw_timeline(frame, timeline, app, &agent, clock);

    let [transcript, side] = if lower.width >= 120 {
        Layout::horizontal([Constraint::Min(0), Constraint::Percentage(36)]).areas(lower)
    } else {
        Layout::horizontal([Constraint::Min(0), Constraint::Length(0)]).areas(lower)
    };
    draw_transcript(frame, transcript, app, clock);
    if side.width > 0 {
        let [children, tape] =
            Layout::vertical([Constraint::Percentage(45), Constraint::Percentage(55)]).areas(side);
        draw_children(frame, children, app, &agent, clock);
        draw_agent_tape(frame, tape, app, &agent, clock);
    }
}

fn draw_header(frame: &mut Frame<'_>, area: Rect, agent: &Agent, clock: Clock) {
    let field = |label: &'static str, value: Option<String>| -> Vec<Span<'static>> {
        vec![
            Span::styled(format!("{label} "), theme::ink(theme::FAINT)),
            Span::styled(
                value.unwrap_or_else(|| String::from("—")),
                theme::ink(theme::AMBER),
            ),
            Span::raw("   "),
        ]
    };

    let title = Line::from(vec![
        Span::styled(format!(" {} ", agent.name), theme::strip()),
        Span::styled(
            format!(" {} ", agent.kind.label()),
            theme::bold(theme::YELLOW),
        ),
        theme::status_square(agent.status, clock.blink()),
        Span::styled(
            format!(" {} ", theme::status_word(agent.status)),
            theme::bold(theme::status_color(agent.status)),
        ),
        Span::styled(
            agent.status_detail.clone().unwrap_or_default(),
            theme::ink(theme::status_color(agent.status)),
        ),
        Span::styled(format!(" {} ", agent.id), theme::ink(theme::FAINT)),
    ]);
    let block = Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Plain)
        .border_style(theme::ink(theme::FAINT))
        .title(title)
        .style(theme::base());

    let mut first = Vec::new();
    first.extend(field("PROGRAM", agent.program.clone()));
    first.extend(field("MODEL", agent.model.clone()));
    first.extend(field(
        "CWD",
        agent.cwd.as_ref().map(|cwd| cwd.display().to_string()),
    ));
    first.extend(field("BRANCH", agent.branch.clone()));
    first.extend(field("SPACE", agent.space.clone()));

    let mut second = Vec::new();
    second.extend(field("TERMINAL", agent.terminal.clone()));
    second.extend(field("SESSION", agent.session.clone()));
    second.extend(field("PID", agent.pid.map(|pid| pid.to_string())));
    second.extend(field("STARTED", agent.started.map(|at| clock.time_of(at))));
    second.extend(field(
        "PARENT",
        agent.parent.as_ref().map(ToString::to_string),
    ));
    second.push(Span::styled("TASK ", theme::ink(theme::FAINT)));
    second.push(Span::styled(
        agent.task.clone().unwrap_or_default(),
        theme::ink(theme::YELLOW),
    ));

    frame.render_widget(
        Paragraph::new(vec![Line::from(first), Line::from(second)]).block(block),
        area,
    );
}

fn draw_stats(frame: &mut Frame<'_>, area: Rect, agent: &Agent, clock: Clock) {
    let duration = agent.started.map_or_else(
        || String::from("—"),
        |started| format::duration(agent.ended.unwrap_or(clock.now) - started),
    );
    let errors = agent.tool_errors;
    let cells: [(&str, String, Color); 9] = [
        ("DURATION", duration, theme::AMBER),
        ("COST", format::cost(agent.cost), theme::YELLOW),
        (
            "TURNS",
            format::thousands(u64::from(agent.turns)),
            theme::AMBER,
        ),
        (
            "TOOLS",
            format::thousands(u64::from(agent.tool_calls)),
            theme::CYAN,
        ),
        (
            "ERRORS",
            errors.to_string(),
            if errors > 0 { theme::RED } else { theme::GREEN },
        ),
        ("TOK IN", format::compact(agent.tokens.input), theme::AMBER),
        (
            "TOK OUT",
            format::compact(agent.tokens.output),
            theme::AMBER,
        ),
        (
            "CACHE RD",
            format::compact(agent.tokens.cache_read),
            theme::DIM,
        ),
        (
            "CACHE WR",
            format::compact(agent.tokens.cache_write),
            theme::DIM,
        ),
    ];
    let areas = Layout::horizontal([Constraint::Ratio(1, 9); 9]).split(area);
    for ((label, value, color), cell) in cells.into_iter().zip(areas.iter()) {
        let block = Block::default()
            .borders(Borders::ALL)
            .border_style(theme::ink(theme::FAINT))
            .title(Span::styled(
                format!(" {label} "),
                theme::bold(theme::STRIP),
            ))
            .style(theme::base());
        frame.render_widget(
            Paragraph::new(vec![
                Line::from(Span::styled(value, theme::bold(color))),
                Line::from(format::activity(
                    &agent.activity,
                    usize::from(cell.width.saturating_sub(2)),
                    theme::FAINT,
                )),
            ])
            .block(block),
            *cell,
        );
    }
}

/// One mark on the timeline.
#[derive(Clone, Copy)]
struct Mark {
    at: Timestamp,
    glyph: char,
    color: Color,
    rank: u8,
}

fn marks(app: &App, agent: &Agent) -> Vec<Mark> {
    let from_transcript = app
        .view
        .transcript
        .as_ref()
        .filter(|transcript| transcript.agent == agent.id && !transcript.items.is_empty());

    let mut marks: Vec<Mark> = match from_transcript {
        Some(transcript) => transcript
            .items
            .iter()
            .map(|item| {
                let (glyph, color, rank) = match (item.kind, item.is_error) {
                    (TranscriptItemKind::User, _) => ('▲', theme::YELLOW, 2),
                    (TranscriptItemKind::Assistant, _) => ('▪', theme::AMBER, 1),
                    (TranscriptItemKind::ToolCall, _) => ('▮', theme::CYAN, 3),
                    (TranscriptItemKind::ToolResult, true) => ('✖', theme::RED, 4),
                    (TranscriptItemKind::ToolResult, false) => ('│', theme::CYAN, 0),
                };
                Mark {
                    at: item.at,
                    glyph,
                    color,
                    rank,
                }
            })
            .collect(),
        None => app
            .view
            .tape
            .iter()
            .filter(|event| event.agent == agent.id)
            .map(|event| {
                let (glyph, color, rank) = match event.kind {
                    TapeKind::TurnStart => ('▲', theme::YELLOW, 2),
                    TapeKind::TurnEnd => ('▪', theme::AMBER, 1),
                    TapeKind::ToolStart | TapeKind::ToolEnd => ('▮', theme::CYAN, 3),
                    TapeKind::ToolError | TapeKind::Failure => ('✖', theme::RED, 4),
                    _ => ('◆', theme::GREEN, 2),
                };
                Mark {
                    at: event.at,
                    glyph,
                    color,
                    rank,
                }
            })
            .collect(),
    };
    marks.sort_by_key(|mark| mark.at);
    marks
}

fn draw_timeline(frame: &mut Frame<'_>, area: Rect, app: &App, agent: &Agent, clock: Clock) {
    let marks = marks(app, agent);
    let block = theme::pane(
        "TIMELINE",
        vec![Span::styled(
            format!(
                " {} EVENTS · GAPS > 2M SQUEEZED ┊ · ▲ TURN ▮ TOOL ✖ ERROR ",
                marks.len()
            ),
            theme::ink(theme::DIM),
        )],
        false,
    );
    let inner = block.inner(area);
    frame.render_widget(block, area);
    let width = usize::from(inner.width);
    if width == 0 || inner.height == 0 {
        return;
    }
    let (Some(first), Some(last)) = (marks.first(), marks.last()) else {
        frame.render_widget(
            Paragraph::new(Span::styled("  no activity yet", theme::ink(theme::FAINT))),
            inner,
        );
        return;
    };

    // Squeezed time: every gap counts at most SQUEEZE, and a squeezed gap
    // leaves a marker. Each mark gets an offset on that squeezed axis.
    let mut offsets = Vec::with_capacity(marks.len());
    let mut squeezed_at = Vec::new();
    let mut offset = 0i64;
    let mut previous = first.at;
    for mark in &marks {
        let gap = mark.at - previous;
        if gap > SQUEEZE {
            squeezed_at.push(offset + SQUEEZE.num_milliseconds() / 2);
            offset += SQUEEZE.num_milliseconds();
        } else {
            offset += gap.num_milliseconds();
        }
        offsets.push(offset);
        previous = mark.at;
    }
    let span = offset.max(1);
    let column = |offset: i64| -> usize {
        let scaled = i128::from(offset) * i128::try_from(width - 1).unwrap_or(0) / i128::from(span);
        usize::try_from(scaled).unwrap_or(0).min(width - 1)
    };

    let mut cells: Vec<Option<Mark>> = vec![None; width];
    for gap in squeezed_at {
        if let Some(cell) = cells.get_mut(column(gap)) {
            *cell = Some(Mark {
                at: first.at,
                glyph: '┊',
                color: theme::FAINT,
                rank: 0,
            });
        }
    }
    for (mark, offset) in marks.iter().zip(offsets) {
        if let Some(cell) = cells.get_mut(column(offset))
            && cell.is_none_or(|existing| existing.rank <= mark.rank)
        {
            *cell = Some(*mark);
        }
    }

    let strip: Vec<Span<'static>> = cells
        .iter()
        .map(|cell| match cell {
            Some(mark) => Span::styled(mark.glyph.to_string(), theme::bold(mark.color)),
            None => Span::styled("·", theme::ink(theme::GHOST)),
        })
        .collect();
    let start = clock.time_of(first.at);
    let end = clock.time_of(last.at);
    let axis = format!(
        "{start}{}{end}",
        " ".repeat(width.saturating_sub(start.len() + end.len()))
    );
    frame.render_widget(
        Paragraph::new(vec![
            Line::from(strip),
            Line::from(Span::styled(axis, theme::ink(theme::FAINT))),
        ]),
        inner,
    );
}

/// The result of each tool call, by tool id.
fn results(items: &[&TranscriptItem]) -> HashMap<String, TranscriptItem> {
    items
        .iter()
        .filter(|item| item.kind == TranscriptItemKind::ToolResult)
        .filter_map(|item| item.tool_id.clone().map(|id| (id, (*item).clone())))
        .collect()
}

fn draw_transcript(frame: &mut Frame<'_>, area: Rect, app: &App, clock: Clock) {
    let focused = matches!(app.mode.base(), Base::Idle | Base::Pane(Pane::Transcript));
    let Some(transcript) = app.view.transcript.as_ref() else {
        let block = theme::pane("TRANSCRIPT", Vec::new(), focused);
        frame.render_widget(Paragraph::new("").block(block), area);
        return;
    };

    let items: Vec<&TranscriptItem> = transcript.items.iter().collect();
    let results = results(&items);
    let last = items.len().saturating_sub(1);
    let cursor = app.cursors.transcript.unwrap_or(last);
    let following = app.cursors.transcript.is_none();

    let mut extra = vec![Span::styled(
        format!(" {} ITEMS ", items.len()),
        theme::ink(theme::DIM),
    )];
    extra.push(if following {
        Span::styled(" ▼ FOLLOWING ", theme::ink(theme::GREEN))
    } else {
        Span::styled(
            format!(" {} BELOW ", last - cursor),
            theme::bold(theme::BG).bg(theme::YELLOW),
        )
    });
    extra.push(Span::styled(
        " ENTER EXPANDS A TOOL CALL ",
        theme::ink(theme::FAINT),
    ));
    let block = theme::pane("TRANSCRIPT", extra, focused);
    let inner = block.inner(area);
    let width = usize::from(inner.width);

    // Lines per item, then a window that keeps the cursor item on screen.
    let mut lines: Vec<(usize, Line<'static>)> = Vec::new();
    for (index, item) in items.iter().enumerate() {
        if item.kind == TranscriptItemKind::ToolResult && !item.is_error {
            continue;
        }
        let selected = focused && index == cursor;
        for line in item_lines(item, &results, &app.cursors.expanded, clock, width) {
            let line = if selected {
                line.style(theme::selected())
            } else {
                line
            };
            lines.push((index, line));
        }
    }
    let height = usize::from(inner.height);
    let cursor_line = lines
        .iter()
        .rposition(|(index, _)| *index <= cursor)
        .unwrap_or(0);
    let skip = (cursor_line + 1).saturating_sub(height);

    let mut shown: Vec<Line<'static>> = lines
        .into_iter()
        .skip(skip)
        .take(height)
        .map(|(_, line)| line)
        .collect();
    if let Some(error) = &transcript.error {
        shown.push(Line::from(Span::styled(
            format!("  {error}"),
            theme::ink(theme::RED),
        )));
    } else if shown.is_empty() {
        shown.push(Line::from(Span::styled(
            "  reading the transcript…",
            theme::ink(theme::FAINT),
        )));
    }
    frame.render_widget(Paragraph::new(shown).block(block), area);
}

fn item_lines(
    item: &TranscriptItem,
    results: &HashMap<String, TranscriptItem>,
    expanded: &std::collections::HashSet<String>,
    clock: Clock,
    width: usize,
) -> Vec<Line<'static>> {
    let time = Span::styled(
        format!("{} ", clock.time_of(item.at)),
        theme::ink(theme::FAINT),
    );
    let one_line = |text: &str| text.split_whitespace().collect::<Vec<_>>().join(" ");

    match item.kind {
        TranscriptItemKind::User => vec![Line::from(vec![
            time,
            Span::styled("USER ", theme::bold(theme::YELLOW)),
            Span::styled(one_line(&item.text), theme::ink(theme::YELLOW)),
        ])],
        TranscriptItemKind::Assistant => vec![Line::from(vec![
            time,
            Span::styled("TURN ", theme::bold(theme::AMBER)),
            Span::styled(one_line(&item.text), theme::ink(theme::AMBER)),
        ])],
        TranscriptItemKind::ToolResult => vec![Line::from(vec![
            time,
            Span::styled("ERR  ", theme::bold(theme::RED)),
            Span::styled(one_line(&item.text), theme::ink(theme::RED)),
        ])],
        TranscriptItemKind::ToolCall => {
            let result = item.tool_id.as_ref().and_then(|id| results.get(id));
            let (status, color) = match result {
                Some(result) if result.is_error => ("ERROR", theme::RED),
                Some(_) => ("OK", theme::GREEN),
                None => ("…", theme::YELLOW),
            };
            let duration = result
                .and_then(|result| result.duration_ms)
                .map(|ms| format!("{:.1}s", ms as f64 / 1000.0))
                .unwrap_or_default();
            let name = item
                .tool_name
                .clone()
                .unwrap_or_else(|| String::from("tool"));
            let tail = format!(" {duration:>6} {status:<5}");
            let gist_width = width.saturating_sub(9 + 5 + 12 + tail.len());
            let mut lines = vec![Line::from(vec![
                time,
                Span::styled("TOOL ", theme::bold(theme::CYAN)),
                Span::styled(format::cell(&name, 12), theme::bold(theme::CYAN)),
                Span::styled(
                    format::cell(&one_line(&item.text), gist_width),
                    theme::ink(theme::DIM),
                ),
                Span::styled(format!(" {duration:>6} "), theme::ink(theme::DIM)),
                Span::styled(format!("{status:<5}"), theme::bold(color)),
            ])];

            let open = item
                .tool_id
                .as_ref()
                .is_some_and(|id| expanded.contains(id));
            if open {
                lines.push(Line::from(Span::styled(
                    "         ┌ ARGUMENTS",
                    theme::ink(theme::FAINT),
                )));
                lines.push(Line::from(Span::styled(
                    format!(
                        "         │ {}",
                        format::clip(&one_line(&item.text), EXPANDED_CHARS)
                    ),
                    theme::ink(theme::AMBER),
                )));
                if let Some(result) = result {
                    lines.push(Line::from(Span::styled(
                        "         ├ RESULT",
                        theme::ink(theme::FAINT),
                    )));
                    lines.push(Line::from(Span::styled(
                        format!(
                            "         │ {}",
                            format::clip(&one_line(&result.text), EXPANDED_CHARS)
                        ),
                        theme::ink(color),
                    )));
                }
                lines.push(Line::from(Span::styled(
                    "         └",
                    theme::ink(theme::FAINT),
                )));
            }
            lines
        }
    }
}

fn draw_children(frame: &mut Frame<'_>, area: Rect, app: &App, agent: &Agent, clock: Clock) {
    let focused = app.mode.base() == Base::Pane(Pane::Children);
    let block = theme::pane(
        "CHILDREN",
        vec![Span::styled(
            format!(" {} · TAB HERE, ENTER DRILLS ", agent.children.len()),
            theme::ink(theme::DIM),
        )],
        focused,
    );
    let mut lines: Vec<Line<'static>> = Vec::new();
    for (index, child) in agent.children.iter().enumerate() {
        let line = match app.view.agents.get(child) {
            Some(child) => Line::from(vec![
                theme::status_square(child.status, clock.blink()),
                Span::raw(" "),
                Span::styled(format::cell(child.kind.label(), 9), theme::ink(theme::DIM)),
                Span::styled(format::cell(&child.name, 16), theme::bold(theme::AMBER)),
                Span::raw(" "),
                Span::styled(
                    format!("{} ", theme::status_word(child.status)),
                    theme::ink(theme::status_color(child.status)),
                ),
                Span::styled(
                    format::right(&format::cost(child.cost), 8),
                    theme::bold(theme::YELLOW),
                ),
                Span::raw(" "),
                Span::styled(
                    child.doing.clone().unwrap_or_default(),
                    theme::ink(theme::CYAN),
                ),
            ]),
            None => Line::from(Span::styled(
                format!("· {child} (gone)"),
                theme::ink(theme::FAINT),
            )),
        };
        lines.push(if focused && index == app.cursors.child {
            line.style(theme::selected())
        } else {
            line
        });
    }
    if lines.is_empty() {
        lines.push(Line::from(Span::styled(
            "  no children",
            theme::ink(theme::FAINT),
        )));
    }
    frame.render_widget(Paragraph::new(lines).block(block), area);
}

fn draw_agent_tape(frame: &mut Frame<'_>, area: Rect, app: &App, agent: &Agent, clock: Clock) {
    let block = theme::pane("TAPE", Vec::new(), false);
    let height = usize::from(block.inner(area).height);
    let lines: Vec<Line<'static>> = app
        .view
        .agent_tape(&agent.id, height)
        .into_iter()
        .map(|event| tape_line(app, clock, event, 10, false))
        .collect();
    frame.render_widget(Paragraph::new(lines).block(block), area);
}
