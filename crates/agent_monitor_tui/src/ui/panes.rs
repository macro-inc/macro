//! The numbered panes: 1 AGENTS, 2 TAPE, 3 SPEND, 4 FAILURES, 6 SOURCES,
//! 7 BODY and 8 CHANGES (in `ui/changes`), each drawn in a monitor grid cell
//! or zoomed to a page.

use ratatui::Frame;
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::style::Style;
use ratatui::text::{Line, Span};
use ratatui::widgets::{Bar, BarChart, BarGroup, Block, Cell, Paragraph, Row, Table, TableState};

use agent_monitor::domain::model::{
    Agent, AgentKind, CiState, Mergeable, Pr, PrState, ReviewState, SourceKind, SourceState,
    TapeEvent, TapeKind, Timestamp,
};

use crate::app::App;
use crate::format;
use crate::keys::{Base, Pane};
use crate::theme;
use crate::theme::Token;
use crate::ui::Clock;
use crate::view::{ViewState, pr_state_word};

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
        Pane::Spend => spend(frame, area, app, focused, zoomed),
        Pane::Failures => failures(frame, area, app, clock, focused),
        Pane::Sources => sources(frame, area, app, clock, focused),
        Pane::Body => body(frame, area, app, focused),
        Pane::Changes => super::changes::draw(frame, area, app, clock, focused, zoomed),
        Pane::Transcript | Pane::Children | Pane::AgentPrs => {}
    }
}

fn count_span(text: String) -> Span<'static> {
    Span::styled(format!(" {text} "), theme::ink(Token::TextDim))
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
const FIXED: u16 = 32 + NAME_WIDTH;

/// The AGENTS table's optional columns at a given inner width.
struct AgentColumns {
    /// Narrow: no KIND or STAT columns; the status square stays.
    compact: bool,
    task: u16,
    tokens: bool,
    spark: u16,
}

