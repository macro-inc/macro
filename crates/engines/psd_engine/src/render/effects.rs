//! Layer styles: each effect becomes a stage (a coverage plane with a
//! color, blend mode, and opacity) that the compositor stacks around the
//! layer's own paint, bottom to top: drop shadows, outer glows, the outer
//! part of strokes, then inside the layer's shape its paint, pattern,
//! gradient, and color overlays, satins, inner glows, inner shadows, the
//! inner part of strokes, and bevels.
//!
//! Effects are computed from the layer's shape: shadows offset it along the
//! light angle; spread and choke dilate before a Gaussian blur of half the
//! remaining size (so the falloff spans the size on each side of the
//! edge); precise glows and strokes measure Euclidean distance; bevels
//! light a height map ramping across the bevel size.

use super::fill::{self, GradientPaint};
use super::layer::Cx;
use super::plane::{Plane, blur, blur_support, dilate, distance, erode};
use crate::model::{
    Bevel, BevelStyle, BevelTechnique, BlendMode, Contour, Effects, Fill, Glow, GlowSource,
    GlowTechnique, Overlay, Rgb, Satin, Shadow, StrokeEffect, StrokePosition,
};
use crate::raster::IRect;

/// An effect's color: one color, or a straight color with alpha per pixel
/// of the stage's region.
pub(crate) enum StageColor {
    /// One color.
    Solid([f32; 3]),
    /// A color per pixel.
    Pixels(Vec<[f32; 4]>),
}

/// One effect layer to composite.
pub(crate) struct Stage {
    /// Blend mode.
    pub(crate) mode: BlendMode,
    /// Opacity.
    pub(crate) opacity: f32,
    /// Color.
    pub(crate) color: StageColor,
    /// Coverage over the region: of the pixel for stages below the layer
    /// and outer bands, of the layer's shape for stages inside it.
    pub(crate) cov: Plane,
    /// Below the layer: hidden where the layer's shape is (it shows only
    /// in the part of each pixel the shape leaves uncovered).
    pub(crate) knocked_out: bool,
}

impl Stage {
    /// Color and coverage (opacity applied) at pixel `i` of the region.
    #[inline]
    pub(crate) fn at(&self, i: usize) -> ([f32; 3], f32) {
        let c = self.cov.v[i] * self.opacity;
        match &self.color {
            StageColor::Solid(rgb) => (*rgb, c),
            StageColor::Pixels(px) => {
                let p = px[i];
                ([p[0], p[1], p[2]], c * p[3])
            }
        }
    }
}

/// A layer's effects over a region, grouped by where they stack.
#[derive(Default)]
pub(crate) struct Stages {
    /// Below the layer (drop shadows, outer glows, outer bevel parts).
    pub(crate) below: Vec<Stage>,
    /// Outside the layer's shape, beside it (outer parts of strokes).
    pub(crate) beside: Vec<Stage>,
    /// Inside the layer's shape, above its paint.
    pub(crate) inside: Vec<Stage>,
}

/// The largest effect size drawn, in pixels at the rendered level
/// (Photoshop's own limit is 250 before scaling).
const MAX_SIZE: f32 = 500.0;

/// The largest shadow or satin offset drawn, in pixels.
const MAX_OFFSET: f32 = 30000.0;

/// A size at scale `k`: finite, non-negative, capped.
fn px_size(v: f32, k: f32) -> f32 {
    let s = v * k;
    if s.is_nan() {
        0.0
    } else {
        s.clamp(0.0, MAX_SIZE)
    }
}

/// An offset at scale `k`: finite and capped.
fn px_offset(v: f32, k: f32) -> f32 {
    let s = v * k;
    if s.is_nan() {
        0.0
    } else {
        s.clamp(0.0, MAX_OFFSET)
    }
}

/// A fraction in `0..=1` (NaN is 0).
fn unit(v: f32) -> f32 {
    if v.is_nan() { 0.0 } else { v.clamp(0.0, 1.0) }
}

/// An angle in degrees (non-finite is 0).
fn degrees(v: f32) -> f32 {
    if v.is_finite() { v } else { 0.0 }
}

