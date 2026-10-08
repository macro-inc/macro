//! Painting: brush and pencil strokes, erasing, fills, flood fills, and
//! gradients, into RGBA layers or one-channel masks, within a selection.
//!
//! Every tool takes the selection as `Option<&Selection>`: `None` paints
//! everywhere, and a selection scales the effect by its coverage (an empty
//! selection selects nothing, so nothing changes). One-channel targets
//! take the gray (Rec. 601 luma) of the color, and ignore `lock_alpha`.
//! Each call returns the bounds of the canvas pixels it changed. Fills and
//! gradients over more than a billion pixels are refused.

mod blend;
mod dab;
mod gradient;
mod stroke;
pub(crate) mod tiles;

pub(crate) use blend::luma;

use crate::edit::select;
use crate::model::{Gradient, Rgb};
use crate::raster::{IRect, Raster, Selection, TILE};
use blend::{mix_gray, over, recolor};
use std::collections::BTreeMap;
use std::sync::Arc;
use stroke::unit;
use tiles::{clamp_rect, rewrite};

/// The canvas area fills and gradients reach, well past the largest canvas.
const WORLD: IRect = IRect::new(-(1 << 21), -(1 << 21), 1 << 22, 1 << 22);
/// The largest area a fill or gradient covers (a billion pixels, past any
/// raster the engine can hold); larger ones are refused.
const MAX_AREA: i64 = 1 << 30;

/// What a stroke does.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BrushMode {
    /// Paints the color.
    #[default]
    Paint,
    /// Removes pixels (paints transparency; on a mask, paints black). Where
    /// alpha is locked it paints the brush's color instead, as Photoshop's
    /// eraser paints the background color.
    Erase,
}

/// A brush.
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Brush {
    /// Diameter in canvas pixels (up to 5000).
    pub size: f32,
    /// Hardness, `0..=1` (1: a hard edge).
    pub hardness: f32,
    /// Most a stroke can cover, `0..=1`.
    pub opacity: f32,
    /// How much each dab adds, `0..=1`.
    pub flow: f32,
    /// Distance between dabs as a fraction of the size (`0.01..=10`).
    pub spacing: f32,
    /// Color (masks take its gray value).
    pub color: Rgb,
    /// Paint or erase.
    pub mode: BrushMode,
    /// Pencil: hard, aliased dabs.
    pub pencil: bool,
    /// Pen pressure scales the size.
    pub pressure_size: bool,
    /// Pen pressure scales the flow.
    pub pressure_opacity: bool,
}

impl Default for Brush {
    /// A hard round black brush, 20 pixels across, at Photoshop's default
    /// 25% spacing.
    fn default() -> Self {
        Brush {
            size: 20.0,
            hardness: 1.0,
            opacity: 1.0,
            flow: 1.0,
            spacing: 0.25,
            color: Rgb::BLACK,
            mode: BrushMode::Paint,
            pencil: false,
            pressure_size: false,
            pressure_opacity: false,
        }
    }
}

/// A stroke in progress: points arrive as the pointer moves, and each batch
/// paints the dabs it reaches. A stroke's opacity caps what it adds however
/// often it crosses itself.
///
/// Dabs fall every `spacing × size` along the path (the distance left over
/// carries from one batch to the next, so batching never changes the
/// result), with pressure interpolated between points. Each dab builds up
/// the stroke's coverage by its flow; the touched pixels are then
/// recomposited from what they were before the stroke, covered by the color
/// at `min(coverage, 1) × opacity`. Each batch costs in proportion to the
/// area it paints.
pub struct Stroke {
    /// The brush, its settings brought into range.
    brush: Brush,
    /// Its dabs' outline.
    shape: dab::Shape,
    /// The color as 8-bit samples (`0..=255`).
    ink_color: [f32; 3],
    /// The last point: canvas position and pressure.
    last: Option<(f64, f64, f32)>,
    /// Distance along the path to the next dab.
    to_next: f64,
    /// The target's grid origin and channels the buffers below follow.
    layout: Option<((i32, i32), u8)>,
    /// The stroke's coverage, in tiles laid out like the target's.
    coverage: dab::Coverage,
    /// The target's tiles from before the stroke, for those it touched.
    base: BTreeMap<(i32, i32), Option<Arc<[u8]>>>,
}

