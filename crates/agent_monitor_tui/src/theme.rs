//! The monitor palette: black, amber ink, yellow for live, cyan for tools, red
//! for errors, green for ok, and macrod's orange for title strips. The HUD
//! dressing lives here too: bracket-cornered frames, slanted title strips,
//! segmented meters and the glitch on fresh values.

use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::{Color, Modifier, Style};
use ratatui::symbols::border;
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders};

use agent_monitor::domain::model::{Severity, Status};

/// The background.
pub const BG: Color = Color::Rgb(0, 0, 0);
/// The ink.
pub const AMBER: Color = Color::Rgb(255, 165, 43);
/// Secondary ink.
pub const DIM: Color = Color::Rgb(194, 123, 28);
/// Rules, borders and quiet labels.
pub const FAINT: Color = Color::Rgb(122, 80, 22);
/// Frame edges between the bright corner brackets.
pub const EDGE: Color = Color::Rgb(92, 60, 16);
/// Barely there: empty bars and grid dots.
pub const GHOST: Color = Color::Rgb(58, 38, 10);
/// Title strips: macrod's accent.
pub const STRIP: Color = Color::Rgb(249, 115, 22);
/// Live values.
pub const YELLOW: Color = Color::Rgb(255, 225, 77);
/// Tools.
pub const CYAN: Color = Color::Rgb(79, 211, 255);
/// Errors.
pub const RED: Color = Color::Rgb(255, 59, 59);
/// Ok.
pub const GREEN: Color = Color::Rgb(34, 229, 92);
/// Cyan rules and tick marks: the tool colour, turned down.
pub const CYAN_DIM: Color = Color::Rgb(28, 98, 122);
/// Barely there cyan: grid lines.
pub const CYAN_DARK: Color = Color::Rgb(16, 56, 70);
/// Highlighted row background.
pub const SELECT: Color = Color::Rgb(70, 40, 0);
/// Text on a strip.
pub const INK_ON_STRIP: Color = Color::Rgb(0, 0, 0);

/// Plain ink on black.
pub fn base() -> Style {
    Style::new().fg(AMBER).bg(BG)
}

/// A colour on black.
pub fn ink(color: Color) -> Style {
    Style::new().fg(color)
}

/// Bold colour.
pub fn bold(color: Color) -> Style {
    Style::new().fg(color).add_modifier(Modifier::BOLD)
}

/// Black on orange, the title strip style.
pub fn strip() -> Style {
    Style::new()
        .fg(INK_ON_STRIP)
        .bg(STRIP)
        .add_modifier(Modifier::BOLD)
}

/// The selected row.
pub fn selected() -> Style {
    Style::new().bg(SELECT).add_modifier(Modifier::BOLD)
}

/// Frame corners: heavy brackets on light edges. [`brackets`] grows each
/// corner an arm along its edges after drawing, so every pane reads as a
/// bracketed HUD frame. Nothing else draws these four glyphs.
pub const FRAME: border::Set = border::Set {
    top_left: "┏",
    top_right: "┓",
    bottom_left: "┗",
    bottom_right: "┛",
    vertical_left: "│",
    vertical_right: "│",
    horizontal_top: "─",
    horizontal_bottom: "─",
};

/// A bordered block in the HUD frame, its edges in `color`.
pub fn frame(color: Color) -> Block<'static> {
    Block::default()
        .borders(Borders::ALL)
        .border_set(FRAME)
        .border_style(Style::new().fg(color))
        .style(base())
}

/// A slanted orange title strip: `◢ TEXT ◤`.
pub fn strip_title(text: &str) -> Vec<Span<'static>> {
    vec![
        Span::styled("◢", Style::new().fg(STRIP).bg(BG)),
        Span::styled(format!(" {text} "), strip()),
        Span::styled("◤", Style::new().fg(STRIP).bg(BG)),
    ]
}

/// A pane title as the HUD writes it: `1 AGENTS` becomes `01 // AGENTS`.
fn hud_title(title: &str) -> String {
    match title.split_once(' ') {
        Some((number, rest))
            if !number.is_empty() && number.chars().all(|c| c.is_ascii_digit()) =>
        {
            format!("{number:0>2} // {rest}")
        }
        _ => title.to_owned(),
    }
}

