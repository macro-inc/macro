//! The 7 BODY pane, behind a small trait so the figure that fills it can be
//! swapped. The default is [`Vitals`]: a heartbeat trace and gauges of
//! activity by channel and by source.

#[cfg(feature = "mesh-man")]
pub mod mesh;

use std::collections::{HashMap, VecDeque};
use std::time::Duration;

use chrono::TimeDelta;
use ratatui::buffer::Buffer;
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::style::Style;
use ratatui::text::{Line, Span};
use ratatui::widgets::{Paragraph, Sparkline, Widget as _};

use agent_monitor::domain::model::{TapeEvent, TapeKind, Timestamp, Totals};

use crate::format;
use crate::theme;

/// What fills the BODY pane. The viewer feeds it every live tape line and
/// every totals update, ticks it while it animates, and renders it into its
/// pane each frame.
pub trait BodyPane: Send {
    /// A short name for the pane's title, such as `VITALS`.
    fn title(&self) -> &str;

    /// One new tape line, as it happens.
    fn event(&mut self, event: &TapeEvent);

    /// Tape lines a snapshot carried: already past, so they may fill counts
    /// but must not animate. Ignored unless a pane keeps counts.
    fn history(&mut self, events: &[TapeEvent]) {
        let _ = events;
    }

    /// New board numbers.
    fn totals(&mut self, totals: &Totals);

    /// Advances animation by `elapsed`.
    fn tick(&mut self, elapsed: Duration);

    /// Whether the next frames differ, so the viewer keeps its frame ticker on.
    fn animating(&self) -> bool;

    /// Draws into `area`.
    fn render(&self, area: Rect, buffer: &mut Buffer);
}

/// Seconds the rate gauges count over.
const RATE_WINDOW: TimeDelta = TimeDelta::seconds(60);

/// Samples kept for the heartbeat trace.
const TRACE_SAMPLES: usize = 64;

/// How fast gauges ease toward their target, per second.
const EASE_PER_SECOND: f32 = 4.0;

/// How long the flash on a channel lasts after an event.
const FLASH: Duration = Duration::from_millis(600);

/// Tracks one activity channel: recent event times, a gauge eased toward
/// the rate, and a flash after each event.
#[derive(Clone, Debug, Default)]
struct Channel {
    recent: VecDeque<Timestamp>,
    shown: f32,
    flash: Duration,
}

impl Channel {
    /// Counts one event; a live one also flashes the channel.
    fn hit(&mut self, at: Timestamp, live: bool) {
        self.recent.push_back(at);
        self.shown += 1.0;
        if live {
            self.flash = FLASH;
        }
    }

    /// Drops events older than the window ending at `latest`.
    fn prune(&mut self, latest: Timestamp) {
        while self
            .recent
            .front()
            .is_some_and(|at| *at < latest - RATE_WINDOW)
        {
            self.recent.pop_front();
        }
    }

    /// Events in the window ending at `latest`.
    fn rate(&self, latest: Timestamp) -> usize {
        self.recent
            .iter()
            .filter(|at| **at >= latest - RATE_WINDOW)
            .count()
    }
}

/// The named channels, in display order.
const CHANNELS: [&str; 5] = ["TOOL", "TURN", "SPWN", "ERR", "DONE"];

/// Source namespaces from agent ids, in display order.
const NAMESPACES: [&str; 5] = ["hc", "claude", "codex", "run", "demo"];

/// A vital-signs panel: a heartbeat whose rate follows tokens per minute, a
/// trace of activity, and gauges of tool calls, turns, spawns, errors and
/// exits, then activity by source.
#[derive(Clone, Debug)]
pub struct Vitals {
    channels: [Channel; CHANNELS.len()],
    namespaces: [Channel; NAMESPACES.len()],
    latest: Option<Timestamp>,
    trace: VecDeque<u16>,
    /// Events since the last trace sample.
    pending: u16,
    sample_clock: Duration,
    heart_phase: f32,
    tokens_per_min: u32,
    working: u32,
    /// Tool calls by tool name.
    tools: HashMap<String, Channel>,
}

impl Default for Vitals {
    fn default() -> Self {
        Self {
            channels: Default::default(),
            namespaces: Default::default(),
            latest: None,
            trace: VecDeque::from(vec![0; TRACE_SAMPLES]),
            pending: 0,
            sample_clock: Duration::ZERO,
            heart_phase: 0.0,
            tokens_per_min: 0,
            working: 0,
            tools: HashMap::new(),
        }
    }
}

/// How often the trace takes a sample.
const SAMPLE_EVERY: Duration = Duration::from_millis(250);

impl Vitals {
    fn bpm(&self) -> u32 {
        // Resting 48, rising with the log of tokens per minute.
        let tokens = f64::from(self.tokens_per_min.max(1));
        let bpm = 48.0 + tokens.log10() * 18.0;
        // Display value only; clamped to a heart's range first.
        bpm.clamp(48.0, 180.0) as u32
    }

