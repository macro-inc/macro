//! Brush dabs: the round marks a stroke stamps along its path, and how they
//! build up in the stroke's coverage.
//!
//! Coverage lives in 16-bit tiles laid out like the target raster's tiles.
//! A dab of strength `a` at a pixel takes its coverage `c` to
//! `c + (1 - c) · a`, so dabs build up toward full coverage but never past
//! it (the way Photoshop's flow builds up within a stroke).

use crate::raster::{IRect, TILE};
use std::collections::BTreeMap;

/// Steps in the soft falloff table.
const FALLOFF_STEPS: usize = 256;
/// A soft brush falls from its hard core to its rim like a Gaussian with
/// this many standard deviations across the falloff, lowered to reach 0 at
/// the rim.
const SOFT_SIGMAS: f32 = 2.5;
/// Pixels in a coverage tile.
const TILE_PIXELS: usize = (TILE * TILE) as usize;
/// The most tiles one stroke covers (268 megapixels): past them it stops
/// spreading, which bounds the memory a runaway stroke can take.
const MAX_TILES: usize = 4096;

/// Per-tile 16-bit coverages, keyed like the target raster's tiles.
pub(super) type Coverage = BTreeMap<(i32, i32), Box<[u16]>>;

/// A dab's outline.
#[derive(Clone, Debug)]
pub(super) enum Shape {
    /// Aliased: the pixels whose centers are inside, fully.
    Pencil,
    /// Solid, with a one-pixel antialiased rim.
    Hard,
    /// Solid out to `hardness` of the radius (leaving at least a pixel to
    /// fall off in), then falling smoothly to nothing at the rim.
    Soft {
        /// The solid core's share of the radius.
        hardness: f32,
        /// The falloff from the core (`[0]`) to the rim (`[FALLOFF_STEPS]`).
        falloff: Box<[f32]>,
    },
}

impl Shape {
    /// The shape of a brush's dabs.
    pub fn new(hardness: f32, pencil: bool) -> Shape {
        if pencil {
            return Shape::Pencil;
        }
        if hardness >= 0.999 {
            return Shape::Hard;
        }
        let k = SOFT_SIGMAS * SOFT_SIGMAS / 2.0;
        let rim = (-k).exp();
        let falloff = (0..=FALLOFF_STEPS)
            .map(|i| {
                let u = i as f32 / FALLOFF_STEPS as f32;
                (((-k * u * u).exp() - rim) / (1.0 - rim)).max(0.0)
            })
            .collect();
        Shape::Soft {
            hardness: hardness.clamp(0.0, 1.0),
            falloff,
        }
    }
}

/// One dab: its center (canvas pixels), radius, and strength (`0..=1`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct Dab {
    /// Center, x.
    pub x: f64,
    /// Center, y.
    pub y: f64,
    /// Radius in pixels.
    pub radius: f32,
    /// Coverage it adds at its solid core.
    pub strength: f32,
}

/// A dab's shape at its radius: what it adds to a pixel at a squared
/// distance from its center.
struct Stamp<'a> {
    shape: &'a Shape,
    strength: f32,
    /// Squared distance beyond which it adds nothing.
    reach2: f32,
    /// Squared distance within which it adds its full strength.
    core2: f32,
    /// Pencil: squared radius. Hard: the rim's outer edge. Soft: the core's
    /// radius.
    edge: f32,
    /// Soft: 1 over the falloff's width.
    inv_width: f32,
}

impl Stamp<'_> {
    fn new(shape: &Shape, radius: f32, strength: f32) -> Stamp<'_> {
        let r = radius.max(0.0);
        let (reach, core, edge, inv_width) = match shape {
            Shape::Pencil => (r, r, r * r + 1e-3, 0.0),
            Shape::Hard => (r + 0.5, (r - 0.5).max(0.0), r + 0.5, 0.0),
            Shape::Soft { hardness, .. } => {
                let core = (hardness * r).min(r - 1.0).max(0.0);
                (r, core, core, 1.0 / (r - core).max(1e-6))
            }
        };
        Stamp {
            shape,
            strength,
            reach2: reach * reach,
            core2: core * core,
            edge,
            inv_width,
        }
    }

    /// Coverage added at squared distance `d2`.
    #[inline]
    fn alpha(&self, d2: f32) -> f32 {
        match self.shape {
            Shape::Pencil => {
                if d2 <= self.edge {
                    self.strength
                } else {
                    0.0
                }
            }
            Shape::Hard => {
                if d2 <= self.core2 {
                    self.strength
                } else if d2 >= self.reach2 {
                    0.0
                } else {
                    (self.edge - d2.sqrt()).clamp(0.0, 1.0) * self.strength
                }
            }
            Shape::Soft { falloff, .. } => {
                if d2 <= self.core2 {
                    self.strength
                } else if d2 >= self.reach2 {
                    0.0
                } else {
                    let u = (d2.sqrt() - self.edge) * self.inv_width;
                    let pos = (u * FALLOFF_STEPS as f32).clamp(0.0, FALLOFF_STEPS as f32 - 1e-3);
                    let i = pos as usize;
                    let (a, b) = (falloff[i], falloff[i + 1]);
                    (a + (b - a) * (pos - i as f32)) * self.strength
                }
            }
        }
    }
}

