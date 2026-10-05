//! A layer's own paint over an area, before blending: its pixels (or its
//! fill and shape stroke) with its pixel and vector masks applied, the
//! area it can paint, and its Blend If weights.

use super::blend::{composite_px, unpremultiply};
use super::cache::Cache;
use super::fill;
use super::plane::{self, Plane};
use super::vector;
use crate::model::{BlendRanges, Document, Fill, Layer, LayerIdx, LayerKind, VectorStroke};
use crate::raster::IRect;

/// Groups nest at most this deep for rendering: deeper layers, like a
/// corrupt tree's cycles, render nothing.
pub(crate) const MAX_DEPTH: usize = 64;

/// What renders at one level share: the document, the level, and caches.
pub(crate) struct Cx<'a> {
    /// The document.
    pub(crate) doc: &'a Document,
    /// The level: pixels are canvas pixels scaled by `1 / 2^level`.
    pub(crate) level: u8,
    /// Derived data kept between renders.
    pub(crate) cache: &'a mut Cache,
    /// Whether layer effects are drawn.
    pub(crate) effects: bool,
    /// The groups being composited, outermost first.
    pub(crate) path: Vec<LayerIdx>,
}

impl<'a> Cx<'a> {
    /// A context for rendering `doc` at `level`.
    pub(crate) fn new(doc: &'a Document, level: u8, cache: &'a mut Cache, effects: bool) -> Self {
        Cx {
            doc,
            level,
            cache,
            effects,
            path: Vec::new(),
        }
    }

    /// Canvas pixels per level pixel, inverted: `1 / 2^level`.
    pub(crate) fn scale(&self) -> f32 {
        0.5f32.powi(self.level as i32)
    }

    /// The canvas at this level.
    pub(crate) fn canvas(&self) -> IRect {
        self.doc.bounds().at_level(self.level)
    }
}

/// A layer's paint over a rectangle.
pub(crate) struct Content {
    /// The rectangle covered.
    pub(crate) rect: IRect,
    /// Straight color and coverage per pixel: masks applied, fill and
    /// opacity not.
    pub(crate) px: Vec<[f32; 4]>,
    /// The shape effects follow and clipped layers clip to, where it
    /// differs from the coverage (clipping groups).
    pub(crate) shape: Option<Vec<f32>>,
    /// Masks applied after the effects ("Layer Mask Hides Effects").
    pub(crate) post_mask: Option<Plane>,
}

impl Content {
    /// Transparent paint over `rect`.
    pub(crate) fn empty(rect: IRect) -> Content {
        Content {
            rect,
            px: vec![[0.0; 4]; rect.area().max(0) as usize],
            shape: None,
            post_mask: None,
        }
    }

    /// The shape as a plane.
    pub(crate) fn shape_plane(&self) -> Plane {
        Plane {
            rect: self.rect,
            v: match &self.shape {
                Some(s) => s.clone(),
                None => self.px.iter().map(|p| p[3]).collect(),
            },
        }
    }

    /// The shape at index `i`.
    #[inline]
    pub(crate) fn shape_at(&self, i: usize) -> f32 {
        match &self.shape {
            Some(s) => s[i],
            None => self.px[i][3],
        }
    }

    /// Multiplies the coverage (and the shape) by a plane over the same
    /// rectangle.
    pub(crate) fn mask(&mut self, m: &Plane) {
        debug_assert_eq!(m.rect, self.rect);
        for (p, &v) in self.px.iter_mut().zip(&m.v) {
            p[3] *= v;
        }
        if let Some(s) = &mut self.shape {
            for (s, &v) in s.iter_mut().zip(&m.v) {
                *s *= v;
            }
        }
    }
}

/// A group's children (bottom to top) for a walk inside the groups on
/// `path`: none when that is too deep or already holds the group (a
/// corrupt tree's cycle), and no index past the document's layers.
pub(crate) fn children(doc: &Document, idx: LayerIdx, path: &[LayerIdx]) -> Vec<LayerIdx> {
    match doc.layers.get(idx as usize) {
        Some(l) if path.len() < MAX_DEPTH && !path.contains(&idx) => l
            .children
            .iter()
            .copied()
            .filter(|&c| (c as usize) < doc.layers.len())
            .collect(),
        _ => Vec::new(),
    }
}