    fn channel_index(kind: TapeKind) -> Option<usize> {
        let index = match kind {
            TapeKind::ToolStart | TapeKind::ToolEnd => 0,
            TapeKind::TurnStart | TapeKind::TurnEnd => 1,
            TapeKind::Spawned => 2,
            TapeKind::ToolError | TapeKind::Failure => 3,
            TapeKind::Finished | TapeKind::Removed => 4,
            TapeKind::Status => return None,
        };
        Some(index)
    }

    fn gauge_line(
        label: &str,
        channel: &Channel,
        rate: usize,
        max: usize,
        width: usize,
        color: ratatui::style::Color,
    ) -> Line<'static> {
        let bar_width = width.saturating_sub(13);
        let share = if max == 0 {
            0.0
        } else {
            channel.shown / max as f32
        };
        // Display rounding of a share in [0, 1].
        let filled = ((share.clamp(0.0, 1.0) * bar_width as f32).round() as usize).min(bar_width);
        let label_style = if channel.flash > Duration::ZERO {
            theme::bold(theme::YELLOW)
        } else {
            theme::ink(theme::DIM)
        };
        Line::from(vec![
            Span::styled(format::cell(label, 8), label_style),
            Span::styled("█".repeat(filled), theme::ink(color)),
            Span::styled("░".repeat(bar_width - filled), theme::ink(theme::GHOST)),
            Span::styled(
                format::right(&rate.to_string(), 5),
                theme::bold(theme::AMBER),
            ),
        ])
    }
}

impl Vitals {
    /// Counts a tape line into the rate channels; a `live` one flashes them.
    fn count(&mut self, event: &TapeEvent, live: bool) {
        let latest = self.latest.map_or(event.at, |latest| latest.max(event.at));
        self.latest = Some(latest);

        if let Some(index) = Self::channel_index(event.kind)
            && let Some(channel) = self.channels.get_mut(index)
        {
            channel.hit(event.at, live);
        }

        let namespace = event.agent.as_str().split(':').next().unwrap_or_default();
        if let Some(index) = NAMESPACES.iter().position(|name| *name == namespace)
            && let Some(channel) = self.namespaces.get_mut(index)
        {
            channel.hit(event.at, live);
        }
        if event.kind == TapeKind::ToolStart {
            let name = event.text.split_whitespace().next().unwrap_or_default();
            if !name.is_empty() {
                self.tools
                    .entry(name.to_owned())
                    .or_default()
                    .hit(event.at, live);
            }
        }
    }
}

impl BodyPane for Vitals {
    fn title(&self) -> &str {
        "VITALS"
    }

    fn event(&mut self, event: &TapeEvent) {
        self.count(event, true);
        self.pending = self.pending.saturating_add(1);
    }

    fn history(&mut self, events: &[TapeEvent]) {
        for event in events {
            self.count(event, false);
        }
    }

    fn totals(&mut self, totals: &Totals) {
        self.tokens_per_min = totals.tokens_per_min.last().copied().unwrap_or(0);
        self.working = totals.working;
    }

    fn tick(&mut self, elapsed: Duration) {
        let seconds = elapsed.as_secs_f32();
        let latest = self.latest;
        for channel in self
            .channels
            .iter_mut()
            .chain(self.namespaces.iter_mut())
            .chain(self.tools.values_mut())
        {
            if let Some(latest) = latest {
                channel.prune(latest);
            }
            // Display only: a per-minute count is far below f32's exact range.
            let target = latest.map_or(0, |latest| channel.rate(latest)) as f32;
            let ease = (EASE_PER_SECOND * seconds).min(1.0);
            channel.shown += (target - channel.shown) * ease;
            channel.flash = channel.flash.saturating_sub(elapsed);
        }

        self.heart_phase = (self.heart_phase + seconds * self.bpm() as f32 / 60.0).fract();

        self.sample_clock += elapsed;
        while self.sample_clock >= SAMPLE_EVERY {
            self.sample_clock -= SAMPLE_EVERY;
            self.trace.pop_front();
            self.trace.push_back(self.pending);
            self.pending = 0;
        }
    }

    fn animating(&self) -> bool {
        // The heart always beats; the pane only ticks while it is on screen.
        true
    }

