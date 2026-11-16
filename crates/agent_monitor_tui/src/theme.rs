//! The monitor's design tokens and its HUD dressing.
//!
//! UI code never names a colour. It names a [`Token`], a role such as
//! [`Token::Alert`] or [`Token::Rule`], and the active [`Theme`] gives each
//! role its colour. The HUD dressing lives here too: thin pane frames,
//! orange title chips, segmented meters and the glitch on fresh values.

#[cfg(test)]
mod test;
mod themes;

use std::cell::Cell;

use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::{Color, Modifier, Style};
use ratatui::symbols::border;
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders};

use agent_monitor::domain::model::{Severity, Status};

pub use themes::{CLASSIC, DUSK, EMBER, PHOSPHOR, ThemeName};

/// A colour role. Tokens run from quiet structure to loud signals; a theme
/// keeps routine roles calm so the loud ones ([`Token::Alert`],
/// [`Token::Attention`]) draw the eye.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Token {
    /// The background, and the text on a filled chip or highlight.
    Bg,
    /// Barely there: grid dots and the empty cells of meters and gauges.
    Ghost,
    /// Thin pane edges.
    Frame,
    /// Rules, separators, quiet labels and settled values (done agents,
    /// zero counts).
    Rule,
    /// The background of the selected row.
    Selection,
    /// Secondary ink: column heads, labels, idle agents, units.
    TextDim,
    /// The ink: names, values and plain tape lines.
    Text,
    /// The brand orange: title chips, spend meters and warnings.
    Accent,
    /// What the eye should find next: the focused frame, key hints, the
    /// command line, live numbers (cost, tokens, counts) and in-flight states
    /// (CI running, a tool call pending, a source starting).
    Highlight,
    /// Waiting on a person: a waiting agent, a PR that needs review.
    Attention,
    /// Healthy and routine: working agents, the live link, CI passed,
    /// approvals, merges, a tool that succeeded.
    Ok,
    /// Routine chart fills, which cover far more cells than text and so sit
    /// quieter than [`Token::Ok`]: activity sparklines on agent rows and
    /// cards, and the token-rate sparkline.
    Trace,
    /// Tools and what an agent is doing now: tool names and counts, the
    /// DOING column, BIOSCAN labels.
    Info,
    /// Info chrome: ids, branch names, tick marks and info rules.
    InfoDim,
    /// Barely there info: the scanner's edge ticks and the help rule.
    InfoFaint,
    /// Errors and failures: failed and blocked agents, failing CI, changes
    /// requested, tool errors, an offline link.
    Alert,
}

/// A colour for every [`Token`], and the BODY figure's palette.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Theme {
    /// The theme's name.
    pub name: ThemeName,
    /// [`Token::Bg`].
    pub bg: Color,
    /// [`Token::Ghost`].
    pub ghost: Color,
    /// [`Token::Frame`].
    pub frame: Color,
    /// [`Token::Rule`].
    pub rule: Color,
    /// [`Token::Selection`].
    pub selection: Color,
    /// [`Token::TextDim`].
    pub text_dim: Color,
    /// [`Token::Text`].
    pub text: Color,
    /// [`Token::Accent`].
    pub accent: Color,
    /// [`Token::Highlight`].
    pub highlight: Color,
    /// [`Token::Attention`].
    pub attention: Color,
    /// [`Token::Ok`].
    pub ok: Color,
    /// [`Token::Trace`].
    pub trace: Color,
    /// [`Token::Info`].
    pub info: Color,
    /// [`Token::InfoDim`].
    pub info_dim: Color,
    /// [`Token::InfoFaint`].
    pub info_faint: Color,
    /// [`Token::Alert`].
    pub alert: Color,
    /// The mesh man's colours, matched to the tokens.
    #[cfg(feature = "mesh-man")]
    pub figure: mesh_man::Palette,
}

impl Theme {
    /// The colour of `token`.
    pub fn color(&self, token: Token) -> Color {
        match token {
            Token::Bg => self.bg,
            Token::Ghost => self.ghost,
            Token::Frame => self.frame,
            Token::Rule => self.rule,
            Token::Selection => self.selection,
            Token::TextDim => self.text_dim,
            Token::Text => self.text,
            Token::Accent => self.accent,
            Token::Highlight => self.highlight,
            Token::Attention => self.attention,
            Token::Ok => self.ok,
            Token::Trace => self.trace,
            Token::Info => self.info,
            Token::InfoDim => self.info_dim,
            Token::InfoFaint => self.info_faint,
            Token::Alert => self.alert,
        }
    }
}

