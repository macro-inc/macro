//! Compositing: the document's layers blended into pixels for any canvas
//! area at any power-of-two scale.
//!
//! Where the stored merged image is current ([`crate::model::Composite`]),
//! it is drawn as is; elsewhere the layers are composited: blend modes,
//! opacity and fill opacity, pixel and vector masks, clipping groups,
//! pass-through and isolated groups, adjustment and fill layers, Blend If,
//! and layer styles. Output is straight RGBA8 over transparency.
//!
//! Work happens in premultiplied `f32` over the requested area (grown
//! where effects, feathers, or blurs read their neighbors), so a rectangle
//! renders the same in one call as in pieces. Below full size, layers,
//! masks, and the stored image are box-filtered by halves and cached by the
//! identity of the tiles they came from, so edits need no invalidation.

pub mod adjust;
pub mod blend;
mod cache;
mod composite;
mod effects;
mod fill;
mod layer;
mod plane;
#[cfg(test)]
mod testing;
mod vector;

use crate::model::{Document, LayerIdx, LayerKind};
use crate::raster::IRect;
use cache::Cache;
use composite::Canvas;
use layer::Cx;

/// Levels beyond this render as this one (a 2^20 reduction).
const MAX_LEVEL: u8 = 20;

/// Composites documents, keeping downscaled layers and other derived data
/// between calls.
#[derive(Default)]
pub struct Renderer {
    cache: Cache,
}

impl Renderer {
    /// A renderer with empty caches.
    pub fn new() -> Renderer {
        Renderer::default()
    }

    /// Composites `rect` of the canvas scaled down by `2^level` (so
    /// `rect` is in pixels of that scale): straight RGBA8, row by row.
    pub fn render(&mut self, doc: &Document, rect: IRect, level: u8) -> Vec<u8> {
        let level = level.min(MAX_LEVEL);
        let mut out = vec![0u8; rect.area().max(0) as usize * 4];
        let visible = rect.intersect(&doc.bounds().at_level(level));
        if visible.is_empty() {
            return out;
        }
        self.cache.begin_render();
        // Areas the layers must be composited for; the stored image covers
        // the rest.
        let mut stale = vec![visible];
        if let Some(stored) = &doc.composite {
            let raster = self.cache.level_raster(&stored.raster, level, visible);
            if raster.channels() == 4 {
                let bytes = raster.read_vec(visible);
                for y in 0..visible.h {
                    let src = (y * visible.w) as usize * 4;
                    let dst =
                        (((visible.y - rect.y + y) * rect.w) + (visible.x - rect.x)) as usize * 4;
                    out[dst..dst + visible.w as usize * 4]
                        .copy_from_slice(&bytes[src..src + visible.w as usize * 4]);
                }
                stale = stored
                    .stale
                    .iter()
                    .map(|s| s.at_level(level).intersect(&visible))
                    .filter(|s| !s.is_empty())
                    .collect();
            }
        }
        let Some(area) = stale.iter().copied().reduce(|a, b| a.union(&b)) else {
            return out;
        };
        // Nothing reaches the area: it stays transparent.
        if !doc.roots.iter().any(|&l| reaches(doc, l, level, area)) {
            return out;
        }
        let mut cx = Cx::new(doc, level, &mut self.cache, true);
        let mut canvas = Canvas::new(area);
        composite::stack(&mut cx, &doc.roots, &mut canvas);
        let mut i = 0;
        for y in area.y..area.bottom() {
            for x in area.x..area.right() {
                if stale.iter().any(|s| s.contains(x, y)) {
                    let o = (((y - rect.y) * rect.w) + (x - rect.x)) as usize * 4;
                    out[o..o + 4].copy_from_slice(&to_rgba8(canvas.px[i]));
                }
                i += 1;
            }
        }
        out
    }

    /// One layer alone (with its masks, and its effects when `effects`),
    /// at `level`, over `rect`, for thumbnails and exports.
    pub fn render_layer(
        &mut self,
        doc: &Document,
        layer: LayerIdx,
        rect: IRect,
        level: u8,
        effects: bool,
    ) -> Vec<u8> {
        let level = level.min(MAX_LEVEL);
        let mut out = vec![0u8; rect.area().max(0) as usize * 4];
        if rect.is_empty() || layer as usize >= doc.layers.len() {
            return out;
        }
        if let LayerKind::Adjustment { .. } = doc.layer(layer).kind {
            return out;
        }
        self.cache.begin_render();
        let mut cx = Cx::new(doc, level, &mut self.cache, effects);
        let mut canvas = Canvas::new(rect);
        composite::layer(&mut cx, &mut canvas, layer, None);
        for (o, p) in out.chunks_exact_mut(4).zip(&canvas.px) {
            o.copy_from_slice(&to_rgba8(*p));
        }
        out
    }

    /// Drops everything cached (after an edit the renderer cannot track,
    /// such as resizing the canvas).
    pub fn clear(&mut self) {
        self.cache.clear();
    }
}

/// The canvas area a layer can change, effects and masks included (for a
/// group, everything in it): what to re-render after it changes.
pub fn visual_bounds(doc: &Document, layer: LayerIdx) -> Option<IRect> {
    if layer as usize >= doc.layers.len() {
        return None;
    }
    let extent = layer::extent(doc, layer, 0, true)?;
    Some(extent.outset(layer::effects_reach(doc, doc.layer(layer))))
}

/// Whether a shown layer's paint (or its effects) can touch `area` at
/// `level`; adjustments alone paint nothing.
fn reaches(doc: &Document, idx: LayerIdx, level: u8, area: IRect) -> bool {
    let Some(l) = doc.layers.get(idx as usize) else {
        return false;
    };
    if !l.visible || l.removed || matches!(l.kind, LayerKind::Adjustment { .. }) {
        return false;
    }
    layer::extent(doc, idx, 0, false)
        .map(|e| e.outset(layer::effects_reach(doc, l)).at_level(level))
        .is_some_and(|e| e.intersects(&area))
}

/// A premultiplied pixel as straight RGBA8.
#[inline]
fn to_rgba8(p: [f32; 4]) -> [u8; 4] {
    let a = p[3].clamp(0.0, 1.0);
    let a8 = (a * 255.0).round();
    if a8 <= 0.0 {
        return [0; 4];
    }
    let inv = 1.0 / a;
    let c = |v: f32| ((v * inv).clamp(0.0, 1.0) * 255.0).round() as u8;
    [c(p[0]), c(p[1]), c(p[2]), a8 as u8]
}

#[cfg(test)]
mod test;
