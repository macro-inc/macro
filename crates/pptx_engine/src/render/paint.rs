//! Converts model fills and lines into display-list paints and strokes.

use super::image::{apply_effects, with_border};
use super::scene::{LineCap, LineJoin, Paint, Raster, Stroke};
use crate::model::color::Rgba;
use crate::model::fill::{Cap, Fill, Gradient, GradientKind, ImageFill, ImageMode, Join, Line, PathShape};
use crate::path::{Affine, Point, Rect};
use std::sync::Arc;

/// Source of decoded pictures (implemented by the renderer's image cache).
pub trait ImageSource {
    /// The decoded picture for an image part, without border.
    fn raster(&mut self, part: &str) -> Option<Arc<Raster>>;
}

/// Points per image pixel for pictures without DPI information (96 DPI).
pub const PT_PER_PX: f32 = 0.75;

/// Builds the paint for `fill` over `bbox` (local coordinates) under `world`.
pub fn fill_paint(fill: &Fill, bbox: Rect, world: &Affine, images: &mut dyn ImageSource) -> Option<Paint> {
    match fill {
        Fill::None | Fill::Group => None,
        Fill::Solid(c) => (c.a > 0.0).then_some(Paint::Solid(*c)),
        Fill::Gradient(g) => gradient_paint(g, bbox, world),
        Fill::Pattern { preset, fg, bg } => {
            let tile = Arc::new(pattern_tile(preset, *fg, *bg));
            let t = world.pre_concat(&Affine::translate(f64::from(bbox.x), f64::from(bbox.y))).pre_concat(&Affine::scale(
                f64::from(PT_PER_PX),
                f64::from(PT_PER_PX),
            ));
            Some(Paint::Image { image: tile, transform: t, repeat: true, opacity: 1.0 })
        }
        Fill::Image(img) => image_paint(img, bbox, world, images),
    }
}

fn gradient_paint(g: &Gradient, bbox: Rect, world: &Affine) -> Option<Paint> {
    let stops: Vec<(f32, Rgba)> = g.stops.iter().map(|s| (s.pos, s.color)).collect();
    if stops.is_empty() {
        return None;
    }
    match &g.kind {
        GradientKind::Linear { angle, scaled } => {
            let rad = f64::from(*angle).to_radians();
            let (sin, cos) = rad.sin_cos();
            if *scaled {
                // Defined on the unit square, then stretched to the box.
                let len = cos.abs() + sin.abs();
                let (dx, dy) = (cos * len / 2.0, sin * len / 2.0);
                let start = Point::new((0.5 - dx) as f32, (0.5 - dy) as f32);
                let end = Point::new((0.5 + dx) as f32, (0.5 + dy) as f32);
                let t = world
                    .pre_concat(&Affine::translate(f64::from(bbox.x), f64::from(bbox.y)))
                    .pre_concat(&Affine::scale(f64::from(bbox.w.max(0.01)), f64::from(bbox.h.max(0.01))));
                Some(Paint::Linear { start, end, stops, transform: t })
            } else {
                let (w, h) = (f64::from(bbox.w), f64::from(bbox.h));
                let len = (w * cos).abs() + (h * sin).abs();
                let c = bbox.center();
                let (dx, dy) = ((cos * len / 2.0) as f32, (sin * len / 2.0) as f32);
                Some(Paint::Linear {
                    start: Point::new(c.x - dx, c.y - dy),
                    end: Point::new(c.x + dx, c.y + dy),
                    stops,
                    transform: *world,
                })
            }
        }
        GradientKind::Path { shape, focus } => {
            // Focus rectangle (fractional insets) → its center in the box.
            let fx = bbox.x + bbox.w * (focus.l + (1.0 - focus.l - focus.r) / 2.0);
            let fy = bbox.y + bbox.h * (focus.t + (1.0 - focus.t - focus.b) / 2.0);
            match shape {
                PathShape::Circle => {
                    // A circle around the focus that just reaches the farthest corner.
                    let r = [(bbox.x, bbox.y), (bbox.right(), bbox.y), (bbox.x, bbox.bottom()), (bbox.right(), bbox.bottom())]
                        .iter()
                        .map(|(x, y)| ((x - fx).powi(2) + (y - fy).powi(2)).sqrt())
                        .fold(0.0f32, f32::max)
                        .max(0.01);
                    let t = world
                        .pre_concat(&Affine::translate(f64::from(fx), f64::from(fy)))
                        .pre_concat(&Affine::scale(f64::from(r), f64::from(r)));
                    Some(Paint::Radial { stops, transform: t })
                }
                PathShape::Rect | PathShape::Shape => {
                    let img = Arc::new(rect_gradient(&stops, bbox, fx, fy));
                    let sx = bbox.w / img.width as f32;
                    let sy = bbox.h / img.height as f32;
                    let t = world
                        .pre_concat(&Affine::translate(f64::from(bbox.x), f64::from(bbox.y)))
                        .pre_concat(&Affine::scale(f64::from(sx), f64::from(sy)));
                    Some(Paint::Image { image: img, transform: t, repeat: false, opacity: 1.0 })
                }
            }
        }
    }
}