impl AgentColumns {
    fn for_width(width: u16) -> Self {
        // The fixed columns and their spacing take 52, `doing` at least 18;
        // what is left goes to tokens, then the sparkline, then the task.
        let compact = width < FIXED + 18;
        let fixed = if compact { FIXED - 14 } else { FIXED };
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

/// One AGENTS row; `badge` marks the agent's pull requests.
fn agent_row(
    agent: &Agent,
    name: String,
    badge: Option<Span<'static>>,
    clock: Clock,
    columns: &AgentColumns,
) -> Row<'static> {
    let doing = match (&agent.doing, agent.status) {
        (Some(doing), _) => Span::styled(doing.clone(), theme::ink(Token::Info)),
        (None, status) => match (&agent.status_detail, &agent.task) {
            (Some(detail), _) => {
                Span::styled(detail.clone(), theme::ink(theme::status_color(status)))
            }
            (None, Some(task)) => Span::styled(task.clone(), theme::ink(Token::TextDim)),
            (None, None) => Span::styled("—", theme::ink(Token::Rule)),
        },
    };
    let mut cells = vec![Cell::from(theme::status_square(
        agent.status,
        clock.blink(),
    ))];
    if !columns.compact {
        cells.push(Cell::from(Span::styled(
            agent.kind.label(),
            theme::ink(Token::TextDim),
        )));
    }
    let name_cell = match badge {
        Some(badge) => {
            // The table may give the column a cell less than asked.
            let room = usize::from(NAME_WIDTH).saturating_sub(badge.width() + 2);
            Line::from(vec![
                Span::styled(format::cell(&name, room), theme::bold(Token::Text)),
                Span::raw(" "),
                badge,
            ])
        }
        None => Line::from(Span::styled(name, theme::bold(Token::Text))),
    };
    cells.push(Cell::from(name_cell));
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
            theme::ink(Token::TextDim),
        )));
    }
    cells.extend([
        Cell::from(Line::from(age_since(clock, agent.started)).right_aligned()),
        Cell::from(Line::from(agent.turns.to_string()).right_aligned()),
        Cell::from(
            Line::from(Span::styled(
                agent.tool_calls.to_string(),
                theme::ink(Token::Info),
            ))
            .right_aligned(),
        ),
    ]);
    if columns.tokens {
        cells.push(Cell::from(
            Line::from(Span::styled(
                format::compact(agent.tokens.total()),
                theme::ink(Token::TextDim),
            ))
            .right_aligned(),
        ));
    }
    if columns.spark > 0 {
        let color = if agent.status.is_final() {
            Token::Rule
        } else {
            Token::Trace
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
    let selected = app
        .cursors
        .agent
        .as_ref()
        .and_then(|id| rows.iter().position(|agent| agent.id == *id))
        .unwrap_or(0);
    let columns = AgentColumns::for_width(area.width.saturating_sub(2));

    let mut extra = vec![count_span(format!(
        "{} SHOWN / {} TOTAL",
        rows.len(),
        app.view.agents.len()
    ))];
    if !app.filter.is_empty() {
        extra.push(Span::styled(" FILTERED ", theme::bold(Token::Highlight)));
    }
    let toggle = if app.filter.all {
        "HIDE ENDED"
    } else {
        "SHOW ENDED"
    };
    let block = theme::pane(area, "1 AGENTS", extra, focused)
        .title_bottom(theme::hotkeys(&[("a", toggle)]));
    let inner = block.inner(area);
    frame.render_widget(block, area);
    let [summary, table_area] =
        Layout::vertical([Constraint::Length(2), Constraint::Min(0)]).areas(inner);
    super::agent_summary::draw(frame, summary, app);

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
    if columns.tokens {
        header.push("TOKENS");
        widths.push(Constraint::Length(7));
    }
    if columns.spark > 0 {
        header.push("ACTIVITY 60M");
        widths.push(Constraint::Length(columns.spark));
    }

    let table_rows: Vec<Row<'static>> = rows
        .iter()
        .map(|agent| {
            let badge = pr_badge(&app.view, agent);
            agent_row(agent, row_name(app, agent), badge, clock, &columns)
        })
        .collect();
    let header_row = Row::new(
        header
            .into_iter()
            .map(|title| Cell::from(Span::styled(title, theme::bold(Token::Rule)))),
    );
    let table = Table::new(table_rows, widths)
        .header(header_row)
        .column_spacing(1)
        .row_highlight_style(if focused {
            theme::selected()
        } else {
            Style::new()
        });

    let mut state = TableState::default().with_selected(Some(selected));
    frame.render_stateful_widget(table, table_area, &mut state);
}

/// An agent's pull request badge: `#<number>` for one, `⎇<count>` for
/// several, coloured by the worst CI among the open ones.
fn pr_badge(view: &ViewState, agent: &Agent) -> Option<Span<'static>> {
    let prs = view.agent_prs(agent);
    let first = prs.first()?;
    let text = if prs.len() == 1 {
        format!("#{}", first.number)
    } else {
        format!("⎇{}", prs.len())
    };
    let open: Vec<&&Pr> = prs.iter().filter(|pr| !pr.state.is_final()).collect();
    let color = if open.iter().any(|pr| pr.ci == CiState::Failed) {
        Token::Alert
    } else if open.iter().any(|pr| pr.ci == CiState::Running) {
        Token::Highlight
    } else if !open.is_empty() && open.iter().all(|pr| pr.ci == CiState::Passed) {
        Token::Ok
    } else {
        Token::InfoDim
    };
    Some(Span::styled(text, theme::bold(color)))
}

/// A pull request's CI glyph: ◆ passed, ◌ running, ✕ failed, · none.
pub fn ci_glyph(ci: CiState) -> Span<'static> {
    match ci {
        CiState::Passed => Span::styled("◆", theme::bold(Token::Ok)),
        CiState::Running => Span::styled("◌", theme::bold(Token::Highlight)),
        CiState::Failed => Span::styled("✕", theme::bold(Token::Alert)),
        CiState::None => Span::styled("·", theme::ink(Token::TextDim)),
        CiState::Unknown => Span::styled("·", theme::ink(Token::Rule)),
    }
}

