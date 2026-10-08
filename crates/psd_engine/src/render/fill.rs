//! What fill layers, overlays, and strokes paint: one color, a gradient
//! laid over a frame (the layer's bounds or the canvas), or a repeated
//! pattern, over any canvas area at any level.
//!
//! A gradient is centered on its frame (shifted by its offset) and runs
//! along its angle across the frame's chord through the center in that
//! direction, times its scale; radial, reflected, and diamond gradients
//! reach half that from the center (as Photoshop's gradient fills do).

use crate::model::{Document, Fill, Gradient, GradientKind, Pattern, PatternFill};
use crate::raster::IRect;

/// Straight RGBA (`0..=1`) per pixel of `rect` (level pixels) for a fill
/// laid over `frame` (canvas pixels, level 0).
pub(crate) fn paint(
    doc: &Document,
    fill: &Fill,
    frame: IRect,
    level: u8,
    rect: IRect,
) -> Vec<[f32; 4]> {
    let n = rect.area().max(0) as usize;
    match fill {
        Fill::Solid { color } => vec![[color.r, color.g, color.b, 1.0]; n],
        Fill::Gradient { gradient } => {
            let g = GradientPaint::new(gradient, frame);
            let s = (1u32 << level.min(30)) as f64;
            let mut out = Vec::with_capacity(n);
            for y in rect.y..rect.bottom() {
                let py = (y as f64 + 0.5) * s;
                for x in rect.x..rect.right() {
                    out.push(g.at((x as f64 + 0.5) * s, py));
                }
            }
            out
        }
        Fill::Pattern { pattern } => match doc.pattern(&pattern.pattern) {
            Some(p)
                if p.width > 0
                    && p.height > 0
                    && p.rgba.len() as u64 >= p.width as u64 * p.height as u64 * 4 =>
            {
                paint_pattern(p, pattern, level, rect)
            }
            _ => vec![[0.0; 4]; n],
        },
    }
}

/// Colors a gradient is drawn from (finer than 8-bit steps, so long
/// gradients don't band).
const GRADIENT_STEPS: usize = 1024;

/// A gradient's colors and geometry, ready to sample.
pub(crate) struct GradientPaint {
    lut: Vec<[f32; 4]>,
    kind: GradientKind,
    center: (f64, f64),
    dir: (f64, f64),
    /// The full length along `dir`.
    length: f64,
    angle: f64,
}

impl GradientPaint {
    /// Prepares a gradient over `frame` (level 0).
    pub(crate) fn new(g: &Gradient, frame: IRect) -> GradientPaint {
        let lut = g.table(GRADIENT_STEPS);
        let (w, h) = (frame.w.max(1) as f64, frame.h.max(1) as f64);
        let degrees = if g.angle.is_finite() {
            g.angle as f64
        } else {
            0.0
        };
        let angle = degrees.to_radians();
        let dir = (angle.cos(), -angle.sin());
        // The frame's chord through its center along the angle.
        let half = |side: f64, d: f64| {
            if d.abs() < 1e-9 {
                f64::INFINITY
            } else {
                side * 0.5 / d.abs()
            }
        };
        let extent = 2.0 * half(w, dir.0).min(half(h, dir.1));
        let scale = if g.scale.is_finite() && g.scale > 0.0 {
            g.scale as f64
        } else {
            1.0
        };
        let offset = |v: f32| if v.is_finite() { v as f64 } else { 0.0 };
        GradientPaint {
            lut,
            kind: g.kind,
            center: (
                frame.x as f64 + w * (0.5 + offset(g.offset.0)),
                frame.y as f64 + h * (0.5 + offset(g.offset.1)),
            ),
            dir,
            length: (extent * scale).max(1e-3),
            angle: degrees,
        }
    }

