//! Drawing: the header, the quote board, the page body and the command line.
//! Layout degrades by width: under 140 columns BODY and SOURCES drop, under
//! 100 everything stacks in one column; under 40 rows the board shrinks to
//! one line. Above 200 columns BODY takes a quarter of the width.

mod board;
mod drill;
mod panes;
mod tree;
mod wall;

#[cfg(test)]
mod test;

use chrono::{FixedOffset, Timelike as _};
use ratatui::Frame;
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::style::Style;
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Clear, Paragraph};

use agent_monitor::domain::model::{SourceKind, SourceState, TapeKind, Timestamp};

use crate::app::App;
use crate::format;
use crate::keys::{Mode, Page, Pane};
use crate::theme;
use crate::view::Link;

/// Widths at which the layout changes.
const WIDE: u16 = 140;
const NARROW: u16 = 100;

/// Height under which the board takes one line.
const SHORT: u16 = 40;

/// The time a frame is drawn at, so tests can fix it.
#[derive(Clone, Copy, Debug)]
pub struct Clock {
    /// Now.
    pub now: Timestamp,
    /// The local offset clock times are shown in.
    pub offset: FixedOffset,
}

impl Clock {
    /// Whether blinking things are in their off phase.
    pub fn blink(&self) -> bool {
        self.now.timestamp_subsec_millis() >= 500
    }

    /// `HH:MM:SS` in local time.
    pub fn time_of(&self, at: Timestamp) -> String {
        at.with_timezone(&self.offset)
            .format("%H:%M:%S")
            .to_string()
    }
}

/// Draws one frame.
pub fn draw(frame: &mut Frame<'_>, app: &mut App, clock: Clock) {
    let area = frame.area();
    frame.render_widget(Block::default().style(theme::base()), area);

    let short = area.height < SHORT;
    let board_height = if short { 1 } else { 4 };
    let [header, tabs, board_area, body, command] = Layout::vertical([
        Constraint::Length(1),
        Constraint::Length(1),
        Constraint::Length(board_height),
        Constraint::Min(0),
        Constraint::Length(1),
    ])
    .areas(area);

    draw_header(frame, header, app, clock);
    draw_tabs(frame, tabs, app);
    board::draw(frame, board_area, app);

    match app.page().clone() {
        Page::Monitor => draw_monitor(frame, body, app, clock),
        Page::Zoom(pane) => panes::draw(frame, body, app, clock, pane, true),
        Page::Tree => tree::draw(frame, body, app, clock),
        Page::Wall => wall::draw(frame, body, app, clock),
        Page::Agent(id) => drill::draw(frame, body, app, clock, &id),
    }

    draw_command(frame, command, app);
    if let Mode::Help { .. } = app.mode {
        draw_help(frame, body);
    }
    theme::grid(frame.buffer_mut(), body);
    theme::brackets(frame.buffer_mut(), area);
}

