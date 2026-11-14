//! The mesh man alone, turning, with random nerve activity.
//!
//! `cargo run -p mesh_man --example spin [-- --figure NAME]`; `b` / `B`
//! cycle figures, `q`, Esc or Ctrl-C quits.

use std::collections::VecDeque;
use std::io;
use std::time::{Duration, Instant};

use clap::Parser;
use mesh_man::{Body, PulseKind};
use rand::Rng;
use rand::seq::IndexedRandom;
use ratatui::DefaultTerminal;
use ratatui::crossterm::event::{self, Event, KeyCode, KeyEventKind, KeyModifiers};
use ratatui::layout::{Constraint, Layout};
use ratatui::style::{Color, Style, Stylize};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Paragraph};

const FRAME: Duration = Duration::from_millis(50);
const TAPE_LINES: usize = 4;

const BLACK: Color = Color::Rgb(0, 0, 0);
const ORANGE: Color = Color::Rgb(255, 138, 0);
const AMBER: Color = Color::Rgb(255, 165, 43);
const AMBER_DIM: Color = Color::Rgb(194, 123, 28);
const YELLOW: Color = Color::Rgb(255, 225, 77);
const CYAN: Color = Color::Rgb(79, 211, 255);
const GREEN: Color = Color::Rgb(34, 229, 92);
const RED: Color = Color::Rgb(255, 59, 59);

/// A tool call in flight: its result fires back when it is due.
struct Pending {
    nerve: String,
    due: Duration,
    fails: bool,
}

/// The mesh man alone, turning.
#[derive(Parser)]
struct Args {
    /// Figure to start on: a name (any case) or a 1-based number.
    #[arg(long)]
    figure: Option<String>,
}

struct Demo {
    body: Body,
    nerves: Vec<String>,
    pending: Vec<Pending>,
    tape: VecDeque<(Duration, String, PulseKind)>,
    started: Instant,
    load: f32,
}

impl Demo {
    fn new(figure: Option<&str>) -> Self {
        let mut body = Body::new();
        if let Some(figure) = figure
            && !body.select_figure(figure)
            && let Ok(number) = figure.parse::<usize>()
        {
            body.set_figure(number.saturating_sub(1));
        }
        let nerves = body.nerve_names().map(str::to_owned).collect();
        Self {
            body,
            nerves,
            pending: Vec::new(),
            tape: VecDeque::new(),
            started: Instant::now(),
            load: 0.3,
        }
    }

    /// Changes figure; calls in flight are forgotten, since their nerves
    /// belong to the old figure.
    fn switch(&mut self, change: fn(&mut Body)) {
        change(&mut self.body);
        self.nerves = self.body.nerve_names().map(str::to_owned).collect();
        self.pending.clear();
    }

    fn fire(&mut self, now: Duration, nerve: &str, kind: PulseKind) {
        self.body.fire(nerve, kind);
        self.tape.push_front((now, nerve.to_owned(), kind));
        self.tape.truncate(TAPE_LINES);
    }

    /// Starts tool calls at random, returns their results a second or three
    /// later (some failing), and ends turns now and then.
    fn step(&mut self, elapsed: Duration) {
        let now = self.started.elapsed();
        let mut rng = rand::rng();

        // Load wanders, so the heart rate and brightness drift.
        self.load = (self.load + rng.random_range(-0.02..0.02)).clamp(0.05, 1.0);
        self.body.set_load(self.load);

        if rng.random_bool(0.06 + 0.12 * f64::from(self.load))
            && let Some(nerve) = self.nerves.choose(&mut rng).cloned()
        {
            self.fire(now, &nerve, PulseKind::ToolStart);
            self.pending.push(Pending {
                nerve,
                due: now + Duration::from_millis(rng.random_range(1200..3200)),
                fails: rng.random_bool(0.15),
            });
        }

        let (due, waiting): (Vec<Pending>, Vec<Pending>) =
            self.pending.drain(..).partition(|call| call.due <= now);
        self.pending = waiting;
        for call in due {
            let kind = if call.fails {
                PulseKind::Error
            } else {
                PulseKind::ToolResult
            };
            self.fire(now, &call.nerve, kind);
        }

        if rng.random_bool(0.012)
            && let Some(nerve) = self.nerves.choose(&mut rng).cloned()
        {
            self.fire(now, &nerve, PulseKind::TurnEnd);
        }

        self.body.tick(elapsed);
    }
}