    /// Where along the gradient (`0..=1`) canvas point `(x, y)` falls.
    pub(crate) fn t(&self, x: f64, y: f64) -> f32 {
        let (dx, dy) = (x - self.center.0, y - self.center.1);
        let along = dx * self.dir.0 + dy * self.dir.1;
        let across = -dx * self.dir.1 + dy * self.dir.0;
        let half = self.length * 0.5;
        let t = match self.kind {
            GradientKind::Linear => along / self.length + 0.5,
            GradientKind::Reflected => along.abs() / half,
            GradientKind::Radial => (dx * dx + dy * dy).sqrt() / half,
            GradientKind::Diamond => (along.abs() + across.abs()) / half,
            GradientKind::Angle => {
                // Clockwise from the gradient's angle (y points down).
                (dy.atan2(dx).to_degrees() + self.angle).rem_euclid(360.0) / 360.0
            }
        };
        if t.is_nan() {
            0.0
        } else {
            t.clamp(0.0, 1.0) as f32
        }
    }

    /// The straight color at a position along the gradient.
    pub(crate) fn color(&self, t: f32) -> [f32; 4] {
        let x = t.clamp(0.0, 1.0) * (self.lut.len() - 1) as f32;
        let i = (x as usize).min(self.lut.len() - 2);
        let f = x - i as f32;
        let (a, b) = (self.lut[i], self.lut[i + 1]);
        std::array::from_fn(|k| a[k] + (b[k] - a[k]) * f)
    }

    /// The straight color at canvas point `(x, y)`.
    #[inline]
    pub(crate) fn at(&self, x: f64, y: f64) -> [f32; 4] {
        self.color(self.t(x, y))
    }
}

/// A pattern repeated over `rect`: scaled, rotated, and shifted by its
/// phase from the canvas origin. (Linking with the layer moves the phase
/// when the layer moves; Photoshop draws linked patterns from the canvas
/// origin too.)
fn paint_pattern(p: &Pattern, fill: &PatternFill, level: u8, rect: IRect) -> Vec<[f32; 4]> {
    let s = (1u32 << level.min(30)) as f64;
    let scale = if fill.scale.is_finite() && fill.scale > 0.0 {
        fill.scale as f64
    } else {
        1.0
    };
    let finite = |v: f32| if v.is_finite() { v as f64 } else { 0.0 };
    let (sin, cos) = (-finite(fill.angle).to_radians()).sin_cos();
    let origin = (finite(fill.phase.0), finite(fill.phase.1));
    let mut out = Vec::with_capacity(rect.area().max(0) as usize);
    for y in rect.y..rect.bottom() {
        for x in rect.x..rect.right() {
            let (dx, dy) = (
                (x as f64 + 0.5) * s - origin.0,
                (y as f64 + 0.5) * s - origin.1,
            );
            // Into the pattern's own (unrotated, unscaled) pixels.
            let u = (dx * cos + dy * sin) / scale;
            let v = (-dx * sin + dy * cos) / scale;
            out.push(sample(p, u - 0.5, v - 0.5));
        }
    }
    out
}

/// Bilinear sample of a pattern at pixel-center coordinates, wrapping.
fn sample(p: &Pattern, u: f64, v: f64) -> [f32; 4] {
    let (w, h) = (p.width as i64, p.height as i64);
    let (fu, fv) = (u.floor(), v.floor());
    let (tu, tv) = ((u - fu) as f32, (v - fv) as f32);
    let (x0, y0) = (fu as i64, fv as i64);
    let px = |x: i64, y: i64| {
        let i = ((y.rem_euclid(h) * w + x.rem_euclid(w)) * 4) as usize;
        let a = p.rgba[i + 3] as f32 / 255.0;
        [
            p.rgba[i] as f32 / 255.0 * a,
            p.rgba[i + 1] as f32 / 255.0 * a,
            p.rgba[i + 2] as f32 / 255.0 * a,
            a,
        ]
    };
    let (a, b, c, d) = (
        px(x0, y0),
        px(x0 + 1, y0),
        px(x0, y0 + 1),
        px(x0 + 1, y0 + 1),
    );
    let mut out = [0.0f32; 4];
    for k in 0..4 {
        let top = a[k] + (b[k] - a[k]) * tu;
        let bottom = c[k] + (d[k] - c[k]) * tu;
        out[k] = top + (bottom - top) * tv;
    }
    super::blend::unpremultiply(out)
}

#[cfg(test)]
mod test;
