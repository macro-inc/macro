//! Filters on a layer's pixels (or a mask), limited to a selection when
//! given: blurs, sharpening, noise, pixelation, and per-pixel functions.
//!
//! Every filter works on premultiplied pixels (one-channel rasters on
//! their gray values), so transparent pixels never darken their
//! neighbors. With a selection, a filter changes only selected pixels,
//! mixing its result with the original by the selection's coverage (an
//! empty selection selects nothing). Filters reach only as far as they
//! legitimately spread: blurs into the transparent space around the
//! content, mosaic to the edges of the cells it touches, and the others no
//! further than the content's bounds (for a one-channel raster, the bounds
//! of its nonzero values). Each returns the area that changed.

mod blur;
mod local;
mod motion;
pub(crate) mod premul;

use crate::raster::{IRect, Raster, Selection};
use premul::{limit, union, write_block};

/// The widest blur and sharpening radius (Photoshop's).
const MAX_RADIUS: f32 = 1000.0;
/// Radii below this change nothing.
const MIN_RADIUS: f32 = 0.05;
/// The strongest sharpening (Photoshop's 500%).
const MAX_AMOUNT: f32 = 5.0;
/// The longest motion blur (Photoshop's).
const MAX_DISTANCE: f32 = 2000.0;
/// The largest mosaic cell.
const MAX_CELL: u32 = 1024;

/// A radius as a blur's standard deviation (Photoshop's radius is about
/// one), unless too small to change anything.
fn sigma(radius: f32) -> Option<f32> {
    (radius.is_finite() && radius >= MIN_RADIUS).then(|| radius.min(MAX_RADIUS))
}

/// Gaussian Blur of `radius` pixels. Returns the area that changed.
///
/// The radius is the blur's standard deviation (up to 1000), as in
/// Photoshop. The content spreads about three radii into the transparent
/// space around it.
pub fn gaussian_blur(
    target: &mut Raster,
    selection: Option<&Selection>,
    radius: f32,
) -> Option<IRect> {
    let sigma = sigma(radius)?;
    match target.channels() {
        4 => blur_with::<4>(target, selection, sigma),
        1 => blur_with::<1>(target, selection, sigma),
        _ => None,
    }
}

fn blur_with<const C: usize>(
    target: &mut Raster,
    selection: Option<&Selection>,
    sigma: f32,
) -> Option<IRect> {
    let content = target.content_bounds()?;
    let area = limit(content.outset(blur::reach(sigma)), selection)?;
    let src = target.clone();
    let mut changed = None;
    blur::blur::<C>(&src, area, sigma, |block, values| {
        changed = union(
            changed,
            write_block(target, selection, block, values, |_| false),
        );
    });
    changed
}

/// Unsharp Mask: `amount` (1.0 is 100%), `radius` pixels, `threshold`
/// levels. Returns the area that changed.
///
/// Each color sample moves away from its Gaussian-blurred surroundings by
/// `amount` times its difference from them, unless that difference is
/// under `threshold` levels. Alpha stays as it is.
pub fn unsharp_mask(
    target: &mut Raster,
    selection: Option<&Selection>,
    amount: f32,
    radius: f32,
    threshold: u8,
) -> Option<IRect> {
    if amount.is_nan() || amount <= 0.0 {
        return None;
    }
    let amount = amount.min(MAX_AMOUNT);
    let sigma = sigma(radius)?;
    let threshold = f32::from(threshold);
    match target.channels() {
        4 => sharpen::<4>(target, selection, amount, sigma, threshold),
        1 => sharpen::<1>(target, selection, amount, sigma, threshold),
        _ => None,
    }
}

fn sharpen<const C: usize>(
    target: &mut Raster,
    selection: Option<&Selection>,
    amount: f32,
    sigma: f32,
    threshold: f32,
) -> Option<IRect> {
    let content = target.content_bounds()?;
    let area = limit(content, selection)?;
    let src = target.clone();
    let mut changed = None;
    let mut values = Vec::new();
    blur::blur::<C>(&src, area, sigma, |block, blurred| {
        let raw = src.read_vec(block);
        values.clear();
        values.extend(
            raw.chunks_exact(C)
                .zip(blurred)
                .map(|(px, b)| sharpened::<C>(px, b, amount, threshold)),
        );
        let keep = |px: &[u8]| C == 4 && px[3] == 0;
        changed = union(
            changed,
            write_block(target, selection, block, &values, keep),
        );
    });
    changed
}