fn sample(stops: &[(f32, Rgba)], t: f32) -> Rgba {
    let t = t.clamp(0.0, 1.0);
    let first = stops[0];
    if t <= first.0 {
        return first.1;
    }
    for w in stops.windows(2) {
        let (a, b) = (w[0], w[1]);
        if t <= b.0 {
            let span = (b.0 - a.0).max(1e-6);
            return a.1.lerp(b.1, (t - a.0) / span);
        }
    }
    stops[stops.len() - 1].1
}

/// Rasterizes a rectangular path gradient (contours are rectangles around the focus).
fn rect_gradient(stops: &[(f32, Rgba)], bbox: Rect, fx: f32, fy: f32) -> Raster {
    let res = (512.0 / bbox.w.max(bbox.h).max(1.0)).min(2.0);
    let w = ((bbox.w * res).ceil() as u32).clamp(1, 512);
    let h = ((bbox.h * res).ceil() as u32).clamp(1, 512);
    let mut r = Raster::new(w, h);
    let (lx, rx) = (fx - bbox.x, bbox.right() - fx);
    let (ty, by) = (fy - bbox.y, bbox.bottom() - fy);
    for y in 0..h {
        for x in 0..w {
            let px = bbox.x + (x as f32 + 0.5) / w as f32 * bbox.w;
            let py = bbox.y + (y as f32 + 0.5) / h as f32 * bbox.h;
            let dx = if px < fx { (fx - px) / lx.max(1e-3) } else { (px - fx) / rx.max(1e-3) };
            let dy = if py < fy { (fy - py) / ty.max(1e-3) } else { (py - fy) / by.max(1e-3) };
            let c = sample(stops, dx.max(dy));
            let i = ((y * w + x) * 4) as usize;
            let a = c.a.clamp(0.0, 1.0);
            r.pixels[i] = (c.r * a * 255.0).round() as u8;
            r.pixels[i + 1] = (c.g * a * 255.0).round() as u8;
            r.pixels[i + 2] = (c.b * a * 255.0).round() as u8;
            r.pixels[i + 3] = (a * 255.0).round() as u8;
        }
    }
    r
}

