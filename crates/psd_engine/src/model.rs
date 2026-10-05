//! The document model: a canvas and its layer tree, with every property the
//! engine renders and edits in typed form.
//!
//! Layers live in an arena ([`Document::layers`]) and refer to each other by
//! [`LayerIdx`]. Stacks (the document's [`Document::roots`] and a group's
//! children) list layers bottom to top, as Photoshop files store them.
//! Removed layers stay in the arena, out of every stack, so undo and other
//! people's changes can bring them back.
//!
//! Colors are straight sRGB in `0..=1`; positions are canvas pixels.

use crate::raster::{IRect, Raster};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

/// Index of a layer in [`Document::layers`].
pub type LayerIdx = u32;

/// The color mode a file stores its pixels in.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ColorMode {
    /// One bit per pixel.
    Bitmap,
    /// One gray channel.
    Grayscale,
    /// Indices into a 256-color palette.
    Indexed,
    /// Red, green, and blue.
    Rgb,
    /// Cyan, magenta, yellow, and black.
    Cmyk,
    /// Channels without a color model.
    Multichannel,
    /// Gray with ink curves.
    Duotone,
    /// CIE L*a*b*.
    Lab,
}

impl ColorMode {
    /// The mode stored in a file header.
    pub fn from_code(code: u16) -> Option<ColorMode> {
        Some(match code {
            0 => ColorMode::Bitmap,
            1 => ColorMode::Grayscale,
            2 => ColorMode::Indexed,
            3 => ColorMode::Rgb,
            4 => ColorMode::Cmyk,
            7 => ColorMode::Multichannel,
            8 => ColorMode::Duotone,
            9 => ColorMode::Lab,
            _ => return None,
        })
    }

    /// The header code of the mode.
    pub fn code(self) -> u16 {
        match self {
            ColorMode::Bitmap => 0,
            ColorMode::Grayscale => 1,
            ColorMode::Indexed => 2,
            ColorMode::Rgb => 3,
            ColorMode::Cmyk => 4,
            ColorMode::Multichannel => 7,
            ColorMode::Duotone => 8,
            ColorMode::Lab => 9,
        }
    }

    /// Color channels (without alpha) a layer has in this mode.
    pub fn color_channels(self) -> usize {
        match self {
            ColorMode::Rgb | ColorMode::Lab => 3,
            ColorMode::Cmyk => 4,
            _ => 1,
        }
    }
}

/// Photoshop's blend modes.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BlendMode {
    /// Groups only: the group's layers blend straight into what is below.
    PassThrough,
    /// Normal.
    #[default]
    Normal,
    /// Dissolve.
    Dissolve,
    /// Darken.
    Darken,
    /// Multiply.
    Multiply,
    /// Color Burn.
    ColorBurn,
    /// Linear Burn.
    LinearBurn,
    /// Darker Color.
    DarkerColor,
    /// Lighten.
    Lighten,
    /// Screen.
    Screen,
    /// Color Dodge.
    ColorDodge,
    /// Linear Dodge (Add).
    LinearDodge,
    /// Lighter Color.
    LighterColor,
    /// Overlay.
    Overlay,
    /// Soft Light.
    SoftLight,
    /// Hard Light.
    HardLight,
    /// Vivid Light.
    VividLight,
    /// Linear Light.
    LinearLight,
    /// Pin Light.
    PinLight,
    /// Hard Mix.
    HardMix,
    /// Difference.
    Difference,
    /// Exclusion.
    Exclusion,
    /// Subtract.
    Subtract,
    /// Divide.
    Divide,
    /// Hue.
    Hue,
    /// Saturation.
    Saturation,
    /// Color.
    Color,
    /// Luminosity.
    Luminosity,
}

impl BlendMode {
    /// Every mode, in Photoshop's menu order.
    pub const ALL: [BlendMode; 28] = [
        BlendMode::PassThrough,
        BlendMode::Normal,
        BlendMode::Dissolve,
        BlendMode::Darken,
        BlendMode::Multiply,
        BlendMode::ColorBurn,
        BlendMode::LinearBurn,
        BlendMode::DarkerColor,
        BlendMode::Lighten,
        BlendMode::Screen,
        BlendMode::ColorDodge,
        BlendMode::LinearDodge,
        BlendMode::LighterColor,
        BlendMode::Overlay,
        BlendMode::SoftLight,
        BlendMode::HardLight,
        BlendMode::VividLight,
        BlendMode::LinearLight,
        BlendMode::PinLight,
        BlendMode::HardMix,
        BlendMode::Difference,
        BlendMode::Exclusion,
        BlendMode::Subtract,
        BlendMode::Divide,
        BlendMode::Hue,
        BlendMode::Saturation,
        BlendMode::Color,
        BlendMode::Luminosity,
    ];

    /// The four-byte key layer records store.
    pub fn key(self) -> [u8; 4] {
        *match self {
            BlendMode::PassThrough => b"pass",
            BlendMode::Normal => b"norm",
            BlendMode::Dissolve => b"diss",
            BlendMode::Darken => b"dark",
            BlendMode::Multiply => b"mul ",
            BlendMode::ColorBurn => b"idiv",
            BlendMode::LinearBurn => b"lbrn",
            BlendMode::DarkerColor => b"dkCl",
            BlendMode::Lighten => b"lite",
            BlendMode::Screen => b"scrn",
            BlendMode::ColorDodge => b"div ",
            BlendMode::LinearDodge => b"lddg",
            BlendMode::LighterColor => b"lgCl",
            BlendMode::Overlay => b"over",
            BlendMode::SoftLight => b"sLit",
            BlendMode::HardLight => b"hLit",
            BlendMode::VividLight => b"vLit",
            BlendMode::LinearLight => b"lLit",
            BlendMode::PinLight => b"pLit",
            BlendMode::HardMix => b"hMix",
            BlendMode::Difference => b"diff",
            BlendMode::Exclusion => b"smud",
            BlendMode::Subtract => b"fsub",
            BlendMode::Divide => b"fdiv",
            BlendMode::Hue => b"hue ",
            BlendMode::Saturation => b"sat ",
            BlendMode::Color => b"colr",
            BlendMode::Luminosity => b"lum ",
        }
    }

