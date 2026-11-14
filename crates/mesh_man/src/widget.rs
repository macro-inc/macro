//! Drawing the body: rotate, project, and paint in depth layers.
//!
//! A braille cell holds one colour, and a later canvas layer replaces an
//! earlier one's cell outright. Painting far to near is therefore the depth
//! cue. The order is in the layer constants below: the turntable, far skin,
//! far bones, near skin, resting nerves, near bones, firing nerves, the scan
//! slice, the heart, then pulses and flashes on top.

use std::f32::consts::{PI, TAU};

use glam::{Vec2, Vec3};
use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::Color;
use ratatui::symbols::Marker;
use ratatui::widgets::Widget;
use ratatui::widgets::canvas::{Canvas, Line};

use crate::{Body, ColorDepth};
use crate::model::Tissue;
use crate::project::{CAMERA_DISTANCE, TILT, View, project};
use crate::pulse::{FLASH_SECONDS, PulseKind};

type Rgb = (u8, u8, u8);

const AMBER: Rgb = (255, 165, 43);
const AMBER_DIM: Rgb = (194, 123, 28);
const AMBER_FAINT: Rgb = (122, 80, 22);
const AMBER_DARK: Rgb = (74, 48, 14);
const YELLOW: Rgb = (255, 225, 77);
const CYAN: Rgb = (79, 211, 255);
const CYAN_HOT: Rgb = (205, 245, 255);
const CYAN_DIM: Rgb = (28, 98, 122);
const CYAN_DARK: Rgb = (16, 56, 70);
const RED: Rgb = (255, 59, 59);
const RED_DARK: Rgb = (110, 22, 22);
const GREEN: Rgb = (34, 229, 92);
const WHITE: Rgb = (255, 255, 255);
const BONE_IDLE: Rgb = (150, 150, 155);
const BONE_FAR: Rgb = (70, 70, 76);
const BONE_FAR_BUSY: Rgb = (125, 125, 130);

/// Half the canvas height in figure units: the figure (2.0) plus the
/// turntable under his feet and room for perspective.
const HALF_HEIGHT: f64 = 1.2;

/// The narrowest half width, so a tall thin pane still fits his arms.
const MIN_HALF_WIDTH: f64 = 0.62;

/// The turntable under the feet: radius and how many ticks mark it.
const TURNTABLE_RADIUS: f32 = 0.45;
const TURNTABLE_TICKS: usize = 24;
const TURNTABLE_Y: f32 = -1.0;

/// Distance between a pulse's head and each of its three tail marks.
const TAIL_STEP: f32 = 0.05;

/// Points around the heart loop.
const HEART_POINTS: usize = 20;

fn mix(a: Rgb, b: Rgb, t: f32) -> Rgb {
    let t = t.clamp(0.0, 1.0);
    let channel = |x: u8, y: u8| {
        let value = f32::from(x) + (f32::from(y) - f32::from(x)) * t;
        value.round().clamp(0.0, 255.0) as u8
    };
    (channel(a.0, b.0), channel(a.1, b.1), channel(a.2, b.2))
}

/// The levels of each channel in the xterm 256-colour cube (indexes 16-231).
const CUBE_LEVELS: [u8; 6] = [0, 95, 135, 175, 215, 255];

/// The colour as the terminal can show it: itself on a truecolor terminal,
/// else the nearest of the 256 indexed colours (the 6x6x6 cube or the
/// 24-step grey ramp).
fn color(rgb: Rgb, depth: ColorDepth) -> Color {
    match depth {
        ColorDepth::TrueColor => Color::Rgb(rgb.0, rgb.1, rgb.2),
        ColorDepth::Indexed => Color::Indexed(indexed(rgb)),
    }
}

/// The nearest xterm 256-colour index to `rgb`.
pub(crate) fn indexed(rgb: Rgb) -> u8 {
    let nearest_level = |value: u8| {
        CUBE_LEVELS
            .iter()
            .enumerate()
            .min_by_key(|(_, level)| level.abs_diff(value))
            .map_or(0, |(index, _)| index)
    };
    let (r, g, b) = (nearest_level(rgb.0), nearest_level(rgb.1), nearest_level(rgb.2));
    let level = |index: usize| CUBE_LEVELS.get(index).copied().unwrap_or(0);
    let cube = (level(r), level(g), level(b));

    // Greys 232-255 run from 8 to 238 in steps of 10.
    let mean = (u16::from(rgb.0) + u16::from(rgb.1) + u16::from(rgb.2)) / 3;
    let grey_step = (mean.saturating_sub(3) / 10).min(23);
    let grey_value = u8::try_from(8 + grey_step * 10).unwrap_or(u8::MAX);
    let grey = (grey_value, grey_value, grey_value);

    let distance = |other: Rgb| {
        let channel = |a: u8, b: u8| u32::from(a.abs_diff(b)).pow(2);
        channel(rgb.0, other.0) + channel(rgb.1, other.1) + channel(rgb.2, other.2)
    };
    if distance(grey) < distance(cube) {
        232 + u8::try_from(grey_step).unwrap_or(23)
    } else {
        let index = 16 + 36 * r + 6 * g + b;
        u8::try_from(index).unwrap_or(u8::MAX)
    }
}

