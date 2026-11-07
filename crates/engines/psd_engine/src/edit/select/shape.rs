//! Shapes' coverage as one-channel rasters at the canvas origin: exact
//! area coverage for rectangles, and tiny-skia's path filling (tile by
//! tile) for ellipses and polygons.

use crate::raster::{IRect, Raster, TILE};
use std::sync::Arc;
use tiny_skia::{FillRule, Mask, Path, Transform};

/// Farthest a shape reaches from the canvas origin, in pixels.
pub(super) const MAX_COORD: f32 = (1 << 20) as f32;
/// The largest area selections work over (a billion pixels, past any
/// raster the engine can hold); larger ones are refused.
pub(super) const MAX_AREA: i64 = 1 << 30;

/// A tile of full coverage.
pub(super) fn full_tile() -> Arc<[u8]> {
    vec![255u8; (TILE * TILE) as usize].into()
}

/// The pixel rectangle a span of canvas coordinates touches.
fn pixel_span(lo: f32, hi: f32) -> (i32, i32) {
    (lo.floor() as i32, hi.ceil() as i32)
}

/// How much of each pixel in `from..to` the span `lo..hi` covers.
fn span_coverage(lo: f32, hi: f32, from: i32, to: i32) -> Vec<f32> {
    (from..to)
        .map(|p| {
            let (a, b) = (p as f32, p as f32 + 1.0);
            (hi.min(b) - lo.max(a)).clamp(0.0, 1.0)
        })
        .collect()
}

/// A rectangle's exact coverage (edges at fractional positions cover
/// their pixels partly); empty unless it has area (and not too much).
pub(super) fn rect(x0: f32, y0: f32, x1: f32, y1: f32) -> Raster {
    let mut out = Raster::gray();
    let [x0, y0, x1, y1] = [x0, y0, x1, y1].map(|v| v.clamp(-MAX_COORD, MAX_COORD));
    if !(x1 > x0 && y1 > y0) {
        return out;
    }
    let (px0, px1) = pixel_span(x0, x1);
    let (py0, py1) = pixel_span(y0, y1);
    if IRect::from_ltrb(px0, py0, px1, py1).area() > MAX_AREA {
        return out;
    }
    let cx = span_coverage(x0, x1, px0, px1);
    let cy = span_coverage(y0, y1, py0, py1);
    let area = IRect::from_ltrb(px0, py0, px1, py1);
    // Pixels covered fully: inside the edges' ceil/floor.
    let solid = IRect::from_ltrb(
        x0.ceil() as i32,
        y0.ceil() as i32,
        x1.floor() as i32,
        y1.floor() as i32,
    );
    let full = full_tile();
    let mut tile = vec![0u8; (TILE * TILE) as usize];
    for (tx, ty) in area.tiles() {
        let tr = IRect::tile(tx, ty);
        if solid.contains_rect(&tr) {
            out.set_tile(tx, ty, Some(full.clone()));
            continue;
        }
        let part = tr.intersect(&area);
        tile.fill(0);
        for y in part.y..part.bottom() {
            let fy = cy[(y - py0) as usize];
            let row = ((y - tr.y) * TILE) as usize;
            for x in part.x..part.right() {
                let v = fy * cx[(x - px0) as usize];
                tile[row + (x - tr.x) as usize] = (v * 255.0 + 0.5) as u8;
            }
        }
        if tile.iter().any(|&v| v != 0) {
            out.set_tile(tx, ty, Some(Arc::from(&tile[..])));
        }
    }
    out
}

/// A path's coverage (nonzero winding), filled tile by tile (empty when
/// its bounds are too large). `inside` names tiles the path is known to
/// cover fully, which skip filling.
pub(super) fn path(path: &Path, antialias: bool, inside: &dyn Fn(IRect) -> bool) -> Raster {
    let mut out = Raster::gray();
    let b = path.bounds();
    let area = IRect::from_ltrb(
        b.left().floor() as i32,
        b.top().floor() as i32,
        b.right().ceil() as i32 + 1,
        b.bottom().ceil() as i32 + 1,
    );
    if area.area() > MAX_AREA {
        return out;
    }
    let Some(mut mask) = Mask::new(TILE as u32, TILE as u32) else {
        return out;
    };
    let full = full_tile();
    for (tx, ty) in area.tiles() {
        let tr = IRect::tile(tx, ty);
        if inside(tr) {
            out.set_tile(tx, ty, Some(full.clone()));
            continue;
        }
        mask.clear();
        let shift = Transform::from_translate(-(tr.x as f32), -(tr.y as f32));
        mask.fill_path(path, FillRule::Winding, antialias, shift);
        let data = mask.data();
        if data.iter().all(|&v| v == 0) {
            continue;
        }
        let tile = if data.iter().all(|&v| v == 255) {
            full.clone()
        } else {
            Arc::from(data)
        };
        out.set_tile(tx, ty, Some(tile));
    }
    out
}