/// The scale effects are drawn at: the view's `k`. (The style's own scale,
/// [`Effects::scale`], records how its sizes were scaled already; Photoshop
/// draws them as stored.)
fn effect_scale(k: f32) -> f32 {
    if k.is_nan() { 0.0 } else { k.max(0.0) }
}

/// How far (pixels at the scale `k`, which multiplies every size) effects
/// reach from the layer's shape, and so how far around a region they read
/// it.
pub(crate) fn margin(fx: &Effects, k: f32) -> i32 {
    if !fx.enabled {
        return 0;
    }
    let k = effect_scale(k);
    let soft = |size: f32, spread: f32| {
        let size = px_size(size, k);
        let spread = unit(spread);
        (size * spread).ceil() as i32 + blur_support(falloff_sigma(size * (1.0 - spread)))
    };
    let mut m = 0;
    for s in fx
        .drop_shadows
        .iter()
        .chain(&fx.inner_shadows)
        .filter(|e| e.enabled)
    {
        m = m.max(px_offset(s.distance, k).ceil() as i32 + soft(s.size, s.spread));
    }
    for g in fx
        .outer_glows
        .iter()
        .chain(&fx.inner_glows)
        .filter(|e| e.enabled)
    {
        m = m.max(soft(g.size, g.spread).max(px_size(g.size, k).ceil() as i32));
    }
    for s in fx.satins.iter().filter(|e| e.enabled) {
        m = m.max(
            px_offset(s.distance, k).ceil() as i32
                + blur_support(falloff_sigma(px_size(s.size, k))),
        );
    }
    for s in fx.strokes.iter().filter(|e| e.enabled) {
        m = m.max(px_size(s.size, k).ceil() as i32);
    }
    for b in fx.bevels.iter().filter(|e| e.enabled) {
        let size = px_size(b.size, k);
        m = m.max(
            size.ceil() as i32
                + blur_support(size * 0.25)
                + blur_support(px_size(b.soften, k) * 0.5),
        );
    }
    m + 2
}

/// Everything effects need besides the shape.
pub(crate) struct Inputs<'a> {
    /// The layer's shape over `region` grown by the effects' [`margin`].
    pub(crate) shape: &'a Plane,
    /// The area to compute.
    pub(crate) region: IRect,
    /// The frame (level 0) aligned gradients and patterns are laid over.
    pub(crate) frame: IRect,
}

/// Computes a layer's effects over `inputs.region`.
pub(crate) fn render(cx: &mut Cx, fx: &Effects, inputs: &Inputs) -> Stages {
    let mut out = Stages::default();
    if !fx.enabled {
        return out;
    }
    let k = effect_scale(cx.scale());
    let a = inputs.shape.crop(inputs.region);
    // Bottom to top within each group; the first of several instances of
    // an effect is drawn topmost.
    for s in fx.drop_shadows.iter().rev().filter(|e| e.enabled) {
        out.below.push(drop_shadow(cx, s, k, inputs));
    }
    for g in fx.outer_glows.iter().rev().filter(|e| e.enabled) {
        out.below.push(outer_glow(g, k, inputs));
    }
    for o in fx.pattern_overlays.iter().rev().filter(|e| e.enabled) {
        out.inside.push(overlay(cx, o, inputs));
    }
    for o in fx.gradient_overlays.iter().rev().filter(|e| e.enabled) {
        out.inside.push(overlay(cx, o, inputs));
    }
    for o in fx.color_overlays.iter().rev().filter(|e| e.enabled) {
        out.inside.push(overlay(cx, o, inputs));
    }
    for s in fx.satins.iter().rev().filter(|e| e.enabled) {
        out.inside.push(satin(s, k, inputs));
    }
    for g in fx.inner_glows.iter().rev().filter(|e| e.enabled) {
        out.inside.push(inner_glow(g, k, inputs));
    }
    for s in fx.inner_shadows.iter().rev().filter(|e| e.enabled) {
        out.inside.push(inner_shadow(cx, s, k, inputs));
    }
    // Several strokes don't stack: each shows only where the strokes above
    // it leave room, and blends with what is below the layer.
    let mut strokes: Vec<(Option<Stage>, Option<Stage>)> = fx
        .strokes
        .iter()
        .filter(|e| e.enabled)
        .map(|s| stroke(cx, s, k, inputs, &a))
        .collect();
    knock_out_below(strokes.iter_mut().filter_map(|s| s.0.as_mut()));
    knock_out_below(strokes.iter_mut().filter_map(|s| s.1.as_mut()));
    for (beside, inside) in strokes.into_iter().rev() {
        out.beside.extend(beside);
        out.inside.extend(inside);
    }
    for b in fx.bevels.iter().rev().filter(|e| e.enabled) {
        bevel(cx, b, k, inputs, &mut out);
    }
    out
}