    /// The mode a layer record's key names.
    pub fn from_key(key: &[u8; 4]) -> Option<BlendMode> {
        BlendMode::ALL.into_iter().find(|m| &m.key() == key)
    }

    /// The name Photoshop's menu shows.
    pub fn label(self) -> &'static str {
        match self {
            BlendMode::PassThrough => "Pass Through",
            BlendMode::Normal => "Normal",
            BlendMode::Dissolve => "Dissolve",
            BlendMode::Darken => "Darken",
            BlendMode::Multiply => "Multiply",
            BlendMode::ColorBurn => "Color Burn",
            BlendMode::LinearBurn => "Linear Burn",
            BlendMode::DarkerColor => "Darker Color",
            BlendMode::Lighten => "Lighten",
            BlendMode::Screen => "Screen",
            BlendMode::ColorDodge => "Color Dodge",
            BlendMode::LinearDodge => "Linear Dodge (Add)",
            BlendMode::LighterColor => "Lighter Color",
            BlendMode::Overlay => "Overlay",
            BlendMode::SoftLight => "Soft Light",
            BlendMode::HardLight => "Hard Light",
            BlendMode::VividLight => "Vivid Light",
            BlendMode::LinearLight => "Linear Light",
            BlendMode::PinLight => "Pin Light",
            BlendMode::HardMix => "Hard Mix",
            BlendMode::Difference => "Difference",
            BlendMode::Exclusion => "Exclusion",
            BlendMode::Subtract => "Subtract",
            BlendMode::Divide => "Divide",
            BlendMode::Hue => "Hue",
            BlendMode::Saturation => "Saturation",
            BlendMode::Color => "Color",
            BlendMode::Luminosity => "Luminosity",
        }
    }
}

/// A straight sRGB color, each component in `0..=1`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Rgb {
    /// Red.
    pub r: f32,
    /// Green.
    pub g: f32,
    /// Blue.
    pub b: f32,
}

impl Rgb {
    /// Black.
    pub const BLACK: Rgb = Rgb {
        r: 0.0,
        g: 0.0,
        b: 0.0,
    };
    /// White.
    pub const WHITE: Rgb = Rgb {
        r: 1.0,
        g: 1.0,
        b: 1.0,
    };

    /// A color from components in `0..=1`.
    pub const fn new(r: f32, g: f32, b: f32) -> Rgb {
        Rgb { r, g, b }
    }

    /// A color from 8-bit components.
    pub fn from_u8(r: u8, g: u8, b: u8) -> Rgb {
        Rgb::new(r as f32 / 255.0, g as f32 / 255.0, b as f32 / 255.0)
    }

    /// The color as 8-bit components (rounded, clamped).
    pub fn to_u8(self) -> [u8; 3] {
        let q = |v: f32| (v.clamp(0.0, 1.0) * 255.0).round() as u8;
        [q(self.r), q(self.g), q(self.b)]
    }

    /// `#rrggbb`.
    pub fn hex(self) -> String {
        let [r, g, b] = self.to_u8();
        format!("#{r:02x}{g:02x}{b:02x}")
    }

    /// Parses `#rrggbb` or `rrggbb`.
    pub fn parse_hex(s: &str) -> Option<Rgb> {
        let s = s.trim().trim_start_matches('#');
        if s.len() != 6 {
            return None;
        }
        let v = u32::from_str_radix(s, 16).ok()?;
        Some(Rgb::from_u8((v >> 16) as u8, (v >> 8) as u8, v as u8))
    }
}

/// A ruler guide.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Guide {
    /// A vertical line (at an x position) rather than a horizontal one.
    pub vertical: bool,
    /// Position in canvas pixels.
    pub position: f64,
}

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
            let mut out = [0.0; N];
            for i in 0..N {
                out[i] = a.2[i] + (b.2[i] - a.2[i]) * k;
            }
            return out;
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

/// A curve remapping `0..=1` to `0..=1`, as shadows, glows, and bevels
/// shape their falloff ("Linear" by default).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Contour {
    /// Its name.
    pub name: String,
    /// Points `(input, output)` in `0..=1`, by input.
    pub points: Vec<(f32, f32)>,
}

impl Default for Contour {
    fn default() -> Self {
        Contour {
            name: "Linear".into(),
            points: vec![(0.0, 0.0), (1.0, 1.0)],
        }
    }
}

impl Contour {
    /// The curve's value at `x` (straight segments between points).
    pub fn apply(&self, x: f32) -> f32 {
        let x = x.clamp(0.0, 1.0);
        let Some(first) = self.points.first() else {
            return x;
        };
        if x <= first.0 {
            return first.1;
        }
        for w in self.points.windows(2) {
            if x <= w[1].0 {
                let span = w[1].0 - w[0].0;
                let t = if span <= f32::EPSILON {
                    1.0
                } else {
                    (x - w[0].0) / span
                };
                return w[0].1 + (w[1].1 - w[0].1) * t;
            }
        }
        self.points.last().map_or(x, |p| p.1)
    }
}

/// A drop shadow or inner shadow.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Shadow {
    /// Shown.
    pub enabled: bool,
    /// How it blends.
    pub blend: BlendMode,
    /// Its color.
    pub color: Rgb,
    /// Opacity, `0..=1`.
    pub opacity: f32,
    /// Light angle in degrees (the shadow falls the other way).
    pub angle: f32,
    /// Uses the document's global light angle instead of `angle`.
    pub use_global_light: bool,
    /// Offset, in pixels.
    pub distance: f32,
    /// Spread (drop shadow) or choke (inner shadow), `0..=1`.
    pub spread: f32,
    /// Blur size, in pixels.
    pub size: f32,
    /// Noise, `0..=1`.
    pub noise: f32,
    /// The falloff curve.
    pub contour: Contour,
    /// Drop shadows: hidden where the layer itself is (Layer Knocks Out
    /// Drop Shadow).
    pub knocks_out: bool,
}

/// Glow techniques.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GlowTechnique {
    /// A blurred falloff.
    #[default]
    Softer,
    /// A distance-based falloff that follows corners.
    Precise,
}

