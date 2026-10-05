//! Text: the glyph outlines Figma laid out, filled with the node's (or the
//! character style's) paints.

use super::{Painter, Shape, Surface};
use crate::model::{Affine, Paint, PaintKind, Props, Rect, Vec2};
use crate::scene::SceneIdx;
use std::sync::Arc;
use tiny_skia::{FillRule, Mask, PathBuilder, PathSegment};

/// Below this many device pixels per em, glyphs are drawn as bars.
const GREEK_BELOW: f64 = 2.5;

impl Painter<'_> {
    pub(crate) fn draw_text(
        &mut self,
        _i: SceneIdx,
        props: &Props,
        ts: &Affine,
        surface: &mut Surface,
        clip: Option<&Mask>,
        opacity: f32,
    ) {
        let Some(layout) = props.text_layout.clone() else {
            return;
        };
        let base: Arc<[Paint]> = props.fills.clone().unwrap_or_else(|| Arc::from([]));
        let styles = props.text_content.as_ref().map(|c| c.styles.clone());
        let fills_for = |style: u32| -> Arc<[Paint]> {
            if style != 0
                && let Some(styles) = &styles
                && let Some(run) = styles.iter().find(|r| r.id == style)
                && let Some(fills) = &run.fills
            {
                return fills.clone();
            }
            base.clone()
        };
        let size = props.size();
        let device_scale = ts.scale_factor();

        // Consecutive glyphs sharing paints are filled as one path.
        let mut run_style: Option<u32> = None;
        let mut builder = PathBuilder::new();
        let flush = |painter: &mut Painter,
                     builder: &mut PathBuilder,
                     style: Option<u32>,
                     surface: &mut Surface| {
            let Some(style) = style else { return };
            let pb = std::mem::take(builder);
            let Some(path) = pb.finish() else { return };
            let shape = Shape::Owned(path, FillRule::Winding);
            for paint in fills_for(style).iter().filter(|p| p.is_visible()) {
                painter.fill_shape(surface, &shape, ts, paint, size, opacity, clip);
            }
        };
        let cut = layout.truncated_at.unwrap_or(u32::MAX);
        // The last glyph shown before the cut, where the ellipsis goes.
        let mut last_shown: Option<&crate::model::Glyph> = None;
        for g in layout.glyphs.iter() {
            if g.first_char >= cut {
                continue;
            }
            if last_shown.is_none_or(|l| g.first_char >= l.first_char) {
                last_shown = Some(g);
            }
            let Some(path) = g.blob.and_then(|b| self.doc.blobs.path(b)) else {
                continue;
            };
            if run_style != Some(g.style_id) {
                flush(self, &mut builder, run_style, surface);
                run_style = Some(g.style_id);
            }
            let fs = f64::from(g.font_size);
            let glyph =
                Affine::translate(f64::from(g.x), f64::from(g.y)).mul(&Affine::scale(fs, -fs));
            if fs * device_scale < GREEK_BELOW {
                // Too small to read: a bar where the glyph's ink sits.
                let b = path.path.bounds();
                let bar_h = (b.height() * 0.45).max(0.1);
                let r = glyph.map_rect(&crate::model::Rect::new(
                    f64::from(b.x()),
                    f64::from(b.y() + b.height() * 0.2),
                    f64::from(b.width()),
                    f64::from(bar_h),
                ));
                if let Some(rect) =
                    tiny_skia::Rect::from_xywh(r.x as f32, r.y as f32, r.w as f32, r.h as f32)
                {
                    builder.push_rect(rect);
                }
                continue;
            }
            append_transformed(&mut builder, &path.path, &glyph);
        }
        if layout.truncated_at.is_some()
            && let Some(g) = last_shown
        {
            if run_style != Some(g.style_id) {
                flush(self, &mut builder, run_style, surface);
                run_style = Some(g.style_id);
            }
            push_ellipsis(&mut builder, g);
        }
        flush(self, &mut builder, run_style, surface);

        for deco in layout.decorations.iter() {
            let mut pb = PathBuilder::new();
            for r in deco.rects.iter() {
                if let Some(rect) =
                    tiny_skia::Rect::from_xywh(r[0], r[1], r[2].max(0.01), r[3].max(0.01))
                {
                    pb.push_rect(rect);
                }
            }
            let Some(path) = pb.finish() else { continue };
            let shape = Shape::Owned(path, FillRule::Winding);
            for paint in fills_for(deco.style_id).iter().filter(|p| p.is_visible()) {
                self.fill_shape(surface, &shape, ts, paint, size, opacity, clip);
            }
        }

        // Older files store an outline for stroked text.
        if props.has_visible_strokes() && !props.stroke_geometry().is_empty() {
            let shapes: Vec<Shape> = props
                .stroke_geometry()
                .iter()
                .filter_map(|g| {
                    self.doc
                        .blobs
                        .path(g.blob)
                        .map(|p| Shape::Blob(p, super::fill_rule(g.winding)))
                })
                .collect();
            // Inside and outside strokes are stored doubled and centered;
            // clip them to (or out of) the glyphs.
            let align = props.stroke_align();
            let mut owned = None;
            let sts = ts.to_skia();
            // The mask is read where the strokes draw.
            let read = shapes
                .iter()
                .filter_map(|s| s.path().bounds().transform(sts))
                .fold(Rect::EMPTY, |acc, b| {
                    acc.union(&Rect::new(
                        f64::from(b.x()),
                        f64::from(b.y()),
                        f64::from(b.width()),
                        f64::from(b.height()),
                    ))
                });
            if align != crate::model::StrokeAlign::Center
                && let Some(mut mask) = self.area_mask(surface, Some(read))
            {
                for g in layout.glyphs.iter() {
                    if let Some(path) = g.blob.and_then(|b| self.doc.blobs.path(b)) {
                        let gts = sts
                            .pre_translate(g.x, g.y)
                            .pre_scale(g.font_size, -g.font_size);
                        mask.fill_path(&path.path, FillRule::Winding, gts);
                    }
                }
                if align == crate::model::StrokeAlign::Outside {
                    mask.invert();
                }
                if let Some(c) = clip {
                    mask.multiply(c);
                }
                owned = Some(mask);
            }
            {
                let stroke_clip = owned.as_ref().map(|m| &m.mask).or(clip);
                for paint in props.strokes().iter().filter(|p| p.is_visible()) {
                    for s in &shapes {
                        self.fill_shape(surface, s, ts, paint, size, opacity, stroke_clip);
                    }
                }
            }
            if let Some(m) = owned {
                self.recycle(m);
            }
        }
    }
}