fn draw_header(frame: &mut Frame<'_>, area: Rect, app: &App, clock: Clock) {
    let totals = &app.view.totals;
    let wide = area.width >= WIDE;
    let (link, link_style) = match &app.view.link {
        Link::Connecting => (String::from("○ CONNECTING"), theme::bold(theme::YELLOW)),
        Link::Live if clock.blink() => (String::from("○ LIVE"), theme::bold(theme::GREEN)),
        Link::Live => (String::from("● LIVE"), theme::bold(theme::GREEN)),
        Link::Reconnecting(_) => (String::from("● RECONNECTING"), theme::bold(theme::RED)),
        Link::Incompatible(_) => (String::from("✕ UPDATE MACROD"), theme::bold(theme::RED)),
    };
    let errors = totals.errors_24h + totals.failed_24h;
    let error_color = if errors > 0 { theme::RED } else { theme::GREEN };
    let state = match (wide, app.view.any_working()) {
        (false, _) => "",
        (true, true) => "ACTIVE ",
        (true, false) => "IDLE ",
    };
    // Wide headers split their fields with slashes; narrow ones with spaces.
    let gap = if wide { " ╱ " } else { "  " };
    let field = |label: &str| {
        vec![
            Span::styled(gap.to_owned(), theme::ink(theme::FAINT)),
            Span::styled(format!("{label} "), theme::ink(theme::DIM)),
        ]
    };

    let mut left = theme::strip_title("MACROD://MON");
    left.push(Span::styled(" >_ ", theme::bold(theme::YELLOW)));
    if let Some(label) = &app.label {
        left.push(Span::styled(
            format!(" {label} "),
            Style::new()
                .fg(theme::BG)
                .bg(theme::YELLOW)
                .add_modifier(ratatui::style::Modifier::BOLD),
        ));
        left.push(Span::raw(" "));
    }
    left.push(Span::styled(state, theme::ink(theme::DIM)));
    if wide {
        left.push(Span::styled("SYS.LINK ", theme::ink(theme::CYAN_DIM)));
    }
    left.push(Span::styled(link, link_style));
    left.extend(field("WORK"));
    left.push(Span::styled(
        totals.working.to_string(),
        theme::bold(theme::GREEN),
    ));
    left.extend(field("WAIT"));
    left.push(Span::styled(
        totals.waiting.to_string(),
        theme::bold(theme::YELLOW),
    ));
    left.extend(field("BLOCK"));
    left.push(Span::styled(
        totals.blocked.to_string(),
        theme::bold(if totals.blocked > 0 {
            theme::RED
        } else {
            theme::AMBER
        }),
    ));
    left.extend(field("ERR"));
    // The error count flickers while its newest failure is fresh.
    let newest_failure = app
        .view
        .tape
        .iter()
        .rev()
        .find(|event| matches!(event.kind, TapeKind::ToolError | TapeKind::Failure))
        .map(|event| event.at);
    let error_text = newest_failure.map_or_else(
        || errors.to_string(),
        |at| {
            theme::glitch(
                &errors.to_string(),
                (clock.now - at).num_milliseconds(),
                clock.now.timestamp_millis(),
            )
        },
    );
    left.push(Span::styled(error_text, theme::bold(error_color)));
    left.extend(field("DAY"));
    left.push(Span::styled(
        format::cost(totals.cost_today),
        theme::bold(theme::YELLOW),
    ));
    if wide {
        left.extend(field("AGENTS"));
        left.push(Span::styled(
            app.view.agents.len().to_string(),
            theme::bold(theme::AMBER),
        ));
        left.extend(host_spans(app));
        left.push(Span::styled(gap, theme::ink(theme::FAINT)));
        left.push(Span::styled(
            format!("SEQ 0x{:04X}", app.view.seq),
            theme::ink(theme::CYAN_DIM),
        ));
    }

    let local = clock.now.with_timezone(&clock.offset);
    let separator = if clock.blink() { " " } else { ":" };
    let time = format!(
        "{:02}:{:02}{separator}{:02}",
        local.hour(),
        local.minute(),
        local.second()
    );
    let date = if wide {
        local.format("%a %d %b ").to_string().to_uppercase()
    } else {
        String::new()
    };
    // `⟦` and `⟧` around the time.
    let right_width = date.chars().count() + time.len() + 4;

    let [left_area, right_area] = Layout::horizontal([
        Constraint::Min(0),
        Constraint::Length(u16::try_from(right_width).unwrap_or(0)),
    ])
    .areas(area);
    frame.render_widget(Paragraph::new(Line::from(left)), left_area);
    frame.render_widget(
        Paragraph::new(Line::from(vec![
            Span::styled(date, theme::ink(theme::DIM)),
            Span::styled("⟦ ", theme::ink(theme::CYAN_DIM)),
            Span::styled(time, theme::bold(theme::AMBER)),
            Span::styled(" ⟧", theme::ink(theme::CYAN_DIM)),
        ])),
        right_area,
    );
}

/// Characters of the hosting macrod's harness id shown in the header.
const HARNESS_ID_SHOWN: usize = 8;

