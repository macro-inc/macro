//! Filling a shape with a Figma paint.
//!
//! Gradient transforms map the node's unit square to gradient space, where a
//! linear gradient runs from (0, 0.5) to (1, 0.5), radial and diamond
//! gradients are centered on (0.5, 0.5) with radius 0.5, and an angular
//! gradient sweeps clockwise from the +x axis around (0.5, 0.5).

use super::{Painter, Shape, Surface, multiply_masks};
use crate::model::{
    Affine, ColorStop, GradientKind, ImagePaint, ImageScaleMode, Paint, PaintKind, Rect, Vec2,
};
use tiny_skia::{
    FilterQuality, GradientStop, LinearGradient, Mask, Pattern, Point, RadialGradient, Shader,
    SpreadMode,
};

impl Painter<'_> {
    /// Fills `shape` (node coordinates, `ts` node → surface) with `paint`.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn fill_shape(
        &mut self,
        surface: &mut Surface,
        shape: &Shape,
        ts: &Affine,
        paint: &Paint,
        size: Vec2,
        opacity: f32,
        clip: Option<&Mask>,
    ) {
        let alpha = paint.opacity * opacity;
        if alpha <= 0.0 {
            return;
        }
        let blend = paint.blend_mode.to_skia();
        match &paint.kind {
            PaintKind::Solid(c) => {
                let mut p = super::solid_paint(c.with_alpha(c.a * alpha));
                p.blend_mode = blend;
                surface
                    .pixmap
                    .fill_path(shape.path(), &p, shape.rule(), ts.to_skia(), clip);
            }
            PaintKind::Gradient {
                kind,
                stops,
                transform,
            } => match kind {
                GradientKind::Linear | GradientKind::Radial => {
                    let Some(shader) = gradient_shader(*kind, stops, transform, size, alpha) else {
                        return;
                    };
                    let p = tiny_skia::Paint {
                        shader,
                        blend_mode: blend,
                        anti_alias: true,
                        force_hq_pipeline: false,
                    };
                    surface
                        .pixmap
                        .fill_path(shape.path(), &p, shape.rule(), ts.to_skia(), clip);
                }
                GradientKind::Angular | GradientKind::Diamond => {
                    fill_rasterized_gradient(
                        surface, shape, ts, *kind, stops, transform, size, alpha, blend, clip,
                    );
                }
            },
            PaintKind::Image(image) => {
                self.fill_image(surface, shape, ts, image, size, alpha, blend, clip);
            }
            PaintKind::Unsupported(_) => {}
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn fill_image(
        &mut self,
        surface: &mut Surface,
        shape: &Shape,
        ts: &Affine,
        image: &ImagePaint,
        size: Vec2,
        alpha: f32,
        blend: tiny_skia::BlendMode,
        clip: Option<&Mask>,
    ) {
        let Some(hash) = image.hash.as_deref() else {
            return;
        };
        let encoded = self.doc.images.get(hash).map(Vec::as_slice);
        let Some(decoded) = self.images.get(hash, encoded) else {
            // Missing or undecodable: Figma shows a neutral placeholder.
            let mut p = super::solid_paint(crate::model::Color {
                r: 0.9,
                g: 0.9,
                b: 0.9,
                a: alpha,
            });
            p.blend_mode = blend;
            surface
                .pixmap
                .fill_path(shape.path(), &p, shape.rule(), ts.to_skia(), clip);
            return;
        };
        let (iw, ih) = (f64::from(decoded.width), f64::from(decoded.height));
        let Some(image_to_node) = image_transform(image, iw, ih, size) else {
            return;
        };
        let device_per_pixel = ts.mul(&image_to_node).scale_factor();
        let Some((pixmap, factor)) = decoded.level_for(device_per_pixel) else {
            return;
        };
        let level_to_node = image_to_node.mul(&Affine::scale(1.0 / factor, 1.0 / factor));
        let tile = image.scale_mode == ImageScaleMode::Tile;
        let quality = if device_per_pixel > 0.999 && device_per_pixel < 1.001 {
            FilterQuality::Nearest
        } else {
            FilterQuality::Bilinear
        };
        let shader = Pattern::new(
            pixmap.as_ref().as_ref(),
            if tile {
                SpreadMode::Repeat
            } else {
                SpreadMode::Pad
            },
            quality,
            alpha,
            level_to_node.to_skia(),
        );
        let p = tiny_skia::Paint {
            shader,
            blend_mode: blend,
            anti_alias: true,
            force_hq_pipeline: false,
        };
        // Fit and crop leave the node transparent outside the image.
        let mut owned = None;
        if matches!(
            image.scale_mode,
            ImageScaleMode::Fit | ImageScaleMode::Stretch
        ) {
            let rect = image_to_node.map_rect(&Rect::new(0.0, 0.0, iw, ih));
            let node = Rect::new(0.0, 0.0, size.x, size.y);
            if !(rect.x <= node.x + 0.01
                && rect.y <= node.y + 0.01
                && rect.right() >= node.right() - 0.01
                && rect.bottom() >= node.bottom() - 0.01)
            {
                let Some(mut mask) = Mask::new(surface.pixmap.width(), surface.pixmap.height())
                else {
                    return;
                };
                let image_rect = crate::geometry::rect_path(0.0, 0.0, iw as f32, ih as f32);
                if let Some(r) = image_rect {
                    mask.fill_path(
                        &r,
                        tiny_skia::FillRule::Winding,
                        true,
                        ts.mul(&image_to_node).to_skia(),
                    );
                }
                if let Some(c) = clip {
                    multiply_masks(&mut mask, c);
                }
                owned = Some(mask);
            }
        }
        surface.pixmap.fill_path(
            shape.path(),
            &p,
            shape.rule(),
            ts.to_skia(),
            owned.as_ref().or(clip),
        );
    }
}

/// Image pixels → node coordinates for the paint's scale mode.
pub(crate) fn image_transform(image: &ImagePaint, iw: f64, ih: f64, size: Vec2) -> Option<Affine> {
    let (w, h) = (size.x, size.y);
    let quarter = ((f64::from(image.rotation) / 90.0).round() as i64).rem_euclid(4);
    let rotate = Affine::rotate(quarter as f64 * std::f64::consts::FRAC_PI_2);
    match image.scale_mode {
        ImageScaleMode::Fill | ImageScaleMode::Fit => {
            let (rw, rh) = if quarter % 2 == 1 { (ih, iw) } else { (iw, ih) };
            if rw <= 0.0 || rh <= 0.0 {
                return None;
            }
            let s = if image.scale_mode == ImageScaleMode::Fill {
                (w / rw).max(h / rh)
            } else {
                (w / rw).min(h / rh)
            };
            Some(
                Affine::translate(w / 2.0, h / 2.0)
                    .mul(&Affine::scale(s, s))
                    .mul(&rotate)
                    .mul(&Affine::translate(-iw / 2.0, -ih / 2.0)),
            )
        }
        ImageScaleMode::Tile => {
            let s = if image.scale > 0.0 {
                f64::from(image.scale)
            } else {
                1.0
            };
            Some(Affine::scale(s, s).mul(&rotate))
        }
        ImageScaleMode::Stretch => {
            let inv = image.transform.invert()?;
            Some(
                Affine::scale(w.max(1e-6), h.max(1e-6))
                    .mul(&inv)
                    .mul(&Affine::scale(1.0 / iw, 1.0 / ih)),
            )
        }
    }
}

fn skia_stops(stops: &[ColorStop], alpha: f32) -> Vec<GradientStop> {
    let mut sorted: Vec<&ColorStop> = stops.iter().collect();
    sorted.sort_by(|a, b| a.position.total_cmp(&b.position));
    sorted
        .into_iter()
        .map(|s| {
            GradientStop::new(
                s.position.clamp(0.0, 1.0),
                s.color.with_alpha(s.color.a * alpha).to_skia(),
            )
        })
        .collect()
}

/// Gradient space → node coordinates.
fn gradient_to_node(transform: &Affine, size: Vec2) -> Option<Affine> {
    let inv = transform.invert()?;
    Some(Affine::scale(size.x.max(1e-6), size.y.max(1e-6)).mul(&inv))
}

pub(crate) fn gradient_shader(
    kind: GradientKind,
    stops: &[ColorStop],
    transform: &Affine,
    size: Vec2,
    alpha: f32,
) -> Option<Shader<'static>> {
    let stops = skia_stops(stops, alpha);
    if stops.is_empty() {
        return None;
    }
    let ts = gradient_to_node(transform, size)?.to_skia();
    match kind {
        GradientKind::Linear => LinearGradient::new(
            Point::from_xy(0.0, 0.5),
            Point::from_xy(1.0, 0.5),
            stops,
            SpreadMode::Pad,
            ts,
        ),
        _ => RadialGradient::new(
            Point::from_xy(0.5, 0.5),
            Point::from_xy(0.5, 0.5),
            0.5,
            stops,
            SpreadMode::Pad,
            ts,
        ),
    }
}