/// Where an inner glow starts.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GlowSource {
    /// From the edges inward.
    #[default]
    Edge,
    /// From the center outward.
    Center,
}

/// An outer or inner glow.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Glow {
    /// Shown.
    pub enabled: bool,
    /// How it blends.
    pub blend: BlendMode,
    /// Its color (when `gradient` is absent).
    pub color: Rgb,
    /// A gradient across the glow instead of one color.
    pub gradient: Option<Gradient>,
    /// Opacity, `0..=1`.
    pub opacity: f32,
    /// Noise, `0..=1`.
    pub noise: f32,
    /// Technique.
    pub technique: GlowTechnique,
    /// Spread (outer) or choke (inner), `0..=1`.
    pub spread: f32,
    /// Size, in pixels.
    pub size: f32,
    /// The falloff curve.
    pub contour: Contour,
    /// Range of the contour, `0..=1`.
    pub range: f32,
    /// Gradient jitter, `0..=1`.
    pub jitter: f32,
    /// Inner glows: where the glow starts.
    pub source: GlowSource,
}

/// Bevel and emboss styles.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BevelStyle {
    /// Outside the layer's edges.
    OuterBevel,
    /// Inside its edges.
    #[default]
    InnerBevel,
    /// Both sides of its edges.
    Emboss,
    /// Sunk into what is below.
    PillowEmboss,
    /// Along a stroke effect.
    StrokeEmboss,
}

/// Bevel techniques.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BevelTechnique {
    /// Smooth.
    #[default]
    Smooth,
    /// Chisel Hard.
    ChiselHard,
    /// Chisel Soft.
    ChiselSoft,
}

/// A bevel and emboss.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bevel {
    /// Shown.
    pub enabled: bool,
    /// Style.
    pub style: BevelStyle,
    /// Technique.
    pub technique: BevelTechnique,
    /// Depth, `0..=10` (`1.0` is 100%).
    pub depth: f32,
    /// Raised (up) rather than sunk (down).
    pub up: bool,
    /// Size, in pixels.
    pub size: f32,
    /// Soften, in pixels.
    pub soften: f32,
    /// Light angle, in degrees.
    pub angle: f32,
    /// Light altitude, in degrees.
    pub altitude: f32,
    /// Uses the document's global light.
    pub use_global_light: bool,
    /// Highlight blend mode.
    pub highlight_blend: BlendMode,
    /// Highlight color.
    pub highlight_color: Rgb,
    /// Highlight opacity, `0..=1`.
    pub highlight_opacity: f32,
    /// Shadow blend mode.
    pub shadow_blend: BlendMode,
    /// Shadow color.
    pub shadow_color: Rgb,
    /// Shadow opacity, `0..=1`.
    pub shadow_opacity: f32,
    /// The gloss contour.
    pub gloss: Contour,
    /// The edge contour, when enabled.
    pub contour: Option<Contour>,
}

/// A satin.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Satin {
    /// Shown.
    pub enabled: bool,
    /// How it blends.
    pub blend: BlendMode,
    /// Its color.
    pub color: Rgb,
    /// Opacity, `0..=1`.
    pub opacity: f32,
    /// Angle, in degrees.
    pub angle: f32,
    /// Offset, in pixels.
    pub distance: f32,
    /// Blur size, in pixels.
    pub size: f32,
    /// Inverted.
    pub invert: bool,
    /// The falloff curve.
    pub contour: Contour,
}

/// A color, gradient, or pattern overlay.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Overlay {
    /// Shown.
    pub enabled: bool,
    /// How it blends.
    pub blend: BlendMode,
    /// Opacity, `0..=1`.
    pub opacity: f32,
    /// What it paints.
    pub fill: Fill,
}

/// Where a stroke sits relative to the layer's edge.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StrokePosition {
    /// Outside the edge.
    #[default]
    Outside,
    /// Inside it.
    Inside,
    /// Centered on it.
    Center,
}

/// A stroke effect.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StrokeEffect {
    /// Shown.
    pub enabled: bool,
    /// How it blends.
    pub blend: BlendMode,
    /// Opacity, `0..=1`.
    pub opacity: f32,
    /// Width, in pixels.
    pub size: f32,
    /// Position.
    pub position: StrokePosition,
    /// What it paints.
    pub fill: Fill,
}

/// A layer's style: its effects, in the lists Photoshop shows (several drop
/// shadows, inner shadows, color and gradient overlays, and strokes are
/// allowed).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Effects {
    /// The style as a whole is shown.
    pub enabled: bool,
    /// Scale of every effect's sizes (`1.0` is 100%).
    pub scale: f32,
    /// Drop shadows.
    pub drop_shadows: Vec<Shadow>,
    /// Inner shadows.
    pub inner_shadows: Vec<Shadow>,
    /// Outer glows.
    pub outer_glows: Vec<Glow>,
    /// Inner glows.
    pub inner_glows: Vec<Glow>,
    /// Bevels and embosses.
    pub bevels: Vec<Bevel>,
    /// Satins.
    pub satins: Vec<Satin>,
    /// Color overlays.
    pub color_overlays: Vec<Overlay>,
    /// Gradient overlays.
    pub gradient_overlays: Vec<Overlay>,
    /// Pattern overlays.
    pub pattern_overlays: Vec<Overlay>,
    /// Strokes.
    pub strokes: Vec<StrokeEffect>,
}

impl Default for Effects {
    fn default() -> Self {
        Effects {
            enabled: true,
            scale: 1.0,
            drop_shadows: Vec::new(),
            inner_shadows: Vec::new(),
            outer_glows: Vec::new(),
            inner_glows: Vec::new(),
            bevels: Vec::new(),
            satins: Vec::new(),
            color_overlays: Vec::new(),
            gradient_overlays: Vec::new(),
            pattern_overlays: Vec::new(),
            strokes: Vec::new(),
        }
    }
}

impl Effects {
    /// Whether any effect would be drawn.
    pub fn any_visible(&self) -> bool {
        self.enabled
            && (self.drop_shadows.iter().any(|e| e.enabled)
                || self.inner_shadows.iter().any(|e| e.enabled)
                || self.outer_glows.iter().any(|e| e.enabled)
                || self.inner_glows.iter().any(|e| e.enabled)
                || self.bevels.iter().any(|e| e.enabled)
                || self.satins.iter().any(|e| e.enabled)
                || self.color_overlays.iter().any(|e| e.enabled)
                || self.gradient_overlays.iter().any(|e| e.enabled)
                || self.pattern_overlays.iter().any(|e| e.enabled)
                || self.strokes.iter().any(|e| e.enabled))
    }