/// The two-beat shape of a heartbeat over one phase: a strong beat, then a
/// weaker one just after.
fn beat(phase: f32) -> f32 {
    const WIDTH: f32 = 0.07;
    let first = (-(phase / WIDTH).powi(2)).exp() + (-((phase - 1.0) / WIDTH).powi(2)).exp();
    let second = 0.6 * (-((phase - 0.2) / 0.06).powi(2)).exp();
    (first + second).min(1.0)
}

/// Canvas lines, grouped into layers painted in order.
struct Frame {
    view: View,
    depth: ColorDepth,
    layers: Vec<Vec<Line>>,
}

impl Frame {
    fn new(view: View, depth: ColorDepth, layer_count: usize) -> Self {
        Self {
            view,
            depth,
            layers: (0..layer_count).map(|_| Vec::new()).collect(),
        }
    }

    fn screen(&self, point: Vec3) -> Vec2 {
        project(self.view.transform(point), CAMERA_DISTANCE)
    }

    /// Adds a figure-space segment to a layer.
    fn line(&mut self, layer: usize, a: Vec3, b: Vec3, rgb: Rgb) {
        let a = self.screen(a);
        let b = self.screen(b);
        self.screen_line(layer, a, b, rgb);
    }

    /// Adds a screen-space segment to a layer.
    fn screen_line(&mut self, layer: usize, a: Vec2, b: Vec2, rgb: Rgb) {
        if let Some(lines) = self.layers.get_mut(layer) {
            lines.push(Line::new(
                f64::from(a.x),
                f64::from(a.y),
                f64::from(b.x),
                f64::from(b.y),
                color(rgb, self.depth),
            ));
        }
    }

    /// A small screen-space ring of `radius` around `centre`.
    fn ring(&mut self, layer: usize, centre: Vec2, radius: f32, sides: usize, rgb: Rgb) {
        for k in 0..sides {
            let a = k as f32 / sides as f32 * TAU;
            let b = (k + 1) as f32 / sides as f32 * TAU;
            self.screen_line(
                layer,
                centre + Vec2::new(a.cos(), a.sin()) * radius,
                centre + Vec2::new(b.cos(), b.sin()) * radius,
                rgb,
            );
        }
    }
}

// Layers, far to near. Resting nerves sit under the near bones so the
// skeleton reads; a nerve that has just fired moves on top of everything.
const FLOOR: usize = 0;
const SKIN_FAR: usize = 1;
const BONE_FAR_LAYER: usize = 2;
const SKIN_NEAR: usize = 3;
const NERVES_RESTING: usize = 4;
const BONE_NEAR: usize = 5;
const NERVES_FIRING: usize = 6;
const SCAN: usize = 7;
const HEART: usize = 8;
const PULSES: usize = 9;
const LAYERS: usize = 10;

/// Bones and nerves lie near the body's centre, so the plain near/far split
/// would flicker a centred bone between layers as he turns. They count as
/// near unless clearly in the back half.
const INNER_DEPTH: f32 = -0.04;

/// Half the width of a scan tick, in figure units.
const SCAN_TICK: f32 = 0.012;

/// Glow above which a nerve draws over the bones.
const FIRING_GLOW: f32 = 0.12;

