//! Vector masks and shape strokes, rasterized with tiny-skia one canvas
//! tile at a time and cached, so every render sees the same coverage
//! wherever its area is cut.
//!
//! The model does not say which subpaths form one shape component, so runs
//! of consecutive subpaths with the same operation are filled together with
//! the non-zero rule (holes wound against their outline stay open, shapes
//! combined into one stay solid) and the runs combine by their operation.

use super::cache::Cache;
use super::plane::Plane;
use crate::model::{LineCap, LineJoin, PathOp, StrokeAlign, Subpath, VectorMask, VectorStroke};
use crate::raster::{IRect, TILE};
use std::hash::{Hash, Hasher};
use std::sync::Arc;
use tiny_skia::{FillRule, Mask, PathBuilder, Transform};

/// Side of a tile, as a `usize`.
const T: usize = TILE as usize;

/// Stroke widths (canvas pixels) beyond this draw as this.
const MAX_WIDTH: f32 = 30000.0;

/// Miter limits beyond this draw as this.
const MAX_MITER: f32 = 100.0;

/// Coverage of a vector mask (inverted when it is) over `rect` at `level`.
pub(crate) fn mask_coverage(cache: &mut Cache, mask: &VectorMask, level: u8, rect: IRect) -> Plane {
    let hash = hash_mask(mask, None);
    tiled(cache, hash, level, rect, |tile| {
        mask_tile(mask, level, tile, true)
    })
}

/// Coverage of a shape layer's stroke along its vector mask over `rect`.
pub(crate) fn stroke_coverage(
    cache: &mut Cache,
    mask: &VectorMask,
    stroke: &VectorStroke,
    level: u8,
    rect: IRect,
) -> Plane {
    let hash = hash_mask(mask, Some(stroke));
    tiled(cache, hash, level, rect, |tile| {
        stroke_tile(mask, stroke, level, tile)
    })
}

/// Assembles a plane from cached tiles.
fn tiled(
    cache: &mut Cache,
    hash: u64,
    level: u8,
    rect: IRect,
    mut make: impl FnMut((i32, i32)) -> Option<Arc<[u8]>>,
) -> Plane {
    let mut out = Plane::filled(rect, 0.0);
    for (tx, ty) in rect.tiles() {
        let Some(tile) = cache.coverage(hash, level, (tx, ty), || make((tx, ty))) else {
            continue;
        };
        let tr = IRect::tile(tx, ty);
        let part = tr.intersect(&rect);
        for y in part.y..part.bottom() {
            let src = (y - tr.y) as usize * T + (part.x - tr.x) as usize;
            let dst = ((y - rect.y) * rect.w + (part.x - rect.x)) as usize;
            for (o, &v) in out.v[dst..dst + part.w as usize]
                .iter_mut()
                .zip(&tile[src..src + part.w as usize])
            {
                *o = v as f32 / 255.0;
            }
        }
    }
    out
}

/// The canvas area (level 0) a vector mask can cover, when bounded.
pub(crate) fn mask_bounds(mask: &VectorMask) -> Option<IRect> {
    if mask.invert || starts_full(mask) {
        return None;
    }
    path_bounds(&mask.subpaths)
}

/// The bounds of the subpaths' points (curves stay inside them).
pub(crate) fn path_bounds(subpaths: &[Subpath]) -> Option<IRect> {
    let mut b: Option<(f64, f64, f64, f64)> = None;
    for k in subpaths.iter().flat_map(|s| &s.knots) {
        for (x, y) in [k.before, k.anchor, k.after] {
            if !x.is_finite() || !y.is_finite() {
                continue;
            }
            b = Some(match b {
                None => (x, y, x, y),
                Some((l, t, r, bt)) => (l.min(x), t.min(y), r.max(x), bt.max(y)),
            });
        }
    }
    let (l, t, r, bt) = b?;
    let clamp = |v: f64| v.clamp(-1e9, 1e9) as i32;
    Some(IRect::from_ltrb(
        clamp(l.floor()) - 1,
        clamp(t.floor()) - 1,
        clamp(r.ceil()) + 1,
        clamp(bt.ceil()) + 1,
    ))
}

/// How far a stroke reaches outside its path, in pixels (level 0).
pub(crate) fn stroke_reach(stroke: &VectorStroke) -> i32 {
    let w = width(stroke)
        * if stroke.align == StrokeAlign::Center {
            0.5
        } else {
            1.0
        };
    let miter = if stroke.join == LineJoin::Miter {
        miter_limit(stroke)
    } else {
        1.0
    };
    (w * miter).ceil() as i32 + 2
}