/// Cuts each stage (topmost first) out of the room the stages above it
/// already cover.
fn knock_out_below<'a>(stages: impl Iterator<Item = &'a mut Stage>) {
    let mut taken: Option<Plane> = None;
    for s in stages {
        match &mut taken {
            None => taken = Some(s.cov.clone()),
            Some(t) => {
                for (c, t) in s.cov.v.iter_mut().zip(t.v.iter_mut()) {
                    *c *= 1.0 - *t;
                    *t += *c;
                }
            }
        }
    }
}

/// The light angle (degrees) an effect uses.
fn light_angle(cx: &Cx, angle: f32, global: bool) -> f32 {
    degrees(if global { cx.doc.global_angle } else { angle })
}

/// The offset (pixels) of a shadow cast by light from `angle` degrees.
fn cast(angle: f32, distance: f32) -> (f32, f32) {
    let r = angle.to_radians();
    (-r.cos() * distance, r.sin() * distance)
}

/// A per-pixel random value in `0..1` for noise.
fn noise_at(x: i32, y: i32) -> f32 {
    super::blend::dissolve_threshold(
        x.wrapping_mul(7).wrapping_add(13),
        y.wrapping_mul(11).wrapping_sub(5),
    )
}

/// Applies a contour and noise to coverage.
fn finish(p: &mut Plane, contour: &Contour, noise: f32) {
    let linear = contour.points == [(0.0, 0.0), (1.0, 1.0)];
    if !linear {
        p.map(|v| unit(contour.apply(v)));
    }
    let n = unit(noise);
    if n > 0.0 {
        let r = p.rect;
        let mut i = 0;
        for y in r.y..r.bottom() {
            for x in r.x..r.right() {
                let v = p.v[i];
                p.v[i] = (v * (1.0 + n * (2.0 * noise_at(x, y) - 1.0))).clamp(0.0, 1.0);
                i += 1;
            }
        }
    }
}

/// The Gaussian matching Photoshop's falloff over `size` pixels: three box
/// blurs of a third of the size each, so it fades out at the size.
pub(crate) fn falloff_sigma(size: f32) -> f32 {
    let r = size.max(0.0) / 3.0;
    (r * (r + 1.0)).sqrt()
}

/// A shape grown by `spread` of `size` then blurred by the rest, over
/// `region`, from a source plane offset by `(dx, dy)` (value `outside`
/// beyond it).
fn soft(
    src: &Plane,
    dx: f32,
    dy: f32,
    outside: f32,
    size: f32,
    spread: f32,
    region: IRect,
) -> Plane {
    let spread = unit(spread);
    let grow = size * spread;
    let sigma = falloff_sigma(size * (1.0 - spread));
    let pad = grow.ceil() as i32 + blur_support(sigma) + 1;
    let r = region.outset(pad);
    let mut p = src.shifted(dx, dy, r, outside);
    p = dilate(&p, grow);
    blur(&mut p, sigma);
    p.crop(region)
}

fn rgb(c: Rgb) -> [f32; 3] {
    [c.r, c.g, c.b]
}

fn drop_shadow(cx: &Cx, s: &Shadow, k: f32, inputs: &Inputs) -> Stage {
    let (dx, dy) = cast(
        light_angle(cx, s.angle, s.use_global_light),
        px_offset(s.distance, k),
    );
    let mut p = soft(
        inputs.shape,
        dx,
        dy,
        0.0,
        px_size(s.size, k),
        s.spread,
        inputs.region,
    );
    finish(&mut p, &s.contour, s.noise);
    Stage {
        mode: s.blend,
        opacity: unit(s.opacity),
        color: StageColor::Solid(rgb(s.color)),
        cov: p,
        knocked_out: s.knocks_out,
    }
}

