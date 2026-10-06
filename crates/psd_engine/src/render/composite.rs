//! The stack compositor: layers bottom to top into a premultiplied canvas,
//! with clipping groups, pass-through and isolated groups, adjustment
//! layers, and each layer's effects.
//!
//! A layer with effects composites as Photoshop's do: effects below it go
//! onto the backdrop (knocked-out ones only in the part of each pixel its
//! shape leaves uncovered), then inside the shape its paint blends onto
//! that with its mode and the interior effects blend onto the result with
//! theirs (or, with "Blend Interior Effects as Group", onto the paint
//! alone before it blends); outer stroke bands sit beside the shape.
//! Opacity, Blend If, and clipping then fade the whole stack against the
//! backdrop.

use super::adjust::Prepared;
use super::blend::{self, composite_px, composite_row, dissolve_threshold, unpremultiply};
use super::effects::{self, Inputs};
use super::layer::{self, Content, Cx, has_effects};
use super::plane::Plane;
use crate::model::{BlendMode, LayerIdx, LayerKind};
use crate::raster::IRect;

/// Premultiplied RGBA (`0..=1`) over a rectangle, row by row.
pub(crate) struct Canvas {
    /// The rectangle covered (level pixels).
    pub(crate) rect: IRect,
    /// One pixel per position.
    pub(crate) px: Vec<[f32; 4]>,
}

impl Canvas {
    /// A transparent canvas.
    pub(crate) fn new(rect: IRect) -> Canvas {
        Canvas {
            rect,
            px: vec![[0.0; 4]; rect.area().max(0) as usize],
        }
    }

    /// Paints the part of `rect` (level pixels) on the canvas with a
    /// premultiplied color.
    fn fill(&mut self, rect: IRect, color: [f32; 4]) {
        let r = rect.intersect(&self.rect);
        if r.is_empty() {
            return;
        }
        let w = self.rect.w as usize;
        let (from, to) = (
            (r.x - self.rect.x) as usize,
            (r.right() - self.rect.x) as usize,
        );
        for y in r.y..r.bottom() {
            let row = (y - self.rect.y) as usize * w;
            self.px[row + from..row + to].fill(color);
        }
    }

    /// Clears everything outside `rect` (level pixels).
    fn keep(&mut self, rect: IRect) {
        let w = self.rect.w.max(1) as usize;
        let (x0, y0) = (self.rect.x, self.rect.y);
        for (i, p) in self.px.iter_mut().enumerate() {
            let (x, y) = (x0 + (i % w) as i32, y0 + (i / w) as i32);
            if x < rect.x || x >= rect.right() || y < rect.y || y >= rect.bottom() {
                *p = [0.0; 4];
            }
        }
    }

    /// The canvas as straight paint.
    fn content(&self) -> Content {
        Content {
            rect: self.rect,
            px: self.px.iter().map(|&p| unpremultiply(p)).collect(),
            shape: None,
            post_mask: None,
        }
    }
}

/// The mode a layer blends with (pass-through only means something for
/// groups).
fn mode_of(mode: BlendMode) -> BlendMode {
    if mode == BlendMode::PassThrough {
        BlendMode::Normal
    } else {
        mode
    }
}

/// Composites a stack (bottom to top) into `canvas`, skipping indices
/// past the document's layers.
pub(crate) fn stack(cx: &mut Cx, layers: &[LayerIdx], canvas: &mut Canvas) {
    let doc = cx.doc;
    let layers: Vec<LayerIdx> = layers
        .iter()
        .copied()
        .filter(|&l| (l as usize) < doc.layers.len())
        .collect();
    let mut i = 0;
    while i < layers.len() {
        let base = layers[i];
        let mut j = i + 1;
        while j < layers.len() && doc.layer(layers[j]).clipping {
            j += 1;
        }
        let b = doc.layer(base);
        if b.visible && !b.removed {
            let clipped: Vec<LayerIdx> = layers[i + 1..j]
                .iter()
                .copied()
                .filter(|&c| doc.layer(c).visible && !doc.layer(c).removed)
                .collect();
            if clipped.is_empty() {
                layer(cx, canvas, base, None);
            } else {
                clip_group(cx, canvas, base, &clipped);
            }
        }
        i = j;
    }
}

/// Composites a group's layers into `canvas` (none in a corrupt tree's
/// cycles or past [`layer::MAX_DEPTH`]).
fn children(cx: &mut Cx, idx: LayerIdx, canvas: &mut Canvas) {
    let children = layer::children(cx.doc, idx, &cx.path);
    cx.path.push(idx);
    stack(cx, &children, canvas);
    cx.path.pop();
}

