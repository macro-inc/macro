//! Growing and shrinking selections by a distance: an exact Euclidean
//! distance transform (Felzenszwalb and Huttenlocher's lower envelope of
//! parabolas) from the selected pixels, or from the unselected ones, so the
//! cost does not depend on the distance and round shapes stay round.
//!
//! Only distances up to the growth matter, so the work goes in tiles, each
//! measured over a halo that wide around it: memory stays bounded however
//! large the selection.

use crate::raster::{IRect, Raster, Selection};

/// Pixels at or above this coverage count as selected.
const SELECTED: u8 = 128;
/// The most a selection grows or shrinks (Photoshop's).
pub(super) const MAX_DISTANCE: i32 = 500;
/// Side of the tiles worked on (more for long distances).
const SIDE: i32 = 512;

/// Grows (positive) or shrinks (negative) a selection by `pixels`, with
/// antialiased edges where the new edge is not straight.
pub(super) fn expand(selection: &Selection, pixels: i32) -> Selection {
    let pixels = pixels.clamp(-MAX_DISTANCE, MAX_DISTANCE);
    let Some(bounds) = selection.mask.content_bounds() else {
        return Selection::none();
    };
    if pixels == 0 {
        return selection.clone();
    }
    let grow = pixels > 0;
    let r = f64::from(pixels.unsigned_abs());
    // Growing needs room for the growth; shrinking, a ring of unselected
    // pixels around the selection to measure from.
    let area = bounds.outset(if grow { pixels + 1 } else { 1 });
    // Distance to the nearest feature: selected pixels when growing,
    // unselected ones when shrinking. Past `far` is far enough.
    let far = pixels.unsigned_abs() as u16 + 2;
    let halo = i32::from(far);
    let side = SIDE.max(4 * halo);
    let feature = |v: u8| (v >= SELECTED) == grow;
    let cap = f64::from(far) * f64::from(far);
    let mut mask = Raster::gray();
    let mut cover = Vec::new();
    let mut out = Vec::new();
    for y in (area.y..area.bottom()).step_by(side as usize) {
        for x in (area.x..area.right()).step_by(side as usize) {
            let part = IRect::new(x, y, side, side).intersect(&area);
            // Pixels past the area are unselected, and past its edge ring
            // never nearer than the ring itself.
            let ctx = part.outset(halo).intersect(&area);
            let (w, h) = (ctx.w as usize, ctx.h as usize);
            cover.clear();
            cover.resize(w * h, 0);
            selection.mask.read(ctx, &mut cover);
            let columns = column_distances(&cover, w, h, far, feature);
            let mut f = vec![0.0; w];
            let mut d2 = vec![0.0; w];
            let mut v = vec![0usize; w];
            let mut z = vec![0.0; w + 1];
            out.clear();
            for row in (part.y - ctx.y) as usize..(part.bottom() - ctx.y) as usize {
                let line = row * w..(row + 1) * w;
                for (f, &c) in f.iter_mut().zip(&columns[line.clone()]) {
                    *f = f64::from(c) * f64::from(c);
                }
                envelope(&f, &mut d2, &mut v, &mut z);
                let cols = (part.x - ctx.x) as usize..(part.right() - ctx.x) as usize;
                for (&px, &d2) in cover[line][cols.clone()].iter().zip(&d2[cols]) {
                    let d = d2.min(cap).sqrt();
                    let edge = if grow {
                        (r + 1.0 - d).clamp(0.0, 1.0)
                    } else {
                        (d - r).clamp(0.0, 1.0)
                    };
                    let edge = (edge * 255.0 + 0.5) as u8;
                    out.push(if grow { px.max(edge) } else { px.min(edge) });
                }
            }
            mask.write(part, &out);
        }
    }
    Selection { mask }
}

/// For each pixel of a `w × h` grid, the distance up or down its column to
/// the nearest pixel where `feature` holds (`far` when none is nearer).
fn column_distances(
    cover: &[u8],
    w: usize,
    h: usize,
    far: u16,
    feature: impl Fn(u8) -> bool,
) -> Vec<u16> {
    let mut d = vec![far; w * h];
    let mut last = vec![None::<usize>; w];
    for y in 0..h {
        for (x, last) in last.iter_mut().enumerate() {
            if feature(cover[y * w + x]) {
                *last = Some(y);
            }
            if let Some(f) = *last {
                d[y * w + x] = (y - f).min(usize::from(far)) as u16;
            }
        }
    }
    last.fill(None);
    for y in (0..h).rev() {
        for (x, last) in last.iter_mut().enumerate() {
            if feature(cover[y * w + x]) {
                *last = Some(y);
            }
            if let Some(f) = *last {
                let i = y * w + x;
                d[i] = d[i].min((f - y).min(usize::from(far)) as u16);
            }
        }
    }
    d
}

/// One row of the distance transform: `out[q]` is the least
/// `f[p] + (q - p)²` over `p`, the lower envelope of parabolas rooted at
/// each `p` (`v` and `z` are scratch: `f.len()` and one more).
fn envelope(f: &[f64], out: &mut [f64], v: &mut [usize], z: &mut [f64]) {
    let n = f.len();
    if n == 0 {
        return;
    }
    let mut k = 0;
    v[0] = 0;
    z[0] = f64::NEG_INFINITY;
    z[1] = f64::INFINITY;
    for q in 1..n {
        let fq = f[q] + (q * q) as f64;
        let meet = |p: usize| (fq - (f[p] + (p * p) as f64)) / (2.0 * (q - p) as f64);
        let mut s = meet(v[k]);
        // z[0] is -inf, so this stops at the first parabola.
        while s <= z[k] {
            k -= 1;
            s = meet(v[k]);
        }
        k += 1;
        v[k] = q;
        z[k] = s;
        z[k + 1] = f64::INFINITY;
    }
    k = 0;
    for (q, o) in out.iter_mut().enumerate() {
        while z[k + 1] < q as f64 {
            k += 1;
        }
        let dq = q as f64 - v[k] as f64;
        *o = dq * dq + f[v[k]];
    }
}
