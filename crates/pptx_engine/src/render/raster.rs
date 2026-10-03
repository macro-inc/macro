//! Rasterizes a display list with tiny-skia.

use super::scene::{Effect, Group, LineCap, LineJoin, Node, Paint, Raster, Stroke};
use crate::model::color::Rgba;
use crate::path::{Affine, Path, PathEl, Point, Rect};
use tiny_skia as sk;

/// Renders `nodes` (points) into a `width`×`height` image at `scale` pixels per point.
pub fn rasterize(nodes: &[Node], width: u32, height: u32, scale: f32) -> Raster {
    let Some(mut pm) = sk::Pixmap::new(width.max(1), height.max(1)) else {
        return Raster::new(width, height);
    };
    let r = Rasterizer { scale };
    r.draw_nodes(&mut pm, nodes, (0, 0));
    Raster { width: pm.width(), height: pm.height(), pixels: pm.take() }
}

/// Converts an engine transform to tiny-skia's.
pub fn to_sk_transform(a: &Affine) -> sk::Transform {
    sk::Transform::from_row(a.a as f32, a.b as f32, a.c as f32, a.d as f32, a.e as f32, a.f as f32)
}

/// Largest coordinate (points) passed to the rasterizer; far beyond any slide.
const COORD_LIMIT: f32 = 200_000.0;

fn el_points(el: &PathEl) -> Vec<Point> {
    match *el {
        PathEl::MoveTo(a) | PathEl::LineTo(a) => vec![a],
        PathEl::QuadTo(c, a) => vec![c, a],
        PathEl::CubicTo(c1, c2, a) => vec![c1, c2, a],
        PathEl::Close => Vec::new(),
    }
}

fn el_points_mut(el: &mut PathEl) -> Vec<&mut Point> {
    match el {
        PathEl::MoveTo(a) | PathEl::LineTo(a) => vec![a],
        PathEl::QuadTo(c, a) => vec![c, a],
        PathEl::CubicTo(c1, c2, a) => vec![c1, c2, a],
        PathEl::Close => Vec::new(),
    }
}

/// Converts an engine path to tiny-skia's (`None` if empty or degenerate).
pub fn to_sk_path(p: &Path) -> Option<sk::Path> {
    // Hostile or degenerate geometry must not reach the rasterizer: tiny-skia
    // overflows its fixed-point maths on coordinates in the millions of pixels.
    if p.els.iter().any(|el| el_points(el).iter().any(|q| !q.x.is_finite() || !q.y.is_finite())) {
        return None;
    }
    if p.els.iter().any(|el| el_points(el).iter().any(|q| q.x.abs() > COORD_LIMIT || q.y.abs() > COORD_LIMIT)) {
        let mut clamped = p.clone();
        for el in &mut clamped.els {
            for q in el_points_mut(el) {
                q.x = q.x.clamp(-COORD_LIMIT, COORD_LIMIT);
                q.y = q.y.clamp(-COORD_LIMIT, COORD_LIMIT);
            }
        }
        return to_sk_path(&clamped);
    }
    let mut b = sk::PathBuilder::with_capacity(p.els.len(), p.els.len() * 2);
    let mut open = false;
    for el in &p.els {
        match *el {
            PathEl::MoveTo(a) => {
                b.move_to(a.x, a.y);
                open = true;
            }
            PathEl::LineTo(a) => {
                if !open {
                    b.move_to(a.x, a.y);
                    open = true;
                } else {
                    b.line_to(a.x, a.y);
                }
            }
            PathEl::QuadTo(c, a) => {
                if open {
                    b.quad_to(c.x, c.y, a.x, a.y);
                }
            }
            PathEl::CubicTo(c1, c2, a) => {
                if open {
                    b.cubic_to(c1.x, c1.y, c2.x, c2.y, a.x, a.y);
                }
            }
            PathEl::Close => b.close(),
        }
    }
    b.finish()
}

fn color(c: Rgba) -> sk::Color {
    sk::Color::from_rgba(c.r.clamp(0.0, 1.0), c.g.clamp(0.0, 1.0), c.b.clamp(0.0, 1.0), c.a.clamp(0.0, 1.0))
        .unwrap_or(sk::Color::BLACK)
}

fn stops(s: &[(f32, Rgba)]) -> Vec<sk::GradientStop> {
    s.iter().map(|(p, c)| sk::GradientStop::new(p.clamp(0.0, 1.0), color(*c))).collect()
}

struct Rasterizer {
    scale: f32,
}