/// A review decision as a short word and colour.
fn review_word(review: ReviewState) -> Span<'static> {
    match review {
        ReviewState::Approved => Span::styled("APPR", theme::bold(Token::Ok)),
        ReviewState::ChangesRequested => Span::styled("CHG ", theme::bold(Token::Alert)),
        ReviewState::ReviewRequired => Span::styled("REQ ", theme::ink(Token::Attention)),
        ReviewState::None => Span::styled("—   ", theme::ink(Token::Rule)),
    }
}

/// A pull request state's colour.
fn pr_state_color(state: PrState) -> Token {
    match state {
        PrState::Open => Token::Text,
        PrState::Draft => Token::TextDim,
        PrState::Merged => Token::Ok,
        PrState::Closed | PrState::Unknown => Token::Rule,
    }
}

/// One pull request line: CI, number, repository, title, agent, review,
/// conflicts, age and state. `agent` is left out where the agent is known.
pub fn pr_line(
    app: &App,
    clock: Clock,
    pr: &Pr,
    width: usize,
    with_agent: bool,
    highlight: bool,
) -> Line<'static> {
    let agent =
        ViewState::pr_agent(pr).map_or_else(|| String::from("—"), |id| app.view.name_of(id));
    // CI, number, repo, review, conflict, age and state, with spacing.
    let agent_width = if with_agent { 15 } else { 0 };
    let branch_width = branch_width(width);
    let fixed = 2 + 7 + 11 + 5 + 2 + 5 + 7 + agent_width + branch_width;
    let title_width = width.saturating_sub(fixed).max(8);
    let title = pr
        .title
        .clone()
        .or_else(|| pr.branch.clone())
        .unwrap_or_else(|| String::from("…"));
    let conflict = if pr.mergeable == Mergeable::Conflicting {
        Span::styled("⚠ ", theme::bold(Token::Alert))
    } else {
        Span::raw("  ")
    };
    let mut spans = vec![
        ci_glyph(pr.ci),
        Span::raw(" "),
        Span::styled(
            format::cell(&format!("#{}", pr.number), 7),
            theme::bold(Token::Highlight),
        ),
        Span::styled(format::cell(pr.repo.name(), 11), theme::ink(Token::InfoDim)),
        Span::styled(
            format::cell(&title, title_width),
            theme::ink(if pr.state.is_final() {
                Token::TextDim
            } else {
                Token::Text
            }),
        ),
    ];
    if branch_width > 0 {
        spans.push(Span::raw(" "));
        spans.push(Span::styled(
            format::cell(pr.branch.as_deref().unwrap_or("—"), branch_width - 1),
            theme::ink(Token::InfoDim),
        ));
    }
    if with_agent {
        spans.push(Span::raw(" "));
        spans.push(Span::styled(
            format::cell(&agent, 14),
            theme::bold(Token::Text),
        ));
    }
    spans.extend([
        Span::raw(" "),
        review_word(pr.review),
        Span::raw(" "),
        conflict,
        Span::styled(
            format::right(&age_since(clock, pr.opened_at), 4),
            theme::ink(Token::TextDim),
        ),
        Span::raw(" "),
        Span::styled(
            format::cell(pr_state_word(pr.state), 6),
            theme::ink(pr_state_color(pr.state)),
        ),
    ]);
    let line = Line::from(spans);
    if highlight {
        line.style(theme::selected())
    } else {
        line
    }
}

/// The PRS BRANCH column's width with its spacing; only wide panes show it.
fn branch_width(width: usize) -> usize {
    if width >= 140 { 29 } else { 0 }
}