fn image_paint(img: &ImageFill, bbox: Rect, world: &Affine, images: &mut dyn ImageSource) -> Option<Paint> {
    let part = img.part.as_deref()?;
    let base = images.raster(part)?;
    let mut raster = (*base).clone();
    if !img.effects.is_empty() {
        apply_effects(&mut raster, &img.effects);
    }
    let (iw, ih) = (raster.width as f32, raster.height as f32);
    match &img.mode {
        ImageMode::Stretch(fill_rect) => {
            let dest = Rect::from_ltrb(
                bbox.x + bbox.w * fill_rect.l,
                bbox.y + bbox.h * fill_rect.t,
                bbox.right() - bbox.w * fill_rect.r,
                bbox.bottom() - bbox.h * fill_rect.b,
            );
            let s = &img.src_rect;
            let (sx0, sy0) = (s.l * iw, s.t * ih);
            let (sx1, sy1) = ((1.0 - s.r) * iw, (1.0 - s.b) * ih);
            let (sw, sh) = ((sx1 - sx0).abs().max(1e-3), (sy1 - sy0).abs().max(1e-3));
            let bordered = Arc::new(with_border(&raster));
            let t = world
                .pre_concat(&Affine::translate(f64::from(dest.x), f64::from(dest.y)))
                .pre_concat(&Affine::scale(f64::from(dest.w / sw), f64::from(dest.h / sh)))
                .pre_concat(&Affine::translate(-f64::from(sx0) - 1.0, -f64::from(sy0) - 1.0));
            Some(Paint::Image { image: bordered, transform: t, repeat: false, opacity: 1.0 })
        }
        ImageMode::Tile { tx, ty, sx, sy, flip: _, align } => {
            let (tw, th) = (iw * PT_PER_PX * sx, ih * PT_PER_PX * sy);
            let (ax, ay) = match align.as_str() {
                "t" => (bbox.w / 2.0 - tw / 2.0, 0.0),
                "tr" => (bbox.w - tw, 0.0),
                "l" => (0.0, bbox.h / 2.0 - th / 2.0),
                "ctr" => (bbox.w / 2.0 - tw / 2.0, bbox.h / 2.0 - th / 2.0),
                "r" => (bbox.w - tw, bbox.h / 2.0 - th / 2.0),
                "bl" => (0.0, bbox.h - th),
                "b" => (bbox.w / 2.0 - tw / 2.0, bbox.h - th),
                "br" => (bbox.w - tw, bbox.h - th),
                _ => (0.0, 0.0),
            };
            let t = world
                .pre_concat(&Affine::translate(f64::from(bbox.x + ax + tx), f64::from(bbox.y + ay + ty)))
                .pre_concat(&Affine::scale(f64::from(PT_PER_PX * sx), f64::from(PT_PER_PX * sy)));
            Some(Paint::Image { image: Arc::new(raster), transform: t, repeat: true, opacity: 1.0 })
        }
    }
}