    /// How far effects can reach outside the layer's pixels, in pixels.
    pub fn reach(&self) -> i32 {
        if !self.enabled {
            return 0;
        }
        let mut r = 0.0f32;
        for s in self.drop_shadows.iter().filter(|e| e.enabled) {
            r = r.max(s.distance + s.size * 1.5);
        }
        for g in self.outer_glows.iter().filter(|e| e.enabled) {
            r = r.max(g.size * 1.5);
        }
        for b in self.bevels.iter().filter(|e| e.enabled) {
            r = r.max(b.size + b.soften);
        }
        for s in self.strokes.iter().filter(|e| e.enabled) {
            r = r.max(s.size);
        }
        (r * self.scale.max(0.0)).ceil() as i32 + 2
    }
}

/// One channel's Levels: input black and white points, gamma, and output
/// black and white points (8-bit values).
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LevelsChannel {
    /// Input black point.
    pub in_black: u8,
    /// Input white point.
    pub in_white: u8,
    /// Output black point.
    pub out_black: u8,
    /// Output white point.
    pub out_white: u8,
    /// Gamma (midtones), `0.1..=9.99`.
    pub gamma: f32,
}

impl Default for LevelsChannel {
    fn default() -> Self {
        LevelsChannel {
            in_black: 0,
            in_white: 255,
            out_black: 0,
            out_white: 255,
            gamma: 1.0,
        }
    }
}

/// One color range of Hue/Saturation: its hue range and adjustments.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HueRange {
    /// Hue range `[begin falloff, begin, end, end falloff]`, in degrees.
    pub range: [i16; 4],
    /// Hue shift, `-180..=180`.
    pub hue: i16,
    /// Saturation, `-100..=100`.
    pub saturation: i16,
    /// Lightness, `-100..=100`.
    pub lightness: i16,
}

/// Adjustment layers' settings.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum Adjustment {
    /// Brightness/Contrast.
    BrightnessContrast {
        /// `-150..=150`.
        brightness: i16,
        /// `-50..=100`.
        contrast: i16,
        /// Legacy (pre-CS3) behavior.
        legacy: bool,
    },
    /// Levels: the composite channel first, then each color channel.
    Levels {
        /// Composite, red, green, blue (missing channels are unchanged).
        channels: Vec<LevelsChannel>,
    },
    /// Curves: points per channel (composite first).
    Curves {
        /// `(channel, points)`: channel 0 is the composite, 1–3 red,
        /// green, blue; points are `(input, output)` 8-bit values.
        channels: Vec<(u8, Vec<(u8, u8)>)>,
    },
    /// Exposure.
    Exposure {
        /// Stops, `-20..=20`.
        exposure: f32,
        /// Offset, `-0.5..=0.5`.
        offset: f32,
        /// Gamma correction, `0.01..=9.99`.
        gamma: f32,
    },
    /// Vibrance.
    Vibrance {
        /// `-100..=100`.
        vibrance: i16,
        /// `-100..=100`.
        saturation: i16,
    },
    /// Hue/Saturation.
    HueSaturation {
        /// Colorize instead of shifting.
        colorize: bool,
        /// Colorize hue, saturation, lightness.
        colorization: (i16, i16, i16),
        /// Master hue, saturation, lightness.
        master: (i16, i16, i16),
        /// Reds, yellows, greens, cyans, blues, magentas.
        ranges: Vec<HueRange>,
    },
    /// Color Balance: cyan–red, magenta–green, yellow–blue per tone range.
    ColorBalance {
        /// Shadows, `-100..=100` each.
        shadows: [i16; 3],
        /// Midtones.
        midtones: [i16; 3],
        /// Highlights.
        highlights: [i16; 3],
        /// Keeps luminosity.
        preserve_luminosity: bool,
    },
    /// Black & White.
    BlackWhite {
        /// Reds, yellows, greens, cyans, blues, magentas, in percent.
        weights: [i16; 6],
        /// A tint, when enabled.
        tint: Option<Rgb>,
    },
    /// Photo Filter.
    PhotoFilter {
        /// The filter color.
        color: Rgb,
        /// Density, `0..=1`.
        density: f32,
        /// Keeps luminosity.
        preserve_luminosity: bool,
    },
    /// Channel Mixer: output red, green, blue rows of red, green, blue,
    /// constant (percent).
    ChannelMixer {
        /// Monochrome output (the red row only).
        monochrome: bool,
        /// Rows.
        rows: [[i16; 4]; 3],
    },
    /// Invert.
    Invert,
    /// Posterize.
    Posterize {
        /// Levels, `2..=255`.
        levels: u8,
    },
    /// Threshold.
    Threshold {
        /// Level, `1..=255`.
        level: u8,
    },
    /// Gradient Map.
    GradientMap {
        /// The gradient luminosity is mapped through.
        gradient: Gradient,
        /// Dithered.
        dither: bool,
        /// Reversed.
        reverse: bool,
    },
    /// Selective Color: cyan, magenta, yellow, black adjustments (percent)
    /// for reds, yellows, greens, cyans, blues, magentas, whites, neutrals,
    /// blacks.
    SelectiveColor {
        /// Absolute rather than relative.
        absolute: bool,
        /// One row per color range.
        colors: [[i16; 4]; 9],
    },
    /// An adjustment the engine keeps but does not draw (Color Lookup,
    /// HDR Toning, and the rest).
    Other {
        /// Its tagged block key.
        key: String,
    },
}