fn kind_label(kind: PulseKind) -> (&'static str, Color) {
    match kind {
        PulseKind::ToolStart => ("TOOL ", CYAN),
        PulseKind::ToolResult => ("OK   ", GREEN),
        PulseKind::Error => ("ERROR", RED),
        PulseKind::TurnEnd => ("TURN ", YELLOW),
    }
}

fn draw(terminal: &mut DefaultTerminal, demo: &Demo) -> io::Result<()> {
    terminal.draw(|frame| {
        let [title, body, tape] = Layout::vertical([
            Constraint::Length(1),
            Constraint::Min(8),
            Constraint::Length(TAPE_LINES as u16 + 2),
        ])
        .areas(frame.area());

        frame.render_widget(Block::new().style(Style::new().bg(BLACK)), frame.area());

        let bpm = demo.body.heart_rate();
        let heading = Line::from(vec![
            Span::raw(" MESH MAN ").fg(BLACK).bg(ORANGE).bold(),
            Span::raw(format!(
                "  [{}/{}] {} ",
                demo.body.figure_index() + 1,
                demo.body.figure_count(),
                demo.body.figure_name()
            ))
            .fg(AMBER)
            .bold(),
            Span::raw(format!(" LOAD {:>3.0}% ", demo.load * 100.0)).fg(YELLOW),
            Span::raw(format!(" HR {bpm:>3.0} ")).fg(RED),
            Span::raw(format!(" CALLS {:>2} ", demo.pending.len())).fg(CYAN),
            Span::raw("  b/B FIGURE  q QUIT").fg(AMBER_DIM),
        ]);
        frame.render_widget(Paragraph::new(heading).bg(BLACK), title);

        frame.render_widget(&demo.body, body);

        let lines: Vec<Line> = demo
            .tape
            .iter()
            .map(|(at, nerve, kind)| {
                let (label, color) = kind_label(*kind);
                Line::from(vec![
                    Span::raw(format!(" {:>7.2}s ", at.as_secs_f32())).fg(AMBER_DIM),
                    Span::raw(label).fg(color).bold(),
                    Span::raw(format!("  {nerve}")).fg(AMBER),
                ])
            })
            .collect();
        let block = Block::bordered()
            .title(" TAPE ")
            .border_style(Style::new().fg(AMBER_DIM))
            .title_style(Style::new().fg(BLACK).bg(ORANGE).bold());
        frame.render_widget(Paragraph::new(lines).block(block).bg(BLACK), tape);
    })?;
    Ok(())
}

fn run(terminal: &mut DefaultTerminal, figure: Option<&str>) -> io::Result<()> {
    let mut demo = Demo::new(figure);
    let mut last = Instant::now();

    loop {
        draw(terminal, &demo)?;

        let deadline = last + FRAME;
        while event::poll(deadline.saturating_duration_since(Instant::now()))? {
            if let Event::Key(key) = event::read()? {
                let ctrl_c =
                    key.code == KeyCode::Char('c') && key.modifiers.contains(KeyModifiers::CONTROL);
                let quit = matches!(key.code, KeyCode::Char('q') | KeyCode::Esc) || ctrl_c;
                if key.kind == KeyEventKind::Press && quit {
                    return Ok(());
                }
                if key.kind == KeyEventKind::Press {
                    match key.code {
                        KeyCode::Char('b') => demo.switch(Body::next_figure),
                        KeyCode::Char('B') => demo.switch(Body::prev_figure),
                        _ => {}
                    }
                }
            }
        }

        let now = Instant::now();
        demo.step(now - last);
        last = now;
    }
}

fn main() -> io::Result<()> {
    let args = Args::parse();
    let mut terminal = ratatui::init();
    let result = run(&mut terminal, args.figure.as_deref());
    ratatui::restore();
    result
}
