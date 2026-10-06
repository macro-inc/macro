//! Selections: marquees, lassos, the magic wand, combining, feathering,
//! growing and shrinking, and the outlines marching ants follow.
//!
//! Shapes come back as coverage: one-channel rasters (0 to 255 per pixel)
//! whose grid is at the canvas origin, ready for [`combine`]. Coordinates
//! clamp to a million pixels from the origin, and shapes or areas over a
//! billion pixels are refused (they come back empty).

mod morph;
mod outline;
mod region;
mod shape;

use crate::edit::filters;
use crate::edit::paint::tiles::clamp_rect;
use crate::raster::{IRect, Raster, Selection, TILE};
use shape::{MAX_AREA, MAX_COORD};
use std::sync::Arc;
use tiny_skia::{PathBuilder, Rect};

/// The widest feather (Photoshop's).
const MAX_FEATHER: f32 = 1000.0;
/// Where selections reach: the canvas area shapes are clamped to.
const WORLD: IRect = IRect::new(
    -(MAX_COORD as i32),
    -(MAX_COORD as i32),
    2 * MAX_COORD as i32,
    2 * MAX_COORD as i32,
);

/// How a new selection combines with the current one.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SelectMode {
    /// Replaces it.
    #[default]
    Replace,
    /// Adds to it.
    Add,
    /// Removes from it.
    Subtract,
    /// Keeps the overlap.
    Intersect,
}

/// Combines a shape's coverage (a one-channel raster, grid at the canvas
/// origin) into a selection: adding keeps the larger coverage, subtracting
/// scales the selection by what the shape leaves, and intersecting keeps
/// the smaller. An RGBA shape counts its alpha.
pub fn combine(selection: &mut Selection, shape: Raster, mode: SelectMode) {
    let shape = coverage_of(shape);
    if mode == SelectMode::Replace {
        selection.mask = shape;
        return;
    }
    let mut mask = coverage_of(std::mem::take(&mut selection.mask));
    let keys: Vec<(i32, i32)> = match mode {
        SelectMode::Intersect => mask.tile_keys().collect(),
        _ => shape.tile_keys().collect(),
    };
    for (tx, ty) in keys {
        let (a, b) = (mask.tile_arc(tx, ty), shape.tile_arc(tx, ty));
        let tile = match (mode, a, b) {
            (SelectMode::Add, None, b) => b,
            (SelectMode::Add, Some(a), Some(b)) => merge(&a, &b, |a, b| a.max(b)),
            (SelectMode::Subtract, Some(a), Some(b)) => merge(&a, &b, |a, b| {
                ((u32::from(a) * (255 - u32::from(b)) + 127) / 255) as u8
            }),
            (SelectMode::Intersect, Some(a), Some(b)) => merge(&a, &b, |a, b| a.min(b)),
            (SelectMode::Intersect, Some(_), None) => None,
            (_, a, _) => a,
        };
        mask.set_tile(tx, ty, tile);
    }
    selection.mask = mask;
}

/// Two coverage tiles merged sample by sample (`None` when nothing is
/// left).
fn merge(a: &Arc<[u8]>, b: &Arc<[u8]>, f: impl Fn(u8, u8) -> u8) -> Option<Arc<[u8]>> {
    let out: Vec<u8> = a.iter().zip(b.iter()).map(|(&a, &b)| f(a, b)).collect();
    out.iter().any(|&v| v != 0).then(|| out.into())
}

/// A raster's coverage as a one-channel raster at the canvas origin (an
/// RGBA raster's alpha).
fn coverage_of(raster: Raster) -> Raster {
    let raster = if raster.channels() == 1 {
        raster
    } else {
        let mut gray = Raster::gray();
        gray.set_origin(raster.origin());
        for (tx, ty) in raster.tile_keys() {
            if let Some(tile) = raster.tile(tx, ty) {
                let c = raster.channels() as usize;
                let alpha: Vec<u8> = tile.chunks_exact(c).map(|p| p[c - 1]).collect();
                if alpha.iter().any(|&v| v != 0) {
                    gray.set_tile(tx, ty, Some(alpha.into()));
                }
            }
        }
        gray
    };
    if raster.origin() == (0, 0) {
        raster
    } else {
        raster.realigned((0, 0))
    }
}

/// `(x, y, w, h)` as edges, with negative sizes flipped; `None` when not
/// all numbers.
fn edges(r: (f32, f32, f32, f32)) -> Option<[f32; 4]> {
    let (x, y, w, h) = r;
    if ![x, y, w, h].iter().all(|v| v.is_finite()) {
        return None;
    }
    let [x0, x1] = if w < 0.0 { [x + w, x] } else { [x, x + w] };
    let [y0, y1] = if h < 0.0 { [y + h, y] } else { [y, y + h] };
    Some([x0, y0, x1, y1].map(|v| v.clamp(-MAX_COORD, MAX_COORD)))
}

/// A rectangle's coverage (`x, y, w, h` in canvas pixels, fractional
/// edges antialiased).
pub fn rect(r: (f32, f32, f32, f32)) -> Raster {
    match edges(r) {
        Some([x0, y0, x1, y1]) => shape::rect(x0, y0, x1, y1),
        None => Raster::gray(),
    }
}

