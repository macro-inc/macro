//! The operations the editor sends, and what they name.

use super::paint::Brush;
use super::transform::Interpolation;
use crate::model::{
    Adjustment, BlendMode, BlendRanges, Effects, Fill, Gradient, Guide, Locks, Rgb, TextLayer,
    VectorMask, VectorStroke,
};
use crate::raster::IRect;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

/// Where in a stack a layer goes.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type", content = "id")]
pub enum Position {
    /// On top of the stack.
    #[default]
    Top,
    /// At the bottom of the stack.
    Bottom,
    /// Directly above a layer.
    Above(u32),
    /// Directly below a layer.
    Below(u32),
}

/// What a pixel operation changes.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Target {
    /// The layer's pixels.
    #[default]
    Pixels,
    /// The layer's pixel mask.
    Mask,
}

/// What a new pixel mask starts as.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MaskInit {
    /// White: shows everything.
    #[default]
    RevealAll,
    /// Black: hides everything.
    HideAll,
    /// Shows the selection.
    RevealSelection,
    /// Hides the selection.
    HideSelection,
    /// The layer's own transparency.
    Transparency,
}

/// A filter applied to pixels.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum FilterSpec {
    /// Gaussian Blur.
    GaussianBlur {
        /// Radius in pixels.
        radius: f32,
    },
    /// Unsharp Mask.
    UnsharpMask {
        /// Amount (1.0 is 100%).
        amount: f32,
        /// Radius in pixels.
        radius: f32,
        /// Threshold in levels.
        threshold: u8,
    },
    /// Add Noise.
    AddNoise {
        /// Amount, `0..=1`.
        amount: f32,
        /// Gaussian rather than uniform.
        gaussian: bool,
        /// The same noise in every channel.
        monochrome: bool,
        /// Random seed.
        seed: u64,
    },
    /// Mosaic.
    Mosaic {
        /// Cell size in pixels.
        cell: u32,
    },
    /// Motion Blur.
    MotionBlur {
        /// Direction in degrees.
        angle: f32,
        /// Distance in pixels.
        distance: f32,
    },
    /// An adjustment applied to the pixels themselves (Image >
    /// Adjustments).
    Adjust {
        /// The adjustment.
        adjustment: Adjustment,
    },
    /// Desaturate.
    Desaturate,
}

/// What a new layer is.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum NewLayer {
    /// An empty pixel layer.
    Pixel,
    /// An empty group.
    Group,
    /// A fill layer (a shape layer with `path`).
    Fill {
        /// What it paints.
        fill: Fill,
        /// The shape, when a shape layer.
        path: Option<VectorMask>,
        /// The shape's stroke.
        stroke: Option<VectorStroke>,
    },
    /// An adjustment layer.
    Adjustment {
        /// Its settings.
        adjustment: Adjustment,
    },
    /// A text layer.
    Text {
        /// The text.
        text: TextLayer,
    },
}

/// Changes to a layer's simple properties; absent fields stay.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayerPatch {
    /// Name.
    pub name: Option<String>,
    /// Shown.
    pub visible: Option<bool>,
    /// Opacity, `0..=255`.
    pub opacity: Option<u8>,
    /// Fill opacity, `0..=255`.
    pub fill_opacity: Option<u8>,
    /// Blend mode.
    pub blend: Option<BlendMode>,
    /// Clipped to the layer below.
    pub clipping: Option<bool>,
    /// Locks.
    pub locks: Option<Locks>,
    /// Color tag.
    pub color_tag: Option<u8>,
    /// A group is expanded.
    pub open: Option<bool>,
    /// Knockout (0 none, 1 shallow, 2 deep).
    pub knockout: Option<u8>,
    /// Blend Clipped Layers as Group.
    pub blend_clipped_as_group: Option<bool>,
    /// Blend Interior Effects as Group.
    pub blend_interior_as_group: Option<bool>,
    /// Transparency Shapes Layer.
    pub transparency_shapes: Option<bool>,
}

/// Changes to a pixel mask's settings; absent fields stay.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MaskPatch {
    /// Turned off.
    pub disabled: Option<bool>,
    /// Moves with the layer.
    pub linked: Option<bool>,
    /// Density, `0..=1`.
    pub density: Option<f32>,
    /// Feather in pixels.
    pub feather: Option<f32>,
}