impl Stroke {
    /// Starts a stroke.
    pub fn new(brush: Brush) -> Stroke {
        Stroke::start(brush)
    }

    /// Paints toward more points (canvas coordinates and pen pressure in
    /// `0..=1`) into `target` (RGBA or one channel), only where `selection`
    /// selects when given; `lock_alpha` keeps transparent pixels
    /// transparent. Points that are not numbers are skipped. Returns the
    /// canvas area that changed.
    pub fn add(
        &mut self,
        target: &mut Raster,
        selection: Option<&Selection>,
        lock_alpha: bool,
        points: &[(f32, f32, f32)],
    ) -> Option<IRect> {
        self.paint(target, selection, lock_alpha, points)
    }
}

/// Fills `bounds` (within `selection` when given) with a color at an
/// opacity. Returns the area that changed.
pub fn fill(
    target: &mut Raster,
    bounds: IRect,
    selection: Option<&Selection>,
    color: [u8; 4],
    opacity: f32,
    lock_alpha: bool,
) -> Option<IRect> {
    let alpha = f32::from(color[3]) / 255.0 * unit(opacity, 0.0);
    let channels = target.channels();
    if alpha <= 0.0 || (channels != 1 && channels != 4) {
        return None;
    }
    let area = limit(bounds, selection)?;
    let rgb = [
        f32::from(color[0]),
        f32::from(color[1]),
        f32::from(color[2]),
    ];
    let source = move |_: i32, _: i32, row: &mut [[f32; 4]]| {
        row.fill([rgb[0], rgb[1], rgb[2], alpha]);
    };
    if selection.is_some() || alpha < 1.0 || (lock_alpha && channels == 4) {
        return paint_area(target, area, selection, lock_alpha, source);
    }
    // Opaque and unmasked: whole tiles share one solid tile.
    let solid: Arc<[u8]> = if channels == 4 {
        [color[0], color[1], color[2], 255]
            .repeat((TILE * TILE) as usize)
            .into()
    } else {
        vec![blend::quantize(luma(rgb)); (TILE * TILE) as usize].into()
    };
    let (ox, oy) = target.origin();
    let mut changed: Option<IRect> = None;
    for (tx, ty) in area.translate(-ox, -oy).tiles() {
        let tile = target.tile_rect(tx, ty);
        let r = if area.contains_rect(&tile) {
            if target.tile(tx, ty) == Some(&solid[..]) {
                None
            } else {
                target.set_tile(tx, ty, Some(solid.clone()));
                Some(tile)
            }
        } else {
            paint_area(target, tile.intersect(&area), None, false, source)
        };
        if let Some(r) = r {
            changed = Some(changed.map_or(r, |acc| acc.union(&r)));
        }
    }
    changed
}

/// The paint bucket: fills the pixels like the one at `seed` (by `sample`,
/// within `tolerance` of it per channel; only connected ones when
/// `contiguous`), inside `bounds` and the selection. Returns the area that
/// changed.
///
/// Pixels match as the magic wand matches them ([`select::magic_wand`]);
/// `antialias` softens the filled region's jagged edges.
#[expect(clippy::too_many_arguments, reason = "the paint bucket's options")]
pub fn flood_fill(
    target: &mut Raster,
    sample: &dyn Fn(i32, i32) -> [u8; 4],
    bounds: IRect,
    selection: Option<&Selection>,
    seed: (i32, i32),
    tolerance: u8,
    contiguous: bool,
    antialias: bool,
    color: [u8; 4],
    opacity: f32,
) -> Option<IRect> {
    let alpha = f32::from(color[3]) / 255.0 * unit(opacity, 0.0);
    if alpha <= 0.0 {
        return None;
    }
    let bounds = limit(bounds, selection)?;
    let region = select::magic_wand(sample, bounds, seed, tolerance, contiguous, antialias);
    let area = limit(region.bounds()?.intersect(&bounds), selection)?;
    let rgb = [
        f32::from(color[0]),
        f32::from(color[1]),
        f32::from(color[2]),
    ];
    let mut cover = Vec::new();
    paint_area(target, area, selection, false, |x0, y, row| {
        cover.resize(row.len(), 0);
        region.read(IRect::new(x0, y, row.len() as i32, 1), &mut cover);
        for (px, &c) in row.iter_mut().zip(&cover) {
            *px = [rgb[0], rgb[1], rgb[2], alpha * f32::from(c) / 255.0];
        }
    })
}