impl Adjustment {
    /// The name Photoshop gives new layers of this kind.
    pub fn label(&self) -> &'static str {
        match self {
            Adjustment::BrightnessContrast { .. } => "Brightness/Contrast",
            Adjustment::Levels { .. } => "Levels",
            Adjustment::Curves { .. } => "Curves",
            Adjustment::Exposure { .. } => "Exposure",
            Adjustment::Vibrance { .. } => "Vibrance",
            Adjustment::HueSaturation { .. } => "Hue/Saturation",
            Adjustment::ColorBalance { .. } => "Color Balance",
            Adjustment::BlackWhite { .. } => "Black & White",
            Adjustment::PhotoFilter { .. } => "Photo Filter",
            Adjustment::ChannelMixer { .. } => "Channel Mixer",
            Adjustment::Invert => "Invert",
            Adjustment::Posterize { .. } => "Posterize",
            Adjustment::Threshold { .. } => "Threshold",
            Adjustment::GradientMap { .. } => "Gradient Map",
            Adjustment::SelectiveColor { .. } => "Selective Color",
            Adjustment::Other { .. } => "Adjustment",
        }
    }
}

/// Text alignment.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TextAlign {
    /// Left.
    #[default]
    Left,
    /// Right.
    Right,
    /// Center.
    Center,
    /// Justified, last line left.
    JustifyLeft,
    /// Justified, last line right.
    JustifyRight,
    /// Justified, last line centered.
    JustifyCenter,
    /// Justified, every line.
    JustifyAll,
}

/// Letter case styles.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TextCase {
    /// As typed.
    #[default]
    Normal,
    /// Small caps.
    SmallCaps,
    /// All caps.
    AllCaps,
}

/// The character style of a run of text.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextStyle {
    /// The font's PostScript name ("MyriadPro-Regular").
    pub font: String,
    /// Size in points (pixels at the text's own scale).
    pub size: f32,
    /// Fill color.
    pub color: Rgb,
    /// Tracking, in thousandths of an em.
    pub tracking: f32,
    /// Leading in points; `None` is auto (120% of the size).
    pub leading: Option<f32>,
    /// Synthesized bold.
    pub faux_bold: bool,
    /// Synthesized italic.
    pub faux_italic: bool,
    /// Underlined.
    pub underline: bool,
    /// Struck through.
    pub strikethrough: bool,
    /// Case.
    pub case: TextCase,
    /// Baseline shift, in points.
    pub baseline_shift: f32,
    /// Horizontal scale (`1.0` is 100%).
    pub horizontal_scale: f32,
    /// Vertical scale (`1.0` is 100%).
    pub vertical_scale: f32,
}

impl Default for TextStyle {
    fn default() -> Self {
        TextStyle {
            font: "Inter-Regular".into(),
            size: 24.0,
            color: Rgb::BLACK,
            tracking: 0.0,
            leading: None,
            faux_bold: false,
            faux_italic: false,
            underline: false,
            strikethrough: false,
            case: TextCase::Normal,
            baseline_shift: 0.0,
            horizontal_scale: 1.0,
            vertical_scale: 1.0,
        }
    }
}

/// A run of characters sharing a style.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextRun {
    /// Length in UTF-16 code units, as Photoshop counts.
    pub length: u32,
    /// The style.
    pub style: TextStyle,
}

/// A run of paragraphs sharing an alignment.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParagraphRun {
    /// Length in UTF-16 code units.
    pub length: u32,
    /// Alignment.
    pub align: TextAlign,
}

/// Text direction.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TextOrientation {
    /// Lines run left to right.
    #[default]
    Horizontal,
    /// Lines run top to bottom.
    Vertical,
}

/// Anti-aliasing methods.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AntiAlias {
    /// None.
    None,
    /// Sharp.
    Sharp,
    /// Crisp.
    Crisp,
    /// Strong.
    Strong,
    /// Smooth.
    #[default]
    Smooth,
}

/// A text layer's content and layout.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextLayer {
    /// The characters; paragraphs end with `\r`, as Photoshop stores them.
    pub text: String,
    /// Character style runs, covering the text in order.
    pub runs: Vec<TextRun>,
    /// Paragraph runs, covering the text in order.
    pub paragraphs: Vec<ParagraphRun>,
    /// Text space to canvas: `[xx, xy, yx, yy, tx, ty]`.
    pub transform: [f64; 6],
    /// Area text: the box the text wraps in, `[left, top, right, bottom]`
    /// in text space; point text has none.
    pub area: Option<[f64; 4]>,
    /// Direction.
    pub orientation: TextOrientation,
    /// Anti-aliasing.
    pub anti_alias: AntiAlias,
    /// The text is warped (kept, drawn from the stored pixels until edited).
    pub warped: bool,
}

impl TextLayer {
    /// The style at a UTF-16 offset.
    pub fn style_at(&self, offset: u32) -> Option<&TextStyle> {
        let mut start = 0;
        for run in &self.runs {
            if offset < start + run.length {
                return Some(&run.style);
            }
            start += run.length;
        }
        self.runs.last().map(|r| &r.style)
    }
}

/// How a subpath of a vector mask combines with the ones before it.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PathOp {
    /// Adds its area.
    #[default]
    Combine,
    /// Removes its area.
    Subtract,
    /// Keeps only the overlap.
    Intersect,
    /// Keeps what is in one but not both.
    Exclude,
}

/// A point of a path: the anchor and its two handles, in canvas pixels.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Knot {
    /// The handle the curve arrives along.
    pub before: (f64, f64),
    /// The anchor.
    pub anchor: (f64, f64),
    /// The handle the curve leaves along.
    pub after: (f64, f64),
    /// The handles move together.
    pub linked: bool,
}

impl Knot {
    /// A corner point (handles on the anchor).
    pub fn corner(x: f64, y: f64) -> Knot {
        Knot {
            before: (x, y),
            anchor: (x, y),
            after: (x, y),
            linked: false,
        }
    }
}

/// One subpath of a vector mask.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Subpath {
    /// Closed (the last point joins the first).
    pub closed: bool,
    /// How it combines with the subpaths before it.
    pub op: PathOp,
    /// Its points, in order.
    pub knots: Vec<Knot>,
}

/// A layer's vector mask (or a shape layer's outline).
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VectorMask {
    /// Subpaths, in order.
    pub subpaths: Vec<Subpath>,
    /// Inverted.
    pub invert: bool,
    /// Turned off (kept but not applied).
    pub disabled: bool,
    /// Not linked to the layer (does not move with it).
    pub unlinked: bool,
    /// The area starts as everything (an initial fill rule of 1) rather
    /// than nothing.
    pub fill_all: bool,
}