/// Builds coverage `c` up by `a`: `c + (1 - c) · a`, rounded.
#[inline]
fn build_up(c: &mut u16, a: f32) {
    let a = (a.min(1.0) * 65536.0) as u32;
    let v = u32::from(*c);
    *c = (v + (((65535 - v) * a + 32768) >> 16)) as u16;
}

/// Stamps a dab into `coverage` (tiles of a raster whose grid origin is at
/// canvas `origin`), only within the canvas rectangle `clip`, recording the
/// canvas area it touched in each tile in `dirty`.
pub(super) fn stamp(
    dab: &Dab,
    shape: &Shape,
    origin: (i32, i32),
    clip: IRect,
    coverage: &mut Coverage,
    dirty: &mut BTreeMap<(i32, i32), IRect>,
) {
    let stamp = Stamp::new(shape, dab.radius, dab.strength);
    if stamp.strength.is_nan() || stamp.strength <= 0.0 || stamp.reach2 <= 0.0 {
        return;
    }
    let reach = f64::from(stamp.reach2.sqrt());
    let bounds = IRect::from_ltrb(
        (dab.x - reach).floor() as i32,
        (dab.y - reach).floor() as i32,
        (dab.x + reach).ceil() as i32 + 1,
        (dab.y + reach).ceil() as i32 + 1,
    )
    .intersect(&clip);
    if bounds.is_empty() {
        return;
    }
    let local = bounds.translate(-origin.0, -origin.1);
    let (cx, cy) = (dab.x - f64::from(origin.0), dab.y - f64::from(origin.1));
    for (tx, ty) in local.tiles() {
        let tile = IRect::tile(tx, ty);
        let part = tile.intersect(&local);
        // The dab's center relative to the tile, small enough for f32.
        let (ux, uy) = (
            (cx - f64::from(tile.x)) as f32,
            (cy - f64::from(tile.y)) as f32,
        );
        let (x0, y0) = (part.x - tile.x, part.y - tile.y);
        let (x1, y1) = (part.right() - tile.x, part.bottom() - tile.y);
        // Skip parts the dab's circle misses.
        let nx = ux.clamp(x0 as f32 + 0.5, x1 as f32 - 0.5) - ux;
        let ny = uy.clamp(y0 as f32 + 0.5, y1 as f32 - 0.5) - uy;
        if nx * nx + ny * ny >= stamp.reach2 {
            continue;
        }
        if coverage.len() >= MAX_TILES && !coverage.contains_key(&(tx, ty)) {
            continue;
        }
        let cov = coverage
            .entry((tx, ty))
            .or_insert_with(|| vec![0u16; TILE_PIXELS].into_boxed_slice());
        for y in y0..y1 {
            let dy = y as f32 + 0.5 - uy;
            let dy2 = dy * dy;
            if dy2 >= stamp.reach2 {
                continue;
            }
            let half = (stamp.reach2 - dy2).sqrt();
            let from = ((ux - half - 0.5).floor() as i32).max(x0);
            let to = ((ux + half - 0.5).ceil() as i32 + 1).min(x1);
            if from >= to {
                continue;
            }
            let row = &mut cov[(y * TILE) as usize..((y + 1) * TILE) as usize];
            for (x, c) in (from..to).zip(&mut row[from as usize..to as usize]) {
                let dx = x as f32 + 0.5 - ux;
                let a = stamp.alpha(dx * dx + dy2);
                if a > 0.0 {
                    build_up(c, a);
                }
            }
        }
        let touched = part.translate(origin.0, origin.1);
        dirty
            .entry((tx, ty))
            .and_modify(|r| *r = r.union(&touched))
            .or_insert(touched);
    }
}