/// A pane: the bracket frame, a slanted numbered title strip, and extra
/// title spans after it. A focused pane gets a yellow frame.
pub fn pane(title: &str, extra: Vec<Span<'static>>, focused: bool) -> Block<'static> {
    let border = if focused { YELLOW } else { EDGE };
    let mut spans = vec![Span::styled("━", Style::new().fg(corner(border)))];
    spans.extend(strip_title(&hud_title(title)));
    spans.extend(extra);
    frame(border).title(Line::from(spans))
}

/// The brighter ink of a frame's corners.
fn corner(border: Color) -> Color {
    match border {
        EDGE => DIM,
        FAINT => AMBER,
        other => other,
    }
}

/// Grows every [`FRAME`] corner in `area` into a bracket: the corner and
/// the edge cells next to it turn heavy and bright. Run once a frame, after
/// everything is drawn.
pub fn brackets(buffer: &mut Buffer, area: Rect) {
    let area = area.intersection(buffer.area);
    let mut corners = Vec::new();
    for y in area.top()..area.bottom() {
        for x in area.left()..area.right() {
            let Some(cell) = buffer.cell((x, y)) else {
                continue;
            };
            let arms: (i32, i32) = match cell.symbol() {
                "┏" => (1, 1),
                "┓" => (-1, 1),
                "┗" => (1, -1),
                "┛" => (-1, -1),
                _ => continue,
            };
            corners.push((x, y, arms, cell.fg));
        }
    }
    for (x, y, (across, down), color) in corners {
        let color = corner(color);
        if let Some(cell) = buffer.cell_mut((x, y)) {
            cell.set_fg(color);
        }
        for step in 1..=BRACKET_ARM {
            heavy(buffer, (x, y), (across * step, 0), ("─", "━"), color);
        }
        heavy(buffer, (x, y), (0, down), ("│", "┃"), color);
    }
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
                "│" | "┃" => {
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
            .is_some_and(|cell| cell.symbol() == " " && cell.bg == BG)
    });
    if !blank {
        return;
    }
    for x in (from + 2..to.saturating_sub(1)).filter(|x| x.is_multiple_of(GRID_COLUMNS)) {
        if let Some(cell) = buffer.cell_mut((x, y)) {
            cell.set_symbol("·").set_fg(GHOST);
        }
    }
}

/// Edge cells a bracket's horizontal arm covers.
const BRACKET_ARM: i32 = 3;

/// Turns the `light` edge cell at an offset from a corner `heavy`.
fn heavy(
    buffer: &mut Buffer,
    (x, y): (u16, u16),
    (dx, dy): (i32, i32),
    (light, heavy): (&str, &str),
    color: Color,
) {
    let (Ok(x), Ok(y)) = (
        u16::try_from(i32::from(x) + dx),
        u16::try_from(i32::from(y) + dy),
    ) else {
        return;
    };
    if let Some(cell) = buffer.cell_mut((x, y))
        && cell.symbol() == light
    {
        cell.set_symbol(heavy).set_fg(color);
    }
}

/// A segmented meter `width` cells wide, `filled` of them lit.
pub fn meter(filled: usize, width: usize, color: Color) -> Vec<Span<'static>> {
    let filled = filled.min(width);
    vec![
        Span::styled("▰".repeat(filled), ink(color)),
        Span::styled("▱".repeat(width - filled), ink(GHOST)),
    ]
}

/// Glyphs a glitch swaps in.
const GLITCH: [char; 8] = ['▚', '▞', '░', '▒', '╳', '▓', '◢', '◤'];

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

/// The colour of a status square.
pub fn status_color(status: Status) -> Color {
    match status {
        Status::Working => GREEN,
        Status::Waiting => YELLOW,
        Status::Blocked | Status::Failed => RED,
        Status::Idle => DIM,
        Status::Done => FAINT,
        Status::Stopped => GHOST,
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

/// The colour of a tape line.
pub fn severity_color(severity: Severity) -> Color {
    match severity {
        Severity::Info => AMBER,
        Severity::Notice => YELLOW,
        Severity::Warning => STRIP,
        Severity::Error => RED,
    }
}