/// A tape kind's short tag and colour.
pub fn tape_tag(kind: TapeKind) -> (&'static str, Token) {
    match kind {
        TapeKind::Spawned => ("SPWN", Token::Ok),
        TapeKind::Status => ("STAT", Token::Highlight),
        TapeKind::TurnStart => ("TURN", Token::Text),
        TapeKind::TurnEnd => ("TEND", Token::TextDim),
        TapeKind::ToolStart => ("TOOL", Token::Info),
        TapeKind::ToolEnd => ("TOK ", Token::Info),
        TapeKind::ToolError => ("TERR", Token::Alert),
        TapeKind::Failure => ("FAIL", Token::Alert),
        TapeKind::Finished => ("DONE", Token::Ok),
        TapeKind::Removed => ("GONE", Token::Rule),
        TapeKind::PrOpened => ("PR+ ", Token::Ok),
        TapeKind::PrCiPassed => ("CI◆ ", Token::Ok),
        TapeKind::PrCiFailed => ("CI✕ ", Token::Alert),
        TapeKind::PrMerged => ("MRGD", Token::Ok),
        TapeKind::PrClosed => ("CLSD", Token::Rule),
        TapeKind::Commit => ("CMIT", Token::Ok),
        TapeKind::Rewritten => ("RWRT", Token::Attention),
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
        TapeKind::ToolStart | TapeKind::ToolEnd => Token::Info,
        TapeKind::ToolError | TapeKind::Failure | TapeKind::PrCiFailed => Token::Alert,
        _ => theme::severity_color(event.severity),
    };
    // An error flickers for a moment as it lands.
    let text = match event.kind {
        TapeKind::ToolError | TapeKind::Failure | TapeKind::PrCiFailed => theme::glitch(
            &event.text,
            (clock.now - event.at).num_milliseconds(),
            clock.now.timestamp_millis(),
        ),
        _ => event.text.clone(),
    };
    let line = Line::from(vec![
        Span::styled(clock.time_of(event.at), theme::ink(Token::TextDim)),
        Span::raw(" "),
        Span::styled(
            format::cell(&app.view.name_of(&event.agent), name_width),
            theme::ink(Token::Text),
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
            theme::chip(Token::Highlight),
        ));
    } else {
        extra.push(Span::styled(" ▼ FOLLOWING ", theme::ink(Token::Ok)));
    }
    let block = theme::pane(area, "2 TAPE", extra, focused);
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

fn spend(frame: &mut Frame<'_>, area: Rect, app: &mut App, focused: bool, zoomed: bool) {
    let totals = &app.view.totals;
    let block = theme::pane(
        area,
        "3 SPEND TODAY",
        vec![Span::styled(
            format!(" {} ", format::cost(totals.cost_today)),
            theme::bold(Token::Highlight),
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
                    Token::Accent
                } else {
                    Token::Ghost
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
        Paragraph::new(Span::styled(axis, theme::ink(Token::Rule))),
        axis_area,
    );

    let [table_area, agents_area] = Layout::horizontal([
        Constraint::Percentage(if zoomed { 50 } else { 100 }),
        Constraint::Min(0),
    ])
    .areas(table_area);
    if zoomed {
        let mut agents: Vec<_> = app.view.agents.values().collect();
        agents.sort_by(|a, b| {
            b.cost
                .usd()
                .unwrap_or(0.0)
                .total_cmp(&a.cost.usd().unwrap_or(0.0))
                .then_with(|| a.id.cmp(&b.id))
        });
        let widths = [Constraint::Min(0), Constraint::Length(12)];
        let rows = agents.into_iter().map(|agent| {
            Row::new(vec![
                Cell::from(agent.name.clone()),
                Cell::from(
                    Line::from(Span::styled(
                        format::cost(agent.cost),
                        theme::ink(Token::Highlight),
                    ))
                    .right_aligned(),
                ),
            ])
        });
        let selected = app
            .cursors
            .spend_agent
            .min(app.view.agents.len().saturating_sub(1));
        let mut state = TableState::default().with_selected(Some(selected));
        frame.render_stateful_widget(
            Table::new(rows, widths)
                .header(Row::new(["AGENT", "LIFETIME USD"]).style(theme::bold(Token::Rule)))
                .row_highlight_style(theme::selected())
                .column_spacing(2),
            agents_area,
            &mut state,
        );
    }

    let kinds = app.view.spend_by_kind();
    let total: f64 = kinds.iter().filter_map(|(_, cost)| cost.usd()).sum();
    let width = usize::from(table_area.width);
    let bar_room = width.saturating_sub(8 + 9 + 5 + 2);
    let mut lines = vec![Line::from(Span::styled(
        format::cell("KIND        USD    %", width),
        theme::bold(Token::Rule),
    ))];
    for (index, (kind, cost)) in kinds.iter().enumerate() {
        let usd = cost.usd().unwrap_or(0.0);
        let share = if total > 0.0 { usd / total } else { 0.0 };
        // Display rounding of a share in [0, 1].
        let filled = ((share * bar_room as f64).round() as usize).min(bar_room);
        let line = Line::from(
            vec![
                Span::styled(format::cell(kind.label(), 8), theme::ink(Token::Text)),
                Span::styled(
                    format::right(&format::cost(*cost), 9),
                    theme::bold(Token::Highlight),
                ),
                Span::styled(
                    format::right(&format!("{:.0}", share * 100.0), 4),
                    theme::ink(Token::TextDim),
                ),
                Span::raw(" "),
            ]
            .into_iter()
            .chain(theme::meter(filled, bar_room, Token::Accent))
            .collect::<Vec<_>>(),
        );
        lines.push(if focused && !zoomed && index == app.cursors.spend {
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
    // Totals cover the last day; rows give the individual failures.
    let count = totals.errors_24h + totals.failed_24h;
    let color = if count == 0 && rows.is_empty() {
        Token::Ok
    } else {
        Token::Alert
    };
    let block = theme::pane(
        area,
        "4 FAILURES",
        vec![Span::styled(format!(" {count} 24H "), theme::bold(color))],
        focused,
    );
    let inner = block.inner(area);
    let height = usize::from(inner.height.saturating_sub(1));
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
                    theme::ink(Token::TextDim),
                ),
                Span::raw(" "),
                Span::styled(
                    format::cell(
                        match row.what {
                            "tool" => "✕ tool",
                            "ci" => "✕ ci",
                            _ => "▲ agent",
                        },
                        8,
                    ),
                    theme::bold(Token::Alert),
                ),
                Span::styled(format::cell(kind, 9), theme::ink(Token::TextDim)),
                Span::styled(
                    format::cell(&app.view.name_of(&row.agent), 14),
                    theme::ink(Token::Text),
                ),
                Span::raw(" "),
                Span::styled(
                    theme::glitch(
                        &row.detail,
                        (clock.now - row.at).num_milliseconds(),
                        clock.now.timestamp_millis(),
                    ),
                    theme::ink(Token::Alert),
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
            theme::ink(Token::Ok),
        )));
    }
    let error_rate = if totals.tools_24h == 0 {
        0.0
    } else {
        f64::from(totals.errors_24h) * 100.0 / f64::from(totals.tools_24h)
    };
    lines.insert(
        0,
        Line::from(Span::styled(
            format!(
                "{} TOOL · {} AGENT · {error_rate:.1}% TOOLS FAILED",
                totals.errors_24h, totals.failed_24h
            ),
            theme::ink(Token::TextDim),
        )),
    );
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
        Token::Ok
    } else {
        Token::Alert
    };
    let block = theme::pane(
        area,
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
        theme::bold(Token::Rule),
    ))];
    for (index, row) in rows.iter().enumerate() {
        let (dot, color) = match row.health.map(|health| health.state) {
            Some(SourceState::Healthy) => ("●", Token::Ok),
            Some(SourceState::Starting) => ("◐", Token::Highlight),
            Some(SourceState::Unhealthy) => ("●", Token::Alert),
            Some(SourceState::Absent) => ("○", Token::Rule),
            None => ("◆", Token::Text),
        };
        let items = row.health.map_or_else(
            || String::from("—"),
            |health| format::thousands(u64::from(health.items)),
        );
        let last = age_since(clock, row.health.and_then(|health| health.last_event));
        // A polled source says how often it asks.
        let name = match row.health.and_then(|health| health.poll_every) {
            Some(every) => format!("{} ◷ {}s", row.source.name(), every.as_secs()),
            None => row.source.name().to_owned(),
        };
        let mut spans = vec![
            Span::styled(format!("{dot} "), theme::bold(color)),
            Span::styled(format::cell(&name, name_width), theme::ink(Token::Text)),
            Span::styled(
                format::right(&row.agents.to_string(), 5),
                theme::bold(Token::Highlight),
            ),
            Span::styled(format::right(&items, 7), theme::ink(Token::Text)),
            Span::styled(format::right(&last, 5), theme::ink(Token::TextDim)),
        ];
        let restarts = row.health.map_or(0, |health| health.restarts);
        if restarts > 0 {
            spans.push(Span::styled(
                format!(" ↻{restarts}"),
                theme::ink(Token::Alert),
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
            let mut spans = vec![Span::styled("  idx ", theme::ink(Token::Rule))];
            spans.extend(theme::meter(filled, room, Token::Highlight));
            lines.push(Line::from(
                spans
                    .into_iter()
                    .chain([Span::styled(
                        format!(" {}/{}", progress.done, progress.total),
                        theme::ink(Token::TextDim),
                    )])
                    .collect::<Vec<_>>(),
            ));
        }
        if let Some(detail) = &health.detail
            && (health.state != SourceState::Healthy || row.source == SourceKind::Daemon)
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
            theme::ink(Token::TextDim),
        )));
    }
    frame.render_widget(Paragraph::new(lines).block(block), area);
}