/// The header's segment for the macrod hosting the collector (its `daemon`
/// source): the harness it serves, whether its runtime is connected, and its
/// open prompts. Empty when no macrod hosts the collector.
fn host_spans(app: &App) -> Vec<Span<'static>> {
    let Some(health) = app.view.sources.get(&SourceKind::Daemon) else {
        return Vec::new();
    };
    let label = Span::styled(" ╱ HOST ", theme::ink(theme::DIM));
    let harness = health
        .detail
        .as_deref()
        .map(|id| id.chars().take(HARNESS_ID_SHOWN).collect::<String>());
    let Some(harness) = harness else {
        return vec![label, Span::styled("NOT SERVING", theme::ink(theme::FAINT))];
    };

    let mut spans = vec![label, Span::styled(harness, theme::bold(theme::AMBER))];
    if health.state == SourceState::Healthy {
        spans.extend([
            Span::styled(" ● ON", theme::bold(theme::GREEN)),
            Span::styled("  PROMPTS ", theme::ink(theme::DIM)),
            Span::styled(health.items.to_string(), theme::bold(theme::YELLOW)),
        ]);
    } else {
        spans.push(Span::styled(" ○ OFFLINE", theme::bold(theme::RED)));
    }
    spans
}

fn draw_tabs(frame: &mut Frame<'_>, area: Rect, app: &App) {
    let page = app.page();
    let tabs: [(&str, &str, &str, bool); 9] = [
        ("0", "MON", "MON", *page == Page::Monitor),
        ("1", "AGENTS", "AGT", *page == Page::Zoom(Pane::Agents)),
        ("2", "TAPE", "TAPE", *page == Page::Zoom(Pane::Tape)),
        ("3", "SPEND", "SPND", *page == Page::Zoom(Pane::Spend)),
        ("4", "FAILURES", "FAIL", *page == Page::Zoom(Pane::Failures)),
        ("5", "TREE", "TREE", *page == Page::Tree),
        ("6", "SOURCES", "SRC", *page == Page::Zoom(Pane::Sources)),
        ("7", "BODY", "BODY", *page == Page::Zoom(Pane::Body)),
        ("w", "WALL", "WALL", *page == Page::Wall),
    ];
    let short = area.width < NARROW;
    let active_style = Style::new()
        .fg(theme::BG)
        .bg(theme::AMBER)
        .add_modifier(ratatui::style::Modifier::BOLD);
    let slant = Style::new().fg(theme::AMBER).bg(theme::BG);

    let mut spans = Vec::new();
    for (key, long_name, short_name, active) in tabs {
        let name = if short { short_name } else { long_name };
        if active {
            spans.push(Span::styled("◢", slant));
            spans.push(Span::styled(format!("{key} {name}"), active_style));
            spans.push(Span::styled("◤", slant));
        } else {
            spans.push(Span::raw(" "));
            spans.push(Span::styled(key, theme::bold(theme::YELLOW)));
            spans.push(Span::styled(format!(" {name}"), theme::ink(theme::AMBER)));
            spans.push(Span::raw(" "));
        }
        if !short {
            spans.push(Span::raw(" "));
        }
    }
    if let Page::Agent(id) = page {
        spans.push(Span::styled("◢", Style::new().fg(theme::YELLOW)));
        spans.push(Span::styled(
            format!("▸ {}", app.view.name_of(id)),
            Style::new()
                .fg(theme::BG)
                .bg(theme::YELLOW)
                .add_modifier(ratatui::style::Modifier::BOLD),
        ));
        spans.push(Span::styled("◤", Style::new().fg(theme::YELLOW)));
    }

    let hints = if area.width >= WIDE {
        " / FIND  ? KEYS  ESC BACK "
    } else {
        ""
    };
    let used: usize = spans.iter().map(Span::width).sum();
    let room = usize::from(area.width).saturating_sub(used + hints.len() + 1);
    if room > 0 {
        spans.push(Span::raw(" "));
        spans.push(Span::styled(rule(room), theme::ink(theme::CYAN_DARK)));
    }
    let [left, right] = Layout::horizontal([
        Constraint::Min(0),
        Constraint::Length(u16::try_from(hints.len()).unwrap_or(0)),
    ])
    .areas(area);
    frame.render_widget(Paragraph::new(Line::from(spans)), left);
    frame.render_widget(
        Paragraph::new(Span::styled(hints, theme::ink(theme::DIM))),
        right,
    );
}

