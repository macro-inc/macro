//! Model paints (colors and gradients) and strokes drawn with tiny-skia.

use super::canvas::Canvas;
use crate::geom::{Affine, PathData, Point};
use crate::model::{BlendMode, Gradient, LineCap, LineJoin, Paint, Stroke};
use tiny_skia::{FillRule, GradientStop, LinearGradient, RadialGradient, Shader, SpreadMode};

/// A tiny-skia paint for a model paint: `paint_to_path` maps the paint's
/// space (the object's) to the path's.
fn skia_paint(
    paint: &Paint,
    opacity: f32,
    blend: BlendMode,
    paint_to_path: &Affine,
) -> Option<tiny_skia::Paint<'static>> {
    let shader = match paint {
        Paint::Solid { color } => {
            let [r, g, b] = color.to_rgb();
            Shader::SolidColor(tiny_skia::Color::from_rgba(
                r.clamp(0.0, 1.0),
                g.clamp(0.0, 1.0),
                b.clamp(0.0, 1.0),
                opacity.clamp(0.0, 1.0),
            )?)
        }
        Paint::Gradient { gradient } => gradient_shader(gradient, opacity, paint_to_path)?,
    };
    Some(tiny_skia::Paint {
        shader,
        blend_mode: blend.to_skia(),
        anti_alias: true,
        force_hq_pipeline: false,
    })
}

/// A gradient's shader in path space.
fn gradient_shader(g: &Gradient, opacity: f32, paint_to_path: &Affine) -> Option<Shader<'static>> {
    let mut stops: Vec<(f32, [f32; 3], f32)> = g
        .stops
        .iter()
        .map(|s| (s.offset.clamp(0.0, 1.0), s.color.to_rgb(), s.opacity))
        .collect();
    if stops.is_empty() {
        return None;
    }
    let transform = g.transform.followed_by(paint_to_path).to_skia();
    if g.radial && g.start_radius > 0.0 && g.end_radius > g.start_radius {
        // tiny-skia's radial gradients start at a point: stops move out to
        // where the start circle is.
        let r0 = g.start_radius / g.end_radius;
        for s in &mut stops {
            s.0 = (r0 + f64::from(s.0) * (1.0 - r0)) as f32;
        }
        if g.extend[0] {
            let first = stops[0];
            stops.insert(0, (0.0, first.1, first.2));
        } else {
            let first = stops[0];
            stops.insert(0, (first.0, first.1, 0.0));
            stops.insert(0, (0.0, first.1, 0.0));
        }
    }
    if !g.radial && g.start.distance(g.end) < 1e-9 {
        // No length: the last color everywhere.
        let (_, [r, gr, b], a) = *stops.last()?;
        return Some(Shader::SolidColor(tiny_skia::Color::from_rgba(
            r.clamp(0.0, 1.0),
            gr.clamp(0.0, 1.0),
            b.clamp(0.0, 1.0),
            (a * opacity).clamp(0.0, 1.0),
        )?));
    }
    let stops: Vec<GradientStop> = stops
        .into_iter()
        .filter_map(|(t, [r, g, b], a)| {
            Some(GradientStop::new(
                t,
                tiny_skia::Color::from_rgba(
                    r.clamp(0.0, 1.0),
                    g.clamp(0.0, 1.0),
                    b.clamp(0.0, 1.0),
                    (a * opacity).clamp(0.0, 1.0),
                )?,
            ))
        })
        .collect();
    let p = |pt: Point| tiny_skia::Point::from_xy(pt.x as f32, pt.y as f32);
    if g.radial {
        RadialGradient::new(
            p(g.start),
            p(g.end),
            g.end_radius.max(1e-6) as f32,
            stops,
            SpreadMode::Pad,
            transform,
        )
    } else {
        LinearGradient::new(p(g.start), p(g.end), stops, SpreadMode::Pad, transform)
    }
}