/// A rectangle in device pixels.
#[derive(Clone, Copy, Debug)]
struct PxRect {
    x0: i32,
    y0: i32,
    x1: i32,
    y1: i32,
}

impl Rasterizer {
    /// Scene → device transform for a layer whose origin is at `origin` (device px).
    fn base(&self, origin: (i32, i32)) -> sk::Transform {
        sk::Transform::from_row(self.scale, 0.0, 0.0, self.scale, -origin.0 as f32, -origin.1 as f32)
    }

    fn paint<'a>(&self, p: &'a Paint) -> Option<sk::Paint<'a>> {
        let mut paint = sk::Paint { anti_alias: true, ..Default::default() };
        match p {
            Paint::Solid(c) => {
                if c.a <= 0.0 {
                    return None;
                }
                paint.set_color(color(*c));
            }
            Paint::Linear { start, end, stops: s, transform } => {
                let degenerate = (start.x - end.x).abs() < 1e-6 && (start.y - end.y).abs() < 1e-6;
                if s.len() == 1 || degenerate {
                    paint.set_color(color(s.last()?.1));
                } else {
                    paint.shader = sk::LinearGradient::new(
                        sk::Point::from_xy(start.x, start.y),
                        sk::Point::from_xy(end.x, end.y),
                        stops(s),
                        sk::SpreadMode::Pad,
                        to_sk_transform(transform),
                    )?;
                }
            }
            Paint::Radial { stops: s, transform } => {
                if s.len() == 1 {
                    paint.set_color(color(s[0].1));
                } else {
                    let c = sk::Point::from_xy(0.0, 0.0);
                    paint.shader = sk::RadialGradient::new(c, c, 1.0, stops(s), sk::SpreadMode::Pad, to_sk_transform(transform))?;
                }
            }
            Paint::Image { image, transform, repeat, opacity } => {
                // Borrowed, not copied: pictures can be tens of megabytes.
                let pm = sk::PixmapRef::from_bytes(&image.pixels, image.width, image.height)?;
                // Downscaled images look better with bicubic filtering.
                let scale = transform.mean_scale() as f32 * self.scale;
                let quality = if scale < 0.9 { sk::FilterQuality::Bicubic } else { sk::FilterQuality::Bilinear };
                paint.shader = sk::Pattern::new(
                    pm,
                    if *repeat { sk::SpreadMode::Repeat } else { sk::SpreadMode::Pad },
                    quality,
                    *opacity,
                    to_sk_transform(transform),
                );
            }
        }
        Some(paint)
    }

    fn draw_nodes(&self, pm: &mut sk::Pixmap, nodes: &[Node], origin: (i32, i32)) {
        for n in nodes {
            self.draw_node(pm, n, origin);
        }
    }

    fn draw_node(&self, pm: &mut sk::Pixmap, node: &Node, origin: (i32, i32)) {
        let base = self.base(origin);
        match node {
            Node::Fill { path, paint, even_odd } => {
                let Some(p) = to_sk_path(path) else { return };
                let Some(paint) = self.paint(paint) else { return };
                let rule = if *even_odd { sk::FillRule::EvenOdd } else { sk::FillRule::Winding };
                pm.fill_path(&p, &paint, rule, base, None);
            }
            Node::Stroke { path, paint, stroke } => {
                let Some(p) = to_sk_path(path) else { return };
                let Some(paint) = self.paint(paint) else { return };
                let s = sk_stroke(stroke);
                pm.stroke_path(&p, &paint, &s, base, None);
            }
            Node::Group(g) => self.draw_group(pm, g, origin),
        }
    }

    fn draw_group(&self, target: &mut sk::Pixmap, g: &Group, origin: (i32, i32)) {
        let needs_layer = g.opacity < 0.999 || g.clip.is_some() || !g.effects.is_empty();
        if !needs_layer {
            self.draw_nodes(target, &g.children, origin);
            return;
        }
        if g.opacity <= 0.0 {
            return;
        }
        // Allocate a layer only as large as the content plus effect margins.
        let Some(content) = nodes_bounds(&g.children) else { return };
        let mut margin = 0.0f32;
        for e in &g.effects {
            margin = margin.max(match e {
                Effect::OuterShadow { blur, offset, transform, .. } => {
                    let skew = (transform.c.abs() + transform.b.abs()) as f32 * content.w.max(content.h);
                    blur * 2.0 + offset.x.abs().max(offset.y.abs()) + skew + content.w.max(content.h) * ((transform.a.abs().max(transform.d.abs()) as f32) - 1.0).max(0.0)
                }
                Effect::Glow { radius, .. } => radius * 2.0,
                Effect::Reflection { dist, height, .. } => dist + height,
                _ => 0.0,
            });
        }
        let r = content.outset(margin + 2.0);
        let px = PxRect {
            x0: (r.x * self.scale).floor() as i32,
            y0: (r.y * self.scale).floor() as i32,
            x1: (r.right() * self.scale).ceil() as i32,
            y1: (r.bottom() * self.scale).ceil() as i32,
        };
        // Intersect with the target.
        let tx0 = origin.0;
        let ty0 = origin.1;
        let tx1 = origin.0 + target.width() as i32;
        let ty1 = origin.1 + target.height() as i32;
        let lx0 = px.x0.max(tx0);
        let ly0 = px.y0.max(ty0);
        let lx1 = px.x1.min(tx1);
        let ly1 = px.y1.min(ty1);
        if lx1 <= lx0 || ly1 <= ly0 {
            return;
        }
        let (lw, lh) = ((lx1 - lx0) as u32, (ly1 - ly0) as u32);
        let Some(mut layer) = sk::Pixmap::new(lw, lh) else { return };
        let lorigin = (lx0, ly0);
        self.draw_nodes(&mut layer, &g.children, lorigin);

        for e in &g.effects {
            layer = self.apply_effect(layer, e, lorigin);
        }
        if let Some(clip) = &g.clip {
            if let (Some(p), Some(mut mask)) = (to_sk_path(clip), sk::Mask::new(lw, lh)) {
                mask.fill_path(&p, sk::FillRule::Winding, true, self.base(lorigin));
                layer.apply_mask(&mask);
            }
        }
        let paint = sk::PixmapPaint { opacity: g.opacity.clamp(0.0, 1.0), ..Default::default() };
        target.draw_pixmap(lx0 - origin.0, ly0 - origin.1, layer.as_ref(), &paint, sk::Transform::identity(), None);
    }

    fn apply_effect(&self, layer: sk::Pixmap, e: &Effect, lorigin: (i32, i32)) -> sk::Pixmap {
        let (w, h) = (layer.width(), layer.height());
        match e {
            Effect::OuterShadow { color: c, blur, offset, transform } => {
                let Some(mut shadow) = sk::Pixmap::new(w, h) else { return layer };
                // Shadow geometry: the layer, transformed about the anchor and offset.
                let t = transform;
                let shift = sk::Transform::from_translate(lorigin.0 as f32, lorigin.1 as f32);
                let scene_t = sk::Transform::from_row(t.a as f32, t.b as f32, t.c as f32, t.d as f32, t.e as f32 * self.scale, t.f as f32 * self.scale);
                let full = shift
                    .post_concat(scene_t)
                    .post_concat(sk::Transform::from_translate(offset.x * self.scale - lorigin.0 as f32, offset.y * self.scale - lorigin.1 as f32));
                shadow.draw_pixmap(0, 0, layer.as_ref(), &sk::PixmapPaint::default(), full, None);
                let mut alpha: Vec<u8> = shadow.data().chunks_exact(4).map(|p| p[3]).collect();
                blur_alpha(&mut alpha, w as usize, h as usize, blur * self.scale);
                let mut out = colorize(&alpha, w, h, *c);
                out.draw_pixmap(0, 0, layer.as_ref(), &sk::PixmapPaint::default(), sk::Transform::identity(), None);
                out
            }
            Effect::Glow { color: c, radius } => {
                let mut alpha: Vec<u8> = layer.data().chunks_exact(4).map(|p| p[3]).collect();
                let r = radius * self.scale;
                dilate_alpha(&mut alpha, w as usize, h as usize, r * 0.6);
                blur_alpha(&mut alpha, w as usize, h as usize, r * 0.5);
                let mut out = colorize(&alpha, w, h, *c);
                out.draw_pixmap(0, 0, layer.as_ref(), &sk::PixmapPaint::default(), sk::Transform::identity(), None);
                out
            }
            Effect::SoftEdge { radius } => {
                let mut layer = layer;
                let mut alpha: Vec<u8> = layer.data().chunks_exact(4).map(|p| p[3]).collect();
                let r = radius * self.scale;
                erode_alpha(&mut alpha, w as usize, h as usize, r * 0.5);
                blur_alpha(&mut alpha, w as usize, h as usize, r * 0.5);
                for (px, a) in layer.data_mut().chunks_exact_mut(4).zip(alpha) {
                    let k = u32::from(a);
                    for v in px.iter_mut() {
                        *v = ((u32::from(*v) * k + 127) / 255) as u8;
                    }
                }
                layer
            }
            Effect::InnerShadow { color: c, blur, offset } => {
                let mut layer = layer;
                let src: Vec<u8> = layer.data().chunks_exact(4).map(|p| p[3]).collect();
                let (dx, dy) = ((offset.x * self.scale).round() as i32, (offset.y * self.scale).round() as i32);
                let (wi, hi) = (w as i32, h as i32);
                let mut inv = vec![0u8; src.len()];
                for y in 0..hi {
                    for x in 0..wi {
                        let (sx, sy) = (x - dx, y - dy);
                        let a = if sx >= 0 && sy >= 0 && sx < wi && sy < hi { src[(sy * wi + sx) as usize] } else { 0 };
                        inv[(y * wi + x) as usize] = 255 - a;
                    }
                }
                blur_alpha(&mut inv, w as usize, h as usize, blur * self.scale);
                for (i, a) in inv.iter_mut().enumerate() {
                    *a = ((u32::from(*a) * u32::from(src[i]) + 127) / 255) as u8;
                }
                let shade = colorize(&inv, w, h, *c);
                layer.draw_pixmap(0, 0, shade.as_ref(), &sk::PixmapPaint::default(), sk::Transform::identity(), None);
                layer
            }
            Effect::Reflection { axis, dist, start_alpha, end_alpha, end_pos, height, blur: _ } => {
                let Some(mut out) = sk::Pixmap::new(w, h) else { return layer };
                // Mirror about the axis, shifted down by `dist`.
                let ay = (axis * self.scale) - lorigin.1 as f32;
                let mirror = sk::Transform::from_row(1.0, 0.0, 0.0, -1.0, 0.0, 2.0 * ay + dist * self.scale);
                let mut refl = sk::Pixmap::new(w, h).unwrap_or_else(|| layer.clone());
                refl.draw_pixmap(0, 0, layer.as_ref(), &sk::PixmapPaint::default(), mirror, None);
                // Fade.
                let fade_len = (height * end_pos.max(0.01) * self.scale).max(1.0);
                let start = ay + dist * self.scale;
                for y in 0..h {
                    let t = ((y as f32 - start) / fade_len).clamp(0.0, 1.0);
                    let a = if (y as f32) < start { 0.0 } else { start_alpha + (end_alpha - start_alpha) * t };
                    let k = (a.clamp(0.0, 1.0) * 255.0) as u32;
                    let row = &mut refl.data_mut()[(y * w * 4) as usize..((y + 1) * w * 4) as usize];
                    for v in row.iter_mut() {
                        *v = ((u32::from(*v) * k + 127) / 255) as u8;
                    }
                }
                out.draw_pixmap(0, 0, refl.as_ref(), &sk::PixmapPaint::default(), sk::Transform::identity(), None);
                out.draw_pixmap(0, 0, layer.as_ref(), &sk::PixmapPaint::default(), sk::Transform::identity(), None);
                out
            }
        }
    }
}