fn inner_shadow(cx: &Cx, s: &Shadow, k: f32, inputs: &Inputs) -> Stage {
    let (dx, dy) = cast(
        light_angle(cx, s.angle, s.use_global_light),
        px_offset(s.distance, k),
    );
    let mut inverse = inputs.shape.clone();
    inverse.map(|v| 1.0 - v);
    let mut p = soft(
        &inverse,
        dx,
        dy,
        1.0,
        px_size(s.size, k),
        s.spread,
        inputs.region,
    );
    finish(&mut p, &s.contour, s.noise);
    Stage {
        mode: s.blend,
        opacity: unit(s.opacity),
        color: StageColor::Solid(rgb(s.color)),
        cov: p,
        knocked_out: false,
    }
}

/// A glow's falloff (1 at the shape, 0 at its size) through its range and
/// contour, then its color.
fn glow_stage(g: &Glow, mut p: Plane, knocked_out: bool) -> Stage {
    // The range is the part of the falloff the contour spans: at 50% the
    // glow is full strength out to the shape's (half-covered) edge.
    let range = unit(g.range).max(0.01);
    let linear = g.contour.points == [(0.0, 0.0), (1.0, 1.0)];
    p.map(|v| {
        let u = (v / range).clamp(0.0, 1.0);
        if linear { u } else { unit(g.contour.apply(u)) }
    });
    finish(&mut p, &Contour::default(), g.noise);
    let color = match &g.gradient {
        Some(grad) => {
            let paint = GradientPaint::new(grad, IRect::new(0, 0, 1, 1));
            StageColor::Pixels(p.v.iter().map(|&v| paint.color(1.0 - v)).collect())
        }
        None => StageColor::Solid(rgb(g.color)),
    };
    Stage {
        mode: g.blend,
        opacity: unit(g.opacity),
        color,
        cov: p,
        knocked_out,
    }
}

/// A precise falloff: solid to `solid` pixels from the set's edge, then
/// linear to `size`.
fn precise(region: IRect, src: &Plane, inside_set: bool, solid: f32, size: f32) -> Plane {
    let pad = size.ceil() as i32 + 2;
    let r = region.outset(pad);
    let s = src.crop(r);
    let d = distance(r, |i| (s.v[i] >= 0.5) == inside_set);
    let ramp = (size - solid).max(1e-3);
    let mut p = Plane::filled(r, 0.0);
    for (o, &dd) in p.v.iter_mut().zip(&d) {
        let e = (dd - 0.5).max(0.0);
        *o = if e <= solid {
            1.0
        } else {
            (1.0 - (e - solid) / ramp).clamp(0.0, 1.0)
        };
    }
    p.crop(region)
}

fn outer_glow(g: &Glow, k: f32, inputs: &Inputs) -> Stage {
    let size = px_size(g.size, k);
    let p = match g.technique {
        GlowTechnique::Softer => soft(inputs.shape, 0.0, 0.0, 0.0, size, g.spread, inputs.region),
        GlowTechnique::Precise => precise(
            inputs.region,
            inputs.shape,
            true,
            size * unit(g.spread),
            size,
        ),
    };
    glow_stage(g, p, true)
}

fn inner_glow(g: &Glow, k: f32, inputs: &Inputs) -> Stage {
    let size = px_size(g.size, k);
    let mut p = match g.technique {
        GlowTechnique::Softer => {
            let mut inverse = inputs.shape.clone();
            inverse.map(|v| 1.0 - v);
            soft(&inverse, 0.0, 0.0, 1.0, size, g.spread, inputs.region)
        }
        GlowTechnique::Precise => precise(
            inputs.region,
            inputs.shape,
            false,
            size * unit(g.spread),
            size,
        ),
    };
    if g.source == GlowSource::Center {
        p.map(|v| 1.0 - v);
    }
    glow_stage(g, p, false)
}

