//! Filters on a layer's pixels (or a mask), limited to a selection when
//! given: blurs, sharpening, noise, pixelation, and per-pixel functions.

use crate::raster::{IRect, Raster, Selection};

/// Gaussian Blur of `radius` pixels. Returns the area that changed.
pub fn gaussian_blur(
    target: &mut Raster,
    selection: Option<&Selection>,
    radius: f32,
) -> Option<IRect> {
    let _ = (target, selection, radius);
    todo!("filters::gaussian_blur")
}

/// Unsharp Mask: `amount` (1.0 is 100%), `radius` pixels, `threshold`
/// levels. Returns the area that changed.
pub fn unsharp_mask(
    target: &mut Raster,
    selection: Option<&Selection>,
    amount: f32,
    radius: f32,
    threshold: u8,
) -> Option<IRect> {
    let _ = (target, selection, amount, radius, threshold);
    todo!("filters::unsharp_mask")
}

/// Add Noise: `amount` (`0..=1`), uniform or Gaussian, colored or
/// monochromatic, from a seed. Returns the area that changed.
pub fn add_noise(
    target: &mut Raster,
    selection: Option<&Selection>,
    amount: f32,
    gaussian: bool,
    monochrome: bool,
    seed: u64,
) -> Option<IRect> {
    let _ = (target, selection, amount, gaussian, monochrome, seed);
    todo!("filters::add_noise")
}

/// Mosaic with `cell`-pixel squares. Returns the area that changed.
pub fn mosaic(target: &mut Raster, selection: Option<&Selection>, cell: u32) -> Option<IRect> {
    let _ = (target, selection, cell);
    todo!("filters::mosaic")
}

/// Motion Blur along `angle` degrees over `distance` pixels. Returns the
/// area that changed.
pub fn motion_blur(
    target: &mut Raster,
    selection: Option<&Selection>,
    angle: f32,
    distance: f32,
) -> Option<IRect> {
    let _ = (target, selection, angle, distance);
    todo!("filters::motion_blur")
}

/// Applies `f` to every RGBA pixel's samples (blended by selection
/// coverage). Returns the area that changed.
pub fn map_pixels(
    target: &mut Raster,
    selection: Option<&Selection>,
    f: &mut dyn FnMut(&mut [u8]),
) -> Option<IRect> {
    let _ = (target, selection, f);
    todo!("filters::map_pixels")
}