fn sk_stroke(s: &Stroke) -> sk::Stroke {
    sk::Stroke {
        width: s.width.max(0.0),
        miter_limit: s.miter_limit.max(1.0),
        line_cap: match s.cap {
            LineCap::Butt => sk::LineCap::Butt,
            LineCap::Round => sk::LineCap::Round,
            LineCap::Square => sk::LineCap::Square,
        },
        line_join: match s.join {
            LineJoin::Miter => sk::LineJoin::Miter,
            LineJoin::Round => sk::LineJoin::Round,
            LineJoin::Bevel => sk::LineJoin::Bevel,
        },
        dash: s.dash.as_ref().and_then(|d| {
            let mut d: Vec<f32> = d.iter().map(|v| v.max(0.01)).collect();
            if d.len() % 2 == 1 {
                let copy = d.clone();
                d.extend(copy);
            }
            sk::StrokeDash::new(d, 0.0)
        }),
    }
}

/// Bounds of nodes in scene coordinates (including stroke widths).
pub fn nodes_bounds(nodes: &[Node]) -> Option<Rect> {
    let mut acc: Option<Rect> = None;
    let mut add = |r: Rect| acc = Some(acc.map_or(r, |a| a.union(&r)));
    for n in nodes {
        match n {
            Node::Fill { path, .. } => {
                if let Some(b) = path.bounds() {
                    add(b);
                }
            }
            Node::Stroke { path, stroke, .. } => {
                if let Some(b) = path.bounds() {
                    add(b.outset(stroke.width * 2.0 + 1.0));
                }
            }
            Node::Group(g) => {
                if let Some(b) = nodes_bounds(&g.children) {
                    add(b);
                }
            }
        }
    }
    acc
}