/// The 8×8 bit patterns of DrawingML preset pattern fills (one byte per row, MSB = left).
fn pattern_bits(preset: &str) -> [u8; 8] {
    match preset {
        "pct5" => [0x80, 0, 0, 0, 0x08, 0, 0, 0],
        "pct10" => [0x80, 0, 0x08, 0, 0x80, 0, 0x08, 0],
        "pct20" => [0x88, 0, 0x22, 0, 0x88, 0, 0x22, 0],
        "pct25" => [0x88, 0x22, 0x88, 0x22, 0x88, 0x22, 0x88, 0x22],
        "pct30" => [0xAA, 0x44, 0xAA, 0x11, 0xAA, 0x44, 0xAA, 0x11],
        "pct40" => [0xAA, 0x55, 0xAA, 0x55, 0xAA, 0x55, 0xAA, 0x11],
        "pct50" => [0xAA, 0x55, 0xAA, 0x55, 0xAA, 0x55, 0xAA, 0x55],
        "pct60" => [0xEE, 0x55, 0xBB, 0x55, 0xEE, 0x55, 0xBB, 0x55],
        "pct70" => [0xEE, 0x77, 0xBB, 0xDD, 0xEE, 0x77, 0xBB, 0xDD],
        "pct75" => [0xEE, 0xFF, 0xBB, 0xFF, 0xEE, 0xFF, 0xBB, 0xFF],
        "pct80" => [0xF7, 0xFF, 0x7F, 0xFF, 0xF7, 0xFF, 0x7F, 0xFF],
        "pct90" => [0xF7, 0xFF, 0xFF, 0xFF, 0x7F, 0xFF, 0xFF, 0xFF],
        "horz" => [0xFF, 0, 0, 0, 0xFF, 0, 0, 0],
        "vert" => [0x88; 8],
        "ltHorz" => [0xFF, 0, 0, 0, 0, 0, 0, 0],
        "ltVert" => [0x80; 8],
        "dkHorz" => [0xFF, 0xFF, 0, 0, 0xFF, 0xFF, 0, 0],
        "dkVert" => [0xCC; 8],
        "narHorz" => [0xFF, 0, 0xFF, 0, 0xFF, 0, 0xFF, 0],
        "narVert" => [0xAA; 8],
        "dashHorz" => [0xF0, 0, 0, 0, 0x0F, 0, 0, 0],
        "dashVert" => [0x80, 0x80, 0x80, 0x80, 0x08, 0x08, 0x08, 0x08],
        "cross" | "lgGrid" => [0xFF, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80],
        "smGrid" => [0xFF, 0x88, 0x88, 0x88, 0xFF, 0x88, 0x88, 0x88],
        "dnDiag" => [0x88, 0x44, 0x22, 0x11, 0x88, 0x44, 0x22, 0x11],
        "upDiag" => [0x11, 0x22, 0x44, 0x88, 0x11, 0x22, 0x44, 0x88],
        "ltDnDiag" => [0x80, 0x40, 0x20, 0x10, 0x08, 0x04, 0x02, 0x01],
        "ltUpDiag" => [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80],
        "dkDnDiag" => [0xCC, 0x66, 0x33, 0x99, 0xCC, 0x66, 0x33, 0x99],
        "dkUpDiag" => [0x33, 0x66, 0xCC, 0x99, 0x33, 0x66, 0xCC, 0x99],
        "wdDnDiag" => [0xC1, 0xE0, 0x70, 0x38, 0x1C, 0x0E, 0x07, 0x83],
        "wdUpDiag" => [0x83, 0x07, 0x0E, 0x1C, 0x38, 0x70, 0xE0, 0xC1],
        "dashDnDiag" => [0x88, 0x44, 0x22, 0x11, 0, 0, 0, 0],
        "dashUpDiag" => [0x11, 0x22, 0x44, 0x88, 0, 0, 0, 0],
        "diagCross" => [0x81, 0x42, 0x24, 0x18, 0x18, 0x24, 0x42, 0x81],
        "smCheck" => [0x99, 0x66, 0x66, 0x99, 0x99, 0x66, 0x66, 0x99],
        "lgCheck" => [0xF0, 0xF0, 0xF0, 0xF0, 0x0F, 0x0F, 0x0F, 0x0F],
        "smConfetti" => [0x80, 0x10, 0x02, 0x40, 0x04, 0x20, 0x01, 0x08],
        "lgConfetti" => [0xB1, 0x30, 0x03, 0x1B, 0xD8, 0xC0, 0x0C, 0x8D],
        "horzBrick" => [0xFF, 0x80, 0x80, 0x80, 0xFF, 0x08, 0x08, 0x08],
        "diagBrick" => [0x80, 0x40, 0x20, 0x10, 0x18, 0x24, 0x42, 0x81],
        "solidDmnd" => [0x10, 0x38, 0x7C, 0xFE, 0x7C, 0x38, 0x10, 0],
        "openDmnd" => [0x80, 0x41, 0x22, 0x14, 0x08, 0x14, 0x22, 0x41],
        "dotDmnd" => [0x80, 0, 0x22, 0, 0x08, 0, 0x22, 0],
        "plaid" => [0xAA, 0x55, 0xAA, 0x55, 0xF0, 0xF0, 0xF0, 0xF0],
        "sphere" => [0x77, 0x89, 0x8F, 0x8F, 0x77, 0x98, 0xF8, 0xF8],
        "weave" => [0x88, 0x54, 0x22, 0x45, 0x88, 0x14, 0x22, 0x51],
        "divot" => [0, 0x08, 0x04, 0x08, 0, 0x10, 0x20, 0x10],
        "shingle" => [0x03, 0x84, 0x48, 0x30, 0x0C, 0x02, 0x01, 0x01],
        "wave" => [0, 0x18, 0xA4, 0x03, 0, 0x18, 0xA4, 0x03],
        "trellis" => [0xFF, 0x66, 0xFF, 0x99, 0xFF, 0x66, 0xFF, 0x99],
        "zigZag" => [0x81, 0x42, 0x24, 0x18, 0x81, 0x42, 0x24, 0x18],
        "dotGrid" => [0xAA, 0, 0x80, 0, 0x80, 0, 0x80, 0],
        _ => [0xAA, 0x55, 0xAA, 0x55, 0xAA, 0x55, 0xAA, 0x55],
    }
}

