//! Painting: brush and pencil strokes, erasing, fills, flood fills, and
//! gradients, into RGBA layers or one-channel masks, within a selection.

use crate::model::{Gradient, Rgb};
use crate::raster::{IRect, Raster, Selection};

/// What a stroke does.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BrushMode {
    /// Paints the color.
    #[default]
    Paint,
    /// Removes pixels (paints transparency; on a mask, paints black).
    Erase,
}

/// A brush.
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Brush {
    /// Diameter in canvas pixels.
    pub size: f32,
    /// Hardness, `0..=1` (1: a hard edge).
    pub hardness: f32,
    /// Most a stroke can cover, `0..=1`.
    pub opacity: f32,
    /// How much each dab adds, `0..=1`.
    pub flow: f32,
    /// Distance between dabs as a fraction of the size.
    pub spacing: f32,
    /// Color (masks take its gray value).
    pub color: Rgb,
    /// Paint or erase.
    pub mode: BrushMode,
    /// Pencil: hard, aliased dabs.
    pub pencil: bool,
    /// Pen pressure scales the size.
    pub pressure_size: bool,
    /// Pen pressure scales the flow.
    pub pressure_opacity: bool,
}

/// A stroke in progress: points arrive as the pointer moves, and each batch
/// paints the dabs it reaches. A stroke's opacity caps what it adds however
/// often it crosses itself.
pub struct Stroke {}

impl Stroke {
    /// Starts a stroke.
    pub fn new(brush: Brush) -> Stroke {
        let _ = brush;
        todo!("Stroke::new")
    }

    /// Paints toward more points (canvas coordinates and pen pressure in
    /// `0..=1`) into `target` (RGBA or one channel), only where `selection`
    /// selects when given; `lock_alpha` keeps transparent pixels
    /// transparent. Returns the canvas area that changed.
    pub fn add(
        &mut self,
        target: &mut Raster,
        selection: Option<&Selection>,
        lock_alpha: bool,
        points: &[(f32, f32, f32)],
    ) -> Option<IRect> {
        let _ = (target, selection, lock_alpha, points);
        todo!("Stroke::add")
    }
}

/// Fills `bounds` (within `selection` when given) with a color at an
/// opacity. Returns the area that changed.
pub fn fill(
    target: &mut Raster,
    bounds: IRect,
    selection: Option<&Selection>,
    color: [u8; 4],
    opacity: f32,
    lock_alpha: bool,
) -> Option<IRect> {
    let _ = (target, bounds, selection, color, opacity, lock_alpha);
    todo!("paint::fill")
}

/// The paint bucket: fills the pixels like the one at `seed` (by `sample`,
/// within `tolerance` of it per channel; only connected ones when
/// `contiguous`), inside `bounds` and the selection. Returns the area that
/// changed.
#[expect(clippy::too_many_arguments, reason = "the paint bucket's options")]
pub fn flood_fill(
    target: &mut Raster,
    sample: &dyn Fn(i32, i32) -> [u8; 4],
    bounds: IRect,
    selection: Option<&Selection>,
    seed: (i32, i32),
    tolerance: u8,
    contiguous: bool,
    antialias: bool,
    color: [u8; 4],
    opacity: f32,
) -> Option<IRect> {
    let _ = (
        target, sample, bounds, selection, seed, tolerance, contiguous, antialias, color, opacity,
    );
    todo!("paint::flood_fill")
}

/// The gradient tool: draws `gradient` from `from` to `to` (its kind
/// decides the shape) over `bounds` within the selection. Returns the area
/// that changed.
pub fn gradient(
    target: &mut Raster,
    gradient: &Gradient,
    from: (f32, f32),
    to: (f32, f32),
    bounds: IRect,
    selection: Option<&Selection>,
    opacity: f32,
    lock_alpha: bool,
) -> Option<IRect> {
    let _ = (
        target, gradient, from, to, bounds, selection, opacity, lock_alpha,
    );
    todo!("paint::gradient")
}
