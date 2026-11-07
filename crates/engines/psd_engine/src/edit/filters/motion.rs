//! Motion blur: averaging along a line through each pixel.
//!
//! Short blurs convolve with the line itself (sampled every half pixel and
//! spread bilinearly over the pixels it crosses), which keeps detail
//! across the motion sharp. Long ones turn the pixels so the motion runs
//! along rows, smear the rows with a running box sum (constant cost per
//! pixel at any length), and turn them back; quarter turns are exact, so
//! level and plumb blurs lose nothing.

use super::premul::{add_rows, add_scaled, load, store};
use crate::edit::transform::{self, Interpolation};
use crate::raster::{IRect, Raster};
use std::collections::BTreeMap;

/// The most taps a short blur convolves with.
const MAX_TAPS: usize = 64;

/// A motion blur's line: offsets and weights.
pub(super) struct Line {
    taps: Vec<(i32, i32, f32)>,
    /// How far it reaches across and down.
    reach: (i32, i32),
}

impl Line {
    /// The line of a blur `distance` pixels long at `angle` degrees
    /// (counterclockwise from pointing right, as seen on screen).
    pub fn new(angle: f32, distance: f32) -> Line {
        let theta = f64::from(angle).to_radians();
        let (dx, dy) = (theta.cos(), -theta.sin());
        let d = f64::from(distance);
        let n = (2.0 * d).ceil().max(1.0) as usize;
        let mut weights: BTreeMap<(i32, i32), f64> = BTreeMap::new();
        for i in 0..n {
            let s = ((i as f64 + 0.5) / n as f64 - 0.5) * d;
            let (x, y) = (s * dx, s * dy);
            let (x0, y0) = (x.floor(), y.floor());
            let (fx, fy) = (x - x0, y - y0);
            for (ox, wx) in [(0, 1.0 - fx), (1, fx)] {
                for (oy, wy) in [(0, 1.0 - fy), (1, fy)] {
                    let w = wx * wy / n as f64;
                    if w > 1e-9 {
                        *weights.entry((x0 as i32 + ox, y0 as i32 + oy)).or_default() += w;
                    }
                }
            }
        }
        let reach = weights.keys().fold((0, 0), |(rx, ry), &(x, y)| {
            (rx.max(x.abs()), ry.max(y.abs()))
        });
        Line {
            taps: weights
                .into_iter()
                .map(|((x, y), w)| (x, y, w as f32))
                .collect(),
            reach,
        }
    }

    /// Whether convolving with it directly is cheap enough.
    pub fn is_short(&self) -> bool {
        self.taps.len() <= MAX_TAPS
    }

    /// How far it reaches across and down.
    pub fn reach(&self) -> (i32, i32) {
        self.reach
    }

    /// Convolves `area` of `src` with the line, a tile at a time, handing
    /// each block's premultiplied values to `f(block, values)`.
    pub fn convolve<const C: usize>(
        &self,
        src: &Raster,
        area: IRect,
        mut f: impl FnMut(IRect, &[[f32; C]]),
    ) {
        let (rx, ry) = self.reach;
        let mut buf = Vec::new();
        let mut values = Vec::new();
        for (tx, ty) in area.tiles() {
            let block = IRect::tile(tx, ty).intersect(&area);
            let input = IRect::from_ltrb(
                block.x - rx,
                block.y - ry,
                block.right() + rx,
                block.bottom() + ry,
            );
            let raw = src.read_vec(input);
            if raw.iter().all(|&v| v == 0) {
                continue;
            }
            buf.clear();
            buf.extend(raw.chunks_exact(C).map(load::<C>));
            let (bw, iw) = (block.w as usize, input.w as usize);
            values.clear();
            values.resize(bw * block.h as usize, [0.0f32; C]);
            for &(dx, dy, w) in &self.taps {
                for (row, out) in values.chunks_exact_mut(bw).enumerate() {
                    let at = (row as i32 + ry + dy) as usize * iw + (rx + dx) as usize;
                    add_rows(out, &buf[at..at + bw], w);
                }
            }
            f(block, &values);
        }
    }
}

/// A long blur: the pixels turned so the motion runs along rows, smeared,
/// and turned back. Hands `area`'s premultiplied values to `f` a tile at a
/// time.
pub(super) fn long<const C: usize>(
    src: &Raster,
    area: IRect,
    angle: f32,
    distance: f32,
    mut f: impl FnMut(IRect, &[[f32; C]]),
) {
    let (s, c) = f64::from(angle).to_radians().sin_cos();
    // (cos, -sin) — the motion on screen — turns to (1, 0).
    let turned = transform::transform(src, [c, s, -s, c, 0.0, 0.0], Interpolation::Bicubic);
    let smeared = smear::<C>(&turned, distance);
    let back = transform::transform(&smeared, [c, -s, s, c, 0.0, 0.0], Interpolation::Bicubic);
    let mut values = Vec::new();
    for (tx, ty) in area.tiles() {
        let block = IRect::tile(tx, ty).intersect(&area);
        let raw = back.read_vec(block);
        if raw.iter().all(|&v| v == 0) {
            continue;
        }
        values.clear();
        values.extend(raw.chunks_exact(C).map(load::<C>));
        f(block, &values);
    }
}

/// The raster's rows averaged over `distance` pixels (centered, with
/// partial weights at the ends), spreading past its content.
fn smear<const C: usize>(src: &Raster, distance: f32) -> Raster {
    let mut out = Raster::new(src.channels());
    let Some(content) = src.content_bounds() else {
        return out;
    };
    let half = f64::from(distance) / 2.0;
    let full = (half - 0.5).floor().max(0.0) as usize;
    let part = (half - (full as f64 + 0.5)).clamp(0.0, 1.0) as f32;
    let reach = full as i32 + 1;
    let rect = IRect::from_ltrb(
        content.x - reach,
        content.y,
        content.right() + reach,
        content.bottom(),
    );
    out.set_origin((rect.x, rect.y));
    let w = rect.w as usize;
    let inv = 1.0 / ((2 * full + 1) as f32 + 2.0 * part);
    let mut raw = vec![0u8; w * C];
    let mut line = Vec::with_capacity(w);
    for y in rect.y..rect.bottom() {
        let row = IRect::new(rect.x, y, rect.w, 1);
        src.read(row, &mut raw);
        line.clear();
        line.extend(raw.chunks_exact(C).map(load::<C>));
        let at = |i: isize| -> [f32; C] {
            if i < 0 || i as usize >= w {
                [0.0; C]
            } else {
                line[i as usize]
            }
        };
        let mut sum = [0.0f32; C];
        for i in 0..=full as isize {
            add_scaled(&mut sum, &at(i), 1.0);
        }
        for (i, px) in raw.chunks_exact_mut(C).enumerate() {
            let i = i as isize;
            let mut v = sum;
            add_scaled(&mut v, &at(i - full as isize - 1), part);
            add_scaled(&mut v, &at(i + full as isize + 1), part);
            for c in &mut v {
                *c *= inv;
            }
            store(v, px);
            add_scaled(&mut sum, &at(i + full as isize + 1), 1.0);
            add_scaled(&mut sum, &at(i - full as isize), -1.0);
        }
        out.write(row, &raw);
    }
    out
}
