use ratatui::Terminal;
use ratatui::backend::TestBackend;
use ratatui::style::Color;

use super::{ColorSupport, TerminalIdentity};
use crate::tui::quickstart::{Quickstart, QuickstartFocus, QuickstartMode};

#[test]
fn terminal_identities_map_to_their_color_support() {
    let cases = [
        // macOS Terminal.app before macOS 26, as an Intel Mac on macOS 14 reports it.
        (
            TerminalIdentity {
                term_program: Some("Apple_Terminal"),
                term: Some("xterm-256color"),
                ..TerminalIdentity::default()
            },
            ColorSupport::Ansi256,
        ),
        // iTerm2 sets COLORTERM.
        (
            TerminalIdentity {
                colorterm: Some("truecolor"),
                term_program: Some("iTerm.app"),
                term: Some("xterm-256color"),
                ..TerminalIdentity::default()
            },
            ColorSupport::TrueColor,
        ),
        // An explicit COLORTERM wins, even in Terminal.app (macOS 26 has truecolor).
        (
            TerminalIdentity {
                colorterm: Some("24bit"),
                term_program: Some("Apple_Terminal"),
                term: Some("xterm-256color"),
                ..TerminalIdentity::default()
            },
            ColorSupport::TrueColor,
        ),
        (
            TerminalIdentity {
                term_program: Some("WezTerm"),
                term: Some("xterm-256color"),
                ..TerminalIdentity::default()
            },
            ColorSupport::TrueColor,
        ),
        // ssh drops COLORTERM; TERM still says 256 colors.
        (
            TerminalIdentity {
                term: Some("xterm-256color"),
                ..TerminalIdentity::default()
            },
            ColorSupport::Ansi256,
        ),
        // kitty over ssh: only its TERM arrives.
        (
            TerminalIdentity {
                term: Some("xterm-kitty"),
                ..TerminalIdentity::default()
            },
            ColorSupport::TrueColor,
        ),
        // tmux, which downsamples for its outer terminal anyway.
        (
            TerminalIdentity {
                term_program: Some("tmux"),
                term: Some("tmux-256color"),
                ..TerminalIdentity::default()
            },
            ColorSupport::Ansi256,
        ),
        (
            TerminalIdentity {
                term: Some("xterm-direct"),
                ..TerminalIdentity::default()
            },
            ColorSupport::TrueColor,
        ),
        (
            TerminalIdentity {
                term: Some("xterm"),
                ..TerminalIdentity::default()
            },
            ColorSupport::Ansi16,
        ),
        (
            TerminalIdentity {
                term: Some("linux"),
                ..TerminalIdentity::default()
            },
            ColorSupport::Ansi16,
        ),
        // Windows Terminal and conhost set no TERM.
        (
            TerminalIdentity {
                windows: true,
                ..TerminalIdentity::default()
            },
            ColorSupport::TrueColor,
        ),
        (TerminalIdentity::default(), ColorSupport::Ansi16),
    ];
    for (terminal, expected) in cases {
        assert_eq!(ColorSupport::of(terminal), expected, "{terminal:?}");
    }
}

#[test]
fn theme_colors_fit_the_256_palette() {
    let fit = |red, green, blue| ColorSupport::Ansi256.fit(Color::Rgb(red, green, blue));
    // Macro orange, #f97316.
    assert_eq!(fit(249, 115, 22), Color::Indexed(208));
    // The panel background, near black, is a gray.
    assert_eq!(fit(21, 17, 14), Color::Indexed(233));
    assert_eq!(fit(255, 255, 255), Color::Indexed(231));
    assert_eq!(fit(0, 0, 0), Color::Indexed(16));
    assert_eq!(fit(74, 222, 128), Color::Indexed(78));
    // Named and indexed colors are already in the palette.
    assert_eq!(ColorSupport::Ansi256.fit(Color::Cyan), Color::Cyan);
    assert_eq!(
        ColorSupport::Ansi256.fit(Color::Indexed(42)),
        Color::Indexed(42)
    );
}

#[test]
fn theme_colors_keep_their_roles_in_16_colors() {
    let fit = |red, green, blue| ColorSupport::Ansi16.fit(Color::Rgb(red, green, blue));
    // Background, surface, text, muted, border.
    assert_eq!(fit(21, 17, 14), Color::Black);
    assert_eq!(fit(33, 26, 20), Color::Black);
    assert_eq!(fit(255, 248, 240), Color::White);
    assert_eq!(fit(199, 185, 171), Color::Gray);
    assert_eq!(fit(128, 106, 85), Color::DarkGray);
    // Accent and the text drawn on it.
    assert_eq!(fit(249, 115, 22), Color::Yellow);
    assert_eq!(fit(24, 13, 5), Color::Black);
    // Success, warning, error.
    assert_eq!(fit(74, 222, 128), Color::LightGreen);
    assert_eq!(fit(255, 178, 36), Color::LightYellow);
    assert_eq!(fit(255, 107, 107), Color::LightRed);
    // A color outside the theme takes the nearest named color.
    assert_eq!(fit(0, 0, 230), Color::Blue);
}

#[test]
fn truecolor_keeps_rgb() {
    assert_eq!(
        ColorSupport::TrueColor.fit(Color::Rgb(249, 115, 22)),
        Color::Rgb(249, 115, 22)
    );
}

#[test]
fn a_terminal_app_frame_has_no_rgb_colors() {
    let colors = ColorSupport::of(TerminalIdentity {
        term_program: Some("Apple_Terminal"),
        term: Some("xterm-256color"),
        ..TerminalIdentity::default()
    });
    let quickstart = Quickstart {
        agents: Vec::new(),
        selected_agent: None,
        focus: QuickstartFocus::Agent(0),
        workspace: "/tmp".to_owned(),
        mode: QuickstartMode::Normal,
        status: Some(("Installing an adapter...".to_owned(), false)),
    };
    let mut terminal = Terminal::new(TestBackend::new(100, 40)).unwrap();
    terminal
        .draw(|frame| {
            crate::tui::ui::render_quickstart(
                frame,
                &quickstart,
                std::path::Path::new("macrod.toml"),
            );
            colors.fit_buffer(frame.buffer_mut());
        })
        .unwrap();
    let rgb = terminal
        .backend()
        .buffer()
        .content()
        .iter()
        .flat_map(|cell| [cell.fg, cell.bg, cell.underline_color])
        .filter(|color| matches!(color, Color::Rgb(..)))
        .count();
    assert_eq!(rgb, 0, "Terminal.app misreads 24-bit color escapes");
}
