//! Drawing: the page body and the command line.
//! Layout degrades by width: under 140 columns BODY and SOURCES drop, under
//! 100 everything stacks in one column. Above 200 columns BODY takes a quarter
//! of the width.

mod agent_summary;
mod changes;
mod drill;
mod panes;
mod tree;
mod wall;

#[cfg(test)]
mod test;

use chrono::FixedOffset;
use ratatui::Frame;
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Clear, Paragraph};

use agent_monitor::domain::model::Timestamp;

use crate::app::App;
use crate::keys::{Mode, Page, Pane};
use crate::theme;
use crate::theme::Token;
use crate::view::Link;

/// Widths at which the layout changes.
const WIDE: u16 = 140;
const NARROW: u16 = 100;

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
    theme::set_active(app.theme);
    let area = frame.area();
    frame.render_widget(Block::default().style(theme::base()), area);

    let [body, command] = Layout::vertical([Constraint::Min(0), Constraint::Length(1)]).areas(area);

    match app.page().clone() {
        Page::Monitor => draw_monitor(frame, body, app, clock),
        Page::Zoom(pane) => panes::draw(frame, body, app, clock, pane, true),
        Page::Tree => tree::draw(frame, body, app, clock),
        Page::Wall => wall::draw(frame, body, app, clock),
        Page::Agent(id) => drill::draw(frame, body, app, clock, &id),
        Page::Lane(repo, branch) => changes::draw_lane(frame, body, app, clock, &repo, &branch),
    }

    draw_command(frame, command, app);
    if let Mode::Help { .. } = app.mode {
        draw_help(frame, body);
    }
    theme::grid(frame.buffer_mut(), body);
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
        let [agents, tape, prs, failures, spend] = Layout::vertical([
            Constraint::Percentage(35),
            Constraint::Percentage(25),
            Constraint::Percentage(15),
            Constraint::Percentage(12),
            Constraint::Percentage(13),
        ])
        .areas(area);
        panes::draw(frame, agents, app, clock, Pane::Agents, false);
        panes::draw(frame, tape, app, clock, Pane::Tape, false);
        panes::draw(frame, prs, app, clock, Pane::Changes, false);
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

    let [tape, right] =
        Layout::horizontal([Constraint::Percentage(50), Constraint::Percentage(50)]).areas(lower);
    let [prs, failures] =
        Layout::vertical([Constraint::Percentage(55), Constraint::Percentage(45)]).areas(right);
    panes::draw(frame, tape, app, clock, Pane::Tape, false);
    panes::draw(frame, prs, app, clock, Pane::Changes, false);
    panes::draw(frame, failures, app, clock, Pane::Failures, false);
}

fn draw_command(frame: &mut Frame<'_>, area: Rect, app: &App) {
    let (status, hints) = match &app.mode {
        Mode::Command { input, .. } | Mode::Find { input, .. } => {
            let label = if matches!(app.mode, Mode::Find { .. }) {
                "FIND"
            } else {
                "CMD"
            };
            (
                Line::from(prompt(
                    label,
                    vec![
                        Span::styled(format!(" {}", input.value()), theme::bold(Token::Highlight)),
                        Span::styled("█", theme::ink(Token::Highlight)),
                    ],
                )),
                theme::hotkeys(&[("Enter", "APPLY"), ("Esc", "CANCEL")]),
            )
        }
        Mode::Base(_) | Mode::Help { .. } => {
            let (link, color) = match &app.view.link {
                Link::Connecting => (String::from("○ CONNECTING"), Token::Highlight),
                Link::Live => (String::from("● LIVE"), Token::Ok),
                Link::Reconnecting(reason) => (format!("○ {reason}"), Token::Alert),
                Link::Incompatible(reason) => (format!("UPDATE MACROD: {reason}"), Token::Alert),
            };
            let mut spans = vec![Span::styled(link, theme::ink(color))];
            if let Some(label) = &app.label {
                spans.push(Span::styled(
                    format!(" {label}"),
                    theme::ink(Token::TextDim),
                ));
            }
            if app.theme_notice {
                spans.push(Span::styled(
                    format!(" THEME {}", app.theme.to_string().to_uppercase()),
                    theme::bold(Token::Highlight),
                ));
            }
            if let Some(message) = &app.message {
                spans.push(Span::styled(
                    format!(" {message}"),
                    theme::bold(Token::Alert),
                ));
            }
            if !app.filter.words.is_empty() {
                spans.push(Span::styled(
                    format!(" FILTER {}", app.filter.words.join(" ")),
                    theme::bold(Token::Highlight),
                ));
            }
            if !app.filter.find.is_empty() {
                spans.push(Span::styled(
                    format!(" FIND /{}", app.filter.find),
                    theme::bold(Token::Highlight),
                ));
            }
            let mut keys = vec![("?", "HELP")];
            for hint in [
                ("Esc", "BACK"),
                ("Enter", "OPEN"),
                ("0-8", "PAGE"),
                ("w", "WALL"),
                ("/", "FIND"),
                ("Tab", "PANE"),
                ("↑↓", "MOVE"),
                ("q", "QUIT"),
                ("`", "THEME"),
                ("letter", "COMMAND"),
            ] {
                let width = theme::hotkeys(&keys).width() + theme::hotkeys(&[hint]).width();
                if width + 16 <= usize::from(area.width) {
                    keys.insert(0, hint);
                }
            }
            (Line::from(spans), theme::hotkeys(&keys))
        }
    };
    let hint_width = u16::try_from(hints.width())
        .unwrap_or(area.width)
        .min(area.width);
    let [left, right] =
        Layout::horizontal([Constraint::Min(0), Constraint::Length(hint_width)]).areas(area);
    frame.render_widget(Paragraph::new(status), left);
    frame.render_widget(Paragraph::new(hints), right);
}