thread_local! {
    /// The theme this thread draws in. Thread-local rather than threaded
    /// through every draw call: [`crate::ui::draw`] sets it from the app at
    /// the top of each frame, and parallel tests on other threads keep their
    /// own.
    static ACTIVE: Cell<ThemeName> = const { Cell::new(ThemeName::Classic) };
}

/// Draws this thread's next frames in `name`.
pub fn set_active(name: ThemeName) {
    ACTIVE.set(name);
}

/// The theme frames are drawn in.
pub fn active() -> &'static Theme {
    ACTIVE.get().theme()
}

impl Token {
    /// This role's colour in the active theme.
    pub fn color(self) -> Color {
        active().color(self)
    }
}

/// Plain ink on black.
pub fn base() -> Style {
    Style::new().fg(Token::Text.color()).bg(Token::Bg.color())
}

/// Text in a role's colour.
pub fn ink(token: Token) -> Style {
    Style::new().fg(token.color())
}

/// Bold text in a role's colour.
pub fn bold(token: Token) -> Style {
    Style::new().fg(token.color()).add_modifier(Modifier::BOLD)
}

/// Bold background-coloured text on a filled role: a chip or a badge.
pub fn chip(token: Token) -> Style {
    bold(Token::Bg).bg(token.color())
}

/// Black on orange, the title strip style.
pub fn strip() -> Style {
    chip(Token::Accent)
}

/// The selected row.
pub fn selected() -> Style {
    Style::new()
        .bg(Token::Selection.color())
        .add_modifier(Modifier::BOLD)
}

/// A bordered block in the HUD frame, its edges in `token`'s colour.
pub fn frame(token: Token) -> Block<'static> {
    Block::default()
        .borders(Borders::ALL)
        .border_set(border::PLAIN)
        .border_style(ink(token))
        .style(base())
}

/// An orange title chip: ` TEXT `.
pub fn strip_title(text: &str) -> Vec<Span<'static>> {
    vec![Span::styled(format!(" {text} "), strip())]
}

/// Right-aligned action labels followed by bracketed hotkeys.
pub fn hotkeys(keys: &[(&str, &str)]) -> Line<'static> {
    let mut spans = Vec::new();
    for (key, action) in keys {
        spans.push(Span::styled(format!(" {action} "), ink(Token::TextDim)));
        spans.push(Span::styled(format!("[{key}] "), bold(Token::Highlight)));
    }
    Line::from(spans).right_aligned()
}

/// A pane with a title chip and its page hotkey on the right, outside the chip.
pub fn pane(area: Rect, title: &str, extra: Vec<Span<'static>>, focused: bool) -> Block<'static> {
    let border = if focused {
        Token::Highlight
    } else {
        Token::Frame
    };
    let (key, title) = match title.split_once(' ') {
        Some((key, title)) if key.chars().all(|c| c.is_ascii_digit()) || key == "w" => {
            (Some(key), title)
        }
        _ => (None, title),
    };
    let mut spans = strip_title(title);
    spans.extend(extra);
    let key_width = key.map_or(0, |key| hotkeys(&[(key, "")]).width() + 1);
    let mut remaining = usize::from(area.width.saturating_sub(2)).saturating_sub(key_width);
    let mut visible = Vec::new();
    for span in spans {
        if span.width() > remaining {
            break;
        }
        remaining -= span.width();
        visible.push(span);
    }
    let mut block = frame(border).title(Line::from(visible));
    if let Some(key) = key {
        block = block.title(hotkeys(&[(key, "")]));
    }
    block
}

/// Columns and rows between grid dots.
const GRID_COLUMNS: u16 = 4;
const GRID_ROWS: u16 = 2;

/// Lays a faint dot grid over empty space: every pane row in `area` that is
/// blank from one frame edge to the next gets a dot every few columns, so
/// empty space reads as a HUD's graticule. Rows with any content stay
/// untouched, so the grid never sits between values.
pub fn grid(buffer: &mut Buffer, area: Rect) {
    let area = area.intersection(buffer.area);
    for y in (area.top()..area.bottom()).filter(|y| y.is_multiple_of(GRID_ROWS)) {
        let mut start = None;
        for x in area.left()..area.right() {
            let symbol = buffer.cell((x, y)).map_or("", |cell| cell.symbol());
            match symbol {
                "│" => {
                    if let Some(from) = start.take() {
                        dots(buffer, y, from, x);
                    }
                    start = Some(x + 1);
                }
                " " => {}
                _ => start = None,
            }
        }
    }
}

/// Dots across `y` from `from` to before `to`, when the run is blank and
/// has a plain background.
fn dots(buffer: &mut Buffer, y: u16, from: u16, to: u16) {
    if to.saturating_sub(from) < GRID_COLUMNS * 2 {
        return;
    }
    let blank = (from..to).all(|x| {
        buffer
            .cell((x, y))
            .is_some_and(|cell| cell.symbol() == " " && cell.bg == Token::Bg.color())
    });
    if !blank {
        return;
    }
    for x in (from + 2..to.saturating_sub(1)).filter(|x| x.is_multiple_of(GRID_COLUMNS)) {
        if let Some(cell) = buffer.cell_mut((x, y)) {
            cell.set_symbol("·").set_fg(Token::Ghost.color());
        }
    }
}

/// A segmented meter `width` cells wide, `filled` of them lit.
pub fn meter(filled: usize, width: usize, token: Token) -> Vec<Span<'static>> {
    let filled = filled.min(width);
    vec![
        Span::styled("▰".repeat(filled), ink(token)),
        Span::styled("▱".repeat(width - filled), ink(Token::Ghost)),
    ]
}

