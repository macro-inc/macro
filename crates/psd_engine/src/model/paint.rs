//! What fills paint: colors, gradients, and patterns.

use super::*;
use serde::{Deserialize, Serialize};

/// A pattern the document's fills, overlays, and strokes can repeat.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Pattern {
    /// The id fills refer to it by.
    pub id: String,
    /// Its name.
    pub name: String,
    /// Width in pixels.
    pub width: u32,
    /// Height in pixels.
    pub height: u32,
    /// Straight RGBA samples, row by row.
    #[serde(skip)]
    pub rgba: Arc<[u8]>,
}

/// Gradient shapes.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GradientKind {
    /// Along a line.
    #[default]
    Linear,
    /// Out from a center.
    Radial,
    /// Around a center.
    Angle,
    /// Along a line, mirrored at its start.
    Reflected,
    /// Out from a center, in diamonds.
    Diamond,
}

/// A color stop of a gradient.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColorStop {
    /// Position along the gradient, `0..=1`.
    pub location: f32,
    /// Where between this stop and the next their colors mix evenly,
    /// as a fraction of the distance (`0.5` by default).
    pub midpoint: f32,
    /// The color.
    pub color: Rgb,
}

/// An opacity stop of a gradient.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpacityStop {
    /// Position along the gradient, `0..=1`.
    pub location: f32,
    /// As [`ColorStop::midpoint`].
    pub midpoint: f32,
    /// Opacity, `0..=1`.
    pub opacity: f32,
}

/// A gradient: its colors and opacities along `0..=1`, and how it is laid
/// over an area.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Gradient {
    /// Its name ("Foreground to Background").
    pub name: String,
    /// The shape.
    pub kind: GradientKind,
    /// Direction in degrees, counter-clockwise from pointing right.
    pub angle: f32,
    /// Size relative to the area it fills (`1.0` is 100%).
    pub scale: f32,
    /// Runs from the last stop to the first.
    pub reverse: bool,
    /// Dithered to hide banding.
    pub dither: bool,
    /// Laid over the layer's bounds rather than the canvas.
    pub align_with_layer: bool,
    /// Shift of the center, as fractions of the area's width and height.
    pub offset: (f32, f32),
    /// Smoothness of transitions, `0..=1` (Photoshop's default is 1).
    pub smoothness: f32,
    /// Color stops, by location.
    pub colors: Vec<ColorStop>,
    /// Opacity stops, by location.
    pub opacities: Vec<OpacityStop>,
}

impl Default for Gradient {
    fn default() -> Self {
        Gradient {
            name: "Black, White".into(),
            kind: GradientKind::Linear,
            angle: 90.0,
            scale: 1.0,
            reverse: false,
            dither: false,
            align_with_layer: true,
            offset: (0.0, 0.0),
            smoothness: 1.0,
            colors: vec![
                ColorStop {
                    location: 0.0,
                    midpoint: 0.5,
                    color: Rgb::BLACK,
                },
                ColorStop {
                    location: 1.0,
                    midpoint: 0.5,
                    color: Rgb::WHITE,
                },
            ],
            opacities: vec![
                OpacityStop {
                    location: 0.0,
                    midpoint: 0.5,
                    opacity: 1.0,
                },
                OpacityStop {
                    location: 1.0,
                    midpoint: 0.5,
                    opacity: 1.0,
                },
            ],
        }
    }
}

/// Where between two stops `t` (`0..=1` from the first to the second) lands
/// once the midpoint is applied: `0.5` at the midpoint.
fn midpoint_ramp(t: f32, midpoint: f32) -> f32 {
    let m = midpoint.clamp(0.001, 0.999);
    if t <= m {
        0.5 * t / m
    } else {
        0.5 + 0.5 * (t - m) / (1.0 - m)
    }
}

/// Interpolates stops `(location, midpoint, value)` at `t`.
fn interpolate<const N: usize>(
    stops: &[(f32, f32, [f32; N])],
    t: f32,
    smoothness: f32,
) -> [f32; N] {
    let Some(first) = stops.first() else {
        return [0.0; N];
    };
    if t <= first.0 {
        return first.2;
    }
    for w in stops.windows(2) {
        let (a, b) = (&w[0], &w[1]);
        if t <= b.0 {
            let span = b.0 - a.0;
            let local = if span <= f32::EPSILON {
                1.0
            } else {
                (t - a.0) / span
            };
            let mut k = midpoint_ramp(local, a.1);
            // Photoshop eases transitions as smoothness rises.
            let eased = k * k * (3.0 - 2.0 * k);
            k += (eased - k) * smoothness.clamp(0.0, 1.0) * 0.5;
            return std::array::from_fn(|i| a.2[i] + (b.2[i] - a.2[i]) * k);
        }
    }
    stops.last().expect("not empty").2
}

impl Gradient {
    /// The straight RGBA color (`0..=1`) at `t` along the gradient, before
    /// `reverse` is applied.
    pub fn sample(&self, t: f32) -> [f32; 4] {
        let t = t.clamp(0.0, 1.0);
        let colors: Vec<(f32, f32, [f32; 3])> = self
            .colors
            .iter()
            .map(|s| (s.location, s.midpoint, [s.color.r, s.color.g, s.color.b]))
            .collect();
        let opacities: Vec<(f32, f32, [f32; 1])> = self
            .opacities
            .iter()
            .map(|s| (s.location, s.midpoint, [s.opacity]))
            .collect();
        let [r, g, b] = if colors.is_empty() {
            [0.0; 3]
        } else {
            interpolate(&colors, t, self.smoothness)
        };
        let [a] = if opacities.is_empty() {
            [1.0]
        } else {
            interpolate(&opacities, t, self.smoothness)
        };
        [r, g, b, a]
    }

    /// 256 straight RGBA8 samples from start to end (with `reverse`
    /// applied), for drawing and gradient maps.
    pub fn lut(&self) -> Vec<[u8; 4]> {
        (0..256)
            .map(|i| {
                let mut t = i as f32 / 255.0;
                if self.reverse {
                    t = 1.0 - t;
                }
                let c = self.sample(t);
                let q = |v: f32| (v.clamp(0.0, 1.0) * 255.0).round() as u8;
                [q(c[0]), q(c[1]), q(c[2]), q(c[3])]
            })
            .collect()
    }
}

/// How a pattern repeats over an area.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatternFill {
    /// [`Pattern::id`] of the pattern.
    pub pattern: String,
    /// The pattern's name, as the file names it.
    pub name: String,
    /// Size (`1.0` is 100%).
    pub scale: f32,
    /// Rotation in degrees.
    pub angle: f32,
    /// Starts at the layer rather than the canvas.
    pub align_with_layer: bool,
    /// Shift of the first tile, in pixels.
    pub phase: (f32, f32),
}

/// What a fill layer, an overlay, or a stroke paints.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum Fill {
    /// One color.
    Solid {
        /// The color.
        color: Rgb,
    },
    /// A gradient.
    Gradient {
        /// The gradient.
        gradient: Gradient,
    },
    /// A repeated pattern.
    Pattern {
        /// The pattern.
        pattern: PatternFill,
    },
}