/// Whether a paint looks the same however a path is split (solid colors).
#[allow(dead_code)]
fn is_solid(paint: &Paint) -> bool {
    matches!(paint.kind, PaintKind::Solid(_))
}

/// An ellipsis (three dots, sized like Inter's) after glyph `g`.
fn push_ellipsis(pb: &mut PathBuilder, g: &crate::model::Glyph) {
    let em = g.font_size;
    let x = g.x + g.advance * em;
    let r = 0.06 * em;
    for k in 0..3 {
        let cx = x + (0.13 + 0.27 * k as f32) * em;
        pb.push_circle(cx, g.y - r, r);
    }
}

/// Appends `path` mapped through `t` to `pb`.
fn append_transformed(pb: &mut PathBuilder, path: &tiny_skia::Path, t: &Affine) {
    let p = |q: tiny_skia::Point| {
        let v = t.apply(Vec2::new(f64::from(q.x), f64::from(q.y)));
        (v.x as f32, v.y as f32)
    };
    for seg in path.segments() {
        match seg {
            PathSegment::MoveTo(a) => {
                let (x, y) = p(a);
                pb.move_to(x, y);
            }
            PathSegment::LineTo(a) => {
                let (x, y) = p(a);
                pb.line_to(x, y);
            }
            PathSegment::QuadTo(c, a) => {
                let (cx, cy) = p(c);
                let (x, y) = p(a);
                pb.quad_to(cx, cy, x, y);
            }
            PathSegment::CubicTo(c1, c2, a) => {
                let (c1x, c1y) = p(c1);
                let (c2x, c2y) = p(c2);
                let (x, y) = p(a);
                pb.cubic_to(c1x, c1y, c2x, c2y, x, y);
            }
            PathSegment::Close => pb.close(),
        }
    }
}
