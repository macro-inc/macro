//! How many colors the terminal can show, and fitting the theme to it.
//!
//! The theme is written in 24-bit RGB. A terminal without truecolor, such as
//! macOS Terminal.app before macOS 26, does not ignore those escapes: it reads
//! their numbers as separate SGR attributes and paints the panel in random
//! colors (teal, on Terminal.app) that change as cells repaint.

use ratatui::buffer::Buffer;
use ratatui::style::Color;

use super::theme::THEME;

#[cfg(test)]
mod test;

mod environment {
    macro_env_var::maybe_env_var! {
        /// `truecolor` or `24bit` when the terminal takes RGB colors.
        pub struct Colorterm;
    }
    macro_env_var::maybe_env_var! {
        /// The terminal application, e.g. `Apple_Terminal` or `iTerm.app`.
        pub struct TermProgram;
    }
    macro_env_var::maybe_env_var! {
        pub struct Term;
    }
}

/// Terminal applications that take RGB colors without setting `COLORTERM`.
const TRUECOLOR_PROGRAMS: [&str; 4] = ["iTerm.app", "WezTerm", "vscode", "ghostty"];

/// `TERM` values of terminals that take RGB colors. ssh forwards `TERM` but
/// not `COLORTERM` or `TERM_PROGRAM`.
const TRUECOLOR_TERMS: [&str; 5] = [
    "xterm-kitty",
    "alacritty",
    "foot",
    "wezterm",
    "xterm-ghostty",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ColorSupport {
    TrueColor,
    /// The xterm 256-color palette.
    Ansi256,
    /// The 16 named colors.
    Ansi16,
}

/// What the terminal says about itself, from its environment variables.
#[derive(Debug, Clone, Copy, Default)]
pub(crate) struct TerminalIdentity<'a> {
    pub(crate) colorterm: Option<&'a str>,
    pub(crate) term_program: Option<&'a str>,
    pub(crate) term: Option<&'a str>,
    /// Windows consoles set no `TERM` and have taken RGB since Windows 10.
    pub(crate) windows: bool,
}

impl ColorSupport {
    /// Read the running terminal's color support from its environment.
    pub(crate) fn detect() -> Self {
        let colorterm = environment::Colorterm::new();
        let term_program = environment::TermProgram::new();
        let term = environment::Term::new();
        Self::of(TerminalIdentity {
            colorterm: colorterm.as_ref().and_then(|value| value.value()),
            term_program: term_program.as_ref().and_then(|value| value.value()),
            term: term.as_ref().and_then(|value| value.value()),
            windows: cfg!(windows),
        })
    }

    pub(crate) fn of(terminal: TerminalIdentity) -> Self {
        if matches!(terminal.colorterm, Some("truecolor" | "24bit")) {
            return Self::TrueColor;
        }
        match terminal.term_program {
            // Terminal.app sets no `COLORTERM` and takes the 256 palette.
            Some("Apple_Terminal") => return Self::Ansi256,
            Some(program) if TRUECOLOR_PROGRAMS.contains(&program) => return Self::TrueColor,
            _ => {}
        }
        match terminal.term {
            Some(term) if term.ends_with("-direct") || TRUECOLOR_TERMS.contains(&term) => {
                Self::TrueColor
            }
            Some(term) if term.contains("256color") => Self::Ansi256,
            None if terminal.windows => Self::TrueColor,
            _ => Self::Ansi16,
        }
    }

    /// The closest color this terminal can show.
    pub(crate) fn fit(self, color: Color) -> Color {
        let Color::Rgb(red, green, blue) = color else {
            return color;
        };
        match self {
            Self::TrueColor => color,
            Self::Ansi256 => Color::Indexed(nearest_256([red, green, blue])),
            Self::Ansi16 => theme_role_16(color).unwrap_or_else(|| nearest_16([red, green, blue])),
        }
    }

    /// Fit every cell's colors to this terminal, after a frame is drawn.
    pub(crate) fn fit_buffer(self, buffer: &mut Buffer) {
        if self == Self::TrueColor {
            return;
        }
        for cell in &mut buffer.content {
            cell.fg = self.fit(cell.fg);
            cell.bg = self.fit(cell.bg);
            cell.underline_color = self.fit(cell.underline_color);
        }
    }
}

/// The levels of each channel in the 6x6x6 cube at palette indices 16-231.
const CUBE_LEVELS: [u8; 6] = [0, 95, 135, 175, 215, 255];

fn distance(left: [u8; 3], right: [u8; 3]) -> u32 {
    left.iter()
        .zip(right)
        .map(|(left, right)| u32::from(left.abs_diff(right)).pow(2))
        .sum()
}

/// The nearer of the closest cube color and the closest gray (232-255).
fn nearest_256(rgb: [u8; 3]) -> u8 {
    let level = |value: u8| match value {
        0..48 => 0,
        48..115 => 1,
        _ => (value - 35) / 40,
    };
    let [red, green, blue] = rgb.map(level);
    let cube = [red, green, blue].map(|index| {
        CUBE_LEVELS
            .get(usize::from(index))
            .copied()
            .unwrap_or(u8::MAX)
    });
    let cube_index = 16 + 36 * red + 6 * green + blue;

    let average = rgb.iter().map(|value| u16::from(*value)).sum::<u16>() / 3;
    // Grays run 8, 18, ..., 238.
    let gray_step = u8::try_from(average.saturating_sub(3) / 10)
        .unwrap_or(23)
        .min(23);
    let gray_level = 8 + 10 * gray_step;
    let gray_index = 232 + gray_step;

    if distance(rgb, [gray_level; 3]) < distance(rgb, cube) {
        gray_index
    } else {
        cube_index
    }
}

/// The 16 named colors with xterm's default values.
const NAMED: [(Color, [u8; 3]); 16] = [
    (Color::Black, [0, 0, 0]),
    (Color::Red, [205, 0, 0]),
    (Color::Green, [0, 205, 0]),
    (Color::Yellow, [205, 205, 0]),
    (Color::Blue, [0, 0, 238]),
    (Color::Magenta, [205, 0, 205]),
    (Color::Cyan, [0, 205, 205]),
    (Color::Gray, [229, 229, 229]),
    (Color::DarkGray, [127, 127, 127]),
    (Color::LightRed, [255, 0, 0]),
    (Color::LightGreen, [0, 255, 0]),
    (Color::LightYellow, [255, 255, 0]),
    (Color::LightBlue, [92, 92, 255]),
    (Color::LightMagenta, [255, 0, 255]),
    (Color::LightCyan, [0, 255, 255]),
    (Color::White, [255, 255, 255]),
];

/// The theme's colors in 16-color terminals, chosen by role: the nearest
/// named color by distance turns error text gray and success teal.
fn theme_role_16(color: Color) -> Option<Color> {
    let roles = [
        (THEME.background, Color::Black),
        (THEME.surface, Color::Black),
        (THEME.text, Color::White),
        (THEME.muted, Color::Gray),
        (THEME.border, Color::DarkGray),
        (THEME.accent, Color::Yellow),
        (THEME.accent_text, Color::Black),
        (THEME.success, Color::LightGreen),
        (THEME.warning, Color::LightYellow),
        (THEME.error, Color::LightRed),
    ];
    roles
        .into_iter()
        .find(|(theme, _)| *theme == color)
        .map(|(_, named)| named)
}

/// The nearest named color, for colors outside the theme.
fn nearest_16(rgb: [u8; 3]) -> Color {
    NAMED
        .iter()
        .min_by_key(|(_, named)| distance(rgb, *named))
        .map_or(Color::Reset, |(color, _)| *color)
}
