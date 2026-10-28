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
        let mut emoji = Vec::new();
        for g in layout.glyphs.iter() {
            if g.first_char >= cut {
                continue;
            }
            if last_shown.is_none_or(|l| g.first_char >= l.first_char) {
                last_shown = Some(g);
            }
            if let Some(codes) = &g.emoji {
                // Figma draws emoji from images it does not store; the
                // outline here is only their box.
                emoji.push((g, codes.clone()));
                continue;
            }
            let Some(path) = g.blob.and_then(|b| self.doc.blobs.path(b)) else {
                continue;
            };
            if run_style != Some(g.style_id) {
                flush(self, &mut builder, run_style, surface);
                run_style = Some(g.style_id);
            }
            let fs = f64::from(g.font_size);
            let glyph = g.to_node();
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
        for (g, codes) in emoji {
            for (path, color) in emoji_stand_in(g, &codes) {
                let paint = Paint::solid(color);
                let shape = Shape::Owned(path, FillRule::Winding);
                self.fill_shape(surface, &shape, ts, &paint, size, opacity, clip);
            }
        }

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
                        let gts = sts.pre_concat(g.to_node().to_skia());
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

/// The usual color of an emoji, for the stand-in drawn in its place.
fn emoji_color(code: u32) -> crate::model::Color {
    let rgb = |r: u8, g: u8, b: u8| crate::model::Color {
        r: f32::from(r) / 255.0,
        g: f32::from(g) / 255.0,
        b: f32::from(b) / 255.0,
        a: 1.0,
    };
    match code {
        // Check marks, green circles and squares, plants.
        0x2705 | 0x2714 | 0x2733 | 0x1F7E2 | 0x1F7E9 | 0x1F331..=0x1F343 => rgb(0x43, 0xA0, 0x47),
        // Crosses, red marks, hearts, fire.
        0x274C | 0x274E | 0x2757 | 0x2763 | 0x2764 | 0x1F534 | 0x1F7E5 | 0x1F525 => {
            rgb(0xE5, 0x39, 0x35)
        }
        // Blue circles, squares, and water.
        0x1F535 | 0x1F7E6 | 0x1F4A7 | 0x1F30A => rgb(0x1E, 0x88, 0xE5),
        0x2B1B | 0x25FC | 0x25FE | 0x26AB => rgb(0x21, 0x21, 0x21),
        0x2B1C | 0x25FB | 0x25FD | 0x26AA => rgb(0xF5, 0xF5, 0xF5),
        // Tools, gears, and objects drawn in metal.
        0x1F6E0 | 0x2699 | 0x1F527 | 0x1F529 | 0x1F512 | 0x1F513 => rgb(0x90, 0xA4, 0xAE),
        // Faces, hands, stars, sparkles, party poppers: yellow.
        _ => rgb(0xFF, 0xC8, 0x3D),
    }
}

/// What stands in for an emoji glyph: a rounded square in its usual color
/// filling its box (and a check for check marks), in node coordinates.
fn emoji_stand_in(
    g: &crate::model::Glyph,
    codes: &[u32],
) -> Vec<(tiny_skia::Path, crate::model::Color)> {
    let mut out = Vec::new();
    let Some(&code) = codes.first() else {
        return out;
    };
    let em = g.font_size;
    // Figma's emoji box: one em wide, from 0.93 em above the baseline.
    let (x, y, side) = (g.x + 0.06 * em, g.y - 0.87 * em, 0.88 * em);
    let radius = crate::model::CornerRadii::uniform(0.22 * em);
    if let Some(square) = crate::geometry::rounded_rect(side, side, radius, 0.0)
        .and_then(|p| p.transform(tiny_skia::Transform::from_translate(x, y)))
    {
        out.push((square, emoji_color(code)));
    }
    if matches!(code, 0x2705 | 0x2714) {
        let mut pb = PathBuilder::new();
        pb.move_to(x + 0.22 * side, y + 0.52 * side);
        pb.line_to(x + 0.42 * side, y + 0.72 * side);
        pb.line_to(x + 0.78 * side, y + 0.3 * side);
        let stroke = tiny_skia::Stroke {
            width: 0.12 * side,
            line_cap: tiny_skia::LineCap::Round,
            line_join: tiny_skia::LineJoin::Round,
            ..Default::default()
        };
        if let Some(check) = pb.finish().and_then(|p| p.stroke(&stroke, 1.0)) {
            out.push((check, crate::model::Color::WHITE));
        }
    }
    out
}