/// Premultiplied RGBA8 of the gradient at `t`.
fn sample(stops: &[ColorStop], t: f32, alpha: f32) -> [u8; 4] {
    let first = &stops[0];
    let last = &stops[stops.len() - 1];
    let c = if t <= first.position {
        first.color
    } else if t >= last.position {
        last.color
    } else {
        let mut c = last.color;
        for pair in stops.windows(2) {
            let (a, b) = (&pair[0], &pair[1]);
            if t >= a.position && t <= b.position {
                let span = (b.position - a.position).max(1e-6);
                let u = (t - a.position) / span;
                c = crate::model::Color {
                    r: a.color.r + (b.color.r - a.color.r) * u,
                    g: a.color.g + (b.color.g - a.color.g) * u,
                    b: a.color.b + (b.color.b - a.color.b) * u,
                    a: a.color.a + (b.color.a - a.color.a) * u,
                };
                break;
            }
        }
        c
    };
    let a = (c.a * alpha).clamp(0.0, 1.0);
    [
        (c.r.clamp(0.0, 1.0) * a * 255.0 + 0.5) as u8,
        (c.g.clamp(0.0, 1.0) * a * 255.0 + 0.5) as u8,
        (c.b.clamp(0.0, 1.0) * a * 255.0 + 0.5) as u8,
        (a * 255.0 + 0.5) as u8,
    ]
}

