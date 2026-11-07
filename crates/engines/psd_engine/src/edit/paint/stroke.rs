//! Strokes: walking the pointer's path to place dabs, building them up in
//! the stroke's coverage, and recompositing touched pixels from what they
//! were before the stroke, so its opacity caps what it adds.

use super::blend::Ink;
use super::dab::{self, Dab, Shape};
use super::tiles::rewrite;
use super::{Brush, BrushMode, Stroke};
use crate::raster::{IRect, Raster, Selection, TILE};
use std::collections::BTreeMap;

/// Farthest a stroke reaches from the canvas origin, in pixels.
const MAX_COORD: f64 = (1 << 20) as f64;
/// Largest brush, in pixels (Photoshop's).
const MAX_SIZE: f32 = 5000.0;
/// Shortest distance between dabs, in pixels.
const MIN_STEP: f64 = 0.25;
/// Most dabs one segment between two points places (a longer segment
/// spaces them further apart).
const MAX_SEGMENT_DABS: f64 = (1 << 18) as f64;

/// Where every stroke may paint: well past the largest canvas.
const WORLD: IRect = IRect::new(-(1 << 21), -(1 << 21), 1 << 22, 1 << 22);

/// A value in `0..=1`, or `fallback` when not a number.
pub(super) fn unit(v: f32, fallback: f32) -> f32 {
    if v.is_nan() {
        fallback
    } else {
        v.clamp(0.0, 1.0)
    }
}

impl Stroke {
    /// A stroke with `brush`'s settings brought into range.
    pub(super) fn start(brush: Brush) -> Stroke {
        let size = if brush.size.is_finite() {
            brush.size.clamp(0.0, MAX_SIZE)
        } else {
            0.0
        };
        let spacing = if brush.spacing.is_finite() {
            brush.spacing.clamp(0.01, 10.0)
        } else {
            0.25
        };
        let brush = Brush {
            size,
            hardness: unit(brush.hardness, 1.0),
            opacity: unit(brush.opacity, 0.0),
            flow: unit(brush.flow, 0.0),
            spacing,
            ..brush
        };
        let [r, g, b] = brush.color.to_u8();
        Stroke {
            shape: Shape::new(brush.hardness, brush.pencil),
            ink_color: [f32::from(r), f32::from(g), f32::from(b)],
            brush,
            last: None,
            to_next: 0.0,
            layout: None,
            coverage: BTreeMap::new(),
            base: BTreeMap::new(),
        }
    }

    /// See [`Stroke::add`].
    pub(super) fn paint(
        &mut self,
        target: &mut Raster,
        selection: Option<&Selection>,
        lock_alpha: bool,
        points: &[(f32, f32, f32)],
    ) -> Option<IRect> {
        let mut dabs = Vec::new();
        for &(x, y, p) in points {
            self.walk(x, y, p, &mut dabs);
        }
        let channels = target.channels();
        if dabs.is_empty() || (channels != 1 && channels != 4) {
            return None;
        }
        let clip = match selection {
            Some(s) => s.mask.bounds()?.intersect(&WORLD),
            None => WORLD,
        };
        // The buffers follow the target's tile grid; a different grid
        // starts them afresh.
        let layout = (target.origin(), channels);
        if self.layout != Some(layout) {
            self.coverage.clear();
            self.base.clear();
            self.layout = Some(layout);
        }
        let mut dirty = BTreeMap::new();
        for dab in &dabs {
            dab::stamp(
                dab,
                &self.shape,
                layout.0,
                clip,
                &mut self.coverage,
                &mut dirty,
            );
        }
        self.recomposite(target, selection, lock_alpha, &dirty)
    }

