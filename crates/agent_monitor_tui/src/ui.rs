//! Drawing: the header, the quote board, the page body and the command line.
//! Layout degrades by width: under 140 columns BODY and SOURCES drop, under
//! 100 everything stacks in one column; under 40 rows the board shrinks to
//! one line.

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

use agent_monitor::domain::model::Timestamp;

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
        at.with_timezone(&self.offset).format("%H:%M:%S").to_string()
    }
}

/// Draws one frame.
pub fn draw(frame: &mut Frame<'_>, app: &mut App, clock: Clock) {
    let area = frame.area();
    frame.render_widget(Block::default().style(theme::base()), area);

    let short = area.height < SHORT;
    let board_height = if short { 1 } else { 4 };
    let ticker_height = if short { 0 } else { 1 };
    let [header, tabs, ticker_area, board_area, body, command] = Layout::vertical([
        Constraint::Length(1),
        Constraint::Length(1),
        Constraint::Length(ticker_height),
        Constraint::Length(board_height),
        Constraint::Min(0),
        Constraint::Length(1),
    ])
    .areas(area);

    draw_header(frame, header, app, clock);
    draw_tabs(frame, tabs, app);
    if ticker_height > 0 {
        draw_ticker(frame, ticker_area, app, clock);
    }
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
}

fn draw_header(frame: &mut Frame<'_>, area: Rect, app: &App, clock: Clock) {
    let totals = &app.view.totals;
    let (link, link_style) = match &app.view.link {
        Link::Connecting => (String::from("○ CONNECTING"), theme::bold(theme::YELLOW)),
        Link::Live if clock.blink() => (String::from("○ LIVE"), theme::bold(theme::GREEN)),
        Link::Live => (String::from("● LIVE"), theme::bold(theme::GREEN)),
        Link::Reconnecting(_) => (String::from("● RECONNECTING"), theme::bold(theme::RED)),
        Link::Incompatible(_) => (String::from("✖ UPDATE MACROD"), theme::bold(theme::RED)),
    };
    let errors = totals.errors_24h + totals.failed_24h;
    let error_color = if errors > 0 { theme::RED } else { theme::GREEN };
    let state = match (area.width >= WIDE, app.view.any_working()) {
        (false, _) => "",
        (true, true) => "ACTIVE  ",
        (true, false) => "IDLE  ",
    };

    let mut left = vec![
        Span::styled(" MACROD ", theme::strip()),
        Span::styled(" MON ", Style::new().fg(theme::STRIP).bg(theme::BG).add_modifier(ratatui::style::Modifier::BOLD)),
        Span::styled(">_ ", theme::bold(theme::YELLOW)),
    ];
    if let Some(label) = &app.label {
        left.push(Span::styled(format!(" {label} "), Style::new().fg(theme::BG).bg(theme::YELLOW).add_modifier(ratatui::style::Modifier::BOLD)));
        left.push(Span::raw(" "));
    }
    left.extend([
        Span::styled(state, theme::ink(theme::DIM)),
        Span::styled(link, link_style),
        Span::styled("  WORK ", theme::ink(theme::DIM)),
        Span::styled(totals.working.to_string(), theme::bold(theme::GREEN)),
        Span::styled("  WAIT ", theme::ink(theme::DIM)),
        Span::styled(totals.waiting.to_string(), theme::bold(theme::YELLOW)),
        Span::styled("  BLOCK ", theme::ink(theme::DIM)),
        Span::styled(totals.blocked.to_string(), theme::bold(if totals.blocked > 0 { theme::RED } else { theme::AMBER })),
        Span::styled("  ERR ", theme::ink(theme::DIM)),
        Span::styled(errors.to_string(), theme::bold(error_color)),
        Span::styled("  DAY ", theme::ink(theme::DIM)),
        Span::styled(format::cost(totals.cost_today), theme::bold(theme::YELLOW)),
    ]);
    if area.width >= WIDE {
        left.push(Span::styled(format!("  AGENTS {}", app.view.agents.len()), theme::ink(theme::DIM)));
        left.push(Span::styled(format!("  SEQ {}", app.view.seq), theme::ink(theme::FAINT)));
    }

    let local = clock.now.with_timezone(&clock.offset);
    let separator = if clock.blink() { " " } else { ":" };
    let time = format!(
        "{:02}:{:02}{separator}{:02} ",
        local.hour(),
        local.minute(),
        local.second()
    );
    let date = if area.width >= WIDE {
        local.format("%a %d %b ").to_string().to_uppercase()
    } else {
        String::new()
    };
    let right_width = time.len() + date.len();

    let [left_area, right_area] =
        Layout::horizontal([Constraint::Min(0), Constraint::Length(u16::try_from(right_width).unwrap_or(0))]).areas(area);
    frame.render_widget(Paragraph::new(Line::from(left)), left_area);
    frame.render_widget(
        Paragraph::new(Line::from(vec![
            Span::styled(date, theme::ink(theme::DIM)),
            Span::styled(time, theme::bold(theme::AMBER)),
        ])),
        right_area,
    );
}

/// Tape lines on the ticker.
const TICKER_EVENTS: usize = 40;

/// Milliseconds per ticker step of one column.
const TICKER_STEP_MS: i64 = 110;