/// The area a gradient paints when it does not extend past its ends, in
/// the gradient's space (`None` when it extends both ways).
fn gradient_extent(g: &Gradient) -> Option<PathData> {
    if g.extend[0] && g.extend[1] {
        return None;
    }
    if g.radial {
        if g.extend[1] {
            return None;
        }
        // Inside the end circle.
        let r = g.end_radius;
        let k = 0.552_284_75 * r;
        let (cx, cy) = (g.end.x, g.end.y);
        use crate::geom::Seg;
        let segs = vec![
            Seg::Move {
                p: Point::new(cx + r, cy),
            },
            Seg::Cubic {
                c1: Point::new(cx + r, cy + k),
                c2: Point::new(cx + k, cy + r),
                p: Point::new(cx, cy + r),
            },
            Seg::Cubic {
                c1: Point::new(cx - k, cy + r),
                c2: Point::new(cx - r, cy + k),
                p: Point::new(cx - r, cy),
            },
            Seg::Cubic {
                c1: Point::new(cx - r, cy - k),
                c2: Point::new(cx - k, cy - r),
                p: Point::new(cx, cy - r),
            },
            Seg::Cubic {
                c1: Point::new(cx + k, cy - r),
                c2: Point::new(cx + r, cy - k),
                p: Point::new(cx + r, cy),
            },
            Seg::Close,
        ];
        return Some(PathData { segs });
    }
    // The band between the lines through the ends, across the axis.
    let (s, e) = (g.start, g.end);
    let len = s.distance(e);
    if len < 1e-9 {
        return None;
    }
    let (dx, dy) = ((e.x - s.x) / len, (e.y - s.y) / len);
    let (nx, ny) = (-dy * 1e6, dx * 1e6);
    let far = 1e6;
    let a = if g.extend[0] {
        Point::new(s.x - dx * far, s.y - dy * far)
    } else {
        s
    };
    let b = if g.extend[1] {
        Point::new(e.x + dx * far, e.y + dy * far)
    } else {
        e
    };
    use crate::geom::Seg;
    Some(PathData {
        segs: vec![
            Seg::Move {
                p: Point::new(a.x + nx, a.y + ny),
            },
            Seg::Line {
                p: Point::new(b.x + nx, b.y + ny),
            },
            Seg::Line {
                p: Point::new(b.x - nx, b.y - ny),
            },
            Seg::Line {
                p: Point::new(a.x - nx, a.y - ny),
            },
            Seg::Close,
        ],
    })
}

/// Fills a path (in path space; `m` maps it to pixels) with a paint
/// defined in the object space `object_to_device` maps to pixels.
#[expect(
    clippy::too_many_arguments,
    reason = "a fill's path, paint, and spaces"
)]
pub fn fill(
    canvas: &mut Canvas,
    path: &tiny_skia::Path,
    paint: &Paint,
    rule: FillRule,
    opacity: f32,
    blend: BlendMode,
    m: &Affine,
    object_to_device: &Affine,
) {
    let Some(inv) = m.invert() else { return };
    let paint_to_path = object_to_device.followed_by(&inv);
    let Some(p) = skia_paint(paint, opacity, blend, &paint_to_path) else {
        return;
    };
    let extent = match paint {
        Paint::Gradient { gradient } => gradient_extent(gradient).and_then(|e| {
            e.transform(&gradient.transform.followed_by(object_to_device))
                .to_skia()
        }),
        Paint::Solid { .. } => None,
    };
    if let Some(e) = &extent {
        canvas.push_clip(Some(e), FillRule::Winding);
    }
    canvas.fill_path_transformed(path, &p, rule, m.to_skia());
    if extent.is_some() {
        canvas.pop_clip();
    }
}

/// Strokes a path (in path space; `m` maps it to pixels, the stroke's
/// width included).
pub fn stroke(
    canvas: &mut Canvas,
    path: &tiny_skia::Path,
    stroke: &Stroke,
    opacity: f32,
    blend: BlendMode,
    m: &Affine,
) {
    let Some(p) = skia_paint(&stroke.paint, opacity, blend, &Affine::IDENTITY) else {
        return;
    };
    let s = skia_stroke(stroke, m);
    canvas.stroke_path(path, &p, &s, m.to_skia());
}

/// A tiny-skia stroke; a width of zero is the thinnest line shown (one
/// pixel).
pub fn skia_stroke(stroke: &Stroke, m: &Affine) -> tiny_skia::Stroke {
    let scale = m.scale_factor().max(1e-9);
    let width = if stroke.width * scale < 1.0 {
        1.0 / scale
    } else {
        stroke.width
    };
    tiny_skia::Stroke {
        width: width as f32,
        miter_limit: stroke.miter_limit.max(1.0) as f32,
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
        dash: dash(&stroke.dash, stroke.dash_offset),
    }
}

/// A dash pattern (`None` when solid or degenerate).
pub fn dash(lengths: &[f64], offset: f64) -> Option<tiny_skia::StrokeDash> {
    if lengths.is_empty() || lengths.iter().all(|&l| l <= 0.0) {
        return None;
    }
    let mut v: Vec<f32> = lengths.iter().map(|&l| l.max(0.0) as f32).collect();
    if v.len() % 2 == 1 {
        let copy = v.clone();
        v.extend(copy);
    }
    tiny_skia::StrokeDash::new(v, offset as f32)
}