/// Stroke alignment for shape strokes.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StrokeAlign {
    /// Inside the outline.
    Inside,
    /// Centered on it.
    #[default]
    Center,
    /// Outside it.
    Outside,
}

/// Line caps.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LineCap {
    /// Flat at the end point.
    #[default]
    Butt,
    /// Rounded.
    Round,
    /// Square, past the end point.
    Square,
}

/// Line joins.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LineJoin {
    /// Mitered.
    #[default]
    Miter,
    /// Rounded.
    Round,
    /// Beveled.
    Bevel,
}

/// A shape layer's stroke.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VectorStroke {
    /// The stroke is drawn.
    pub enabled: bool,
    /// The shape's fill is drawn.
    pub fill_enabled: bool,
    /// Width in pixels.
    pub width: f32,
    /// Alignment.
    pub align: StrokeAlign,
    /// Caps.
    pub cap: LineCap,
    /// Joins.
    pub join: LineJoin,
    /// Miter limit.
    pub miter_limit: f32,
    /// Dash lengths in widths (empty: solid).
    pub dashes: Vec<f32>,
    /// Dash offset in widths.
    pub dash_offset: f32,
    /// Opacity, `0..=1`.
    pub opacity: f32,
    /// How it blends.
    pub blend: BlendMode,
    /// What it paints.
    pub fill: Fill,
}

/// A smart object's placement.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartObject {
    /// The placed content's unique id.
    pub id: String,
    /// The embedded or linked file's name.
    pub file_name: Option<String>,
    /// The content's corners on the canvas (top left, top right, bottom
    /// right, bottom left), `[x0, y0, … x3, y3]`.
    pub corners: [f64; 8],
    /// The content is linked to a file outside the document.
    pub linked: bool,
}

/// What a layer is.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum LayerKind {
    /// Pixels.
    Pixel,
    /// A group of layers.
    Group {
        /// Expanded in the layers panel.
        open: bool,
    },
    /// Text, drawn from its stored pixels until edited.
    Text {
        /// The text.
        text: Box<TextLayer>,
    },
    /// A fill: one color, a gradient, or a pattern, shaped by the vector
    /// mask when it has one (a shape layer).
    Fill {
        /// What it paints.
        fill: Fill,
        /// A shape layer's stroke.
        stroke: Option<Box<VectorStroke>>,
    },
    /// An adjustment of everything below it.
    Adjustment {
        /// The settings.
        adjustment: Box<Adjustment>,
    },
    /// Placed content, drawn from its stored pixels.
    SmartObject {
        /// The placement.
        object: Box<SmartObject>,
    },
}

impl LayerKind {
    /// Whether the layer is a group.
    pub fn is_group(&self) -> bool {
        matches!(self, LayerKind::Group { .. })
    }

    /// Whether its pixels are what it shows (pixel, text, and smart object
    /// layers).
    pub fn has_pixels(&self) -> bool {
        matches!(
            self,
            LayerKind::Pixel | LayerKind::Text { .. } | LayerKind::SmartObject { .. }
        )
    }
}

/// A layer's pixel mask.
#[derive(Clone, Debug, PartialEq)]
pub struct LayerMask {
    /// Mask values (one channel); pixels outside its tiles take
    /// `default_color`.
    pub raster: Raster,
    /// The canvas rectangle the mask's pixels cover; outside it every pixel
    /// is `default_color`.
    pub rect: IRect,
    /// Value outside `rect` (0 or 255).
    pub default_color: u8,
    /// Turned off (kept but not applied).
    pub disabled: bool,
    /// Moves with the layer.
    pub linked: bool,
    /// Density, `0..=1`.
    pub density: f32,
    /// Feather, in pixels.
    pub feather: f32,
    /// Bumped whenever the mask's values are replaced wholesale, as
    /// [`Layer::generation`] is for pixels.
    pub generation: u32,
}

impl LayerMask {
    /// The mask value at canvas `(x, y)`.
    pub fn value(&self, x: i32, y: i32) -> u8 {
        if self.rect.contains(x, y) {
            self.raster.get(x, y)[0]
        } else {
            self.default_color
        }
    }
}

/// Blend If ranges: for the gray composite and then each color channel,
/// the source (this layer) and destination (what is below) ranges, each
/// `[black low, black high, white low, white high]`.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlendRanges {
    /// `(source, destination)` per channel, gray first.
    pub channels: Vec<([u8; 4], [u8; 4])>,
}

impl BlendRanges {
    /// Whether the ranges let everything through (Photoshop's default).
    pub fn is_default(&self) -> bool {
        self.channels
            .iter()
            .all(|(s, d)| *s == [0, 0, 255, 255] && *d == [0, 0, 255, 255])
    }
}

/// Lock settings.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Locks {
    /// Transparent pixels stay transparent.
    pub transparency: bool,
    /// Pixels cannot be painted.
    pub pixels: bool,
    /// The layer cannot move.
    pub position: bool,
    /// The layer cannot nest in or out of artboards.
    pub artboard: bool,
}

impl Locks {
    /// Everything locked.
    pub fn all(&self) -> bool {
        self.transparency && self.pixels && self.position
    }
}

