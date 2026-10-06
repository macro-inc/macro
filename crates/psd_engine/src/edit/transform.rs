//! Transforming pixels: free transforms (any affine map) with resampling,
//! and exact flips and quarter turns.
//!
//! Results cover the transformed bounds of the source's content, with
//! their tile grid starting at that area's top left. Maps that carry whole
//! pixels onto whole pixels (whole-pixel moves, flips, quarter turns) move
//! samples exactly instead of resampling.

mod exact;
mod resample;

use crate::raster::Raster;
use exact::Exact;

/// Resampling methods.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Interpolation {
    /// Nearest neighbor.
    Nearest,
    /// Bilinear.
    Bilinear,
    /// Bicubic.
    #[default]
    Bicubic,
}

/// The raster's pixels mapped through `m` (`[a, b, c, d, e, f]`: canvas
/// `(x, y)` goes to `(a·x + c·y + e, b·x + d·y + f)`), resampled; works for
/// RGBA (premultiplied while filtering) and one-channel rasters.
///
/// Bilinear and bicubic downscales by more than half average over each
/// output pixel's footprint. A map that collapses the pixels (no area), or
/// that would make over a billion of them, leaves nothing; one that is not
/// all numbers leaves them as they are.
pub fn transform(src: &Raster, m: [f64; 6], interpolation: Interpolation) -> Raster {
    if !m.iter().all(|v| v.is_finite()) {
        return src.clone();
    }
    match Exact::from_matrix(m) {
        Some(exact) => exact.apply(src),
        None => resample::resample(src, m, interpolation),
    }
}

/// A doubled canvas position as a whole number of pixels (positions snap
/// to the nearest half pixel, so pixels stay whole).
fn doubled(v: f64) -> Option<i32> {
    let v = (2.0 * v).round();
    (v.is_finite() && v.abs() <= f64::from(1 << 24)).then_some(v as i32)
}

/// Mirrors pixels across the vertical line `x = axis` (exact; the axis
/// snaps to the nearest half pixel).
pub fn flip_horizontal(src: &Raster, axis: f64) -> Raster {
    match doubled(axis) {
        Some(e) => Exact::new(-1, 0, 0, 1, e, 0).apply(src),
        None => src.clone(),
    }
}

/// Mirrors pixels across the horizontal line `y = axis` (exact; the axis
/// snaps to the nearest half pixel).
pub fn flip_vertical(src: &Raster, axis: f64) -> Raster {
    match doubled(axis) {
        Some(f) => Exact::new(1, 0, 0, -1, 0, f).apply(src),
        None => src.clone(),
    }
}

/// Turns pixels by `quarters` quarter turns clockwise (as seen on screen)
/// about `center`. Always exact: a center on a pixel corner or center turns
/// in place, and any other shifts by half a pixel so pixels stay whole.
pub fn rotate_quarters(src: &Raster, quarters: i32, center: (f64, f64)) -> Raster {
    let (Some(cx2), Some(cy2)) = (doubled(center.0), doubled(center.1)) else {
        return src.clone();
    };
    // Turning about (cx, cy): one quarter takes (x, y) to
    // (cx + cy - y, cy - cx + x); the translations are rounded halves.
    let half = |v: i32| v.div_euclid(2) + i32::from(v.rem_euclid(2) == 1);
    match quarters.rem_euclid(4) {
        0 => src.clone(),
        1 => Exact::new(0, 1, -1, 0, half(cx2 + cy2), half(cy2 - cx2)).apply(src),
        2 => Exact::new(-1, 0, 0, -1, cx2, cy2).apply(src),
        _ => Exact::new(0, -1, 1, 0, half(cx2 - cy2), half(cy2 + cx2)).apply(src),
    }
}

#[cfg(test)]
mod test;
