//! Selections: marquees, lassos, the magic wand, combining, feathering,
//! growing and shrinking, and the outlines marching ants follow.

use crate::raster::{IRect, Raster, Selection};

/// How a new selection combines with the current one.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SelectMode {
    /// Replaces it.
    #[default]
    Replace,
    /// Adds to it.
    Add,
    /// Removes from it.
    Subtract,
    /// Keeps the overlap.
    Intersect,
}

/// Combines a shape's coverage (a one-channel raster, grid at the canvas
/// origin) into a selection.
pub fn combine(selection: &mut Selection, shape: Raster, mode: SelectMode) {
    let _ = (selection, shape, mode);
    todo!("select::combine")
}

/// A rectangle's coverage (`x, y, w, h` in canvas pixels, fractional
/// edges antialiased).
pub fn rect(r: (f32, f32, f32, f32)) -> Raster {
    let _ = r;
    todo!("select::rect")
}

/// An ellipse's coverage inside `x, y, w, h`.
pub fn ellipse(r: (f32, f32, f32, f32), antialias: bool) -> Raster {
    let _ = (r, antialias);
    todo!("select::ellipse")
}

/// A polygon's coverage (lasso points, closed).
pub fn polygon(points: &[(f32, f32)], antialias: bool) -> Raster {
    let _ = (points, antialias);
    todo!("select::polygon")
}

/// The magic wand's coverage: pixels like the one at `seed` (by `sample`)
/// within `tolerance`, connected to it when `contiguous`, inside `bounds`.
pub fn magic_wand(
    sample: &dyn Fn(i32, i32) -> [u8; 4],
    bounds: IRect,
    seed: (i32, i32),
    tolerance: u8,
    contiguous: bool,
    antialias: bool,
) -> Raster {
    let _ = (sample, bounds, seed, tolerance, contiguous, antialias);
    todo!("select::magic_wand")
}

/// Selects everything within `bounds`.
pub fn all(bounds: IRect) -> Selection {
    let _ = bounds;
    todo!("select::all")
}

/// Inverts a selection within `bounds`.
pub fn invert(selection: &Selection, bounds: IRect) -> Selection {
    let _ = (selection, bounds);
    todo!("select::invert")
}

/// Softens a selection's edge by `radius` pixels.
pub fn feather(selection: &Selection, radius: f32) -> Selection {
    let _ = (selection, radius);
    todo!("select::feather")
}

/// Grows (positive) or shrinks (negative) a selection by `pixels`.
pub fn expand(selection: &Selection, pixels: i32) -> Selection {
    let _ = (selection, pixels);
    todo!("select::expand")
}

/// A layer's transparency (or a mask's values) as a selection.
pub fn from_alpha(raster: &Raster) -> Selection {
    let _ = raster;
    todo!("select::from_alpha")
}

/// The selection's edges at half coverage as closed polygons in canvas
/// pixels (for marching ants), simplified to at most about `max_points`
/// points in all.
pub fn outline(selection: &Selection, max_points: usize) -> Vec<Vec<(f32, f32)>> {
    let _ = (selection, max_points);
    todo!("select::outline")
}