/// An edit operation.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "op")]
pub enum Op {
    /// Changes simple properties of layers.
    SetLayer {
        /// Layers.
        ids: Vec<u32>,
        /// The changes.
        #[serde(flatten)]
        patch: LayerPatch,
    },
    /// Adds a layer; the step's `created` reports its id.
    NewLayer {
        /// The group it goes in (`None`: the top level).
        parent: Option<u32>,
        /// Where in that stack.
        #[serde(default)]
        position: Position,
        /// Its name (Photoshop's default when absent).
        name: Option<String>,
        /// What it is.
        kind: NewLayer,
    },
    /// Deletes layers (a group with what it holds).
    Delete {
        /// Layers.
        ids: Vec<u32>,
    },
    /// Copies layers, each just above itself.
    Duplicate {
        /// Layers.
        ids: Vec<u32>,
    },
    /// Moves layers into a stack, keeping their order.
    Move {
        /// Layers.
        ids: Vec<u32>,
        /// The group (`None`: the top level).
        parent: Option<u32>,
        /// Where in that stack.
        position: Position,
    },
    /// Puts layers in a new group where the topmost of them was.
    Group {
        /// Layers.
        ids: Vec<u32>,
        /// The group's name.
        name: Option<String>,
    },
    /// Replaces a group by its layers.
    Ungroup {
        /// The group.
        id: u32,
    },
    /// Merges layers into one pixel layer (the topmost's place and name);
    /// a single layer merges into the one below it.
    Merge {
        /// Layers.
        ids: Vec<u32>,
    },
    /// Flattens every visible layer into a Background layer.
    Flatten,
    /// Turns text, fill, shape, and smart object layers into pixels.
    Rasterize {
        /// Layers.
        ids: Vec<u32>,
    },
    /// Moves layers (and what moves with them) by whole pixels.
    Translate {
        /// Layers (a group moves everything in it).
        ids: Vec<u32>,
        /// Horizontal offset.
        dx: i32,
        /// Vertical offset.
        dy: i32,
    },
    /// Free transform: maps layers through `matrix` (`[a, b, c, d, e, f]`,
    /// canvas `(x, y)` to `(a·x + c·y + e, b·x + d·y + f)`).
    Transform {
        /// Layers.
        ids: Vec<u32>,
        /// The map.
        matrix: [f64; 6],
        /// Resampling.
        #[serde(default)]
        interpolation: Interpolation,
    },
    /// Mirrors layers about the center of their combined bounds.
    Flip {
        /// Layers.
        ids: Vec<u32>,
        /// Left-right rather than top-bottom.
        horizontal: bool,
    },
    /// Turns layers by quarter turns clockwise about the center of their
    /// combined bounds.
    Rotate {
        /// Layers.
        ids: Vec<u32>,
        /// Quarter turns.
        quarters: i32,
    },
    /// Continues a brush stroke (`stroke` names it; send the same `stroke`
    /// with every batch of points, and `done` with the last).
    Paint {
        /// The layer.
        id: u32,
        /// Its pixels or its mask.
        #[serde(default)]
        target: Target,
        /// The stroke.
        stroke: u32,
        /// The brush.
        brush: Brush,
        /// Points: canvas x, y, and pen pressure `0..=1`.
        points: Vec<[f32; 3]>,
        /// The pointer was released.
        #[serde(default)]
        done: bool,
    },
    /// Fills the selection (or the whole layer) with a color.
    Fill {
        /// The layer.
        id: u32,
        /// Its pixels or its mask.
        #[serde(default)]
        target: Target,
        /// The color.
        color: Rgb,
        /// Opacity, `0..=1`.
        opacity: f32,
    },
    /// The paint bucket.
    Bucket {
        /// The layer.
        id: u32,
        /// Its pixels or its mask.
        #[serde(default)]
        target: Target,
        /// Where it was clicked.
        x: i32,
        /// Where it was clicked.
        y: i32,
        /// The color.
        color: Rgb,
        /// Opacity, `0..=1`.
        opacity: f32,
        /// Tolerance in levels.
        tolerance: u8,
        /// Only pixels connected to the click.
        contiguous: bool,
        /// Antialiased edges.
        antialias: bool,
        /// Compares the merged image rather than the layer.
        sample_all: bool,
    },
    /// The gradient tool.
    Gradient {
        /// The layer.
        id: u32,
        /// Its pixels or its mask.
        #[serde(default)]
        target: Target,
        /// The gradient.
        gradient: Gradient,
        /// Start point.
        from: (f32, f32),
        /// End point.
        to: (f32, f32),
        /// Opacity, `0..=1`.
        opacity: f32,
    },
    /// Deletes the selected pixels (on a mask: paints them black).
    Clear {
        /// The layer.
        id: u32,
        /// Its pixels or its mask.
        #[serde(default)]
        target: Target,
    },
    /// Applies a filter (within the selection).
    Filter {
        /// The layer.
        id: u32,
        /// Its pixels or its mask.
        #[serde(default)]
        target: Target,
        /// The filter.
        filter: FilterSpec,
    },
    /// Layer via Copy (or Cut): the selected pixels as a new layer above.
    CopyToLayer {
        /// The layer.
        id: u32,
        /// Removes them from the layer.
        cut: bool,
    },
    /// Adds a pixel mask.
    AddMask {
        /// The layer.
        id: u32,
        /// What it starts as.
        init: MaskInit,
    },
    /// Removes a pixel mask, first applying it to the pixels when `apply`.
    DeleteMask {
        /// The layer.
        id: u32,
        /// Bake it into the layer's transparency.
        apply: bool,
    },
    /// Changes a pixel mask's settings.
    SetMask {
        /// The layer.
        id: u32,
        /// The changes.
        #[serde(flatten)]
        patch: MaskPatch,
    },
    /// Sets or removes a vector mask.
    SetVectorMask {
        /// The layer.
        id: u32,
        /// The mask (`None` removes it).
        mask: Option<VectorMask>,
    },
    /// Replaces a text layer's text (its pixels are laid out again).
    SetText {
        /// The layer.
        id: u32,
        /// The text.
        text: TextLayer,
    },
    /// Changes a fill or shape layer's fill and stroke.
    SetFill {
        /// The layer.
        id: u32,
        /// What it paints.
        fill: Fill,
        /// The shape's stroke (`None` keeps it, `Some(None)` removes it).
        #[serde(default, with = "double_option")]
        stroke: Option<Option<VectorStroke>>,
    },
    /// Changes an adjustment layer's settings.
    SetAdjustment {
        /// The layer.
        id: u32,
        /// Its settings.
        adjustment: Adjustment,
    },
    /// Sets or removes a layer's style.
    SetEffects {
        /// The layer.
        id: u32,
        /// The style (`None` clears it).
        effects: Option<Effects>,
    },
    /// Sets or removes Blend If ranges.
    SetBlendRanges {
        /// The layer.
        id: u32,
        /// The ranges (`None`: everything blends).
        ranges: Option<BlendRanges>,
    },
    /// Crops the canvas (pixels outside stay in the layers).
    Crop {
        /// The new canvas, in current canvas pixels.
        rect: IRect,
    },
    /// Changes the canvas size, keeping pixels where `anchor` says
    /// (`(0, 0)` top left, `(0.5, 0.5)` center).
    CanvasSize {
        /// New width.
        width: u32,
        /// New height.
        height: u32,
        /// Anchor, `0..=1` each.
        anchor: (f32, f32),
    },
    /// Resamples the whole document.
    ImageSize {
        /// New width.
        width: u32,
        /// New height.
        height: u32,
        /// Resampling.
        #[serde(default)]
        interpolation: Interpolation,
    },
    /// Turns the canvas by quarter turns clockwise.
    RotateCanvas {
        /// Quarter turns.
        quarters: i32,
    },
    /// Mirrors the canvas.
    FlipCanvas {
        /// Left-right rather than top-bottom.
        horizontal: bool,
    },
    /// Replaces the ruler guides.
    SetGuides {
        /// Guides.
        guides: Vec<Guide>,
    },
    /// Sets the resolution.
    SetResolution {
        /// Pixels per inch.
        ppi: f64,
    },
    /// Converts a CMYK, Lab, grayscale, indexed, or high-bit document to
    /// 8-bit RGB (Image > Mode), so it can be edited.
    ConvertToRgb,
    /// Places pixels as a new layer (pasting, placing an image).
    Place {
        /// The new layer's name.
        name: String,
        /// Where the pixels go.
        rect: IRect,
        /// Straight RGBA, row by row (not sent as JSON).
        #[serde(skip)]
        rgba: Arc<[u8]>,
        /// The group it goes in.
        parent: Option<u32>,
        /// Where in that stack.
        #[serde(default)]
        position: Position,
    },
}

mod double_option {
    use serde::{Deserialize, Deserializer, Serialize, Serializer};

    pub fn serialize<T: Serialize, S: Serializer>(
        v: &Option<Option<T>>,
        s: S,
    ) -> Result<S::Ok, S::Error> {
        match v {
            None => s.serialize_none(),
            Some(inner) => inner.serialize(s),
        }
    }

    pub fn deserialize<'de, T: Deserialize<'de>, D: Deserializer<'de>>(
        d: D,
    ) -> Result<Option<Option<T>>, D::Error> {
        Option::<T>::deserialize(d).map(Some)
    }
}