impl Body {
    fn frame(&self) -> Frame {
        let mut frame = Frame::new(View::new(self.angle, TILT), self.color_depth, LAYERS);
        let load = self.load;

        self.draw_turntable(&mut frame);

        let bone_near = mix(BONE_IDLE, WHITE, load);
        let bone_far = mix(BONE_FAR, BONE_FAR_BUSY, load);
        let skin_near = mix(AMBER_DIM, AMBER, load * 0.35);
        let scan = self.scan_height();
        for segment in &self.model.segments {
            let depth = frame.view.depth((segment.a + segment.b) * 0.5);
            let (layer, rgb) = match segment.tissue {
                Tissue::Skin if depth >= 0.0 => (SKIN_NEAR, skin_near),
                Tissue::Skin => (SKIN_FAR, AMBER_FAINT),
                Tissue::Bone if depth >= INNER_DEPTH => (BONE_NEAR, bone_near),
                Tissue::Bone => (BONE_FAR_LAYER, bone_far),
            };
            frame.line(layer, segment.a, segment.b, rgb);

            // Where a skin line crosses the scan plane, a bright tick: the
            // ticks together trace the body's outline at that height.
            let below = segment.a.y - scan;
            let above = segment.b.y - scan;
            if segment.tissue == Tissue::Skin && below * above < 0.0 {
                let crossing = segment.a.lerp(segment.b, below / (below - above));
                let rgb = if depth >= 0.0 { YELLOW } else { AMBER_DIM };
                let centre = frame.screen(crossing);
                frame.screen_line(
                    SCAN,
                    centre - Vec2::X * SCAN_TICK,
                    centre + Vec2::X * SCAN_TICK,
                    rgb,
                );
            }
        }

        self.draw_nerves(&mut frame);
        self.draw_heart(&mut frame);
        self.draw_pulses(&mut frame);

        frame
    }

    /// Height of the scan plane: it sweeps from the feet to the crown and
    /// back, easing at each end.
    fn scan_height(&self) -> f32 {
        let wave = (1.0 - (self.scan_phase * TAU).cos()) / 2.0;
        -0.98 + 1.96 * wave
    }

    /// A ring of ticks under the feet that turns with him, so the turn reads
    /// even when he faces square on.
    fn draw_turntable(&self, frame: &mut Frame) {
        let centre = Vec3::new(0.0, TURNTABLE_Y, 0.0);
        let point = |angle: f32, radius: f32| {
            centre + Vec3::new(radius * angle.cos(), 0.0, radius * angle.sin())
        };

        let sides = TURNTABLE_TICKS * 2;
        for k in 0..sides {
            let a = k as f32 / sides as f32 * TAU;
            let b = (k + 1) as f32 / sides as f32 * TAU;
            let near = frame.view.depth(point((a + b) / 2.0, TURNTABLE_RADIUS)) >= 0.0;
            let rgb = if near { AMBER_FAINT } else { AMBER_DARK };
            frame.line(
                FLOOR,
                point(a, TURNTABLE_RADIUS),
                point(b, TURNTABLE_RADIUS),
                rgb,
            );
        }

        for k in 0..TURNTABLE_TICKS {
            let angle = k as f32 / TURNTABLE_TICKS as f32 * TAU;
            let long = k % 6 == 0;
            let inner = if long { 0.36 } else { 0.41 };
            let near = frame.view.depth(point(angle, TURNTABLE_RADIUS)) >= 0.0;
            let rgb = match (long, near) {
                (true, true) => AMBER,
                (true, false) | (false, true) => AMBER_FAINT,
                (false, false) => AMBER_DARK,
            };
            frame.line(
                FLOOR,
                point(angle, inner),
                point(angle, TURNTABLE_RADIUS),
                rgb,
            );
        }
    }

    fn draw_nerves(&self, frame: &mut Frame) {
        let load = self.load;
        let near_base = mix(CYAN_DARK, CYAN, 0.2 + 0.5 * load);
        let far_base = mix(CYAN_DARK, CYAN_DIM, load);
        let heartbeat = beat(self.heart_phase);

        let hottest = self.glow.iter().copied().fold(0.0_f32, f32::max);
        let brain = mix(
            mix(CYAN_DIM, CYAN, 0.4 + 0.6 * load),
            CYAN_HOT,
            hottest * 0.6,
        );
        for (a, b) in &self.model.brain {
            frame.line(NERVES_FIRING, *a, *b, brain);
        }

        for (index, nerve) in self.model.nerves.iter().enumerate() {
            let mut glow = self.glow.get(index).copied().unwrap_or(0.0);
            if nerve.name == "vagus" {
                glow = glow.max(heartbeat * (0.3 + 0.5 * load));
            }

            let layer = if glow > FIRING_GLOW {
                NERVES_FIRING
            } else {
                NERVES_RESTING
            };
            for pair in nerve.points.windows(2) {
                let near = frame.view.depth((pair[0] + pair[1]) * 0.5) >= INNER_DEPTH;
                let base = if near { near_base } else { far_base };
                frame.line(layer, pair[0], pair[1], mix(base, CYAN_HOT, glow));
            }
        }
    }