/// Glyphs a glitch swaps in.
const GLITCH: [char; 8] = ['▚', '▞', '░', '▒', '╳', '▓', '▘', '▝'];

/// How long a fresh value glitches, in milliseconds.
pub const GLITCH_MS: i64 = 1_200;

/// `text` with a few characters swapped for block noise: a faint flicker for
/// a value `age_ms` old, driven by the frame clock `now_ms`, so it moves only
/// as fast as frames are drawn and settles once [`GLITCH_MS`] have passed.
pub fn glitch(text: &str, age_ms: i64, now_ms: i64) -> String {
    if !(0..GLITCH_MS).contains(&age_ms) {
        return text.to_owned();
    }
    // A new pattern every 90ms; fewer swaps as the value ages.
    let frame = now_ms.div_euclid(90);
    let every = 3 + age_ms * 8 / GLITCH_MS;
    text.chars()
        .enumerate()
        .map(|(index, character)| {
            let index = i64::try_from(index).unwrap_or(0);
            let noise = (index * 7_919 + frame * 104_729).rem_euclid(97);
            if character == ' ' || noise % every != 0 {
                return character;
            }
            let pick = usize::try_from(noise).unwrap_or(0) % GLITCH.len();
            GLITCH.get(pick).copied().unwrap_or(character)
        })
        .collect()
}

/// The role of a status square.
pub fn status_color(status: Status) -> Token {
    match status {
        Status::Working => Token::Ok,
        Status::Waiting => Token::Attention,
        Status::Blocked | Status::Failed => Token::Alert,
        Status::Idle => Token::TextDim,
        Status::Done => Token::Rule,
        Status::Stopped => Token::Ghost,
    }
}

/// The status word in a row.
pub fn status_word(status: Status) -> &'static str {
    match status {
        Status::Working => "WORK",
        Status::Blocked => "BLCK",
        Status::Waiting => "WAIT",
        Status::Idle => "IDLE",
        Status::Done => "DONE",
        Status::Failed => "FAIL",
        Status::Stopped => "STOP",
    }
}

/// The status glyph: working blinks between a filled and a hollow diamond
/// on `blink`; blocked is a warning triangle, failed a cross.
pub fn status_square(status: Status, blink: bool) -> Span<'static> {
    let glyph = match status {
        Status::Working if blink => "◇",
        Status::Working | Status::Waiting => "◆",
        Status::Blocked => "▲",
        Status::Failed => "✕",
        Status::Idle => "◇",
        Status::Done | Status::Stopped => "·",
    };
    Span::styled(glyph, bold(status_color(status)))
}

/// The role of a tape line.
pub fn severity_color(severity: Severity) -> Token {
    match severity {
        Severity::Info => Token::Text,
        Severity::Notice => Token::Highlight,
        Severity::Warning => Token::Accent,
        Severity::Error => Token::Alert,
    }
}
