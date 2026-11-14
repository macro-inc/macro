//! Renders the mesh man to an asciicast (v2) on stdout, for previews:
//! `cargo run -p mesh_man --example frames -- FIGURE COLS ROWS FRAMES STEP_MS`.

use std::fmt::Write as _;
use std::time::Duration;

use mesh_man::{Body, PulseKind};
use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::Color;
use ratatui::widgets::Widget;

fn ansi(buffer: &Buffer, area: Rect) -> String {
    let mut out = String::from("\u{1b}[H");
    for y in 0..area.height {
        for x in 0..area.width {
            let cell = &buffer[(x, y)];
            match cell.fg {
                Color::Rgb(r, g, b) => {
                    let _ = write!(out, "\u{1b}[38;2;{r};{g};{b}m");
                }
                Color::Indexed(i) => {
                    let _ = write!(out, "\u{1b}[38;5;{i}m");
                }
                _ => out.push_str("\u{1b}[39m"),
            }
            out.push_str(cell.symbol());
        }
        out.push_str("\r\n");
    }
    out
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let arg = |i: usize, default: &str| args.get(i).cloned().unwrap_or_else(|| default.to_owned());
    let figure = arg(1, "CLASSIC");
    let cols: u16 = arg(2, "50").parse().unwrap_or(50);
    let rows: u16 = arg(3, "35").parse().unwrap_or(35);
    let frames: usize = arg(4, "1").parse().unwrap_or(1);
    let step: u64 = arg(5, "1000").parse().unwrap_or(1000);

    let mut body = Body::new();
    body.select_figure(&figure);
    body.set_load(0.5);
    let nerves: Vec<String> = body.nerve_names().map(str::to_owned).collect();

    println!(
        "{{\"version\": 2, \"width\": {cols}, \"height\": {rows}, \"env\": {{\"TERM\": \"xterm-256color\"}}}}"
    );
    let area = Rect::new(0, 0, cols, rows);
    // Simulate in 50 ms steps; fire a nerve every 250 ms and answer it a
    // second later, so pulses are in flight in every frame.
    let mut worst = Duration::ZERO;
    let mut clock = 0u64;
    let mut next = 0usize;
    for frame in 0..frames {
        let until = (frame as u64 + 1) * step;
        while clock < until {
            if clock.is_multiple_of(600) && !nerves.is_empty() {
                next = (next * 7 + 3) % nerves.len();
                if let Some(nerve) = nerves.get(next) {
                    body.fire(nerve, PulseKind::ToolStart);
                }
                if let Some(nerve) = nerves.get((next + nerves.len() / 2) % nerves.len()) {
                    let kind = if clock.is_multiple_of(3000) { PulseKind::Error } else { PulseKind::ToolResult };
                    body.fire(nerve, kind);
                }
            }
            body.tick(Duration::from_millis(50));
            clock += 50;
        }
        let mut buffer = Buffer::empty(area);
        let started = std::time::Instant::now();
        (&body).render(area, &mut buffer);
        worst = worst.max(started.elapsed());
        let text = ansi(&buffer, area);
        let time = frame as f64 * step as f64 / 1000.0;
        let escaped = serde_like(&text);
        println!("[{time:.3}, \"o\", \"{escaped}\"]");
    }
    eprintln!("{figure}: worst render {worst:?}");
}

fn serde_like(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\r' => out.push_str("\\r"),
            '\n' => out.push_str("\\n"),
            c if (c as u32) < 0x20 => {
                let _ = write!(out, "\\u{:04x}", c as u32);
            }
            c => out.push(c),
        }
    }
    out
}