/// Edit flags: which of a layer's properties changed since the file was
/// opened (saving rewrites only those), and which document properties did.
pub mod flags {
    /// The layer was created (it has no record in the file).
    pub const CREATED: u64 = 1 << 0;
    /// Name.
    pub const NAME: u64 = 1 << 1;
    /// Visibility.
    pub const VISIBLE: u64 = 1 << 2;
    /// Opacity.
    pub const OPACITY: u64 = 1 << 3;
    /// Fill opacity.
    pub const FILL_OPACITY: u64 = 1 << 4;
    /// Blend mode.
    pub const BLEND: u64 = 1 << 5;
    /// Clipping.
    pub const CLIPPING: u64 = 1 << 6;
    /// Locks.
    pub const LOCKS: u64 = 1 << 7;
    /// Color tag.
    pub const COLOR_TAG: u64 = 1 << 8;
    /// Pixels.
    pub const PIXELS: u64 = 1 << 9;
    /// Mask pixels.
    pub const MASK: u64 = 1 << 10;
    /// Mask settings (enabled, linked, density, feather, default color).
    pub const MASK_SETTINGS: u64 = 1 << 11;
    /// Vector mask.
    pub const VECTOR_MASK: u64 = 1 << 12;
    /// Effects.
    pub const EFFECTS: u64 = 1 << 13;
    /// Text.
    pub const TEXT: u64 = 1 << 14;
    /// Fill content or shape stroke.
    pub const FILL: u64 = 1 << 15;
    /// Adjustment settings.
    pub const ADJUSTMENT: u64 = 1 << 16;
    /// Parent or position among siblings.
    pub const PARENT: u64 = 1 << 17;
    /// Group open state.
    pub const OPEN: u64 = 1 << 18;
    /// Smart object placement.
    pub const PLACEMENT: u64 = 1 << 19;
    /// Blend If ranges.
    pub const BLEND_RANGES: u64 = 1 << 20;
    /// Kind (a layer converted: rasterized text, a group's kind, …).
    pub const KIND: u64 = 1 << 21;
    /// Advanced blending (knockout, blend clipped layers as group, …).
    pub const ADVANCED: u64 = 1 << 22;
    /// The pixels (and a linked mask) moved by whole pixels, unchanged
    /// otherwise: saving shifts their rectangles and keeps their data.
    pub const OFFSET: u64 = 1 << 23;

    /// Document: canvas size (or every layer moved with a crop).
    pub const DOC_CANVAS: u64 = 1 << 0;
    /// Document: guides.
    pub const DOC_GUIDES: u64 = 1 << 1;
    /// Document: resolution.
    pub const DOC_RESOLUTION: u64 = 1 << 2;
    /// Document: the layer stack (layers added, removed, or moved).
    pub const DOC_LAYERS: u64 = 1 << 3;
    /// Document: color mode (converted to RGB).
    pub const DOC_MODE: u64 = 1 << 4;
}

/// A layer.
#[derive(Clone, Debug, PartialEq)]
pub struct Layer {
    /// Stable id (the file's `lyid`), unique in the document.
    pub id: u32,
    /// Name.
    pub name: String,
    /// What it is.
    pub kind: LayerKind,
    /// The group it is in (`None`: the document's top level).
    pub parent: Option<LayerIdx>,
    /// A group's layers, bottom to top.
    pub children: Vec<LayerIdx>,
    /// Shown.
    pub visible: bool,
    /// Opacity, `0..=255`.
    pub opacity: u8,
    /// Fill opacity (opacity of the pixels, not the effects), `0..=255`.
    pub fill_opacity: u8,
    /// Blend mode.
    pub blend: BlendMode,
    /// Clipped to the layer below.
    pub clipping: bool,
    /// Locks.
    pub locks: Locks,
    /// Color tag (`0` none, then red, orange, yellow, green, blue, violet,
    /// gray).
    pub color_tag: u8,
    /// The layer is the document's Background (opaque, bottom, locked in
    /// place).
    pub background: bool,
    /// Pixels (RGBA, straight alpha).
    pub pixels: Raster,
    /// Pixel mask.
    pub mask: Option<LayerMask>,
    /// Vector mask.
    pub vector_mask: Option<VectorMask>,
    /// Layer style.
    pub effects: Option<Effects>,
    /// Blend If.
    pub blend_ranges: Option<BlendRanges>,
    /// Knockout: 0 none, 1 shallow, 2 deep.
    pub knockout: u8,
    /// Blend Clipped Layers as Group (on by default).
    pub blend_clipped_as_group: bool,
    /// Blend Interior Effects as Group (off by default).
    pub blend_interior_as_group: bool,
    /// Transparency Shapes Layer (on by default).
    pub transparency_shapes: bool,
    /// Layer Mask Hides Effects.
    pub mask_hides_effects: bool,
    /// Vector Mask Hides Effects.
    pub vector_mask_hides_effects: bool,
    /// The record in the opened file this layer saves from: its own, or
    /// for a copy, the original's (fields the engine does not model are
    /// kept from it).
    pub record: Option<u32>,
    /// Edit flags ([`flags`]) of properties changed since opening.
    pub edits: u64,
    /// Deleted (kept for undo and for other people's changes).
    pub removed: bool,
    /// Pixel generation: a new value (unique among the people editing)
    /// whenever the pixels are replaced wholesale (a transform, text laid
    /// out again), so shared tile changes are only applied to the pixels
    /// they were made on. Files open at generation 0.
    pub generation: u32,
}

impl Layer {
    /// A new, empty, visible pixel layer.
    pub fn new(id: u32, name: impl Into<String>) -> Layer {
        Layer {
            id,
            name: name.into(),
            kind: LayerKind::Pixel,
            parent: None,
            children: Vec::new(),
            visible: true,
            opacity: 255,
            fill_opacity: 255,
            blend: BlendMode::Normal,
            clipping: false,
            locks: Locks::default(),
            color_tag: 0,
            background: false,
            pixels: Raster::rgba(),
            mask: None,
            vector_mask: None,
            effects: None,
            blend_ranges: None,
            knockout: 0,
            blend_clipped_as_group: true,
            blend_interior_as_group: false,
            transparency_shapes: true,
            mask_hides_effects: false,
            vector_mask_hides_effects: false,
            record: None,
            edits: flags::CREATED,
            removed: false,
            generation: 0,
        }
    }

    /// Whether the layer is a group.
    pub fn is_group(&self) -> bool {
        self.kind.is_group()
    }
}

/// The merged image the file stores (Photoshop's own rendering of every
/// layer), shown where no edit has changed what it would look like.
#[derive(Clone, Debug, PartialEq)]
pub struct Composite {
    /// The pixels (RGBA, grid at the canvas origin).
    pub raster: Raster,
    /// Canvas areas edits changed since opening: the engine composites
    /// the layers there itself.
    pub stale: Vec<IRect>,
}

impl Composite {
    /// Whether no part of `rect` is stale.
    pub fn covers(&self, rect: &IRect) -> bool {
        !self.stale.iter().any(|s| s.intersects(rect))
    }