fn colorize(alpha: &[u8], w: u32, h: u32, c: Rgba) -> sk::Pixmap {
    let mut pm = sk::Pixmap::new(w.max(1), h.max(1)).expect("non-zero layer");
    let (r, g, b, a) = (c.r.clamp(0.0, 1.0), c.g.clamp(0.0, 1.0), c.b.clamp(0.0, 1.0), c.a.clamp(0.0, 1.0));
    for (px, &m) in pm.data_mut().chunks_exact_mut(4).zip(alpha) {
        let k = f32::from(m) / 255.0 * a;
        px[0] = (r * k * 255.0).round() as u8;
        px[1] = (g * k * 255.0).round() as u8;
        px[2] = (b * k * 255.0).round() as u8;
        px[3] = (k * 255.0).round() as u8;
    }
    pm
}

/// Approximates a Gaussian blur of standard deviation `radius / 2` with three box blurs.
pub fn blur_alpha(a: &mut [u8], w: usize, h: usize, radius: f32) {
    if radius < 0.5 || w == 0 || h == 0 {
        return;
    }
    let sigma = radius / 2.0;
    let b = (((12.0 * sigma * sigma / 3.0) + 1.0).sqrt().floor() as usize).max(1);
    let r = b / 2;
    let mut buf: Vec<f32> = a.iter().map(|&v| f32::from(v)).collect();
    let mut tmp = vec![0f32; buf.len()];
    for _ in 0..3 {
        box_pass(&buf, &mut tmp, w, h, r, true);
        box_pass(&tmp, &mut buf, w, h, r, false);
    }
    for (dst, v) in a.iter_mut().zip(buf) {
        *dst = v.round().clamp(0.0, 255.0) as u8;
    }
}