/// An ellipse's coverage inside `x, y, w, h`.
pub fn ellipse(r: (f32, f32, f32, f32), antialias: bool) -> Raster {
    let Some([x0, y0, x1, y1]) = edges(r) else {
        return Raster::gray();
    };
    let Some(path) = Rect::from_ltrb(x0, y0, x1, y1).and_then(PathBuilder::from_oval) else {
        return Raster::gray();
    };
    let (cx, cy) = ((x0 + x1) / 2.0, (y0 + y1) / 2.0);
    let (rx, ry) = ((x1 - x0) / 2.0, (y1 - y0) / 2.0);
    // A tile is inside when its corners are, a pixel in from the edge.
    let inside = |t: IRect| {
        let corner = |x: i32, y: i32| {
            let (dx, dy) = ((x as f32 - cx) / (rx - 1.0), (y as f32 - cy) / (ry - 1.0));
            dx * dx + dy * dy <= 1.0
        };
        rx > 2.0
            && ry > 2.0
            && corner(t.x, t.y)
            && corner(t.right(), t.y)
            && corner(t.x, t.bottom())
            && corner(t.right(), t.bottom())
    };
    shape::path(&path, antialias, &inside)
}

/// A polygon's coverage (lasso points, closed; where it crosses itself,
/// everything it winds around is inside).
pub fn polygon(points: &[(f32, f32)], antialias: bool) -> Raster {
    let mut points = points
        .iter()
        .filter(|(x, y)| x.is_finite() && y.is_finite())
        .map(|&(x, y)| {
            (
                x.clamp(-MAX_COORD, MAX_COORD),
                y.clamp(-MAX_COORD, MAX_COORD),
            )
        });
    let mut builder = PathBuilder::new();
    let Some((x, y)) = points.next() else {
        return Raster::gray();
    };
    builder.move_to(x, y);
    for (x, y) in points {
        builder.line_to(x, y);
    }
    builder.close();
    match builder.finish() {
        Some(path) => shape::path(&path, antialias, &|_| false),
        None => Raster::gray(),
    }
}

/// The magic wand's coverage: pixels like the one at `seed` (by `sample`)
/// within `tolerance`, connected to it when `contiguous`, inside `bounds`.
///
/// Pixels compare premultiplied, each channel (alpha included) within
/// `tolerance` of the seed's, so every fully transparent pixel is alike.
/// `antialias` softens the region's staircase edges.
pub fn magic_wand(
    sample: &dyn Fn(i32, i32) -> [u8; 4],
    bounds: IRect,
    seed: (i32, i32),
    tolerance: u8,
    contiguous: bool,
    antialias: bool,
) -> Raster {
    let bounds = clamp_rect(bounds, WORLD);
    if bounds.area() > MAX_AREA {
        return Raster::gray();
    }
    match region::find(sample, bounds, seed, tolerance, contiguous) {
        Some(bits) => region::coverage(&bits, antialias),
        None => Raster::gray(),
    }
}

/// Selects everything within `bounds`.
pub fn all(bounds: IRect) -> Selection {
    invert(&Selection::none(), bounds)
}

/// Inverts a selection within `bounds`.
pub fn invert(selection: &Selection, bounds: IRect) -> Selection {
    let bounds = clamp_rect(bounds, WORLD);
    if bounds.area() > MAX_AREA {
        return Selection::none();
    }
    let mask = coverage_of(selection.mask.clone());
    let mut out = Raster::gray();
    let full = shape::full_tile();
    let mut tile = vec![0u8; (TILE * TILE) as usize];
    for (tx, ty) in bounds.tiles() {
        let tr = IRect::tile(tx, ty);
        let part = tr.intersect(&bounds);
        let old = mask.tile(tx, ty);
        if part == tr && old.is_none() {
            out.set_tile(tx, ty, Some(full.clone()));
            continue;
        }
        tile.fill(0);
        for y in part.y..part.bottom() {
            let row = ((y - tr.y) * TILE) as usize;
            for x in (row + (part.x - tr.x) as usize)..(row + (part.right() - tr.x) as usize) {
                tile[x] = 255 - old.map_or(0, |t| t[x]);
            }
        }
        if tile.iter().any(|&v| v != 0) {
            out.set_tile(tx, ty, Some(Arc::from(&tile[..])));
        }
    }
    Selection { mask: out }
}

/// Softens a selection's edge by `radius` pixels: a Gaussian blur of its
/// coverage with a standard deviation of half the radius.
pub fn feather(selection: &Selection, radius: f32) -> Selection {
    let mut mask = coverage_of(selection.mask.clone());
    if radius.is_finite() && radius > 0.0 {
        filters::gaussian_blur(&mut mask, None, radius.min(MAX_FEATHER) / 2.0);
    }
    Selection { mask }
}

/// Grows (positive) or shrinks (negative) a selection by `pixels` (at
/// most 500): pixels within that distance of the selection join it, or
/// those within it of the unselected area leave it, so corners round off.
/// Pixels count as selected from half coverage.
pub fn expand(selection: &Selection, pixels: i32) -> Selection {
    morph::expand(
        &Selection {
            mask: coverage_of(selection.mask.clone()),
        },
        pixels,
    )
}

/// A layer's transparency (or a mask's values) as a selection.
pub fn from_alpha(raster: &Raster) -> Selection {
    Selection {
        mask: coverage_of(raster.clone()),
    }
}

/// The selection's edges at half coverage as closed polygons in canvas
/// pixels (for marching ants), simplified to at most about `max_points`
/// points in all.
///
/// The selected side is on each polygon's left as seen on screen (outer
/// edges run counterclockwise, holes clockwise), so filling them with the
/// nonzero rule gives back the selection's shape. Hard edges keep their
/// pixel corners exactly. When even three points per polygon exceed the
/// budget, the smallest polygons are left out.
pub fn outline(selection: &Selection, max_points: usize) -> Vec<Vec<(f32, f32)>> {
    outline::outline(selection, max_points)
}

#[cfg(test)]
mod test;