    /// Repaints the `dirty` part of each tile from the pixels before the
    /// stroke and the stroke's coverage.
    fn recomposite(
        &mut self,
        target: &mut Raster,
        selection: Option<&Selection>,
        lock_alpha: bool,
        dirty: &BTreeMap<(i32, i32), IRect>,
    ) -> Option<IRect> {
        let c = target.channels() as usize;
        let ink = Ink {
            color: self.ink_color,
            erase: self.brush.mode == BrushMode::Erase,
            lock_alpha: lock_alpha && c == 4,
        };
        let opacity = self.brush.opacity / 65535.0;
        let mut sel = Vec::new();
        let mut changed: Option<IRect> = None;
        for (&key, &part) in dirty {
            let Some(cov) = self.coverage.get(&key) else {
                continue;
            };
            let base = self
                .base
                .entry(key)
                .or_insert_with(|| target.tile_arc(key.0, key.1));
            // Erasing or recoloring nothing changes nothing.
            if base.is_none() && (ink.erase || ink.lock_alpha) {
                continue;
            }
            if let Some(s) = selection {
                sel.resize(part.area() as usize, 0);
                s.mask.read(part, &mut sel);
            }
            let tile = target.tile_rect(key.0, key.1);
            let base = base.as_deref();
            let w = part.w as usize;
            let r = rewrite(target, part, false, |part, samples| {
                for y in 0..part.h as usize {
                    let ty = (part.y - tile.y) as usize + y;
                    let tx = (part.x - tile.x) as usize;
                    let row = ty * TILE as usize + tx;
                    for x in 0..w {
                        let i = row + x;
                        let mut k = f32::from(cov[i]) * opacity;
                        if selection.is_some() {
                            k *= f32::from(sel[y * w + x]) / 255.0;
                        }
                        let o = y * w + x;
                        if c == 4 {
                            let b = base.map_or([0; 4], |t| {
                                [t[i * 4], t[i * 4 + 1], t[i * 4 + 2], t[i * 4 + 3]]
                            });
                            samples[o * 4..o * 4 + 4].copy_from_slice(&ink.rgba(b, k));
                        } else {
                            let b = base.map_or(0, |t| t[i]);
                            samples[o] = ink.gray(b, k);
                        }
                    }
                }
            });
            if let Some(r) = r {
                changed = Some(changed.map_or(r, |acc| acc.union(&r)));
            }
        }
        changed
    }

    /// Moves the stroke to the next point, adding the dabs it passes.
    fn walk(&mut self, x: f32, y: f32, pressure: f32, dabs: &mut Vec<Dab>) {
        if !x.is_finite() || !y.is_finite() {
            return;
        }
        let x = f64::from(x).clamp(-MAX_COORD, MAX_COORD);
        let y = f64::from(y).clamp(-MAX_COORD, MAX_COORD);
        let p = unit(pressure, 1.0);
        let Some((lx, ly, lp)) = self.last else {
            dabs.push(self.dab(x, y, p));
            self.to_next = self.step(p);
            self.last = Some((x, y, p));
            return;
        };
        let (dx, dy) = (x - lx, y - ly);
        let len = dx.hypot(dy);
        if len > 0.0 {
            let shortest = len / MAX_SEGMENT_DABS;
            let mut at = 0.0;
            while self.to_next <= len - at {
                at += self.to_next;
                let t = at / len;
                let q = lp + (p - lp) * t as f32;
                dabs.push(self.dab(lx + dx * t, ly + dy * t, q));
                self.to_next = self.step(q).max(shortest);
            }
            self.to_next -= len - at;
        }
        self.last = Some((x, y, p));
    }

    /// The brush's diameter at a pressure.
    fn size_at(&self, pressure: f32) -> f32 {
        if self.brush.pressure_size {
            self.brush.size * pressure
        } else {
            self.brush.size
        }
    }

    /// The distance to the next dab after one at a pressure.
    fn step(&self, pressure: f32) -> f64 {
        (f64::from(self.brush.spacing) * f64::from(self.size_at(pressure))).max(MIN_STEP)
    }

    /// The dab at a point.
    fn dab(&self, x: f64, y: f64, pressure: f32) -> Dab {
        let size = self.size_at(pressure);
        let strength = if self.brush.pressure_opacity {
            self.brush.flow * pressure
        } else {
            self.brush.flow
        };
        if self.brush.pencil {
            // Whole pixels: odd sizes center on a pixel, even ones on a
            // pixel corner.
            let d = size.round().max(1.0);
            let snap = |v: f64| {
                if d % 2.0 == 1.0 {
                    v.floor() + 0.5
                } else {
                    v.round()
                }
            };
            let strength = if size > 0.0 { strength } else { 0.0 };
            return Dab {
                x: snap(x),
                y: snap(y),
                radius: d / 2.0,
                strength,
            };
        }
        if size < 1.0 {
            // Below a pixel, a dab fades with its area instead of shrinking.
            return Dab {
                x,
                y,
                radius: 0.5,
                strength: strength * size * size,
            };
        }
        Dab {
            x,
            y,
            radius: size / 2.0,
            strength,
        }
    }
}