/// Whether a layer's effects are drawn.
pub(crate) fn has_effects(cx: &Cx, layer: &Layer) -> bool {
    cx.effects && layer.effects.as_ref().is_some_and(|fx| fx.any_visible())
}

/// The area (level pixels) a layer's own paint can cover, effects aside;
/// `None` when it paints nothing. Tile-granular for pixels unless `tight`.
pub(crate) fn extent(doc: &Document, idx: LayerIdx, level: u8, tight: bool) -> Option<IRect> {
    Some(extent_in(doc, idx, tight, &mut Vec::new())?.at_level(level))
}

/// [`extent`] at level 0 for a walk inside the groups on `path`.
fn extent_in(
    doc: &Document,
    idx: LayerIdx,
    tight: bool,
    path: &mut Vec<LayerIdx>,
) -> Option<IRect> {
    let layer = doc.layers.get(idx as usize)?;
    let canvas = doc.bounds();
    let own = match &layer.kind {
        LayerKind::Group { .. } => {
            let mut out: Option<IRect> = None;
            let children = children(doc, idx, path);
            path.push(idx);
            for c in children {
                let child = doc.layer(c);
                if !child.visible || child.removed {
                    continue;
                }
                // Adjustments inside reach the whole canvas below them.
                if let Some(r) = extent_in(doc, c, tight, path) {
                    let r = r.outset(effects_reach(doc, child));
                    out = Some(out.map_or(r, |o| o.union(&r)));
                }
            }
            path.pop();
            out?
        }
        LayerKind::Fill { stroke, .. } => match &layer.vector_mask {
            Some(vm) if !vm.disabled => {
                let fill = vector::mask_bounds(vm).unwrap_or(canvas);
                match stroke.as_deref().filter(|s| s.enabled) {
                    Some(s) => match vector::path_bounds(&vm.subpaths) {
                        Some(p) => fill.union(&p.outset(vector::stroke_reach(s))),
                        None => fill,
                    },
                    None => fill,
                }
            }
            _ => canvas,
        },
        LayerKind::Adjustment { .. } => canvas,
        _ => {
            if layer.background {
                canvas
            } else if tight {
                layer.pixels.content_bounds()?
            } else {
                layer.pixels.bounds()?
            }
        }
    };
    let mut r = own;
    if let Some(m) = layer
        .mask
        .as_ref()
        .filter(|m| !m.disabled && m.default_color == 0 && m.density >= 1.0)
    {
        r = r.intersect(&m.rect.outset(plane::blur_support(m.feather.max(0.0))));
    }
    if !matches!(layer.kind, LayerKind::Fill { .. })
        && let Some(b) = layer
            .vector_mask
            .as_ref()
            .filter(|v| !v.disabled)
            .and_then(vector::mask_bounds)
    {
        r = r.intersect(&b);
    }
    (!r.is_empty()).then_some(r)
}

/// How far (canvas pixels) a layer's effects reach past its paint.
pub(crate) fn effects_reach(_doc: &Document, layer: &Layer) -> i32 {
    match &layer.effects {
        Some(fx) if fx.any_visible() => super::effects::margin(fx, 1.0),
        _ => 0,
    }
}

/// The frame (canvas pixels, level 0) gradients and patterns aligned with
/// the layer are laid over: the layer's tight bounds (a group's layers'
/// together), or the canvas.
pub(crate) fn frame(cx: &mut Cx, idx: LayerIdx) -> IRect {
    own_frame(cx, idx, &mut Vec::new())
        .filter(|r| !r.is_empty())
        .unwrap_or_else(|| cx.doc.bounds())
}

