//! Filters that look at one pixel or one cell at a time: noise, mosaic,
//! and applying a function to each pixel.

use super::premul::{add_scaled, apply, load, union};
use crate::edit::paint::luma;
use crate::raster::{IRect, Raster, Selection, TILE};

/// A well-mixed 64-bit hash (SplitMix64's finalizer).
fn mix(mut h: u64) -> u64 {
    h = (h ^ (h >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    h = (h ^ (h >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    h ^ (h >> 31)
}

/// The hash of a canvas pixel under a seed.
fn pixel_hash(seed: u64, x: i32, y: i32) -> u64 {
    mix(seed ^ mix(u64::from(x as u32) << 32 | u64::from(y as u32)))
}

/// A pixel's noise for one channel, from the pixel's hash: in `-1..1`
/// (uniform), or with a standard deviation of 0.5 (Gaussian: the sum of
/// four uniform draws, which is close to normal and never strays past
/// 1.73).
fn noise(pixel: u64, channel: u64, gaussian: bool) -> f32 {
    let h = mix(pixel.wrapping_add(channel.wrapping_mul(0x9e37_79b9_7f4a_7c15)));
    if gaussian {
        let sum: u64 = (0..4).map(|i| (h >> (16 * i)) & 0xffff).sum();
        // Four draws in 0..1 have mean 2 and variance 1/3.
        let z = (sum as f32 / 65536.0 - 2.0) * 3f32.sqrt();
        0.5 * z
    } else {
        (h >> 40) as f32 / (1u64 << 23) as f32 - 1.0
    }
}

/// Add Noise over `area`: each color sample moves by up to `amount` of
/// the full range (fully transparent pixels stay as they are).
pub(super) fn add_noise<const C: usize>(
    target: &mut Raster,
    selection: Option<&Selection>,
    area: IRect,
    amount: f32,
    gaussian: bool,
    monochrome: bool,
    seed: u64,
) -> Option<IRect> {
    let scale = amount * 255.0;
    apply::<C>(target, selection, area, C == 4, |x, y, px| {
        let mut out = [0.0f32; C];
        let o: &mut [f32] = &mut out;
        let pixel = pixel_hash(seed, x, y);
        if o.len() == 4 {
            if px[3] == 0 {
                return None;
            }
            let shared = noise(pixel, 0, gaussian);
            let a = f32::from(px[3]);
            for (ch, (o, &v)) in o.iter_mut().zip(&px[..3]).enumerate() {
                let n = if monochrome {
                    shared
                } else {
                    noise(pixel, ch as u64, gaussian)
                };
                *o = (f32::from(v) + n * scale).clamp(0.0, 255.0) * a / 255.0;
            }
            o[3] = a;
        } else {
            o[0] = (f32::from(px[0]) + noise(pixel, 0, gaussian) * scale).clamp(0.0, 255.0);
        }
        Some(out)
    })
}

/// Mosaic over the cells (of `cell` pixels, aligned to the canvas origin)
/// that meet `content`: each takes its premultiplied average.
pub(super) fn mosaic<const C: usize>(
    target: &mut Raster,
    selection: Option<&Selection>,
    content: IRect,
    cell: i32,
) -> Option<IRect> {
    let snap_down = |v: i32| v.div_euclid(cell) * cell;
    let snap_up = |v: i32| (v + cell - 1).div_euclid(cell) * cell;
    let grid = IRect::from_ltrb(
        snap_down(content.x),
        snap_down(content.y),
        snap_up(content.right()),
        snap_up(content.bottom()),
    );
    let write = super::premul::limit(grid, selection)?;
    // Blocks of whole cells, about a tile across.
    let side = (TILE / cell).max(1) * cell;
    let src = target.clone();
    let mut changed = None;
    let (bx0, by0) = (write.x.div_euclid(side), write.y.div_euclid(side));
    let (bx1, by1) = (
        (write.right() - 1).div_euclid(side),
        (write.bottom() - 1).div_euclid(side),
    );
    let mut sums: Vec<[f32; C]> = Vec::new();
    for by in by0..=by1 {
        for bx in bx0..=bx1 {
            let cells = IRect::new(bx * side, by * side, side, side).intersect(&grid);
            let block = cells.intersect(&write);
            if block.is_empty() {
                continue;
            }
            let raw = src.read_vec(cells);
            if raw.iter().all(|&v| v == 0) {
                continue;
            }
            let (cw, ch) = ((cells.w / cell) as usize, (cells.h / cell) as usize);
            sums.clear();
            sums.resize(cw * ch, [0.0; C]);
            let k = 1.0 / (cell * cell) as f32;
            for (y, row) in raw.chunks_exact(cells.w as usize * C).enumerate() {
                let line = &mut sums[(y / cell as usize) * cw..][..cw];
                for (x, px) in row.chunks_exact(C).enumerate() {
                    add_scaled(&mut line[x / cell as usize], &load::<C>(px), k);
                }
            }
            let r = apply::<C>(target, selection, block, false, |x, y, _| {
                let (i, j) = (
                    ((x - cells.x) / cell) as usize,
                    ((y - cells.y) / cell) as usize,
                );
                Some(sums[j * cw + i])
            });
            changed = union(changed, r);
        }
    }
    changed
}

/// Applies `f` to each pixel of `area` (RGBA samples; one-channel pixels
/// as gray RGBA, taking back the result's luma). Fully transparent RGBA
/// pixels stay as they are.
pub(super) fn map<const C: usize>(
    target: &mut Raster,
    selection: Option<&Selection>,
    area: IRect,
    f: &mut dyn FnMut(&mut [u8]),
) -> Option<IRect> {
    apply::<C>(target, selection, area, C == 4, |_, _, px| {
        let mut out = [0.0f32; C];
        let o: &mut [f32] = &mut out;
        if o.len() == 4 {
            if px[3] == 0 {
                return None;
            }
            let mut rgba = [px[0], px[1], px[2], px[3]];
            f(&mut rgba);
            o.copy_from_slice(&load::<4>(&rgba));
        } else {
            let mut rgba = [px[0], px[0], px[0], 255];
            f(&mut rgba);
            o[0] = luma([f32::from(rgba[0]), f32::from(rgba[1]), f32::from(rgba[2])]);
        }
        Some(out)
    })
}