fn satin(s: &Satin, k: f32, inputs: &Inputs) -> Stage {
    let r = degrees(s.angle).to_radians();
    let d = px_offset(s.distance, k);
    let (ox, oy) = (r.cos() * d, -r.sin() * d);
    let sigma = falloff_sigma(px_size(s.size, k));
    let pad = blur_support(sigma) + 1;
    let rr = inputs.region.outset(pad);
    let a1 = inputs.shape.shifted(ox, oy, rr, 0.0);
    let a2 = inputs.shape.shifted(-ox, -oy, rr, 0.0);
    let mut p = Plane {
        rect: rr,
        v: a1.v.iter().zip(&a2.v).map(|(a, b)| (a - b).abs()).collect(),
    };
    blur(&mut p, sigma);
    let mut p = p.crop(inputs.region);
    finish(&mut p, &s.contour, 0.0);
    if s.invert {
        p.map(|v| 1.0 - v);
    }
    Stage {
        mode: s.blend,
        opacity: unit(s.opacity),
        color: StageColor::Solid(rgb(s.color)),
        cov: p,
        knocked_out: false,
    }
}

/// A fill's color over the region.
fn fill_color(cx: &Cx, f: &Fill, frame: IRect, region: IRect) -> StageColor {
    match f {
        Fill::Solid { color } => StageColor::Solid(rgb(*color)),
        _ => StageColor::Pixels(fill::paint(cx.doc, f, frame, cx.level, region)),
    }
}

fn overlay(cx: &Cx, o: &Overlay, inputs: &Inputs) -> Stage {
    Stage {
        mode: o.blend,
        opacity: unit(o.opacity),
        color: fill_color(cx, &o.fill, inputs.frame, inputs.region),
        cov: Plane::filled(inputs.region, 1.0),
        knocked_out: false,
    }
}

/// A stroke's part outside the shape (coverage of the pixel) and inside it
/// (share of the shape).
fn stroke(
    cx: &Cx,
    s: &StrokeEffect,
    k: f32,
    inputs: &Inputs,
    a: &Plane,
) -> (Option<Stage>, Option<Stage>) {
    let size = px_size(s.size, k);
    if size <= 0.0 {
        return (None, None);
    }
    let (out_w, in_w) = match s.position {
        StrokePosition::Outside => (size, 0.0),
        StrokePosition::Inside => (0.0, size),
        StrokePosition::Center => (size * 0.5, size * 0.5),
    };
    let pad = size.ceil() as i32 + 2;
    let r = inputs.region.outset(pad);
    let src = inputs.shape.crop(r);
    let stage = |cov: Plane| Stage {
        mode: s.blend,
        opacity: unit(s.opacity),
        color: fill_color(cx, &s.fill, inputs.frame, inputs.region),
        cov,
        knocked_out: false,
    };
    let beside = (out_w > 0.0).then(|| {
        let d = dilate(&src, out_w).crop(inputs.region);
        let v =
            d.v.iter()
                .zip(&a.v)
                .map(|(d, a)| (d - a).max(0.0))
                .collect();
        stage(Plane {
            rect: inputs.region,
            v,
        })
    });
    let inside = (in_w > 0.0).then(|| {
        let e = erode(&src, in_w).crop(inputs.region);
        let v =
            e.v.iter()
                .zip(&a.v)
                .map(|(e, a)| {
                    if *a > 0.0 {
                        ((a - e) / a).clamp(0.0, 1.0)
                    } else {
                        0.0
                    }
                })
                .collect();
        stage(Plane {
            rect: inputs.region,
            v,
        })
    });
    (beside, inside)
}