/// Composites one layer, its coverage scaled by `clip` (canvas-sized).
pub(crate) fn layer(cx: &mut Cx, canvas: &mut Canvas, idx: LayerIdx, clip: Option<&Plane>) {
    let l = cx.doc.layer(idx);
    match &l.kind {
        LayerKind::Adjustment { .. } => adjustment(cx, canvas, idx, clip),
        LayerKind::Group { .. } => group(cx, canvas, idx, clip),
        _ => {
            let Some(rect) = paint_rect(cx, idx, canvas.rect) else {
                return;
            };
            let content = layer::content(cx, idx, rect);
            let fill = l.fill_opacity as f32 / 255.0;
            paint(cx, canvas, idx, content, fill, clip);
        }
    }
}

/// Where a layer's paint is needed to composite it (with its effects)
/// onto `target`.
fn paint_rect(cx: &Cx, idx: LayerIdx, target: IRect) -> Option<IRect> {
    let l = cx.doc.layer(idx);
    let extent = layer::extent(cx.doc, idx, cx.level, false)?;
    let m = match &l.effects {
        Some(fx) if has_effects(cx, l) => effects::margin(fx, cx.scale()),
        _ => 0,
    };
    if !extent.outset(m).intersects(&target) {
        return None;
    }
    Some(target.outset(m).intersect(&extent))
}

/// A group: pass-through groups composite their layers straight into the
/// backdrop and fade the result against it; others composite their layers
/// alone and blend the result like a layer.
fn group(cx: &mut Cx, canvas: &mut Canvas, idx: LayerIdx, clip: Option<&Plane>) {
    let l = cx.doc.layer(idx);
    let ranges = l.blend_ranges.as_ref().is_some_and(|r| !r.is_default());
    // Artboards composite alone, on their backgrounds.
    let artboard = matches!(
        l.kind,
        LayerKind::Group {
            artboard: Some(_),
            ..
        }
    );
    let pass_through =
        l.blend == BlendMode::PassThrough && !has_effects(cx, l) && !ranges && !artboard;
    if pass_through {
        if layer::extent(cx.doc, idx, cx.level, false).is_none_or(|e| !e.intersects(&canvas.rect)) {
            return;
        }
        let weight = l.opacity as f32 / 255.0 * l.fill_opacity as f32 / 255.0;
        let masks = layer::masks(cx, l, canvas.rect, true, true);
        if weight >= 1.0 && masks.is_none() && clip.is_none() {
            children(cx, idx, canvas);
            return;
        }
        let before = canvas.px.clone();
        children(cx, idx, canvas);
        for (i, (p, b)) in canvas.px.iter_mut().zip(&before).enumerate() {
            let mut w = weight;
            if let Some(m) = &masks {
                w *= m.v[i];
            }
            if let Some(c) = clip {
                w *= c.v[i];
            }
            if w < 1.0 {
                *p = std::array::from_fn(|k| b[k] + (p[k] - b[k]) * w);
            }
        }
        return;
    }
    let Some(rect) = paint_rect(cx, idx, canvas.rect) else {
        return;
    };
    let content = group_content(cx, idx, rect);
    let fill = l.fill_opacity as f32 / 255.0;
    paint(cx, canvas, idx, content, fill, clip);
}

/// A group's layers composited alone over `rect`, with the group's masks:
/// an artboard's on its background and cut to its rectangle.
fn group_content(cx: &mut Cx, idx: LayerIdx, rect: IRect) -> Content {
    let l = cx.doc.layer(idx);
    let mut sub = Canvas::new(rect);
    let artboard = match &l.kind {
        LayerKind::Group { artboard, .. } => *artboard,
        _ => None,
    };
    if let Some(color) = artboard.and_then(|a| a.background.color()) {
        let board = artboard.map_or(rect, |a| a.rect.at_level(cx.level));
        sub.fill(board, [color.r, color.g, color.b, 1.0]);
    }
    children(cx, idx, &mut sub);
    if let Some(a) = artboard {
        sub.keep(a.rect.at_level(cx.level));
    }
    let mut content = sub.content();
    let effects = has_effects(cx, l);
    let (hide_pixel, hide_vector) = (
        effects && l.mask_hides_effects,
        effects && l.vector_mask_hides_effects,
    );
    if let Some(m) = layer::masks(cx, l, rect, !hide_pixel, !hide_vector) {
        content.mask(&m);
    }
    if hide_pixel || hide_vector {
        content.post_mask = layer::masks(cx, l, rect, hide_pixel, hide_vector);
    }
    content
}

