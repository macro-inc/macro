//! Layer effects: shadows, glows, bevels, satin, overlays, and strokes.

use super::*;
use serde::{Deserialize, Serialize};

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