    /// A heart-shaped loop at the end of the vagus nerve, swelling on each
    /// beat.
    fn draw_heart(&self, frame: &mut Frame) {
        let heartbeat = beat(self.heart_phase);
        let size = 0.0022 * (1.0 + 0.4 * heartbeat);
        let rgb = mix(RED_DARK, RED, 0.35 + 0.65 * heartbeat);

        let points: Vec<Vec3> = (0..HEART_POINTS)
            .map(|k| {
                let t = k as f32 / HEART_POINTS as f32 * TAU;
                let x = 16.0 * t.sin().powi(3);
                let y = 13.0 * t.cos()
                    - 5.0 * (2.0 * t).cos()
                    - 2.0 * (3.0 * t).cos()
                    - (4.0 * t).cos();
                self.model.heart + Vec3::new(x, y, 0.0) * size
            })
            .collect();

        for (index, a) in points.iter().enumerate() {
            let b = points
                .get((index + 1) % points.len())
                .copied()
                .unwrap_or(*a);
            frame.line(HEART, *a, b, rgb);
        }
    }

    fn draw_pulses(&self, frame: &mut Frame) {
        for pulse in &self.pulses {
            let Some(nerve) = self.model.nerves.get(pulse.nerve) else {
                continue;
            };

            let head_rgb = match pulse.kind {
                PulseKind::ToolStart | PulseKind::TurnEnd => YELLOW,
                PulseKind::ToolResult => GREEN,
                PulseKind::Error => RED,
            };
            let behind = if pulse.kind.is_inward() {
                TAIL_STEP
            } else {
                -TAIL_STEP
            };

            // Tail first, faintest farthest back, so the head wins its cell.
            for step in (0..3).rev() {
                let near_end = pulse.position + behind * step as f32;
                let far_end = near_end + behind;
                let fade = 0.3 + 0.25 * (2 - step) as f32;
                frame.line(
                    PULSES,
                    nerve.point_at(far_end),
                    nerve.point_at(near_end),
                    mix(CYAN_DARK, head_rgb, fade),
                );
            }

            let head = frame.screen(nerve.point_at(pulse.position));
            let arm = 0.024;
            frame.screen_line(PULSES, head - Vec2::X * arm, head + Vec2::X * arm, head_rgb);
            frame.screen_line(PULSES, head - Vec2::Y * arm, head + Vec2::Y * arm, head_rgb);
        }

        for flash in &self.flashes {
            let Some(nerve) = self.model.nerves.get(flash.nerve) else {
                continue;
            };

            let progress = (flash.age / FLASH_SECONDS).clamp(0.0, 1.0);
            let hue = if flash.kind == PulseKind::Error {
                RED
            } else {
                AMBER
            };
            let rgb = if progress < 0.25 {
                mix(WHITE, hue, progress * 4.0)
            } else {
                mix(hue, AMBER_DARK, (progress - 0.25) / 0.75)
            };

            let centre = frame.screen(nerve.end());
            let radius = 0.025 + 0.09 * progress;
            frame.ring(PULSES, centre, radius, 12, rgb);

            // Four spokes, turned a little as the burst grows.
            for k in 0..4 {
                let angle = k as f32 * PI / 2.0 + progress;
                let direction = Vec2::new(angle.cos(), angle.sin());
                frame.screen_line(
                    PULSES,
                    centre + direction * radius * 0.4,
                    centre + direction * radius * 1.35,
                    rgb,
                );
            }
        }
    }
}

/// Renders the body to fill `area`, keeping braille dots square: a dot is
/// half a cell wide and a quarter of a cell high, and a cell is about twice
/// as tall as it is wide.
impl Widget for &Body {
    fn render(self, area: Rect, buffer: &mut Buffer) {
        // The canvas indexes the buffer directly; never let it reach outside.
        let area = area.intersection(buffer.area);
        if area.width == 0 || area.height == 0 {
            return;
        }

        let columns = f64::from(area.width);
        let rows = f64::from(area.height);
        let mut half_height = HALF_HEIGHT;
        let mut half_width = half_height * columns / (2.0 * rows);
        if half_width < MIN_HALF_WIDTH {
            half_height *= MIN_HALF_WIDTH / half_width;
            half_width = MIN_HALF_WIDTH;
        }

        // The canvas paints its whole area with one background; keep the one
        // the caller already put there (taken from the top-left cell, so a
        // uniform background survives).
        let background = buffer
            .cell((area.x, area.y))
            .map_or(Color::Reset, |cell| cell.bg);

        let frame = self.frame();
        Canvas::default()
            .background_color(background)
            .marker(Marker::Braille)
            .x_bounds([-half_width, half_width])
            .y_bounds([-half_height, half_height])
            .paint(|context| {
                for layer in &frame.layers {
                    for line in layer {
                        context.draw(line);
                    }
                    context.layer();
                }
            })
            .render(area, buffer);
    }
}