/// An 8×8 tile for a pattern fill.
pub fn pattern_tile(preset: &str, fg: Rgba, bg: Rgba) -> Raster {
    let bits = pattern_bits(preset);
    let mut r = Raster::new(8, 8);
    for (y, row) in bits.iter().enumerate() {
        for x in 0..8 {
            let on = row & (0x80 >> x) != 0;
            let c = if on { fg } else { bg };
            let a = c.a.clamp(0.0, 1.0);
            let i = (y * 8 + x) * 4;
            r.pixels[i] = (c.r * a * 255.0).round() as u8;
            r.pixels[i + 1] = (c.g * a * 255.0).round() as u8;
            r.pixels[i + 2] = (c.b * a * 255.0).round() as u8;
            r.pixels[i + 3] = (a * 255.0).round() as u8;
        }
    }
    r
}

/// Stroke parameters for a resolved line drawn under a transform with `scale`.
pub fn line_stroke(line: &Line, scale: f32) -> Stroke {
    let width = line.width * scale;
    Stroke {
        width,
        cap: match line.cap {
            Cap::Flat => LineCap::Butt,
            Cap::Round => LineCap::Round,
            Cap::Square => LineCap::Square,
        },
        join: match line.join {
            Join::Round => LineJoin::Round,
            Join::Bevel => LineJoin::Bevel,
            Join::Miter(_) => LineJoin::Miter,
        },
        miter_limit: match line.join {
            Join::Miter(l) => l,
            _ => 4.0,
        },
        dash: line.dash.as_ref().map(|d| {
            // Round/square caps extend dashes; shorten them so the visible length matches.
            let cap_ext = if line.cap == Cap::Flat { 0.0 } else { 1.0 };
            d.iter()
                .enumerate()
                .map(|(i, v)| {
                    let len = v * width.max(0.1);
                    if i % 2 == 0 { (len - cap_ext * width).max(0.01) } else { len + cap_ext * width }
                })
                .collect()
        }),
    }
}

/// Lightens or darkens a paint for `lighten`/`darken` geometry sub-paths.
pub fn shade_paint(p: Paint, factor: f32, lighten: bool) -> Paint {
    let adjust = |c: Rgba| {
        if lighten {
            Rgba { r: c.r + (1.0 - c.r) * factor, g: c.g + (1.0 - c.g) * factor, b: c.b + (1.0 - c.b) * factor, a: c.a }
        } else {
            Rgba { r: c.r * factor, g: c.g * factor, b: c.b * factor, a: c.a }
        }
    };
    match p {
        Paint::Solid(c) => Paint::Solid(adjust(c)),
        Paint::Linear { start, end, stops, transform } => {
            Paint::Linear { start, end, stops: stops.into_iter().map(|(p, c)| (p, adjust(c))).collect(), transform }
        }
        Paint::Radial { stops, transform } => {
            Paint::Radial { stops: stops.into_iter().map(|(p, c)| (p, adjust(c))).collect(), transform }
        }
        other => other,
    }
}
