//! The mesh man: a slowly turning wireframe human for a terminal, drawn in
//! braille on a ratatui [`Canvas`](ratatui::widgets::canvas::Canvas).
//!
//! He has a skin mesh, a skeleton inside it and a nervous system on top.
//! Callers drive him with [`Body::fire`] (a pulse along a nerve) and
//! [`Body::set_load`] (heartbeat and brightness), advance him with
//! [`Body::tick`], and draw him by rendering `&Body` as a widget.
//!
//! ```
//! use std::time::Duration;
//! use mesh_man::{Body, PulseKind};
//! use ratatui::{buffer::Buffer, layout::Rect, widgets::Widget};
//!
//! let mut body = Body::new();
//! body.set_load(0.5);
//! body.fire("left_median", PulseKind::ToolStart);
//! body.tick(Duration::from_millis(80));
//!
//! let area = Rect::new(0, 0, 44, 30);
//! let mut buffer = Buffer::empty(area);
//! (&body).render(area, &mut buffer);
//! ```

#![deny(missing_docs)]

use std::f32::consts::TAU;
use std::time::Duration;

#[cfg(feature = "demo-assets")]
mod assets;
mod figure;
mod figures;
mod model;
mod palette;
mod project;
mod pulse;
mod widget;

#[cfg(test)]
mod test;

pub use figure::{Core, Figure, FigureBuilder, catalog};
pub use palette::{Look, Palette, Rgb};
pub use pulse::PulseKind;

use pulse::{Flash, Pulse};

/// Seconds for one full turn.
const TURN_SECONDS: f32 = 30.0;

/// Seconds for the scan plane to sweep up the body and back down.
const SCAN_SECONDS: f32 = 9.0;

/// Seconds for a nerve's glow to fall to about a third after it fires.
const GLOW_SECONDS: f32 = 1.6;

/// Most pulses and flashes on the body at once; firing more drops the oldest,
/// so a burst of events can't grow a frame without bound.
const MAX_PULSES: usize = 64;
const MAX_FLASHES: usize = 32;

/// Heart rate at no load and at full load, in beats per minute.
const RESTING_BPM: f32 = 48.0;
const PEAK_BPM: f32 = 150.0;

/// The figure and everything that moves on it.
#[derive(Clone, Debug)]
pub struct Body {
    /// The figures it can wear; never empty.
    figures: Vec<Figure>,
    /// Index of the figure it wears now.
    current: usize,
    /// Current turn about the vertical axis, in radians, in `[0, 2π)`.
    angle: f32,
    /// Position in the current heartbeat, in `[0, 1)`.
    heart_phase: f32,
    /// Position of the scan plane in its up-and-down sweep, in `[0, 1)`.
    scan_phase: f32,
    load: f32,
    pulses: Vec<Pulse>,
    flashes: Vec<Flash>,
    /// Per nerve, how recently it fired: 1 just after, falling toward 0.
    glow: Vec<f32>,
    /// The colours the terminal can show.
    color_depth: ColorDepth,
    /// The colours the figure is drawn in.
    palette: Palette,
}

/// How many colours the terminal shows.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ColorDepth {
    /// 24-bit colour.
    #[default]
    TrueColor,
    /// The 256 indexed colours, for terminals without truecolor.
    Indexed,
}

impl ColorDepth {
    /// The depth a `COLORTERM` value announces: truecolor only for
    /// `truecolor` or `24bit`, as terminals set it.
    pub fn from_colorterm(colorterm: Option<&str>) -> Self {
        match colorterm.map(str::to_ascii_lowercase).as_deref() {
            Some("truecolor" | "24bit") => ColorDepth::TrueColor,
            _ => ColorDepth::Indexed,
        }
    }
}

impl Default for Body {
    fn default() -> Self {
        Self::new()
    }
}

impl Body {
    /// A figure facing the viewer, at rest, wearing the first of the
    /// built-in figures ([`catalog`]) and able to cycle through the rest.
    pub fn new() -> Self {
        Self::with_figures(catalog())
    }