    /// Marks an area stale.
    pub fn invalidate(&mut self, rect: IRect) {
        if rect.is_empty() {
            return;
        }
        if self.stale.iter().any(|s| s.contains_rect(&rect)) {
            return;
        }
        self.stale.retain(|s| !rect.contains_rect(s));
        self.stale.push(rect);
        // Many small areas cost more to test than one large one.
        if self.stale.len() > 64 {
            let all = self
                .stale
                .iter()
                .fold(IRect::default(), |acc, r| acc.union(r));
            self.stale = vec![all];
        }
    }
}

/// A document: the canvas and its layers.
#[derive(Clone, Debug)]
pub struct Document {
    /// Canvas width in pixels.
    pub width: u32,
    /// Canvas height in pixels.
    pub height: u32,
    /// The file's color mode.
    pub mode: ColorMode,
    /// The file's bits per channel (1, 8, 16, or 32).
    pub depth: u16,
    /// Pixels per inch.
    pub resolution: f64,
    /// Every layer, removed ones included.
    pub layers: Vec<Layer>,
    /// The top-level stack, bottom to top.
    pub roots: Vec<LayerIdx>,
    /// Ruler guides.
    pub guides: Vec<Guide>,
    /// Patterns fills and effects use.
    pub patterns: Vec<Pattern>,
    /// Global light angle, in degrees.
    pub global_angle: f32,
    /// Global light altitude, in degrees.
    pub global_altitude: f32,
    /// The stored merged image, when the file has a real one.
    pub composite: Option<Composite>,
    /// The opened file (saving patches it).
    pub source: Option<Arc<crate::file::PsdFile>>,
    /// Document edit flags ([`flags`]`::DOC_*`).
    pub edits: u64,
    /// The id the next new layer gets.
    pub next_id: u32,
}

impl Document {
    /// A blank document with no layers.
    pub fn new(width: u32, height: u32) -> Document {
        Document {
            width,
            height,
            mode: ColorMode::Rgb,
            depth: 8,
            resolution: 72.0,
            layers: Vec::new(),
            roots: Vec::new(),
            guides: Vec::new(),
            patterns: Vec::new(),
            global_angle: 120.0,
            global_altitude: 30.0,
            composite: None,
            source: None,
            edits: 0,
            next_id: 1,
        }
    }

    /// The canvas rectangle.
    pub fn bounds(&self) -> IRect {
        IRect::new(0, 0, self.width as i32, self.height as i32)
    }

    /// A layer.
    pub fn layer(&self, i: LayerIdx) -> &Layer {
        &self.layers[i as usize]
    }

    /// A layer, to change.
    pub fn layer_mut(&mut self, i: LayerIdx) -> &mut Layer {
        &mut self.layers[i as usize]
    }

    /// The layer with an id (removed ones included).
    pub fn find(&self, id: u32) -> Option<LayerIdx> {
        self.layers
            .iter()
            .position(|l| l.id == id)
            .map(|i| i as LayerIdx)
    }

    /// The stack a layer is in: its group's children or the top level.
    pub fn siblings(&self, i: LayerIdx) -> &[LayerIdx] {
        match self.layer(i).parent {
            Some(p) => &self.layer(p).children,
            None => &self.roots,
        }
    }

    /// The stack of a group (the top level for `None`).
    pub fn stack(&self, parent: Option<LayerIdx>) -> &[LayerIdx] {
        match parent {
            Some(p) => &self.layer(p).children,
            None => &self.roots,
        }
    }

    /// The stack of a group (the top level for `None`), to change.
    pub fn stack_mut(&mut self, parent: Option<LayerIdx>) -> &mut Vec<LayerIdx> {
        match parent {
            Some(p) => &mut self.layers[p as usize].children,
            None => &mut self.roots,
        }
    }

    /// Every live layer, depth first from the top of the document down
    /// (the layers panel's order), with its depth.
    pub fn panel_order(&self) -> Vec<(LayerIdx, usize)> {
        fn walk(
            doc: &Document,
            stack: &[LayerIdx],
            depth: usize,
            out: &mut Vec<(LayerIdx, usize)>,
        ) {
            for &i in stack.iter().rev() {
                out.push((i, depth));
                if doc.layer(i).is_group() {
                    walk(doc, &doc.layer(i).children, depth + 1, out);
                }
            }
        }
        let mut out = Vec::new();
        walk(self, &self.roots, 0, &mut out);
        out
    }

    /// Every live layer from the bottom of the document up (painting
    /// order, groups before their children).
    pub fn paint_order(&self) -> Vec<LayerIdx> {
        fn walk(doc: &Document, stack: &[LayerIdx], out: &mut Vec<LayerIdx>) {
            for &i in stack {
                out.push(i);
                if doc.layer(i).is_group() {
                    walk(doc, &doc.layer(i).children, out);
                }
            }
        }
        let mut out = Vec::new();
        walk(self, &self.roots, &mut out);
        out
    }

    /// Whether a layer and every group it is in are visible.
    pub fn is_shown(&self, i: LayerIdx) -> bool {
        let mut at = Some(i);
        while let Some(j) = at {
            let l = self.layer(j);
            if !l.visible || l.removed {
                return false;
            }
            at = l.parent;
        }
        true
    }

    /// Whether `ancestor` is `i` or contains it.
    pub fn is_within(&self, i: LayerIdx, ancestor: LayerIdx) -> bool {
        let mut at = Some(i);
        while let Some(j) = at {
            if j == ancestor {
                return true;
            }
            at = self.layer(j).parent;
        }
        false
    }

    /// The pattern with an id.
    pub fn pattern(&self, id: &str) -> Option<&Pattern> {
        self.patterns.iter().find(|p| p.id == id)
    }

    /// A fresh layer id.
    pub fn allocate_id(&mut self) -> u32 {
        let id = self.next_id;
        self.next_id = self.next_id.wrapping_add(1).max(1);
        id
    }

    /// Adds a layer to the arena (not to any stack); returns its index.
    pub fn push_layer(&mut self, layer: Layer) -> LayerIdx {
        self.layers.push(layer);
        (self.layers.len() - 1) as LayerIdx
    }
}

#[cfg(test)]
mod test;