/// Columns between the tick marks on a rule.
const TICK_EVERY: usize = 8;

/// A thin rule `width` wide with a tick mark every [`TICK_EVERY`] columns.
fn rule(width: usize) -> String {
    (0..width)
        .map(|column| {
            if column % TICK_EVERY == TICK_EVERY - 1 {
                '┼'
            } else {
                '┄'
            }
        })
        .collect()
}

/// Width above which the BODY pane grows with the terminal.
const BODY_GROWS_ABOVE: u16 = 200;

/// The BODY pane's width: 40 columns, and a quarter of the screen on
/// terminals wider than [`BODY_GROWS_ABOVE`], so the figure can be big.
fn body_width(width: u16) -> u16 {
    if width > BODY_GROWS_ABOVE {
        (width / 4).max(40)
    } else {
        40
    }
}

fn draw_monitor(frame: &mut Frame<'_>, area: Rect, app: &mut App, clock: Clock) {
    if area.width < NARROW {
        let [agents, tape, failures, spend] = Layout::vertical([
            Constraint::Percentage(40),
            Constraint::Percentage(30),
            Constraint::Percentage(15),
            Constraint::Percentage(15),
        ])
        .areas(area);
        panes::draw(frame, agents, app, clock, Pane::Agents, false);
        panes::draw(frame, tape, app, clock, Pane::Tape, false);
        panes::draw(frame, failures, app, clock, Pane::Failures, false);
        panes::draw(frame, spend, app, clock, Pane::Spend, false);
        return;
    }

    let [upper, lower] =
        Layout::vertical([Constraint::Percentage(60), Constraint::Percentage(40)]).areas(area);

    if area.width < WIDE {
        let [agents, spend] =
            Layout::horizontal([Constraint::Min(0), Constraint::Length(34)]).areas(upper);
        panes::draw(frame, agents, app, clock, Pane::Agents, false);
        panes::draw(frame, spend, app, clock, Pane::Spend, false);
    } else {
        let [agents, body, right] = Layout::horizontal([
            Constraint::Min(0),
            Constraint::Length(body_width(area.width)),
            Constraint::Length(38),
        ])
        .areas(upper);
        let [spend, sources] =
            Layout::vertical([Constraint::Percentage(55), Constraint::Percentage(45)]).areas(right);
        panes::draw(frame, agents, app, clock, Pane::Agents, false);
        panes::draw(frame, body, app, clock, Pane::Body, false);
        panes::draw(frame, spend, app, clock, Pane::Spend, false);
        panes::draw(frame, sources, app, clock, Pane::Sources, false);
    }

    let [tape, failures] =
        Layout::horizontal([Constraint::Percentage(58), Constraint::Percentage(42)]).areas(lower);
    panes::draw(frame, tape, app, clock, Pane::Tape, false);
    panes::draw(frame, failures, app, clock, Pane::Failures, false);
}