/// A stock-ticker line of the newest tape lines, scrolling left with the clock.
fn draw_ticker(frame: &mut Frame<'_>, area: Rect, app: &App, clock: Clock) {
    let mut cells: Vec<(char, Style)> = Vec::new();
    let skip = app.view.tape.len().saturating_sub(TICKER_EVENTS);
    for event in app.view.tape.iter().skip(skip) {
        let (tag, color) = panes::tape_tag(event.kind);
        let arrow = match event.severity {
            agent_monitor::domain::model::Severity::Error
            | agent_monitor::domain::model::Severity::Warning => ("▼ ", theme::bold(theme::RED)),
            _ => ("▲ ", theme::bold(theme::GREEN)),
        };
        let pieces = [
            (app.view.name_of(&event.agent).to_uppercase(), theme::bold(theme::AMBER)),
            (String::from(" "), theme::base()),
            (String::from(arrow.0), arrow.1),
            (format!("{} ", tag.trim()), theme::bold(color)),
            (event.text.clone(), theme::ink(theme::DIM)),
            (String::from("   ┃   "), theme::ink(theme::FAINT)),
        ];
        for (text, style) in pieces {
            cells.extend(text.chars().map(|character| (character, style)));
        }
    }
    if cells.is_empty() {
        return;
    }

    let width = usize::from(area.width);
    let steps = clock.now.timestamp_millis() / TICKER_STEP_MS;
    let offset = usize::try_from(steps.rem_euclid(i64::try_from(cells.len()).unwrap_or(1))).unwrap_or(0);
    let spans: Vec<Span<'static>> = (0..width)
        .filter_map(|column| cells.get((offset + column) % cells.len()))
        .map(|(character, style)| Span::styled(character.to_string(), *style))
        .collect();
    frame.render_widget(
        Paragraph::new(Line::from(spans)).style(Style::new().bg(theme::BG)),
        area,
    );
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

    let mut spans = vec![Span::raw(" ")];
    for (key, long_name, short_name, active) in tabs {
        let name = if short { short_name } else { long_name };
        if active {
            spans.push(Span::styled(format!("{key} {name}"), Style::new().fg(theme::BG).bg(theme::AMBER).add_modifier(ratatui::style::Modifier::BOLD)));
        } else {
            spans.push(Span::styled(key, theme::bold(theme::YELLOW)));
            spans.push(Span::styled(format!(" {name}"), theme::ink(theme::AMBER)));
        }
        spans.push(Span::raw(if short { " " } else { "  " }));
    }
    if let Page::Agent(id) = page {
        spans.push(Span::styled(
            format!("▸ {}", app.view.name_of(id)),
            Style::new().fg(theme::BG).bg(theme::YELLOW).add_modifier(ratatui::style::Modifier::BOLD),
        ));
    }

    let hints = if area.width >= WIDE { "/ FIND  ? KEYS  ESC BACK " } else { "" };
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
            Constraint::Length(40),
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
        Mode::Command { input, .. } => Line::from(vec![
            Span::styled(" CMD ", theme::strip()),
            Span::styled(format!(" {}", input.value()), theme::bold(theme::YELLOW)),
            Span::styled("█", theme::ink(theme::YELLOW)),
            Span::styled(
                "   MON AGT TAPE SPND FAIL TREE SRC BODY WALL  + filter words",
                theme::ink(theme::FAINT),
            ),
        ]),
        Mode::Find { input, .. } => Line::from(vec![
            Span::styled(" FIND ", theme::strip()),
            Span::styled(format!(" /{}", input.value()), theme::bold(theme::YELLOW)),
            Span::styled("█", theme::ink(theme::YELLOW)),
        ]),
        Mode::Base(_) | Mode::Help { .. } => {
            let mut spans = vec![Span::styled(" > ", theme::strip()), Span::raw(" ")];
            if let Some(message) = &app.message {
                spans.push(Span::styled(message.clone(), theme::bold(theme::RED)));
                spans.push(Span::raw("  "));
            }
            if !app.filter.words.is_empty() {
                spans.push(Span::styled("FILTER ", theme::ink(theme::DIM)));
                spans.push(Span::styled(app.filter.words.join(" "), theme::bold(theme::YELLOW)));
                spans.push(Span::raw("  "));
            }
            if !app.filter.find.is_empty() {
                spans.push(Span::styled("FIND ", theme::ink(theme::DIM)));
                spans.push(Span::styled(format!("/{}", app.filter.find), theme::bold(theme::YELLOW)));
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
                spans.push(Span::styled(format!("LINK: {reason}"), theme::ink(theme::RED)));
            }
            Line::from(spans)
        }
    };
    frame.render_widget(Paragraph::new(line), area);
}

const HELP: [(&str, &str); 16] = [
    ("0 … 7", "monitor, then the numbered pane full screen (5 = tree)"),
    ("w", "wall: a card per agent"),
    ("TAB  S-TAB", "focus the next or previous pane"),
    ("↑ ↓  j k", "move the cursor"),
    ("← →  h l", "collapse / expand, previous / next card"),
    ("PGUP PGDN HOME END", "page, first, last"),
    ("ENTER", "open the agent under the cursor; expand a tool call"),
    ("ESC", "back one step"),
    ("/", "find: filter rows as you type"),
    ("?", "this help"),
    ("q  CTRL-C", "quit"),
    ("", ""),
    ("TYPE A LETTER", "command line, then ENTER:"),
    ("MON AGT TAPE SPND", "monitor, agents, tape, spend"),
    ("FAIL TREE SRC BODY WALL", "failures, tree, sources, body, wall"),
    ("AGT builder working", "words after a mnemonic filter rows"),
];

fn draw_help(frame: &mut Frame<'_>, area: Rect) {
    let width = area.width.min(78);
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
            theme::pane("KEYS", vec![Span::styled(" ESC CLOSES ", theme::ink(theme::DIM))], true)
                .borders(Borders::ALL),
        ),
        popup,
    );
}