/// Angular and diamond gradients, which tiny-skia lacks: evaluated per pixel
/// over the shape's bounds, then used as a pattern.
#[allow(clippy::too_many_arguments)]
fn fill_rasterized_gradient(
    surface: &mut Surface,
    shape: &Shape,
    ts: &Affine,
    kind: GradientKind,
    stops: &[ColorStop],
    transform: &Affine,
    size: Vec2,
    alpha: f32,
    blend: tiny_skia::BlendMode,
    clip: Option<&Mask>,
) {
    if stops.is_empty() {
        return;
    }
    let mut sorted = stops.to_vec();
    sorted.sort_by(|a, b| a.position.total_cmp(&b.position));
    let b = shape.path().bounds();
    let local = Rect::new(
        f64::from(b.x()),
        f64::from(b.y()),
        f64::from(b.width()),
        f64::from(b.height()),
    );
    let surface_rect = Rect::new(
        0.0,
        0.0,
        f64::from(surface.pixmap.width()),
        f64::from(surface.pixmap.height()),
    );
    let area = ts.map_rect(&local).intersect(&surface_rect);
    if area.is_empty() {
        return;
    }
    let (x0, y0) = (area.x.floor() as i32, area.y.floor() as i32);
    let (x1, y1) = (area.right().ceil() as i32, area.bottom().ceil() as i32);
    let (w, h) = ((x1 - x0).max(1) as u32, (y1 - y0).max(1) as u32);
    let Some(mut pixmap) = tiny_skia::Pixmap::new(w, h) else {
        return;
    };
    // surface pixel → node → unit square → gradient space
    let Some(surface_to_node) = ts.invert() else {
        return;
    };
    let unit = Affine::scale(1.0 / size.x.max(1e-6), 1.0 / size.y.max(1e-6));
    let to_gradient = transform.mul(&unit).mul(&surface_to_node);
    let data = pixmap.data_mut();
    for py in 0..h {
        for px in 0..w {
            let p = to_gradient.apply(Vec2::new(
                f64::from(x0) + f64::from(px) + 0.5,
                f64::from(y0) + f64::from(py) + 0.5,
            ));
            let (dx, dy) = (p.x - 0.5, p.y - 0.5);
            let t = match kind {
                GradientKind::Angular => {
                    let a = dy.atan2(dx) / std::f64::consts::TAU;
                    a.rem_euclid(1.0) as f32
                }
                _ => ((dx.abs() + dy.abs()) * 2.0) as f32,
            };
            let at = ((py * w + px) * 4) as usize;
            data[at..at + 4].copy_from_slice(&sample(&sorted, t, alpha));
        }
    }
    let pattern_to_node = surface_to_node.mul(&Affine::translate(f64::from(x0), f64::from(y0)));
    let p = tiny_skia::Paint {
        shader: Pattern::new(
            pixmap.as_ref(),
            SpreadMode::Pad,
            FilterQuality::Nearest,
            1.0,
            pattern_to_node.to_skia(),
        ),
        blend_mode: blend,
        anti_alias: true,
        force_hq_pipeline: false,
    };
    surface
        .pixmap
        .fill_path(shape.path(), &p, shape.rule(), ts.to_skia(), clip);
}
