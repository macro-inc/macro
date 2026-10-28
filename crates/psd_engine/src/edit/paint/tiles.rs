//! Rewriting a raster's pixels tile by tile, writing only what changes.

use crate::raster::{IRect, Raster, TILE};

/// `r` within `world`, computed without overflowing however far out `r`
/// reaches (empty when they do not meet).
pub(crate) fn clamp_rect(r: IRect, world: IRect) -> IRect {
    let x0 = i64::from(r.x).max(i64::from(world.x));
    let y0 = i64::from(r.y).max(i64::from(world.y));
    let x1 = (i64::from(r.x) + i64::from(r.w)).min(i64::from(world.right()));
    let y1 = (i64::from(r.y) + i64::from(r.h)).min(i64::from(world.bottom()));
    if x1 <= x0 || y1 <= y0 {
        return IRect::default();
    }
    IRect::new(x0 as i32, y0 as i32, (x1 - x0) as i32, (y1 - y0) as i32)
}

/// Rewrites `target`'s samples inside the canvas rectangle `rect`, one tile
/// part at a time: `f(part, samples)` gets each part's canvas rectangle and
/// its samples (row by row; zeros where no tile exists) to change in place.
/// Missing tiles are passed over when `skip_missing`. Only changed rows are
/// written, tiles are created only where something changes, and a tile
/// rewritten whole to zeros is dropped. Returns the bounds of the pixels
/// that changed.
pub(crate) fn rewrite(
    target: &mut Raster,
    rect: IRect,
    skip_missing: bool,
    mut f: impl FnMut(IRect, &mut [u8]),
) -> Option<IRect> {
    let c = target.channels() as usize;
    let (ox, oy) = target.origin();
    let local = rect.translate(-ox, -oy);
    let stride = TILE as usize * c;
    let mut buf = Vec::new();
    let mut changed: Option<IRect> = None;
    for (tx, ty) in local.tiles() {
        let tile_rect = IRect::tile(tx, ty);
        let part = tile_rect.intersect(&local);
        if part.is_empty() {
            continue;
        }
        let old = target.tile(tx, ty);
        if old.is_none() && skip_missing {
            continue;
        }
        let row = part.w as usize * c;
        let start = ((part.y - tile_rect.y) * TILE + (part.x - tile_rect.x)) as usize * c;
        buf.clear();
        match old {
            Some(tile) => {
                for y in 0..part.h as usize {
                    let s = start + y * stride;
                    buf.extend_from_slice(&tile[s..s + row]);
                }
            }
            None => buf.resize(row * part.h as usize, 0),
        }
        let canvas_part = part.translate(ox, oy);
        f(canvas_part, &mut buf);

        // The changed pixels' bounds within the part: (x0, x1, y0, y1), inclusive.
        let mut span: Option<(usize, usize, usize, usize)> = None;
        for (y, new) in buf.chunks_exact(row).enumerate() {
            let cols = match old {
                Some(tile) => {
                    let s = start + y * stride;
                    diff_span(&tile[s..s + row], new, c)
                }
                None => nonzero_span(new, c),
            };
            if let Some((a, b)) = cols {
                span = Some(match span {
                    None => (a, b, y, y),
                    Some((x0, x1, y0, _)) => (x0.min(a), x1.max(b), y0, y),
                });
            }
        }
        let Some((x0, x1, y0, y1)) = span else {
            continue;
        };
        let tile = target.tile_mut(tx, ty);
        for y in y0..=y1 {
            let s = start + y * stride;
            tile[s..s + row].copy_from_slice(&buf[y * row..(y + 1) * row]);
        }
        if part == tile_rect && buf.iter().all(|&v| v == 0) {
            target.set_tile(tx, ty, None);
        }
        let r = IRect::from_ltrb(
            canvas_part.x + x0 as i32,
            canvas_part.y + y0 as i32,
            canvas_part.x + x1 as i32 + 1,
            canvas_part.y + y1 as i32 + 1,
        );
        changed = Some(changed.map_or(r, |acc| acc.union(&r)));
    }
    changed
}

/// The first and last pixels (of `c` samples) that differ between two rows.
fn diff_span(old: &[u8], new: &[u8], c: usize) -> Option<(usize, usize)> {
    if old == new {
        return None;
    }
    let pairs = || old.chunks_exact(c).zip(new.chunks_exact(c));
    let first = pairs().position(|(a, b)| a != b)?;
    let last = pairs().rposition(|(a, b)| a != b)?;
    Some((first, last))
}

/// The first and last pixels (of `c` samples) that are not all zero.
fn nonzero_span(row: &[u8], c: usize) -> Option<(usize, usize)> {
    let first = row
        .chunks_exact(c)
        .position(|p| p.iter().any(|&v| v != 0))?;
    let last = row
        .chunks_exact(c)
        .rposition(|p| p.iter().any(|&v| v != 0))?;
    Some((first, last))
}