fn draw_command(frame: &mut Frame<'_>, area: Rect, app: &App) {
    let line = match &app.mode {
        Mode::Command { input, .. } => Line::from(prompt(
            "CMD",
            vec![
                Span::styled(format!(" {}", input.value()), theme::bold(theme::YELLOW)),
                Span::styled("█", theme::ink(theme::YELLOW)),
                Span::styled(
                    "   MON AGT TAPE SPND FAIL TREE SRC BODY WALL  + filter words",
                    theme::ink(theme::FAINT),
                ),
            ],
        )),
        Mode::Find { input, .. } => Line::from(prompt(
            "FIND",
            vec![
                Span::styled(format!(" /{}", input.value()), theme::bold(theme::YELLOW)),
                Span::styled("█", theme::ink(theme::YELLOW)),
            ],
        )),
        Mode::Base(_) | Mode::Help { .. } => {
            let mut spans = theme::strip_title(">_");
            spans.push(Span::raw(" "));
            if let Some(message) = &app.message {
                spans.push(Span::styled(message.clone(), theme::bold(theme::RED)));
                spans.push(Span::raw("  "));
            }
            if !app.filter.words.is_empty() {
                spans.push(Span::styled("FILTER ", theme::ink(theme::DIM)));
                spans.push(Span::styled(
                    app.filter.words.join(" "),
                    theme::bold(theme::YELLOW),
                ));
                spans.push(Span::raw("  "));
            }
            if !app.filter.find.is_empty() {
                spans.push(Span::styled("FIND ", theme::ink(theme::DIM)));
                spans.push(Span::styled(
                    format!("/{}", app.filter.find),
                    theme::bold(theme::YELLOW),
                ));
                spans.push(Span::raw("  "));
            }
            for (key, what) in [
                ("TYPE", "COMMAND"),
                ("ENTER", "OPEN"),
                ("TAB", "PANE"),
                ("↑↓", "MOVE"),
                ("0-7", "PAGE"),
                ("w", "WALL"),
                ("q", "QUIT"),
            ] {
                spans.push(Span::styled(key, theme::bold(theme::AMBER)));
                spans.push(Span::styled(format!(" {what}  "), theme::ink(theme::FAINT)));
            }
            if let Link::Reconnecting(reason) = &app.view.link {
                spans.push(Span::styled(
                    format!("LINK: {reason}"),
                    theme::ink(theme::RED),
                ));
            }
            Line::from(spans)
        }
    };
    frame.render_widget(Paragraph::new(line), area);
}

/// A command-line prompt: a slanted strip, then `rest`.
fn prompt(label: &str, rest: Vec<Span<'static>>) -> Vec<Span<'static>> {
    let mut spans = theme::strip_title(label);
    spans.extend(rest);
    spans
}

const HELP: [(&str, &str); 17] = [
    (
        "0 … 7",
        "monitor, then the numbered pane full screen (5 = tree)",
    ),
    ("w", "wall: a card per agent"),
    ("TAB  S-TAB", "focus the next or previous pane"),
    ("↑ ↓  j k", "move the cursor"),
    ("← →  h l", "collapse / expand, previous / next card"),
    ("PGUP PGDN HOME END", "page, first, last"),
    (
        "ENTER",
        "open the agent under the cursor; expand a tool call",
    ),
    ("ESC", "back one step"),
    ("/", "find: filter rows as you type"),
    ("a", "list ended agents too, or only current ones"),
    ("?", "this help"),
    ("q  CTRL-C", "quit"),
    ("", ""),
    ("TYPE A LETTER", "command line, then ENTER:"),
    ("MON AGT TAPE SPND", "monitor, agents, tape, spend"),
    (
        "FAIL TREE SRC BODY WALL",
        "failures, tree, sources, body, wall",
    ),
    (
        "AGT builder working",
        "words after a mnemonic filter rows; all lists ended",
    ),
];

/// The help box: the keys column plus the longest description and borders.
const HELP_WIDTH: u16 = 86;

fn draw_help(frame: &mut Frame<'_>, area: Rect) {
    let width = area.width.min(HELP_WIDTH);
    let height = area.height.min(u16::try_from(HELP.len()).unwrap_or(0) + 2);
    let popup = Rect {
        x: area.x + (area.width - width) / 2,
        y: area.y + (area.height - height) / 2,
        width,
        height,
    };
    let lines: Vec<Line<'_>> = HELP
        .iter()
        .map(|(keys, what)| {
            Line::from(vec![
                Span::styled(format::cell(keys, 26), theme::bold(theme::YELLOW)),
                Span::styled(*what, theme::ink(theme::AMBER)),
            ])
        })
        .collect();
    frame.render_widget(Clear, popup);
    frame.render_widget(
        Paragraph::new(lines).block(
            theme::pane(
                "KEYS",
                vec![Span::styled(" ESC CLOSES ", theme::ink(theme::DIM))],
                true,
            )
            .borders(Borders::ALL),
        ),
        popup,
    );
}
