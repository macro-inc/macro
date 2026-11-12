//! Regions of similar pixels, what the magic wand selects and the paint
//! bucket fills: a scanline flood fill from a seed, or a sweep of the whole
//! area, then optionally antialiased.
//!
//! Pixels compare premultiplied (so every fully transparent pixel matches
//! every other), each channel within the tolerance of the seed's.

use crate::raster::{IRect, Raster, TILE};
use std::sync::Arc;

/// One bit per pixel of a rectangle; rows are allocated when first set.
pub(super) struct Bits {
    rect: IRect,
    words: usize,
    rows: Vec<Option<Box<[u64]>>>,
}

impl Bits {
    fn new(rect: IRect) -> Bits {
        Bits {
            rect,
            words: (rect.w as usize).div_ceil(64),
            rows: (0..rect.h).map(|_| None).collect(),
        }
    }

    /// The bits of row `y` (canvas), when any was set.
    fn row(&self, y: i32) -> Option<&[u64]> {
        if y < self.rect.y || y >= self.rect.bottom() {
            return None;
        }
        self.rows[(y - self.rect.y) as usize].as_deref()
    }

    /// The bit of canvas pixel `(x, y)` (clear outside the rectangle).
    fn get(&self, x: i32, y: i32) -> bool {
        if x < self.rect.x || x >= self.rect.right() {
            return false;
        }
        self.row(y).is_some_and(|r| {
            let i = (x - self.rect.x) as usize;
            r[i / 64] >> (i % 64) & 1 == 1
        })
    }

    /// Sets the bits of pixels `x0..=x1` in row `y` (all inside).
    fn set_span(&mut self, x0: i32, x1: i32, y: i32) {
        let words = self.words;
        let row = self.rows[(y - self.rect.y) as usize]
            .get_or_insert_with(|| vec![0u64; words].into_boxed_slice());
        for i in (x0 - self.rect.x) as usize..=(x1 - self.rect.x) as usize {
            row[i / 64] |= 1 << (i % 64);
        }
    }
}

/// A pixel as compared: premultiplied color and alpha.
fn key(px: [u8; 4]) -> [i16; 4] {
    let a = u32::from(px[3]);
    let p = |v: u8| ((u32::from(v) * a + 127) / 255) as i16;
    [p(px[0]), p(px[1]), p(px[2]), a as i16]
}

/// Finds the region: pixels in `bounds` whose samples are within
/// `tolerance` of the seed's, connected to the seed (4-way) when
/// `contiguous`. `None` when the seed is outside `bounds`.
pub(super) fn find(
    sample: &dyn Fn(i32, i32) -> [u8; 4],
    bounds: IRect,
    seed: (i32, i32),
    tolerance: u8,
    contiguous: bool,
) -> Option<Bits> {
    if !bounds.contains(seed.0, seed.1) {
        return None;
    }
    let want = key(sample(seed.0, seed.1));
    let tol = i16::from(tolerance);
    let like = |x: i32, y: i32| {
        let k = key(sample(x, y));
        (0..4).all(|i| (k[i] - want[i]).abs() <= tol)
    };
    let mut inside = Bits::new(bounds);
    if !contiguous {
        for y in bounds.y..bounds.bottom() {
            let mut x = bounds.x;
            while x < bounds.right() {
                if like(x, y) {
                    let start = x;
                    while x + 1 < bounds.right() && like(x + 1, y) {
                        x += 1;
                    }
                    inside.set_span(start, x, y);
                }
                x += 1;
            }
        }
        return Some(inside);
    }
    // Pixels found unlike the seed, so each is sampled once.
    let mut unlike = Bits::new(bounds);
    let mut test = |inside: &Bits, x: i32, y: i32| -> bool {
        if inside.get(x, y) || unlike.get(x, y) {
            return false;
        }
        if like(x, y) {
            return true;
        }
        unlike.set_span(x, x, y);
        false
    };
    let (sx, sy) = seed;
    let (mut l, mut r) = (sx, sx);
    while l > bounds.x && test(&inside, l - 1, sy) {
        l -= 1;
    }
    while r + 1 < bounds.right() && test(&inside, r + 1, sy) {
        r += 1;
    }
    inside.set_span(l, r, sy);
    // Spans to look beside: (x0, x1, y of the span, direction to look).
    let mut stack = vec![(l, r, sy, 1), (l, r, sy, -1)];
    while let Some((l, r, y, dir)) = stack.pop() {
        let ny = y + dir;
        if ny < bounds.y || ny >= bounds.bottom() {
            continue;
        }
        let mut x = l;
        while x <= r {
            if !test(&inside, x, ny) {
                x += 1;
                continue;
            }
            let mut start = x;
            while start > bounds.x && test(&inside, start - 1, ny) {
                start -= 1;
            }
            let mut end = x;
            while end + 1 < bounds.right() && test(&inside, end + 1, ny) {
                end += 1;
            }
            inside.set_span(start, end, ny);
            stack.push((start, end, ny, dir));
            // The span may reach past its parent and around a corner.
            if start < l || end > r {
                stack.push((start, end, ny, -dir));
            }
            x = end + 2;
        }
    }
    Some(inside)
}