/// A stroke's width in canvas pixels, kept finite.
fn width(stroke: &VectorStroke) -> f32 {
    if stroke.width.is_nan() {
        0.0
    } else {
        stroke.width.clamp(0.0, MAX_WIDTH)
    }
}

/// A stroke's miter limit, kept finite.
fn miter_limit(stroke: &VectorStroke) -> f32 {
    if stroke.miter_limit.is_nan() {
        1.0
    } else {
        stroke.miter_limit.clamp(1.0, MAX_MITER)
    }
}

/// Whether the mask's area starts as everything: the initial fill rule, or
/// a first subpath that subtracts or intersects.
fn starts_full(mask: &VectorMask) -> bool {
    mask.fill_all
        || mask
            .subpaths
            .first()
            .is_some_and(|s| matches!(s.op, PathOp::Subtract | PathOp::Intersect))
}

/// A content hash of a mask (and a stroke along it).
fn hash_mask(mask: &VectorMask, stroke: Option<&VectorStroke>) -> u64 {
    let mut h = std::collections::hash_map::DefaultHasher::new();
    for s in &mask.subpaths {
        s.closed.hash(&mut h);
        (s.op as u8).hash(&mut h);
        for k in &s.knots {
            for (x, y) in [k.before, k.anchor, k.after] {
                x.to_bits().hash(&mut h);
                y.to_bits().hash(&mut h);
            }
        }
        0xffu8.hash(&mut h);
    }
    mask.invert.hash(&mut h);
    mask.fill_all.hash(&mut h);
    if let Some(s) = stroke {
        1u8.hash(&mut h);
        s.width.to_bits().hash(&mut h);
        (s.align as u8).hash(&mut h);
        (s.cap as u8).hash(&mut h);
        (s.join as u8).hash(&mut h);
        s.miter_limit.to_bits().hash(&mut h);
        for d in &s.dashes {
            d.to_bits().hash(&mut h);
        }
        s.dash_offset.to_bits().hash(&mut h);
    }
    h.finish()
}

/// A path of subpaths in tile pixels: canvas (level 0) points scaled by
/// `scale` and moved by `-origin`. Open subpaths are closed when `close`.
fn build_path(
    subpaths: &[&Subpath],
    scale: f64,
    origin: (f64, f64),
    close: bool,
) -> Option<tiny_skia::Path> {
    let p = |(x, y): (f64, f64)| ((x * scale - origin.0) as f32, (y * scale - origin.1) as f32);
    let mut pb = PathBuilder::new();
    for s in subpaths {
        let Some(first) = s.knots.first() else {
            continue;
        };
        if s.knots.len() < 2 {
            continue;
        }
        let (x, y) = p(first.anchor);
        pb.move_to(x, y);
        for w in s.knots.windows(2) {
            let (a, b, c) = (p(w[0].after), p(w[1].before), p(w[1].anchor));
            pb.cubic_to(a.0, a.1, b.0, b.1, c.0, c.1);
        }
        if s.closed {
            let last = s.knots[s.knots.len() - 1];
            let (a, b, c) = (p(last.after), p(first.before), p(first.anchor));
            pb.cubic_to(a.0, a.1, b.0, b.1, c.0, c.1);
            pb.close();
        } else if close {
            pb.close();
        }
    }
    pb.finish()
}

/// The fill of a mask's subpaths over a tile, in `0..=1` (before
/// inversion when `invert` is false).
fn area(mask: &VectorMask, level: u8, tile: (i32, i32)) -> Vec<f32> {
    let scale = 0.5f64.powi(level as i32);
    let t = IRect::tile(tile.0, tile.1);
    let origin = (t.x as f64, t.y as f64);
    let tile_f = tiny_skia::Rect::from_xywh(0.0, 0.0, TILE as f32, TILE as f32);
    let mut acc = vec![if starts_full(mask) { 1.0f32 } else { 0.0 }; T * T];
    let mut i = 0;
    while i < mask.subpaths.len() {
        // A shape: a subpath and those joined to it, filled by its rule,
        // then combined with what is there by its operation.
        let first = &mask.subpaths[i];
        let op = first.op;
        let rule = if first.nonzero {
            FillRule::Winding
        } else {
            FillRule::EvenOdd
        };
        let mut shape = vec![first];
        i += 1;
        while i < mask.subpaths.len() && mask.subpaths[i].joined {
            shape.push(&mask.subpaths[i]);
            i += 1;
        }
        let cov = build_path(&shape, scale, origin, true).and_then(|path| {
            let b = path.bounds();
            let overlaps = tile_f.is_some_and(|tf| b.intersect(&tf).is_some());
            if !overlaps {
                return None;
            }
            let mut m = Mask::new(TILE as u32, TILE as u32)?;
            m.fill_path(&path, rule, true, Transform::identity());
            Some(m)
        });
        let cov = cov.as_ref().map(|m| m.data());
        let g = |j: usize| cov.map_or(0.0, |c| c[j] as f32 / 255.0);
        match op {
            PathOp::Combine => {
                if cov.is_some() {
                    for (j, a) in acc.iter_mut().enumerate() {
                        let v = g(j);
                        *a = *a + v - *a * v;
                    }
                }
            }
            PathOp::Subtract => {
                if cov.is_some() {
                    for (j, a) in acc.iter_mut().enumerate() {
                        *a *= 1.0 - g(j);
                    }
                }
            }
            PathOp::Intersect => {
                for (j, a) in acc.iter_mut().enumerate() {
                    *a *= g(j);
                }
            }
            PathOp::Exclude => {
                if cov.is_some() {
                    for (j, a) in acc.iter_mut().enumerate() {
                        let v = g(j);
                        *a = *a + v - 2.0 * *a * v;
                    }
                }
            }
        }
    }
    acc
}

