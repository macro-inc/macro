//! Transforming pixels: free transforms (any affine map) with resampling,
//! and exact flips and quarter turns.

use crate::raster::Raster;

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
pub fn transform(src: &Raster, m: [f64; 6], interpolation: Interpolation) -> Raster {
    let _ = (src, m, interpolation);
    todo!("transform::transform")
}

/// Mirrors pixels across the vertical line `x = axis` (exact).
pub fn flip_horizontal(src: &Raster, axis: f64) -> Raster {
    let _ = (src, axis);
    todo!("transform::flip_horizontal")
}

/// Mirrors pixels across the horizontal line `y = axis` (exact).
pub fn flip_vertical(src: &Raster, axis: f64) -> Raster {
    let _ = (src, axis);
    todo!("transform::flip_vertical")
}

/// Turns pixels by `quarters` quarter turns clockwise about `center`
/// (exact when the center is on a pixel corner or center).
pub fn rotate_quarters(src: &Raster, quarters: i32, center: (f64, f64)) -> Raster {
    let _ = (src, quarters, center);
    todo!("transform::rotate_quarters")
}