fn body(frame: &mut Frame<'_>, area: Rect, app: &mut App, focused: bool) {
    let block = theme::pane(
        area,
        "7 BODY",
        vec![
            Span::styled(" BIOSCAN ", theme::bold(Token::Info)),
            count_span(app.view.body.title().to_owned()),
        ],
        focused,
    );
    let inner = block.inner(area);
    frame.render_widget(block, area);
    app.view.body.render(inner, frame.buffer_mut());
    scanner(frame, inner, app);
}

/// The scanner readout over the BODY figure: crosshair corners with a label
/// in each, and tick marks down both edges.
fn scanner(frame: &mut Frame<'_>, area: Rect, app: &App) {
    if area.width < 24 || area.height < 6 {
        return;
    }
    let rule = theme::ink(Token::InfoDim);
    let label = theme::bold(Token::Info);
    let tokens = app.view.totals.tokens_per_min.last().copied().unwrap_or(0);

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
        corner(area.right(), area.y, vec![Span::styled("╶┐", rule)], true),
        corner(
            area.x,
            area.bottom() - 1,
            vec![
                Span::styled("└╴", rule),
                Span::styled("SUBJ ", theme::ink(Token::TextDim)),
                Span::styled(
                    format!("{:02}", app.view.totals.working),
                    theme::bold(Token::Ok),
                ),
                Span::styled(" LIVE", theme::ink(Token::TextDim)),
            ],
            false,
        ),
        corner(
            area.right(),
            area.bottom() - 1,
            vec![
                Span::styled("TOK/M ", theme::ink(Token::TextDim)),
                Span::styled(
                    format::compact(u64::from(tokens)),
                    theme::bold(Token::Highlight),
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
                    cell.set_char(symbol).set_fg(Token::InfoFaint.color());
                }
            }
        }
    }
}
