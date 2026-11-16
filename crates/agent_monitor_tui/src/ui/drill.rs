//! The agent drill-in: header, stats, a timeline strip, the transcript tail,
//! the children list and the agent's pull requests.

use std::collections::HashMap;

use chrono::TimeDelta;
use ratatui::Frame;
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::text::{Line, Span};
use ratatui::widgets::Paragraph;

use agent_monitor::domain::model::{
    Agent, AgentId, TapeKind, Timestamp, TranscriptItem, TranscriptItemKind,
};

use crate::app::App;
use crate::format;
use crate::keys::{Base, Pane};
use crate::theme;
use crate::theme::Token;
use crate::ui::Clock;
use crate::ui::panes::{pr_line, tape_line};

/// Gaps longer than this are squeezed to one column in the timeline.
const SQUEEZE: TimeDelta = TimeDelta::seconds(120);

/// Characters of a tool call's arguments or result shown when expanded.
const EXPANDED_CHARS: usize = 600;

/// Draws the drill-in page for `id`.
pub fn draw(frame: &mut Frame<'_>, area: Rect, app: &mut App, clock: Clock, id: &AgentId) {
    let Some(agent) = app.view.agents.get(id).cloned() else {
        let block =
            theme::pane(area, "AGENT", Vec::new(), true).title(theme::hotkeys(&[("Esc", "BACK")]));
        let text = format!("  {id} is gone.");
        frame.render_widget(
            Paragraph::new(Span::styled(text, theme::ink(Token::Alert))).block(block),
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
        let pr_rows = u16::try_from(agent.prs.len().clamp(1, 6)).unwrap_or(1) + 2;
        let [children, prs, tape] = Layout::vertical([
            Constraint::Percentage(40),
            Constraint::Length(pr_rows),
            Constraint::Min(0),
        ])
        .areas(side);
        draw_children(frame, children, app, &agent, clock);
        draw_prs(frame, prs, app, &agent, clock);
        draw_agent_tape(frame, tape, app, &agent, clock);
    }
}

fn draw_header(frame: &mut Frame<'_>, area: Rect, agent: &Agent, clock: Clock) {
    let field = |label: &'static str, value: Option<String>| -> Vec<Span<'static>> {
        vec![
            Span::styled(format!("{label} "), theme::ink(Token::Rule)),
            Span::styled(
                value.unwrap_or_else(|| String::from("—")),
                theme::ink(Token::Text),
            ),
            Span::raw("   "),
        ]
    };

    let mut title = theme::strip_title(&agent.name);
    title.extend([
        Span::styled(
            format!(" {} ", agent.kind.label()),
            theme::bold(Token::Highlight),
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
        Span::styled(format!(" {} ", agent.id), theme::ink(Token::InfoDim)),
    ]);
    let block = theme::frame(Token::Frame).title(Line::from(title));

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
    second.push(Span::styled("TASK ", theme::ink(Token::Rule)));
    second.push(Span::styled(
        agent.task.clone().unwrap_or_default(),
        theme::ink(Token::Highlight),
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
    let minutes = &agent.minutes;
    let counts = |series: &[u16]| series.iter().map(|value| u64::from(*value)).collect();
    let tokens = minutes
        .tokens
        .iter()
        .map(|value| u64::from(*value))
        .collect();
    // Cells with a per-minute series draw it; the rest show only their value.
    let cells: [(&str, String, Token, Option<Vec<u64>>); 7] = [
        ("DURATION", duration, Token::Text, None),
        (
            "TURNS",
            format::thousands(u64::from(agent.turns)),
            Token::Text,
            Some(counts(&minutes.turns)),
        ),
        (
            "TOOLS",
            format::thousands(u64::from(agent.tool_calls)),
            Token::Info,
            Some(counts(&minutes.tools)),
        ),
        (
            "TOKENS",
            format::compact(agent.tokens.total()),
            Token::Text,
            Some(tokens),
        ),
        (
            "TOK IN",
            format::compact(agent.tokens.input),
            Token::Text,
            None,
        ),
        (
            "TOK OUT",
            format::compact(agent.tokens.output),
            Token::Text,
            None,
        ),
        (
            "CACHE RD/WR",
            format!(
                "{}/{}",
                format::compact(agent.tokens.cache_read),
                format::compact(agent.tokens.cache_write)
            ),
            Token::TextDim,
            None,
        ),
    ];
    let areas = Layout::horizontal([Constraint::Ratio(1, 7); 7]).split(area);
    for ((label, value, color, series), cell) in cells.into_iter().zip(areas.iter()) {
        let block = theme::frame(Token::Frame).title(Line::from(vec![Span::styled(
            format!(" {label} "),
            theme::bold(Token::Accent),
        )]));
        let mut lines = vec![Line::from(Span::styled(value, theme::bold(color)))];
        if let Some(series) = series {
            lines.push(Line::from(format::spark(
                series,
                usize::from(cell.width.saturating_sub(2)),
                color,
            )));
        }
        frame.render_widget(Paragraph::new(lines).block(block), *cell);
    }
}

/// One mark on the timeline.
#[derive(Clone, Copy)]
struct Mark {
    at: Timestamp,
    glyph: char,
    color: Token,
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
                    (TranscriptItemKind::User, _) => ('▲', Token::Highlight, 2),
                    (TranscriptItemKind::Assistant, _) => ('▪', Token::Text, 1),
                    (TranscriptItemKind::ToolCall, _) => ('▮', Token::Info, 3),
                    (TranscriptItemKind::ToolResult, true) => ('✖', Token::Alert, 4),
                    (TranscriptItemKind::ToolResult, false) => ('│', Token::Info, 0),
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
                    TapeKind::TurnStart => ('▲', Token::Highlight, 2),
                    TapeKind::TurnEnd => ('▪', Token::Text, 1),
                    TapeKind::ToolStart | TapeKind::ToolEnd => ('▮', Token::Info, 3),
                    TapeKind::ToolError | TapeKind::Failure | TapeKind::PrCiFailed => {
                        ('✖', Token::Alert, 4)
                    }
                    _ => ('◆', Token::Ok, 2),
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
        area,
        "TIMELINE",
        vec![Span::styled(
            format!(
                " {} EVENTS · GAPS > 2M SQUEEZED ┊ · ▲ TURN ▮ TOOL ✖ ERROR ",
                marks.len()
            ),
            theme::ink(Token::TextDim),
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
            Paragraph::new(Span::styled("  no activity yet", theme::ink(Token::Rule))),
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
                color: Token::Rule,
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
            None => Span::styled("·", theme::ink(Token::Ghost)),
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
            Line::from(Span::styled(axis, theme::ink(Token::Rule))),
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
        let block = theme::pane(area, "TRANSCRIPT", Vec::new(), focused);
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
        theme::ink(Token::TextDim),
    )];
    extra.push(if following {
        Span::styled(" ▼ FOLLOWING ", theme::ink(Token::Ok))
    } else {
        Span::styled(
            format!(" {} BELOW ", last - cursor),
            theme::chip(Token::Highlight),
        )
    });
    let block = theme::pane(area, "TRANSCRIPT", extra, focused)
        .title_bottom(theme::hotkeys(&[("Enter", "EXPAND TOOL CALL")]));
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
            theme::ink(Token::Alert),
        )));
    } else if shown.is_empty() {
        shown.push(Line::from(Span::styled(
            "  reading the transcript…",
            theme::ink(Token::Rule),
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
        theme::ink(Token::Rule),
    );
    let one_line = |text: &str| text.split_whitespace().collect::<Vec<_>>().join(" ");

    match item.kind {
        TranscriptItemKind::User => vec![Line::from(vec![
            time,
            Span::styled("USER ", theme::bold(Token::Highlight)),
            Span::styled(one_line(&item.text), theme::ink(Token::Highlight)),
        ])],
        TranscriptItemKind::Assistant => vec![Line::from(vec![
            time,
            Span::styled("TURN ", theme::bold(Token::Text)),
            Span::styled(one_line(&item.text), theme::ink(Token::Text)),
        ])],
        TranscriptItemKind::ToolResult => vec![Line::from(vec![
            time,
            Span::styled("ERR  ", theme::bold(Token::Alert)),
            Span::styled(
                theme::glitch(
                    &one_line(&item.text),
                    (clock.now - item.at).num_milliseconds(),
                    clock.now.timestamp_millis(),
                ),
                theme::ink(Token::Alert),
            ),
        ])],
        TranscriptItemKind::ToolCall => {
            let result = item.tool_id.as_ref().and_then(|id| results.get(id));
            let (status, color) = match result {
                Some(result) if result.is_error => ("✕ ERR", Token::Alert),
                Some(_) => ("◆ OK", Token::Ok),
                None => ("◇ …", Token::Highlight),
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
                Span::styled("TOOL ", theme::bold(Token::Info)),
                Span::styled(format::cell(&name, 12), theme::bold(Token::Info)),
                Span::styled(
                    format::cell(&one_line(&item.text), gist_width),
                    theme::ink(Token::TextDim),
                ),
                Span::styled(format!(" {duration:>6} "), theme::ink(Token::TextDim)),
                Span::styled(format!("{status:<5}"), theme::bold(color)),
            ])];

            let open = item
                .tool_id
                .as_ref()
                .is_some_and(|id| expanded.contains(id));
            if open {
                lines.push(Line::from(Span::styled(
                    "         ┌ ARGUMENTS",
                    theme::ink(Token::Rule),
                )));
                lines.push(Line::from(Span::styled(
                    format!(
                        "         │ {}",
                        format::clip(&one_line(&item.text), EXPANDED_CHARS)
                    ),
                    theme::ink(Token::Text),
                )));
                if let Some(result) = result {
                    lines.push(Line::from(Span::styled(
                        "         ├ RESULT",
                        theme::ink(Token::Rule),
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
                    theme::ink(Token::Rule),
                )));
            }
            lines
        }
    }
}

fn draw_children(frame: &mut Frame<'_>, area: Rect, app: &App, agent: &Agent, clock: Clock) {
    let focused = app.mode.base() == Base::Pane(Pane::Children);
    let block = theme::pane(
        area,
        "CHILDREN",
        vec![Span::styled(
            format!(" {} ", agent.children.len()),
            theme::ink(Token::TextDim),
        )],
        focused,
    );
    let block = block.title_bottom(theme::hotkeys(&[("Tab", "FOCUS"), ("Enter", "OPEN")]));
    let mut lines: Vec<Line<'static>> = Vec::new();
    for (index, child) in agent.children.iter().enumerate() {
        let line = match app.view.agents.get(child) {
            Some(child) => Line::from(vec![
                theme::status_square(child.status, clock.blink()),
                Span::raw(" "),
                Span::styled(
                    format::cell(child.kind.label(), 9),
                    theme::ink(Token::TextDim),
                ),
                Span::styled(format::cell(&child.name, 16), theme::bold(Token::Text)),
                Span::raw(" "),
                Span::styled(
                    format!("{} ", theme::status_word(child.status)),
                    theme::ink(theme::status_color(child.status)),
                ),
                Span::styled(
                    child.doing.clone().unwrap_or_default(),
                    theme::ink(Token::Info),
                ),
            ]),
            None => Line::from(Span::styled(
                format!("· {child} (gone)"),
                theme::ink(Token::Rule),
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
            theme::ink(Token::Rule),
        )));
    }
    frame.render_widget(Paragraph::new(lines).block(block), area);
}

fn draw_prs(frame: &mut Frame<'_>, area: Rect, app: &App, agent: &Agent, clock: Clock) {
    let focused = app.mode.base() == Base::Pane(Pane::AgentPrs);
    let block = theme::pane(
        area,
        "PRS",
        vec![Span::styled(
            format!(" {} ", agent.prs.len()),
            theme::ink(Token::TextDim),
        )],
        focused,
    );
    let block = block.title_bottom(theme::hotkeys(&[("Enter", "OPEN AGENT")]));
    let width = usize::from(block.inner(area).width);
    let mut lines: Vec<Line<'static>> = app
        .view
        .agent_prs(agent)
        .into_iter()
        .enumerate()
        .map(|(index, pr)| {
            pr_line(
                app,
                clock,
                pr,
                width,
                false,
                focused && index == app.cursors.agent_pr,
            )
        })
        .collect();
    if lines.is_empty() {
        lines.push(Line::from(Span::styled(
            "  no pull requests",
            theme::ink(Token::Rule),
        )));
    }
    frame.render_widget(Paragraph::new(lines).block(block), area);
}

fn draw_agent_tape(frame: &mut Frame<'_>, area: Rect, app: &App, agent: &Agent, clock: Clock) {
    let block = theme::pane(area, "TAPE", Vec::new(), false);
    let height = usize::from(block.inner(area).height);
    let lines: Vec<Line<'static>> = app
        .view
        .agent_tape(&agent.id, height)
        .into_iter()
        .map(|event| tape_line(app, clock, event, 10, false))
        .collect();
    frame.render_widget(Paragraph::new(lines).block(block), area);
}
