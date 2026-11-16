//! Drawing: the page body, filters and bottom key hints.
//! Layout degrades by width: under 140 columns BODY and SOURCES drop, under
//! 100 everything stacks in one column. Above 200 columns BODY takes a quarter
//! of the width.

mod agent_summary;
mod changes;
mod drill;
mod filters;
mod panes;
mod tabs;
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

    let [body, footer] = Layout::vertical([Constraint::Min(0), Constraint::Length(1)]).areas(area);

    let body = tabs::draw(frame, body, app.page());
    let body = if *app.page() == Page::Zoom(Pane::Changes) {
        body
    } else {
        filters::draw(frame, body, app)
    };

    match app.page().clone() {
        Page::Monitor => draw_monitor(frame, body, app, clock),
        Page::Zoom(pane) => panes::draw(frame, body, app, clock, pane, true),
        Page::Tree => tree::draw(frame, body, app, clock),
        Page::Wall => wall::draw(frame, body, app, clock),
        Page::Agent(id) => drill::draw(frame, body, app, clock, &id),
        Page::Lane(repo, branch) => changes::draw_lane(frame, body, app, clock, &repo, &branch),
    }

    draw_footer(frame, footer, app);
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

fn draw_footer(frame: &mut Frame<'_>, area: Rect, app: &App) {
    let mut spans = Vec::new();
    match &app.view.link {
        Link::Live => {}
        Link::Connecting => spans.push(Span::styled("CONNECTING  ", theme::ink(Token::Highlight))),
        Link::Reconnecting(reason) => spans.push(Span::styled(
            format!("{reason}  "),
            theme::ink(Token::Alert),
        )),
        Link::Incompatible(reason) => spans.push(Span::styled(
            format!("UPDATE MACROD: {reason}  "),
            theme::ink(Token::Alert),
        )),
    }
    if let Some(label) = &app.label {
        spans.push(Span::styled(
            format!("{label}  "),
            theme::ink(Token::TextDim),
        ));
    }
    if app.theme_notice {
        spans.push(Span::styled(
            format!("THEME {}  ", app.theme.to_string().to_uppercase()),
            theme::bold(Token::Highlight),
        ));
    }
    if let Some(message) = &app.message {
        spans.push(Span::styled(
            format!("{message}  "),
            theme::bold(Token::Alert),
        ));
    }
    let mut keys = vec![("?", "HELP")];
    if matches!(app.mode, Mode::Filter { .. }) {
        keys = vec![("Enter", "APPLY"), ("Esc", "CANCEL")];
    } else {
        for hint in [
            ("Esc", "BACK"),
            ("Enter", "OPEN"),
            ("Tab", "PANE"),
            ("↑↓", "MOVE"),
            ("`", "THEME"),
            ("q", "QUIT"),
        ] {
            let width = theme::hotkeys(&keys).width() + theme::hotkeys(&[hint]).width();
            if width + Line::from(spans.clone()).width() <= usize::from(area.width) {
                keys.push(hint);
            }
        }
    }
    spans.extend(theme::hotkeys(&keys).spans);
    frame.render_widget(Paragraph::new(Line::from(spans)), area);
}

const HELP: [(&str, &str); 20] = [
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
        "open the selected row; inspect a change; expand a tool call",
    ),
    ("ESC", "back one step"),
    ("t", "agent pages: cycle kind filter"),
    ("s", "agent pages: cycle status filter"),
    ("/", "search text in names, tasks, activity and events"),
    ("x", "clear only this page's filters"),
    ("a", "list ended agents too, or only current ones"),
    ("b  B", "next / previous BODY figure (monitor and BODY)"),
    ("CTRL-T  `", "cycle themes: classic, ember, phosphor, dusk"),
    ("8: b t", "changes: branch list / timeline"),
    (
        "8: + − < > HOME",
        "changes: zoom, pan, back to now; [ ] repository",
    ),
    ("8: n N m s a", "attention, show finished, sort, open agent"),
    ("?", "this help"),
    ("q  CTRL-C", "quit"),
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
        let key_text = format!("[{keys}]");
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
                Line::from(Span::styled(key_text, theme::ink(Token::Frame))).right_aligned(),
            ),
            key_area,
        );
    }
}