    /// A body that cycles through `figures`, wearing the first. An empty list
    /// falls back to the built-in catalog.
    pub fn with_figures(figures: Vec<Figure>) -> Self {
        let figures = if figures.is_empty() {
            catalog()
        } else {
            figures
        };
        let glow = vec![0.0; figures.first().map_or(0, |figure| figure.nerves.len())];

        Self {
            figures,
            current: 0,
            angle: 0.0,
            heart_phase: 0.0,
            scan_phase: 0.0,
            load: 0.0,
            pulses: Vec::new(),
            flashes: Vec::new(),
            glow,
            color_depth: ColorDepth::default(),
            palette: Palette::DEFAULT,
        }
    }

    /// The figure it wears now.
    pub(crate) fn figure(&self) -> &Figure {
        // `figures` is never empty; `with_figures` guarantees it.
        self.figures
            .get(self.current)
            .or_else(|| self.figures.first())
            .unwrap_or_else(|| unreachable_figure())
    }

    /// The name of the figure it wears now, such as `MESH MAN`.
    pub fn figure_name(&self) -> &str {
        self.figure().name()
    }

    /// The index of the figure it wears now, from 0.
    pub fn figure_index(&self) -> usize {
        self.current
    }

    /// How many figures it can wear.
    pub fn figure_count(&self) -> usize {
        self.figures.len()
    }

    /// The names of all its figures, in order.
    pub fn figure_names(&self) -> impl Iterator<Item = &str> {
        self.figures.iter().map(Figure::name)
    }

    /// Switches to the next figure, wrapping round.
    pub fn next_figure(&mut self) {
        self.set_figure(self.current + 1);
    }

    /// Switches to the previous figure, wrapping round.
    pub fn prev_figure(&mut self) {
        self.set_figure(self.current + self.figures.len().saturating_sub(1));
    }

    /// Switches to figure `index` (wrapping round). Pulses and flashes in
    /// flight are dropped, since they ran along the old figure's nerves; the
    /// turn, heartbeat and load carry on.
    pub fn set_figure(&mut self, index: usize) {
        let index = index % self.figures.len().max(1);
        if index == self.current {
            return;
        }
        self.current = index;
        self.pulses.clear();
        self.flashes.clear();
        self.glow = vec![0.0; self.figure().nerves.len()];
    }

    /// Switches to the figure called `name` (ignoring case); returns whether
    /// there was one.
    pub fn select_figure(&mut self, name: &str) -> bool {
        let found = self
            .figures
            .iter()
            .position(|figure| figure.name().eq_ignore_ascii_case(name));
        if let Some(index) = found {
            self.set_figure(index);
        }
        found.is_some()
    }

    /// Draws with the colours a terminal of `depth` can show.
    pub fn set_color_depth(&mut self, depth: ColorDepth) {
        self.color_depth = depth;
    }

    /// Draws in `palette`'s colours: the dashboard's theme. Each figure's
    /// [`Look`] maps its parts onto the palette's roles, so a new palette
    /// recolours every figure.
    pub fn set_palette(&mut self, palette: Palette) {
        self.palette = palette;
    }

    /// The names of the current figure's nerves. For the default figure, in
    /// a fixed order: `spinal_cord`; then for the
    /// left side and then the right, the arm nerves (`left_radial`,
    /// `left_median`, `left_ulnar`), the rib nerves (`left_intercostal_1` to
    /// `_4`), the leg nerves (`left_tibial`, `left_peroneal`,
    /// `left_femoral`) and `left_optic`; then `vagus`.
    pub fn nerve_names(&self) -> impl Iterator<Item = &str> {
        self.figure().nerves.iter().map(|nerve| nerve.name.as_str())
    }