/// The region's coverage as a one-channel raster at the canvas origin;
/// `antialias` softens its staircase edges (straight edges stay crisp).
pub(super) fn coverage(bits: &Bits, antialias: bool) -> Raster {
    let mut out = Raster::gray();
    let full: Arc<[u8]> = vec![255u8; (TILE * TILE) as usize].into();
    let mut tile = vec![0u8; (TILE * TILE) as usize];
    for (tx, ty) in bits.rect.tiles() {
        let tr = IRect::tile(tx, ty);
        let part = tr.intersect(&bits.rect);
        let reach = if antialias { 1 } else { 0 };
        if (part.y - reach..part.bottom() + reach).all(|y| bits.row(y).is_none()) {
            continue;
        }
        tile.fill(0);
        let mut any = false;
        for y in part.y..part.bottom() {
            let rows = [bits.row(y - 1), bits.row(y), bits.row(y + 1)];
            let present = if antialias {
                rows.iter().any(Option::is_some)
            } else {
                rows[1].is_some()
            };
            if !present {
                continue;
            }
            for x in part.x..part.right() {
                let v = if antialias {
                    smooth(bits.rect, rows, x)
                } else if bit(bits.rect, rows[1], x) == 1 {
                    255
                } else {
                    0
                };
                if v != 0 {
                    tile[((y - tr.y) * TILE + (x - tr.x)) as usize] = v;
                    any = true;
                }
            }
        }
        if any {
            let data = if tile.iter().all(|&v| v == 255) {
                full.clone()
            } else {
                Arc::from(&tile[..])
            };
            out.set_tile(tx, ty, Some(data));
        }
    }
    out
}

/// The bit of pixel `x` in a row of bits over `rect` (0 outside).
fn bit(rect: IRect, row: Option<&[u64]>, x: i32) -> u32 {
    if x < rect.x || x >= rect.right() {
        return 0;
    }
    let i = (x - rect.x) as usize;
    row.map_or(0, |r| (r[i / 64] >> (i % 64) & 1) as u32)
}

/// An antialiased pixel from the rows above, at, and below it: its 3×3
/// neighborhood blurred with a tent (`[1 2 1]` each way), then stretched
/// so a straight edge's pixels land back on 0 and 255 while staircase
/// corners take values between.
fn smooth(rect: IRect, [above, row, below]: [Option<&[u64]>; 3], x: i32) -> u8 {
    let tent = 4 * bit(rect, row, x)
        + 2 * (bit(rect, row, x - 1)
            + bit(rect, row, x + 1)
            + bit(rect, above, x)
            + bit(rect, below, x))
        + bit(rect, above, x - 1)
        + bit(rect, above, x + 1)
        + bit(rect, below, x - 1)
        + bit(rect, below, x + 1);
    // 2 · tent/16 − 0.5, in 255ths.
    let v = (tent as f32 / 8.0 - 0.5).clamp(0.0, 1.0);
    (v * 255.0 + 0.5) as u8
}