/// A layer with the layers clipped to it. Blended as a group (the
/// default), they composite onto the base's paint within its shape and the
/// result blends like the base; otherwise each blends onto the backdrop
/// within the base's shape.
fn clip_group(cx: &mut Cx, canvas: &mut Canvas, base: LayerIdx, clipped: &[LayerIdx]) {
    let b = cx.doc.layer(base);
    let is_adjustment = matches!(b.kind, LayerKind::Adjustment { .. });
    if !b.blend_clipped_as_group || is_adjustment {
        layer(cx, canvas, base, None);
        let mut shape = if is_adjustment {
            layer::masks(cx, b, canvas.rect, true, true)
                .unwrap_or_else(|| Plane::filled(canvas.rect, 1.0))
        } else {
            match paint_rect(cx, base, canvas.rect) {
                Some(_) => base_paint(cx, base, canvas.rect).shape_plane(),
                None => return,
            }
        };
        let opacity = b.opacity as f32 / 255.0;
        shape.map(|v| v * opacity);
        for &c in clipped {
            layer(cx, canvas, c, Some(&shape));
        }
        return;
    }
    let Some(rect) = paint_rect(cx, base, canvas.rect) else {
        return;
    };
    let content = base_paint(cx, base, rect);
    let shape = content.shape_plane();
    let fill = b.fill_opacity as f32 / 255.0;
    let mut buf = Canvas::new(rect);
    for (d, p) in buf.px.iter_mut().zip(&content.px) {
        let a = p[3] * fill;
        *d = [p[0] * a, p[1] * a, p[2] * a, a];
    }
    for &c in clipped {
        if matches!(cx.doc.layer(c).kind, LayerKind::Adjustment { .. }) {
            adjustment(cx, &mut buf, c, None);
        } else {
            layer(cx, &mut buf, c, Some(&shape));
        }
    }
    let mut group = buf.content();
    group.shape = Some(shape.v);
    group.post_mask = content.post_mask;
    paint(cx, canvas, base, group, 1.0, None);
}

/// A clipping base's own paint over `rect`.
fn base_paint(cx: &mut Cx, base: LayerIdx, rect: IRect) -> Content {
    if cx.doc.layer(base).is_group() {
        group_content(cx, base, rect)
    } else {
        layer::content(cx, base, rect)
    }
}

/// An adjustment layer: everything below it in `canvas`, adjusted, blended
/// back with the layer's mode within its masks, opacity, and fill.
fn adjustment(cx: &mut Cx, canvas: &mut Canvas, idx: LayerIdx, clip: Option<&Plane>) {
    let l = cx.doc.layer(idx);
    let LayerKind::Adjustment { adjustment } = &l.kind else {
        return;
    };
    let prepared = Prepared::new(adjustment);
    let k = l.opacity as f32 / 255.0 * l.fill_opacity as f32 / 255.0;
    if prepared.is_identity() || k <= 0.0 {
        return;
    }
    let masks = layer::masks(cx, l, canvas.rect, true, true);
    let mode = mode_of(l.blend);
    for (i, p) in canvas.px.iter_mut().enumerate() {
        let a = p[3];
        if a <= 0.0 {
            continue;
        }
        let mut w = k;
        if let Some(m) = &masks {
            w *= m.v[i];
        }
        if let Some(c) = clip {
            w *= c.v[i];
        }
        if w <= 0.0 {
            continue;
        }
        let inv = 1.0 / a;
        let cb = [p[0] * inv, p[1] * inv, p[2] * inv].map(|v| v.clamp(0.0, 1.0));
        let adjusted = prepared.apply(cb);
        let target = if mode == BlendMode::Normal {
            adjusted
        } else {
            blend::blend(mode, cb, adjusted)
        };
        for c in 0..3 {
            p[c] = (cb[c] + (target[c] - cb[c]) * w) * a;
        }
    }
}

/// Composites a layer's paint (with its effects) onto `canvas`.
fn paint(
    cx: &mut Cx,
    canvas: &mut Canvas,
    idx: LayerIdx,
    content: Content,
    fill: f32,
    clip: Option<&Plane>,
) {
    let l = cx.doc.layer(idx);
    let fx = l.effects.as_ref().filter(|_| has_effects(cx, l));
    if let Some(fx) = fx {
        with_effects(cx, canvas, idx, &content, fill, clip, fx);
        return;
    }
    let mode = mode_of(l.blend);
    let opacity = l.opacity as f32 / 255.0;
    let ranges = l.blend_ranges.as_ref().filter(|r| !r.is_default());
    let area = content.rect.intersect(&canvas.rect);
    if area.is_empty() {
        return;
    }
    let weighted = ranges.is_some() || clip.is_some() || content.post_mask.is_some();
    let mut row = vec![[0.0f32; 4]; area.w as usize];
    for y in area.y..area.bottom() {
        let src = ((y - content.rect.y) * content.rect.w + (area.x - content.rect.x)) as usize;
        let dst = ((y - canvas.rect.y) * canvas.rect.w + (area.x - canvas.rect.x)) as usize;
        let src = &content.px[src..src + area.w as usize];
        let dst = &mut canvas.px[dst..dst + area.w as usize];
        if !weighted {
            composite_row(mode, dst, src, opacity, fill, area.x, y);
            continue;
        }
        for (i, (r, s)) in row.iter_mut().zip(src).enumerate() {
            let x = area.x + i as i32;
            let mut a = s[3];
            if a > 0.0 {
                if let Some(c) = clip {
                    a *= c.get(x, y);
                }
                if let Some(m) = &content.post_mask {
                    a *= m.get(x, y);
                }
                if let Some(rg) = ranges {
                    let b = unpremultiply(dst[i]);
                    a *= layer::blend_if(rg, [s[0], s[1], s[2]], [b[0], b[1], b[2]]);
                }
            }
            *r = [s[0], s[1], s[2], a];
        }
        composite_row(mode, dst, &row, opacity, fill, area.x, y);
    }
}