    /// Fires a nerve. `key` is either a nerve name from [`Body::nerve_names`]
    /// or any other stable key (an agent id), which maps to one nerve by hash
    /// (see [`Body::nerve_for`]).
    pub fn fire(&mut self, key: &str, kind: PulseKind) {
        let nerve = self.nerve_index(key);
        let figure = self.figure();
        if nerve >= figure.nerves.len() {
            return;
        }

        if kind.travels() {
            // A forking figure sends pulses down the nerve's whole group:
            // they run together along the shared trunk and part where the
            // paths do.
            let group = match figure.forks.get(nerve) {
                Some(group) if group.contains(&nerve) => group.clone(),
                _ => vec![nerve],
            };
            let pulses: Vec<Pulse> = group
                .iter()
                .filter_map(|index| {
                    let length = figure.nerves.get(*index)?.length();
                    Some(Pulse::new(*index, kind, length))
                })
                .collect();
            for pulse in pulses {
                if self.pulses.len() >= MAX_PULSES {
                    self.pulses.remove(0);
                }
                self.pulses.push(pulse);
            }
        }

        // Only the nerve fired flashes and glows.
        if kind.flashes() {
            if self.flashes.len() >= MAX_FLASHES {
                self.flashes.remove(0);
            }
            self.flashes.push(Flash {
                nerve,
                kind,
                age: 0.0,
            });
        }

        if let Some(glow) = self.glow.get_mut(nerve) {
            *glow = 1.0;
        }
    }

    /// Sets how busy things are, from 0 (idle) to 1 (flat out); values
    /// outside are clamped. It sets the heart rate and how bright the
    /// skeleton and nerves are.
    pub fn set_load(&mut self, load: f32) {
        self.load = if load.is_nan() {
            0.0
        } else {
            load.clamp(0.0, 1.0)
        };
    }

    /// Advances time: the turn, the heartbeat, pulses, flashes and glow.
    pub fn tick(&mut self, elapsed: Duration) {
        let seconds = elapsed.as_secs_f32();

        self.angle = (self.angle + seconds * TAU / TURN_SECONDS).rem_euclid(TAU);
        self.heart_phase = (self.heart_phase + seconds * self.heart_rate() / 60.0).fract();
        self.scan_phase = (self.scan_phase + seconds / SCAN_SECONDS).fract();

        let nerves = self
            .figures
            .get(self.current)
            .map_or(&[][..], |figure| figure.nerves.as_slice());
        self.pulses.retain_mut(|pulse| {
            let length = nerves.get(pulse.nerve).map_or(0.0, |path| path.length());
            pulse.advance(seconds, length)
        });
        self.flashes.retain_mut(|flash| flash.advance(seconds));

        let fade = (-seconds / GLOW_SECONDS).exp();
        for glow in &mut self.glow {
            *glow *= fade;
        }
    }

    /// Heart rate for the current load, in beats per minute.
    pub fn heart_rate(&self) -> f32 {
        RESTING_BPM + (PEAK_BPM - RESTING_BPM) * self.load
    }

    /// The name of the nerve [`Body::fire`] uses for `key`: the nerve of that
    /// name, or one picked by a stable hash of the key. Several keys can share
    /// a nerve, and adding a nerve to the figure moves hashed keys.
    pub fn nerve_for(&self, key: &str) -> &str {
        self.figure()
            .nerves
            .get(self.nerve_index(key))
            .map_or("", |nerve| nerve.name.as_str())
    }

    /// The index of the nerve a key fires.
    fn nerve_index(&self, key: &str) -> usize {
        if let Some(index) = self
            .figure()
            .nerves
            .iter()
            .position(|nerve| nerve.name == key)
        {
            return index;
        }

        // FNV-1a: stable across runs and platforms, unlike std's hasher.
        let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
        for byte in key.bytes() {
            hash ^= u64::from(byte);
            hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
        }

        let count = self.figure().nerves.len().max(1) as u64;
        usize::try_from(hash % count).unwrap_or(0)
    }
}

/// Never reached: a body always has a figure. Builds the default rather than
/// panicking.
fn unreachable_figure() -> &'static Figure {
    static FALLBACK: std::sync::LazyLock<Figure> = std::sync::LazyLock::new(model::mesh_man);
    &FALLBACK
}