/// Quantizes coverage into a tile (`None` when all zero).
fn quantize(cov: &[f32]) -> Option<Arc<[u8]>> {
    let out: Vec<u8> = cov
        .iter()
        .map(|v| (v.clamp(0.0, 1.0) * 255.0).round() as u8)
        .collect();
    out.iter().any(|&v| v != 0).then(|| Arc::from(out))
}

/// One tile of a vector mask's coverage.
fn mask_tile(mask: &VectorMask, level: u8, tile: (i32, i32), invert: bool) -> Option<Arc<[u8]>> {
    let mut acc = area(mask, level, tile);
    if invert && mask.invert {
        for a in &mut acc {
            *a = 1.0 - *a;
        }
    }
    quantize(&acc)
}

/// One tile of a stroke along a mask's subpaths; inside and outside
/// strokes are drawn twice as wide and cut by the shape's area.
fn stroke_tile(
    mask: &VectorMask,
    stroke: &VectorStroke,
    level: u8,
    tile: (i32, i32),
) -> Option<Arc<[u8]>> {
    let scale = 0.5f64.powi(level as i32);
    let t = IRect::tile(tile.0, tile.1);
    let subpaths: Vec<&Subpath> = mask.subpaths.iter().collect();
    let path = build_path(&subpaths, scale, (t.x as f64, t.y as f64), false)?;
    let sided = stroke.align != StrokeAlign::Center;
    let unit = width(stroke) * scale as f32;
    let width = unit * if sided { 2.0 } else { 1.0 };
    if width <= 0.0 {
        return None;
    }
    let dash = if stroke.dashes.is_empty() {
        None
    } else {
        let mut array: Vec<f32> = stroke.dashes.iter().map(|d| d.max(0.0) * unit).collect();
        if array.len() % 2 == 1 {
            array.extend_from_within(..);
        }
        tiny_skia::StrokeDash::new(array, stroke.dash_offset * unit)
    };
    let ts = tiny_skia::Stroke {
        width,
        miter_limit: miter_limit(stroke),
        line_cap: match stroke.cap {
            LineCap::Butt => tiny_skia::LineCap::Butt,
            LineCap::Round => tiny_skia::LineCap::Round,
            LineCap::Square => tiny_skia::LineCap::Square,
        },
        line_join: match stroke.join {
            LineJoin::Miter => tiny_skia::LineJoin::Miter,
            LineJoin::Round => tiny_skia::LineJoin::Round,
            LineJoin::Bevel => tiny_skia::LineJoin::Bevel,
        },
        dash: None,
    };
    let path = match &dash {
        Some(d) => path.dash(d, 1.0)?,
        None => path,
    };
    let outline = path.stroke(&ts, 1.0)?;
    let tile_f = tiny_skia::Rect::from_xywh(0.0, 0.0, TILE as f32, TILE as f32)?;
    outline.bounds().intersect(&tile_f)?;
    let mut m = Mask::new(TILE as u32, TILE as u32)?;
    m.fill_path(&outline, FillRule::Winding, true, Transform::identity());
    let mut cov: Vec<f32> = m.data().iter().map(|&v| v as f32 / 255.0).collect();
    if sided {
        let shape = area(mask, level, tile);
        let inside = stroke.align == StrokeAlign::Inside;
        for (c, s) in cov.iter_mut().zip(shape) {
            *c *= if inside { s } else { 1.0 - s };
        }
    }
    quantize(&cov)
}

#[cfg(test)]
mod test;