/// Composites a layer's paint with its effects onto `canvas`.
fn with_effects(
    cx: &mut Cx,
    canvas: &mut Canvas,
    idx: LayerIdx,
    content: &Content,
    fill: f32,
    clip: Option<&Plane>,
    fx: &crate::model::Effects,
) {
    let l = cx.doc.layer(idx);
    let m = effects::margin(fx, cx.scale());
    let region = canvas.rect.intersect(&content.rect.outset(m));
    if region.is_empty() {
        return;
    }
    let shape = content.shape_plane();
    let frame = layer::frame(cx, idx);
    let stages = effects::render(
        cx,
        fx,
        &Inputs {
            shape: &shape,
            region,
            frame,
        },
    );
    let mut mode = mode_of(l.blend);
    let dissolve = mode == BlendMode::Dissolve;
    if dissolve {
        mode = BlendMode::Normal;
    }
    let opacity = l.opacity as f32 / 255.0;
    let ranges = l.blend_ranges.as_ref().filter(|r| !r.is_default());
    let interior_as_group = l.blend_interior_as_group;
    let mut i = 0;
    for y in region.y..region.bottom() {
        let row = ((y - canvas.rect.y) * canvas.rect.w + (region.x - canvas.rect.x)) as usize;
        for x in region.x..region.right() {
            let ci = row + (x - region.x) as usize;
            let b = canvas.px[ci];
            let (paint, a) = if content.rect.contains(x, y) {
                let j = ((y - content.rect.y) * content.rect.w + (x - content.rect.x)) as usize;
                (content.px[j], content.shape_at(j))
            } else {
                ([0.0; 4], 0.0)
            };
            // Effects below the layer; knocked-out ones only where its
            // shape leaves the pixel uncovered.
            let mut below = b;
            let mut outside = b;
            for st in &stages.below {
                let (c, k) = st.at(i);
                composite_px(st.mode, &mut outside, c, k, 1.0);
                if !st.knocked_out {
                    composite_px(st.mode, &mut below, c, k, 1.0);
                }
            }
            let room = 1.0 - a;
            for st in &stages.beside {
                let (c, k) = st.at(i);
                if room > 1e-6 {
                    composite_px(st.mode, &mut outside, c, (k / room).min(1.0), 1.0);
                }
            }
            let fin = if a > 0.0 {
                let mut inside = below;
                let share = (paint[3] / a).min(1.0);
                let (share, f) = if dissolve {
                    let shown = dissolve_threshold(x, y) < share * fill;
                    (if shown { 1.0 } else { 0.0 }, 1.0)
                } else {
                    (share, fill)
                };
                let rgb = [paint[0], paint[1], paint[2]];
                if interior_as_group {
                    // The paint and interior effects together first, then
                    // blended with the layer's mode.
                    let s = share * f;
                    let mut own = [rgb[0] * s, rgb[1] * s, rgb[2] * s, s];
                    for st in &stages.inside {
                        let (c, k) = st.at(i);
                        composite_px(st.mode, &mut own, c, k, 1.0);
                    }
                    let o = unpremultiply(own);
                    composite_px(mode, &mut inside, [o[0], o[1], o[2]], o[3], 1.0);
                } else {
                    composite_px(mode, &mut inside, rgb, share, f);
                    for st in &stages.inside {
                        let (c, k) = st.at(i);
                        composite_px(st.mode, &mut inside, c, k, 1.0);
                    }
                }
                std::array::from_fn(|k| outside[k] + (inside[k] - outside[k]) * a)
            } else {
                outside
            };
            let mut w = opacity;
            if let Some(c) = clip {
                w *= c.get(x, y);
            }
            if let Some(pm) = &content.post_mask {
                w *= pm.get(x, y);
            }
            if let Some(rg) = ranges {
                let bs = unpremultiply(b);
                w *= layer::blend_if(rg, [paint[0], paint[1], paint[2]], [bs[0], bs[1], bs[2]]);
            }
            canvas.px[ci] = std::array::from_fn(|k| b[k] + (fin[k] - b[k]) * w);
            i += 1;
        }
    }
}

#[cfg(test)]
mod test;
