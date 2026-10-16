//! Vector masks and shape strokes.

use super::*;
use serde::{Deserialize, Serialize};

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
    /// Filled by the nonzero winding rule rather than even-odd.
    #[serde(default)]
    pub nonzero: bool,
    /// Part of the previous subpath's shape (filled with it, by its rule
    /// and operation) rather than a shape of its own.
    #[serde(default)]
    pub joined: bool,
    /// The live shape (the index of its entry in the layer's `vogk`
    /// origination data) it was drawn as.
    #[serde(default)]
    pub shape: u32,
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