/// A command-line prompt: a title chip, then `rest`.
fn prompt(label: &str, rest: Vec<Span<'static>>) -> Vec<Span<'static>> {
    let mut spans = theme::strip_title(label);
    spans.extend(rest);
    spans
}

const HELP: [(&str, &str); 22] = [
    (
        "0 … 8",
        "monitor, then the numbered pane full screen (5 = tree, 8 = changes)",
    ),
    ("w", "wall: a card per agent"),
    ("TAB  S-TAB", "focus the next or previous pane"),
    ("↑ ↓  j k", "move the cursor"),
    ("← →  h l", "collapse / expand, previous / next card"),
    ("PGUP PGDN HOME END", "page, first, last"),
    (
        "ENTER",
        "open the agent under the cursor (a PR's author); expand a tool call",
    ),
    ("ESC", "back one step"),
    ("/", "find: filter rows as you type"),
    ("a", "list ended agents too, or only current ones"),
    (
        "b  B",
        "next BODY figure (monitor, BODY); previous (BODY only)",
    ),
    (
        "CTRL-T  `",
        "next colour theme (` where a browser keeps CTRL-T)",
    ),
    (
        "8: + − < > HOME",
        "changes: zoom, pan, back to now; [ ] repository",
    ),
    (
        "8: n N m s p",
        "next/previous failing lane, landed, sort, lane page",
    ),
    ("?", "this help"),
    ("q  CTRL-C", "quit"),
    ("", ""),
    (
        "TYPE A LETTER",
        "command line, any case (CAPITALS on 0, 7, 8), then ENTER:",
    ),
    ("MON AGT TAPE SPND", "monitor, agents, tape, spend"),
    (
        "FAIL TREE SRC BODY CHG WALL",
        "failures, tree, sources, body, changes (PRS too), wall",
    ),
    (
        "AGT builder working",
        "words after a mnemonic filter rows; all lists ended",
    ),
    (
        "THEME [name]",
        "colour theme: classic, ember, phosphor or dusk; no name = next",
    ),
];

/// The help box: the keys column plus the longest description and borders.
const HELP_WIDTH: u16 = 110;

fn draw_help(frame: &mut Frame<'_>, area: Rect) {
    let width = area.width.min(HELP_WIDTH);
    let height = area.height.min(u16::try_from(HELP.len()).unwrap_or(0) + 2);
    let popup = Rect {
        x: area.x + (area.width - width) / 2,
        y: area.y + (area.height - height) / 2,
        width,
        height,
    };
    let block =
        theme::pane(popup, "KEYS", Vec::new(), true).title(theme::hotkeys(&[("Esc", "CLOSE")]));
    let inner = block.inner(popup);
    frame.render_widget(Clear, popup);
    frame.render_widget(block, popup);
    for (index, (keys, what)) in HELP.iter().enumerate() {
        let row = u16::try_from(index).unwrap_or(inner.height);
        if row >= inner.height {
            break;
        }
        let key_text = if index < 16 {
            format!("[{keys}]")
        } else {
            (*keys).to_owned()
        };
        let key_width = u16::try_from(key_text.chars().count())
            .unwrap_or(0)
            .min(inner.width);
        let line = Rect::new(inner.x, inner.y + row, inner.width, 1);
        let [description, key_area] =
            Layout::horizontal([Constraint::Min(0), Constraint::Length(key_width)]).areas(line);
        frame.render_widget(
            Paragraph::new(Span::styled(*what, theme::ink(Token::Text))),
            description,
        );
        frame.render_widget(
            Paragraph::new(
                Line::from(Span::styled(key_text, theme::bold(Token::Highlight))).right_aligned(),
            ),
            key_area,
        );
    }
}