/// A pixel sharpened against its blurred surroundings (premultiplied).
fn sharpened<const C: usize>(
    px: &[u8],
    blurred: &[f32; C],
    amount: f32,
    threshold: f32,
) -> [f32; C] {
    let sharpen = |v: f32, blur: f32| {
        let d = v - blur;
        if d.abs() < threshold {
            v
        } else {
            (v + amount * d).clamp(0.0, 255.0)
        }
    };
    let mut out = [0.0f32; C];
    let o: &mut [f32] = &mut out;
    let b: &[f32] = blurred;
    if o.len() == 4 {
        let a = f32::from(px[3]);
        for ((o, &v), &bv) in o.iter_mut().zip(&px[..3]).zip(&b[..3]) {
            let v = f32::from(v);
            // The surroundings' straight color.
            let blur = if b[3] > 0.0 {
                (bv * 255.0 / b[3]).clamp(0.0, 255.0)
            } else {
                v
            };
            *o = sharpen(v, blur) * a / 255.0;
        }
        o[3] = a;
    } else {
        o[0] = sharpen(f32::from(px[0]), b[0]);
    }
    out
}

/// Add Noise: `amount` (`0..=1`), uniform or Gaussian, colored or
/// monochromatic, from a seed. Returns the area that changed.
///
/// Uniform noise moves each color sample by up to `amount` of the full
/// range; Gaussian noise has a standard deviation of half that. The noise
/// at each canvas pixel depends only on the seed, so the same seed adds
/// the same noise. Fully transparent pixels stay as they are.
pub fn add_noise(
    target: &mut Raster,
    selection: Option<&Selection>,
    amount: f32,
    gaussian: bool,
    monochrome: bool,
    seed: u64,
) -> Option<IRect> {
    if amount.is_nan() || amount <= 0.0 {
        return None;
    }
    let amount = amount.min(1.0);
    let area = limit(target.content_bounds()?, selection)?;
    match target.channels() {
        4 => local::add_noise::<4>(target, selection, area, amount, gaussian, monochrome, seed),
        1 => local::add_noise::<1>(target, selection, area, amount, gaussian, monochrome, seed),
        _ => None,
    }
}

/// Mosaic with `cell`-pixel squares. Returns the area that changed.
///
/// Cells line up with the canvas origin; each becomes the average of its
/// pixels (transparent ones included, so cells at the content's edge turn
/// partly transparent).
pub fn mosaic(target: &mut Raster, selection: Option<&Selection>, cell: u32) -> Option<IRect> {
    if cell <= 1 {
        return None;
    }
    let cell = cell.min(MAX_CELL) as i32;
    let content = target.content_bounds()?;
    match target.channels() {
        4 => local::mosaic::<4>(target, selection, content, cell),
        1 => local::mosaic::<1>(target, selection, content, cell),
        _ => None,
    }
}

/// Motion Blur along `angle` degrees over `distance` pixels. Returns the
/// area that changed.
///
/// Each pixel averages the line `distance` pixels long through it, at
/// `angle` degrees counterclockwise from pointing right (up to 2000
/// pixels).
pub fn motion_blur(
    target: &mut Raster,
    selection: Option<&Selection>,
    angle: f32,
    distance: f32,
) -> Option<IRect> {
    if !angle.is_finite() || (distance.is_nan() || distance < 1.0) {
        return None;
    }
    let distance = distance.min(MAX_DISTANCE);
    match target.channels() {
        4 => motion_with::<4>(target, selection, angle, distance),
        1 => motion_with::<1>(target, selection, angle, distance),
        _ => None,
    }
}

fn motion_with<const C: usize>(
    target: &mut Raster,
    selection: Option<&Selection>,
    angle: f32,
    distance: f32,
) -> Option<IRect> {
    let content = target.content_bounds()?;
    let line = motion::Line::new(angle, distance);
    let src = target.clone();
    let mut changed = None;
    let mut write = |block: IRect, values: &[[f32; C]]| {
        changed = union(
            changed,
            write_block(target, selection, block, values, |_| false),
        );
    };
    if line.is_short() {
        let (rx, ry) = line.reach();
        let spread = IRect::from_ltrb(
            content.x - rx,
            content.y - ry,
            content.right() + rx,
            content.bottom() + ry,
        );
        line.convolve::<C>(&src, limit(spread, selection)?, &mut write);
    } else {
        let spread = content.outset((distance / 2.0).ceil() as i32 + 2);
        motion::long::<C>(&src, limit(spread, selection)?, angle, distance, &mut write);
    }
    changed
}

/// Applies `f` to every RGBA pixel's samples (blended by selection
/// coverage). Returns the area that changed.
///
/// Fully transparent pixels stay as they are. On a one-channel raster
/// each value goes through `f` as a gray RGBA pixel and comes back as the
/// result's luma.
pub fn map_pixels(
    target: &mut Raster,
    selection: Option<&Selection>,
    f: &mut dyn FnMut(&mut [u8]),
) -> Option<IRect> {
    let area = limit(target.content_bounds()?, selection)?;
    match target.channels() {
        4 => local::map::<4>(target, selection, area, f),
        1 => local::map::<1>(target, selection, area, f),
        _ => None,
    }
}

#[cfg(test)]
mod test;