/// Bevel and emboss: a height map rising across the bevel size, shaded by
/// the light into a highlight and a shadow.
fn bevel(cx: &Cx, b: &Bevel, k: f32, inputs: &Inputs, out: &mut Stages) {
    let size = px_size(b.size, k).max(0.5);
    let smooth = match b.technique {
        BevelTechnique::Smooth => size * 0.25,
        BevelTechnique::ChiselSoft => size * 0.1,
        BevelTechnique::ChiselHard => 0.0,
    };
    let soften = px_size(b.soften, k) * 0.5;
    let pad = size.ceil() as i32 + blur_support(smooth) + blur_support(soften) + 3;
    let r = inputs.region.outset(pad);
    let src = inputs.shape.crop(r);
    let d_in = distance(r, |i| src.v[i] < 0.5);
    let d_out = distance(r, |i| src.v[i] >= 0.5);
    let ramp = |d: f32| ((d - 0.5) / size).clamp(0.0, 1.0);
    let mut h = Plane::filled(r, 0.0);
    for (i, v) in h.v.iter_mut().enumerate() {
        let inside = src.v[i] >= 0.5;
        *v = match b.style {
            BevelStyle::InnerBevel | BevelStyle::StrokeEmboss => {
                if inside {
                    ramp(d_in[i])
                } else {
                    0.0
                }
            }
            BevelStyle::OuterBevel => {
                if inside {
                    1.0
                } else {
                    1.0 - ramp(d_out[i])
                }
            }
            BevelStyle::Emboss => {
                if inside {
                    0.5 + 0.5 * ramp(d_in[i] * 2.0)
                } else {
                    0.5 - 0.5 * ramp(d_out[i] * 2.0)
                }
            }
            BevelStyle::PillowEmboss => {
                if inside {
                    0.5 + 0.5 * ramp(d_in[i] * 2.0)
                } else {
                    0.5 + 0.5 * ramp(d_out[i] * 2.0)
                }
            }
        };
    }
    if let Some(c) = &b.contour {
        h.map(|v| unit(c.apply(v)));
    }
    blur(&mut h, smooth);
    let angle = light_angle(cx, b.angle, b.use_global_light).to_radians();
    let altitude = degrees(if b.use_global_light {
        cx.doc.global_altitude
    } else {
        b.altitude
    })
    .clamp(0.0, 90.0)
    .to_radians();
    let light = [
        altitude.cos() * angle.cos(),
        -altitude.cos() * angle.sin(),
        altitude.sin(),
    ];
    let flat = light[2].max(1e-3);
    // Heights in pixels: the ramp rises `size × depth` over `size`.
    let depth = if b.depth.is_nan() {
        1.0
    } else {
        b.depth.clamp(0.0, 10.0)
    };
    let lift = size * depth * if b.up { 1.0 } else { -1.0 };
    let (w, hh) = (r.w as usize, r.h as usize);
    let mut hi = Plane::filled(r, 0.0);
    let mut sh = Plane::filled(r, 0.0);
    for y in 0..hh {
        for x in 0..w {
            let at = |xx: usize, yy: usize| h.v[yy * w + xx];
            let (x0, x1) = (x.saturating_sub(1), (x + 1).min(w - 1));
            let (y0, y1) = (y.saturating_sub(1), (y + 1).min(hh - 1));
            let gx = (at(x1, y) - at(x0, y)) / (x1 - x0).max(1) as f32 * lift;
            let gy = (at(x, y1) - at(x, y0)) / (y1 - y0).max(1) as f32 * lift;
            let n = [-gx, -gy, 1.0];
            let len = (n[0] * n[0] + n[1] * n[1] + 1.0).sqrt();
            let shade = (n[0] * light[0] + n[1] * light[1] + n[2] * light[2]) / len;
            let i = y * w + x;
            hi.v[i] = unit(
                b.gloss
                    .apply(((shade - flat) / (1.0 - flat).max(1e-3)).clamp(0.0, 1.0)),
            );
            sh.v[i] = unit(b.gloss.apply(((flat - shade) / flat).clamp(0.0, 1.0)));
        }
    }
    blur(&mut hi, soften);
    blur(&mut sh, soften);
    let (hi, sh) = (hi.crop(inputs.region), sh.crop(inputs.region));
    let outside = matches!(
        b.style,
        BevelStyle::OuterBevel | BevelStyle::Emboss | BevelStyle::PillowEmboss
    );
    let inner = !matches!(b.style, BevelStyle::OuterBevel);
    let stage = |mode: BlendMode, color: Rgb, opacity: f32, cov: Plane, knocked_out: bool| Stage {
        mode,
        opacity: unit(opacity),
        color: StageColor::Solid(rgb(color)),
        cov,
        knocked_out,
    };
    if outside {
        out.below.push(stage(
            b.shadow_blend,
            b.shadow_color,
            b.shadow_opacity,
            sh.clone(),
            true,
        ));
        out.below.push(stage(
            b.highlight_blend,
            b.highlight_color,
            b.highlight_opacity,
            hi.clone(),
            true,
        ));
    }
    if inner {
        out.inside.push(stage(
            b.shadow_blend,
            b.shadow_color,
            b.shadow_opacity,
            sh,
            false,
        ));
        out.inside.push(stage(
            b.highlight_blend,
            b.highlight_color,
            b.highlight_opacity,
            hi,
            false,
        ));
    }
}

#[cfg(test)]
mod test;