/// The gradient tool: draws `gradient` from `from` to `to` (its kind
/// decides the shape) over `bounds` within the selection. Returns the area
/// that changed.
///
/// Linear and reflected gradients run along the drag (reflected mirrored
/// at its start), radial and diamond ones grow out from `from` (a
/// diamond's corner at `to`), and an angle gradient sweeps
/// counterclockwise from the drag's direction. Colors come from
/// [`Gradient::sample`], reversed when the gradient says so, and dithered
/// when it asks to be; before `from` and past `to` they hold the end
/// colors. Its own angle, scale and offset are for fill layers and do not
/// apply here.
#[expect(clippy::too_many_arguments, reason = "the gradient tool's options")]
pub fn gradient(
    target: &mut Raster,
    gradient: &Gradient,
    from: (f32, f32),
    to: (f32, f32),
    bounds: IRect,
    selection: Option<&Selection>,
    opacity: f32,
    lock_alpha: bool,
) -> Option<IRect> {
    let opacity = unit(opacity, 0.0);
    if opacity <= 0.0 {
        return None;
    }
    let layout = gradient::Layout::new(gradient.kind, from, to)?;
    let area = limit(bounds, selection)?;
    let table = gradient::table(gradient);
    let dither = gradient.dither;
    paint_area(target, area, selection, lock_alpha, |x0, y, row| {
        let cy = f64::from(y) + 0.5;
        for (x, px) in (x0..).zip(row.iter_mut()) {
            let t = layout.t(f64::from(x) + 0.5, cy);
            let [mut r, mut g, mut b, a] = gradient::color(&table, t);
            if dither {
                let n = gradient::dither(x, y);
                (r, g, b) = (r + n, g + n, b + n);
            }
            *px = [r, g, b, a * opacity];
        }
    })
}

/// `area` within the world and the selection's bounds, unless empty or
/// too large.
fn limit(area: IRect, selection: Option<&Selection>) -> Option<IRect> {
    let mut area = clamp_rect(area, WORLD);
    if let Some(s) = selection {
        area = area.intersect(&s.mask.bounds()?);
    }
    (!area.is_empty() && area.area() <= MAX_AREA).then_some(area)
}

/// Paints a color per pixel over `area` (scaled by selection coverage):
/// `source(x0, y, row)` gives the straight colors (`0..=255`, alpha
/// `0..=1`) of the pixels from `(x0, y)` rightward. Returns the area that
/// changed.
fn paint_area(
    target: &mut Raster,
    area: IRect,
    selection: Option<&Selection>,
    lock_alpha: bool,
    mut source: impl FnMut(i32, i32, &mut [[f32; 4]]),
) -> Option<IRect> {
    let c = target.channels() as usize;
    if c != 1 && c != 4 {
        return None;
    }
    let lock = lock_alpha && c == 4;
    let mut row = Vec::new();
    let mut sel = Vec::new();
    rewrite(target, area, lock, |part, samples| {
        let w = part.w as usize;
        if let Some(s) = selection {
            sel.resize(w * part.h as usize, 0);
            s.mask.read(part, &mut sel);
        }
        row.resize(w, [0.0f32; 4]);
        for y in 0..part.h as usize {
            source(part.x, part.y + y as i32, &mut row);
            for (x, &[r, g, b, a]) in row.iter().enumerate() {
                let k = match selection {
                    Some(_) => a * f32::from(sel[y * w + x]) / 255.0,
                    None => a,
                };
                let o = y * w + x;
                if c == 4 {
                    let px = &mut samples[o * 4..o * 4 + 4];
                    let base = [px[0], px[1], px[2], px[3]];
                    let out = if lock {
                        recolor(base, [r, g, b], k)
                    } else {
                        over(base, [r, g, b], k)
                    };
                    px.copy_from_slice(&out);
                } else {
                    samples[o] = mix_gray(samples[o], luma([r, g, b]), k);
                }
            }
        }
    })
}

#[cfg(test)]
mod test;