/// A layer's tight bounds, remembered per raster in the cache, for a walk
/// inside the groups on `path`.
fn own_frame(cx: &mut Cx, idx: LayerIdx, path: &mut Vec<LayerIdx>) -> Option<IRect> {
    let doc = cx.doc;
    let layer = doc.layers.get(idx as usize)?;
    match &layer.kind {
        LayerKind::Fill { .. } => layer
            .vector_mask
            .as_ref()
            .filter(|v| !v.disabled)
            .and_then(|v| vector::path_bounds(&v.subpaths).map(|b| b.outset(-1))),
        LayerKind::Group { .. } => {
            let children = children(doc, idx, path);
            path.push(idx);
            let out = children
                .into_iter()
                .filter(|&c| doc.layer(c).visible && !doc.layer(c).removed)
                .filter_map(|c| own_frame(cx, c, path))
                .reduce(|a, b| a.union(&b));
            path.pop();
            out
        }
        LayerKind::Adjustment { .. } => None,
        _ => cx.cache.content_bounds(&layer.pixels),
    }
}

/// A layer's masks over `rect` (level pixels): its pixel mask (density and
/// feather applied) times its vector mask; `None` when it has neither.
/// `pixel` and `vector` choose which to include.
pub(crate) fn masks(
    cx: &mut Cx,
    layer: &Layer,
    rect: IRect,
    pixel: bool,
    vector: bool,
) -> Option<Plane> {
    let mut out: Option<Plane> = None;
    if pixel && let Some(m) = layer.mask.as_ref().filter(|m| !m.disabled) {
        let feather = m.feather.max(0.0) * cx.scale();
        let support = plane::blur_support(feather);
        let padded = rect.outset(support);
        let lm = cx.cache.level_mask(m, cx.level, padded);
        let mut p = Plane::filled(padded, 0.0);
        let mut i = 0;
        for y in padded.y..padded.bottom() {
            for x in padded.x..padded.right() {
                p.v[i] = lm.value(x, y) as f32 / 255.0;
                i += 1;
            }
        }
        if support > 0 {
            plane::blur(&mut p, feather);
            p = p.crop(rect);
        }
        let density = if m.density.is_nan() {
            1.0
        } else {
            m.density.clamp(0.0, 1.0)
        };
        if density < 1.0 {
            p.map(|v| 1.0 - density * (1.0 - v));
        }
        out = Some(p);
    }
    if vector && let Some(vm) = layer.vector_mask.as_ref().filter(|v| !v.disabled) {
        let cov = vector::mask_coverage(cx.cache, vm, cx.level, rect);
        out = Some(match out {
            Some(mut p) => {
                for (a, b) in p.v.iter_mut().zip(&cov.v) {
                    *a *= b;
                }
                p
            }
            None => cov,
        });
    }
    out
}

/// A pixel, text, smart object, or fill layer's paint over `rect` with its
/// masks; masks that hide effects are left in `post_mask` when the layer
/// draws effects.
pub(crate) fn content(cx: &mut Cx, idx: LayerIdx, rect: IRect) -> Content {
    let doc = cx.doc;
    let layer = doc.layer(idx);
    let effects = has_effects(cx, layer);
    let hide_pixel = effects && layer.mask_hides_effects;
    let hide_vector = effects && layer.vector_mask_hides_effects;
    let mut out = match &layer.kind {
        LayerKind::Fill { fill, stroke } => fill_content(cx, idx, fill, stroke.as_deref(), rect),
        _ => pixel_content(cx, layer, rect),
    };
    // A fill layer's vector mask is its shape, already applied.
    let is_fill = matches!(layer.kind, LayerKind::Fill { .. });
    if let Some(m) = masks(cx, layer, rect, !hide_pixel, !hide_vector && !is_fill) {
        out.mask(&m);
    }
    if hide_pixel || (hide_vector && !is_fill) {
        out.post_mask = masks(cx, layer, rect, hide_pixel, hide_vector && !is_fill);
    }
    out
}