fn box_pass(src: &[f32], dst: &mut [f32], w: usize, h: usize, r: usize, horizontal: bool) {
    let (outer, inner) = if horizontal { (h, w) } else { (w, h) };
    let idx = |o: usize, i: usize| if horizontal { o * w + i } else { i * w + o };
    let win = (2 * r + 1) as f32;
    for o in 0..outer {
        let mut sum = 0.0f32;
        // Window over [i - r, i + r] with zero padding.
        for i in 0..=r.min(inner - 1) {
            sum += src[idx(o, i)];
        }
        for i in 0..inner {
            dst[idx(o, i)] = sum / win;
            let add = i + r + 1;
            if add < inner {
                sum += src[idx(o, add)];
            }
            if i >= r {
                sum -= src[idx(o, i - r)];
            }
        }
    }
}

fn morph(a: &mut [u8], w: usize, h: usize, radius: f32, dilate: bool) {
    let r = radius.round() as i32;
    if r <= 0 {
        return;
    }
    let src = a.to_vec();
    let mut tmp = vec![0u8; src.len()];
    let pick = |x: u8, y: u8| if dilate { x.max(y) } else { x.min(y) };
    for y in 0..h as i32 {
        for x in 0..w as i32 {
            let mut v = if dilate { 0 } else { 255 };
            for k in -r..=r {
                let xx = x + k;
                let s = if xx < 0 || xx >= w as i32 { 0 } else { src[(y * w as i32 + xx) as usize] };
                v = pick(v, s);
            }
            tmp[(y * w as i32 + x) as usize] = v;
        }
    }
    for y in 0..h as i32 {
        for x in 0..w as i32 {
            let mut v = if dilate { 0 } else { 255 };
            for k in -r..=r {
                let yy = y + k;
                let s = if yy < 0 || yy >= h as i32 { 0 } else { tmp[(yy * w as i32 + x) as usize] };
                v = pick(v, s);
            }
            a[(y * w as i32 + x) as usize] = v;
        }
    }
}

fn dilate_alpha(a: &mut [u8], w: usize, h: usize, radius: f32) {
    morph(a, w, h, radius, true);
}

fn erode_alpha(a: &mut [u8], w: usize, h: usize, radius: f32) {
    morph(a, w, h, radius, false);
}

#[cfg(test)]
mod test;