    fn render(&self, area: Rect, buffer: &mut Buffer) {
        let width = usize::from(area.width);
        let beat = self.heart_phase < 0.18;
        let heart = if beat { "♥" } else { "♡" };
        let header = Line::from(vec![
            Span::styled(format!("{heart} "), theme::bold(theme::RED)),
            Span::styled(format!("{} BPM", self.bpm()), theme::bold(theme::YELLOW)),
            Span::styled(
                format!(
                    "  {} TOK/M",
                    format::compact(u64::from(self.tokens_per_min))
                ),
                theme::ink(theme::DIM),
            ),
            Span::styled(
                format!("  {} WORKING", self.working),
                theme::bold(theme::GREEN),
            ),
        ]);

        let [header_area, ecg_area, trace_area, rest] = Layout::vertical([
            Constraint::Length(1),
            Constraint::Length(3),
            Constraint::Length(2),
            Constraint::Min(0),
        ])
        .areas(area);
        Paragraph::new(header).render(header_area, buffer);

        // The ECG: each column is a moment `ECG_STEP` apart, ending now, read
        // off one heartbeat's waveform at the phase it had then.
        let beats_per_second = self.bpm() as f32 / 60.0;
        let ecg: Vec<u64> = (0..width)
            .map(|column| {
                let back = (width - column) as f32 * ECG_STEP.as_secs_f32();
                let phase = (self.heart_phase - back * beats_per_second).rem_euclid(1.0);
                waveform(phase)
            })
            .collect();
        Sparkline::default()
            .data(&ecg)
            .max(8)
            .style(theme::ink(theme::RED))
            .render(ecg_area, buffer);

        let trace: Vec<u64> = self.trace.iter().map(|value| u64::from(*value)).collect();
        let skip = trace.len().saturating_sub(width);
        Sparkline::default()
            .data(trace.get(skip..).unwrap_or_default())
            .style(theme::ink(theme::GREEN))
            .render(trace_area, buffer);

        let mut lines = Vec::new();
        let rates: Vec<usize> = self
            .channels
            .iter()
            .chain(self.namespaces.iter())
            .map(|channel| self.latest.map_or(0, |latest| channel.rate(latest)))
            .collect();
        let max = rates.iter().copied().max().unwrap_or(0).max(1);

        lines.push(Line::from(Span::styled(
            format::cell("EVENT      /MIN", width),
            theme::ink(theme::FAINT),
        )));
        let colors = [
            theme::CYAN,
            theme::AMBER,
            theme::GREEN,
            theme::RED,
            theme::DIM,
        ];
        for (index, (label, color)) in CHANNELS.iter().zip(colors).enumerate() {
            let (Some(channel), Some(rate)) = (self.channels.get(index), rates.get(index)) else {
                continue;
            };
            lines.push(Self::gauge_line(label, channel, *rate, max, width, color));
        }

        lines.push(Line::from(Span::styled(
            format::cell("SOURCE     /MIN", width),
            theme::ink(theme::FAINT),
        )));
        for (index, label) in NAMESPACES.iter().enumerate() {
            let offset = CHANNELS.len() + index;
            let (Some(channel), Some(rate)) = (self.namespaces.get(index), rates.get(offset))
            else {
                continue;
            };
            if *rate == 0 && channel.shown < 0.05 {
                continue;
            }
            lines.push(Self::gauge_line(
                label,
                channel,
                *rate,
                max,
                width,
                theme::YELLOW,
            ));
        }

        let mut tools: Vec<(&String, usize)> = self
            .tools
            .iter()
            .map(|(name, channel)| (name, self.latest.map_or(0, |latest| channel.rate(latest))))
            .filter(|(_, rate)| *rate > 0)
            .collect();
        tools.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(b.0)));
        if !tools.is_empty() {
            lines.push(Line::from(Span::styled(
                format::cell("TOOL       /MIN", width),
                theme::ink(theme::FAINT),
            )));
            let top = tools.first().map_or(1, |(_, rate)| *rate).max(1);
            for (name, rate) in tools.into_iter().take(TOP_TOOLS) {
                let room = width.saturating_sub(13);
                let filled = (rate * room).div_ceil(top).min(room);
                lines.push(Line::from(vec![
                    Span::styled(format::cell(name, 8), theme::ink(theme::CYAN)),
                    Span::styled("▮".repeat(filled), theme::ink(theme::CYAN)),
                    Span::styled(" ".repeat(room - filled), theme::base()),
                    Span::styled(
                        format::right(&rate.to_string(), 5),
                        theme::bold(theme::AMBER),
                    ),
                ]));
            }
        }

        Paragraph::new(lines)
            .style(Style::new().bg(theme::BG))
            .render(rest, buffer);
    }
}

/// Seconds between ECG columns.
const ECG_STEP: Duration = Duration::from_millis(40);

/// Tools listed by rate.
const TOP_TOOLS: usize = 6;

/// One heartbeat's trace at `phase` in `[0, 1)`, on a 0-8 scale: a baseline,
/// a small P wave, the tall QRS spike, then a T wave.
fn waveform(phase: f32) -> u64 {
    match phase {
        p if (0.08..0.14).contains(&p) => 3,
        p if (0.18..0.20).contains(&p) => 0,
        p if (0.20..0.23).contains(&p) => 8,
        p if (0.23..0.25).contains(&p) => 0,
        p if (0.36..0.46).contains(&p) => 4,
        _ => 1,
    }
}