/// A pixel layer's pixels over `rect` as straight color and alpha.
fn pixel_content(cx: &mut Cx, layer: &Layer, rect: IRect) -> Content {
    let raster = cx.cache.level_raster(&layer.pixels, cx.level, rect);
    let mut out = Content::empty(rect);
    if raster.channels() != 4 {
        return out;
    }
    let bytes = raster.read_vec(rect);
    for (p, b) in out.px.iter_mut().zip(bytes.chunks_exact(4)) {
        if b[3] != 0 {
            *p = [
                b[0] as f32 / 255.0,
                b[1] as f32 / 255.0,
                b[2] as f32 / 255.0,
                b[3] as f32 / 255.0,
            ];
        }
    }
    if layer.background {
        // The Background is opaque across the canvas.
        let canvas = cx.canvas();
        let mut i = 0;
        for y in rect.y..rect.bottom() {
            for x in rect.x..rect.right() {
                if canvas.contains(x, y) {
                    out.px[i][3] = 1.0;
                }
                i += 1;
            }
        }
    }
    out
}

/// A fill layer's paint: its fill inside its vector mask (the whole canvas
/// without one), then its shape stroke over it.
fn fill_content(
    cx: &mut Cx,
    idx: LayerIdx,
    fill: &Fill,
    stroke: Option<&VectorStroke>,
    rect: IRect,
) -> Content {
    let doc = cx.doc;
    let layer = doc.layer(idx);
    let frame = frame(cx, idx);
    let vm = layer.vector_mask.as_ref().filter(|v| !v.disabled);
    let stroke = stroke.filter(|s| s.enabled && vm.is_some());
    let fill_shown = stroke.is_none_or(|s| s.fill_enabled);
    let mut out = Content::empty(rect);
    if fill_shown {
        let paint = fill::paint(doc, fill, frame, cx.level, rect);
        let coverage = match vm {
            Some(vm) => vector::mask_coverage(cx.cache, vm, cx.level, rect),
            None => {
                let canvas = cx.canvas();
                let mut p = Plane::filled(rect, 0.0);
                let part = rect.intersect(&canvas);
                for y in part.y..part.bottom() {
                    let row = ((y - rect.y) * rect.w + (part.x - rect.x)) as usize;
                    p.v[row..row + part.w as usize].fill(1.0);
                }
                p
            }
        };
        for ((o, c), &a) in out.px.iter_mut().zip(&paint).zip(&coverage.v) {
            *o = [c[0], c[1], c[2], c[3] * a];
        }
    }
    if let (Some(s), Some(vm)) = (stroke, vm) {
        let cov = vector::stroke_coverage(cx.cache, vm, s, cx.level, rect);
        let paint = fill::paint(doc, &s.fill, frame, cx.level, rect);
        let opacity = s.opacity.clamp(0.0, 1.0);
        for ((o, c), &a) in out.px.iter_mut().zip(&paint).zip(&cov.v) {
            if a <= 0.0 {
                continue;
            }
            let mut d = [o[0] * o[3], o[1] * o[3], o[2] * o[3], o[3]];
            composite_px(s.blend, &mut d, [c[0], c[1], c[2]], a * c[3] * opacity, 1.0);
            *o = unpremultiply(d);
        }
    }
    out
}

/// Blend If: how much of the layer shows at each pixel given its own
/// color and the backdrop's (both straight), `None` when everything shows.
pub(crate) fn blend_if(ranges: &BlendRanges, src: [f32; 3], dst: [f32; 3]) -> f32 {
    let mut w = 1.0;
    for (i, (s, d)) in ranges.channels.iter().take(4).enumerate() {
        let value = |c: [f32; 3]| {
            if i == 0 {
                super::blend::lum(c) * 255.0
            } else {
                c[i - 1] * 255.0
            }
        };
        w *= ramp(value(src), s) * ramp(value(dst), d);
        if w <= 0.0 {
            return 0.0;
        }
    }
    w
}

/// One Blend If slider pair: 0 below the black range, 1 between the
/// ranges, 0 above the white range, ramping across split sliders.
fn ramp(v: f32, r: &[u8; 4]) -> f32 {
    let [bl, bh, wl, wh] = r.map(|x| x as f32);
    let low = if v < bl {
        0.0
    } else if v >= bh {
        1.0
    } else {
        (v - bl) / (bh - bl)
    };
    let high = if v > wh {
        0.0
    } else if v <= wl {
        1.0
    } else {
        (wh - v) / (wh - wl)
    };
    low * high
}

#[cfg(test)]
mod test;
