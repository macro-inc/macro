//! Geometry: moving and transforming layers, and changing the canvas
//! (crop, canvas size, image size, rotation, flips). Everything that moves
//! with a layer moves with it: linked masks, vector masks, a text layer's
//! transform, a smart object's corners.

use super::Ctx;
use super::layers::{outermost, subtree};
use super::transform::{self, Interpolation};
use crate::error::{PsdError, Result};
use crate::model::{ColorMode, Layer, LayerIdx, LayerKind, LayerMask, VectorMask, flags};
use crate::raster::{IRect, Raster};

/// An affine map `[a, b, c, d, e, f]`: `(x, y)` to
/// `(a·x + c·y + e, b·x + d·y + f)`.
pub(super) type Matrix = [f64; 6];

/// Applies a map to a point.
pub(super) fn apply(m: &Matrix, (x, y): (f64, f64)) -> (f64, f64) {
    (m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5])
}

/// `a` after `b`.
fn concat(a: &Matrix, b: &Matrix) -> Matrix {
    [
        a[0] * b[0] + a[2] * b[1],
        a[1] * b[0] + a[3] * b[1],
        a[0] * b[2] + a[2] * b[3],
        a[1] * b[2] + a[3] * b[3],
        a[0] * b[4] + a[2] * b[5] + a[4],
        a[1] * b[4] + a[3] * b[5] + a[5],
    ]
}

fn translation(dx: f64, dy: f64) -> Matrix {
    [1.0, 0.0, 0.0, 1.0, dx, dy]
}

/// The layers an operation on `ids` moves: each named layer and everything
/// in the groups among them, without duplicates.
fn moving(ctx: &Ctx<'_>, ids: &[u32]) -> Vec<LayerIdx> {
    let found = ctx.find_all(ids);
    let mut out = Vec::new();
    for i in outermost(ctx, &found) {
        for j in subtree(ctx, i) {
            if !out.contains(&j) {
                out.push(j);
            }
        }
    }
    out
}

fn check_movable(ctx: &Ctx<'_>, layers: &[LayerIdx]) -> Result<()> {
    if let Some(&i) = layers.iter().find(|&&i| ctx.doc.layer(i).locks.position) {
        return Err(PsdError::invalid(format!(
            "\"{}\" is locked in place",
            ctx.doc.layer(i).name
        )));
    }
    Ok(())
}

fn map_vector(mask: &mut VectorMask, m: &Matrix) {
    for sp in &mut mask.subpaths {
        for k in &mut sp.knots {
            k.before = apply(m, k.before);
            k.anchor = apply(m, k.anchor);
            k.after = apply(m, k.after);
        }
    }
}

/// Moves a layer's own content by whole pixels.
fn translate_layer(layer: &mut Layer, dx: i32, dy: i32) {
    let m = translation(f64::from(dx), f64::from(dy));
    layer.pixels.translate(dx, dy);
    if let Some(mask) = &mut layer.mask
        && mask.linked
    {
        mask.raster.translate(dx, dy);
        mask.rect = mask.rect.translate(dx, dy);
    }
    if let Some(v) = &mut layer.vector_mask
        && !v.unlinked
    {
        map_vector(v, &m);
    }
    match &mut layer.kind {
        LayerKind::Text { text } => {
            text.transform[4] += f64::from(dx);
            text.transform[5] += f64::from(dy);
        }
        LayerKind::SmartObject { object } => {
            for k in 0..4 {
                object.corners[2 * k] += f64::from(dx);
                object.corners[2 * k + 1] += f64::from(dy);
            }
        }
        _ => {}
    }
}

/// What a geometric change of a layer edits; `moved` for whole-pixel
/// moves, which keep pixel data as it is.
fn layer_edits_for(layer: &Layer, moved: bool) -> u64 {
    let mut e = if moved { flags::OFFSET } else { flags::PIXELS };
    if layer.mask.is_some() && !moved {
        e |= flags::MASK;
    }
    if layer.vector_mask.is_some() {
        e |= flags::VECTOR_MASK;
    }
    match layer.kind {
        LayerKind::Text { .. } => e |= flags::TEXT,
        LayerKind::SmartObject { .. } => e |= flags::PLACEMENT,
        _ => {}
    }
    e
}

fn layer_edits(layer: &Layer) -> u64 {
    layer_edits_for(layer, false)
}

pub(super) fn translate(ctx: &mut Ctx<'_>, ids: &[u32], dx: i32, dy: i32) -> Result<()> {
    if dx == 0 && dy == 0 {
        return Ok(());
    }
    let layers = moving(ctx, ids);
    check_movable(ctx, &layers)?;
    for &i in &layers {
        ctx.dirty_layer(i);
    }
    for &i in &layers {
        let edits = layer_edits_for(ctx.doc.layer(i), true);
        translate_layer(ctx.layer(i, edits), dx, dy);
    }
    for &i in &layers {
        ctx.dirty_layer(i);
    }
    Ok(())
}

/// A mask raster mapped through `m`: masks whose outside shows (default
/// 255) are inverted around the resampling, so what the map exposes keeps
/// the default.
fn transform_mask(mask: &LayerMask, m: &Matrix, interpolation: Interpolation) -> LayerMask {
    let corners = [
        (mask.rect.x, mask.rect.y),
        (mask.rect.right(), mask.rect.y),
        (mask.rect.x, mask.rect.bottom()),
        (mask.rect.right(), mask.rect.bottom()),
    ];
    let mapped: Vec<(f64, f64)> = corners
        .iter()
        .map(|&(x, y)| apply(m, (f64::from(x), f64::from(y))))
        .collect();
    let left = mapped.iter().map(|p| p.0).fold(f64::INFINITY, f64::min);
    let top = mapped.iter().map(|p| p.1).fold(f64::INFINITY, f64::min);
    let right = mapped.iter().map(|p| p.0).fold(f64::NEG_INFINITY, f64::max);
    let bottom = mapped.iter().map(|p| p.1).fold(f64::NEG_INFINITY, f64::max);
    let rect = if mask.rect.is_empty() {
        IRect::default()
    } else {
        IRect::from_ltrb(
            left.floor() as i32,
            top.floor() as i32,
            right.ceil() as i32,
            bottom.ceil() as i32,
        )
    };
    let raster = if mask.default_color == 255 {
        let inverted = invert_gray(&mask.raster, mask.rect);
        let moved = transform::transform(&inverted, *m, interpolation);
        invert_gray(&moved, rect)
    } else {
        transform::transform(&mask.raster, *m, interpolation)
    };
    LayerMask {
        raster,
        rect,
        ..mask.clone()
    }
}

/// `255 - v` over `rect` (outside it the raster stays empty).
fn invert_gray(raster: &Raster, rect: IRect) -> Raster {
    if rect.is_empty() {
        return Raster::gray();
    }
    let mut data = raster.read_vec(rect);
    for v in &mut data {
        *v = 255 - *v;
    }
    Raster::from_region(1, rect, &data)
}

/// Maps a layer's own content through `m`; the new pixels and mask take
/// `generation`.
fn transform_layer(layer: &mut Layer, m: &Matrix, interpolation: Interpolation, generation: u32) {
    match &mut layer.kind {
        LayerKind::Text { text } => {
            text.transform = {
                let t = &text.transform;
                // Text space to canvas: [xx, xy, yx, yy, tx, ty].
                let current: Matrix = [t[0], t[1], t[2], t[3], t[4], t[5]];
                concat(m, &current)
            };
            layer.pixels = crate::text::render(text);
        }
        LayerKind::SmartObject { object } => {
            for k in 0..4 {
                let (x, y) = apply(m, (object.corners[2 * k], object.corners[2 * k + 1]));
                object.corners[2 * k] = x;
                object.corners[2 * k + 1] = y;
            }
            layer.pixels = transform::transform(&layer.pixels, *m, interpolation);
        }
        LayerKind::Pixel => {
            layer.pixels = transform::transform(&layer.pixels, *m, interpolation);
        }
        LayerKind::Group { .. } | LayerKind::Fill { .. } | LayerKind::Adjustment { .. } => {}
    }
    if let Some(mask) = &layer.mask
        && mask.linked
    {
        let mut moved = transform_mask(mask, m, interpolation);
        moved.generation = generation;
        layer.mask = Some(moved);
    }
    if let Some(v) = &mut layer.vector_mask
        && !v.unlinked
    {
        map_vector(v, m);
    }
    layer.generation = generation;
}

pub(super) fn transform_layers(
    ctx: &mut Ctx<'_>,
    ids: &[u32],
    matrix: Matrix,
    interpolation: Interpolation,
) -> Result<()> {
    if matrix.iter().any(|v| !v.is_finite()) {
        return Err(PsdError::invalid("the transform is not finite"));
    }
    let det = matrix[0] * matrix[3] - matrix[1] * matrix[2];
    if det.abs() < 1e-9 {
        return Err(PsdError::invalid("the transform flattens the layer"));
    }
    let layers = moving(ctx, ids);
    check_movable(ctx, &layers)?;
    for &i in &layers {
        ctx.dirty_layer(i);
    }
    for &i in &layers {
        let edits = layer_edits(ctx.doc.layer(i));
        let generation = ctx.doc.allocate_id();
        transform_layer(ctx.layer(i, edits), &matrix, interpolation, generation);
    }
    for &i in &layers {
        ctx.dirty_layer(i);
    }
    Ok(())
}

/// The union of layers' visual bounds.
fn combined_bounds(ctx: &Ctx<'_>, layers: &[LayerIdx]) -> Option<IRect> {
    layers
        .iter()
        .filter_map(|&i| crate::render::visual_bounds(ctx.doc, i))
        .reduce(|a, b| a.union(&b))
}

/// Applies an exact pixel map (flip or quarter turn) and its matrix to
/// layers; `canvas` maps unlinked masks too (the whole canvas moves).
fn remap_exact(
    ctx: &mut Ctx<'_>,
    layers: &[LayerIdx],
    m: &Matrix,
    pixels: &dyn Fn(&Raster) -> Raster,
    canvas: bool,
) {
    for &i in layers {
        ctx.dirty_layer(i);
    }
    for &i in layers {
        let edits = layer_edits(ctx.doc.layer(i));
        let generation = ctx.doc.allocate_id();
        let layer = ctx.layer(i, edits);
        match &mut layer.kind {
            LayerKind::Text { text } => {
                let t = text.transform;
                text.transform = concat(m, &[t[0], t[1], t[2], t[3], t[4], t[5]]);
                layer.pixels = crate::text::render(text);
            }
            LayerKind::SmartObject { object } => {
                for k in 0..4 {
                    let (x, y) = apply(m, (object.corners[2 * k], object.corners[2 * k + 1]));
                    object.corners[2 * k] = x;
                    object.corners[2 * k + 1] = y;
                }
                layer.pixels = pixels(&layer.pixels);
            }
            LayerKind::Pixel => layer.pixels = pixels(&layer.pixels),
            _ => {}
        }
        if let Some(mask) = &mut layer.mask
            && (mask.linked || canvas)
        {
            mask.raster = pixels(&mask.raster);
            mask.generation = generation;
            let r = mask.rect;
            if !r.is_empty() {
                let a = apply(m, (f64::from(r.x), f64::from(r.y)));
                let b = apply(m, (f64::from(r.right()), f64::from(r.bottom())));
                mask.rect = IRect::from_ltrb(
                    a.0.min(b.0).round() as i32,
                    a.1.min(b.1).round() as i32,
                    a.0.max(b.0).round() as i32,
                    a.1.max(b.1).round() as i32,
                );
            }
        }
        if let Some(v) = &mut layer.vector_mask
            && (!v.unlinked || canvas)
        {
            map_vector(v, m);
        }
        layer.generation = generation;
    }
    for &i in layers {
        ctx.dirty_layer(i);
    }
}

pub(super) fn flip_layers(ctx: &mut Ctx<'_>, ids: &[u32], horizontal: bool) -> Result<()> {
    let layers = moving(ctx, ids);
    check_movable(ctx, &layers)?;
    let Some(bounds) = combined_bounds(ctx, &layers) else {
        return Ok(());
    };
    // Axes on pixel edges keep the flip exact.
    let (m, axis) = if horizontal {
        let axis = f64::from(bounds.x + bounds.right()) / 2.0;
        let axis = (axis * 2.0).round() / 2.0;
        ([-1.0, 0.0, 0.0, 1.0, 2.0 * axis, 0.0], axis)
    } else {
        let axis = f64::from(bounds.y + bounds.bottom()) / 2.0;
        let axis = (axis * 2.0).round() / 2.0;
        ([1.0, 0.0, 0.0, -1.0, 0.0, 2.0 * axis], axis)
    };
    let flip = move |r: &Raster| {
        if horizontal {
            transform::flip_horizontal(r, axis)
        } else {
            transform::flip_vertical(r, axis)
        }
    };
    remap_exact(ctx, &layers, &m, &flip, false);
    Ok(())
}

/// The matrix of `quarters` clockwise quarter turns about `(cx, cy)`.
fn quarter_matrix(quarters: i32, (cx, cy): (f64, f64)) -> Matrix {
    let q = quarters.rem_euclid(4);
    // Clockwise on screen (y down): (x, y) -> (-y, x).
    let (a, b, c, d) = match q {
        0 => (1.0, 0.0, 0.0, 1.0),
        1 => (0.0, 1.0, -1.0, 0.0),
        2 => (-1.0, 0.0, 0.0, -1.0),
        _ => (0.0, -1.0, 1.0, 0.0),
    };
    let to_origin = translation(-cx, -cy);
    let back = translation(cx, cy);
    concat(&back, &concat(&[a, b, c, d, 0.0, 0.0], &to_origin))
}

pub(super) fn rotate_layers(ctx: &mut Ctx<'_>, ids: &[u32], quarters: i32) -> Result<()> {
    if quarters.rem_euclid(4) == 0 {
        return Ok(());
    }
    let layers = moving(ctx, ids);
    check_movable(ctx, &layers)?;
    let Some(bounds) = combined_bounds(ctx, &layers) else {
        return Ok(());
    };
    // A center on a pixel corner keeps the turn exact.
    let center = (
        f64::from((bounds.x + bounds.right()).div_euclid(2)),
        f64::from((bounds.y + bounds.bottom()).div_euclid(2)),
    );
    let m = quarter_matrix(quarters, center);
    let turn = move |r: &Raster| transform::rotate_quarters(r, quarters, center);
    remap_exact(ctx, &layers, &m, &turn, false);
    Ok(())
}

/// Every live layer.
fn all_layers(ctx: &Ctx<'_>) -> Vec<LayerIdx> {
    ctx.doc.paint_order()
}

/// Moves every layer and the stored composite by whole pixels (for crops
/// and canvas size changes).
fn shift_everything(ctx: &mut Ctx<'_>, dx: i32, dy: i32) {
    if dx == 0 && dy == 0 {
        return;
    }
    for i in all_layers(ctx) {
        let edits = layer_edits_for(ctx.doc.layer(i), true);
        let layer = ctx.layer(i, edits);
        translate_layer(layer, dx, dy);
        // Unlinked masks and vector masks stay with the canvas content too.
        if let Some(mask) = &mut layer.mask
            && !mask.linked
        {
            mask.raster.translate(dx, dy);
            mask.rect = mask.rect.translate(dx, dy);
        }
        if let Some(v) = &mut layer.vector_mask
            && v.unlinked
        {
            map_vector(v, &translation(f64::from(dx), f64::from(dy)));
        }
    }
    if let Some(c) = &mut ctx.doc.composite {
        let moved = c.raster.realigned((0, 0));
        let mut r = moved;
        r.translate(dx, dy);
        c.raster = r.realigned((0, 0));
        for s in &mut c.stale {
            *s = s.translate(dx, dy);
        }
    }
    for g in &mut ctx.doc.guides {
        g.position += f64::from(if g.vertical { dx } else { dy });
    }
}

/// The canvas changed size: the composite only covers its old area, and
/// every view must redraw.
fn resized(ctx: &mut Ctx<'_>, old: IRect) {
    ctx.doc.edits |= flags::DOC_CANVAS;
    let new = ctx.doc.bounds();
    if let Some(c) = &mut ctx.doc.composite {
        c.raster.crop_to(old.intersect(&new));
        // Areas the old composite did not cover are composited from layers.
        for strip in [
            IRect::from_ltrb(new.x, new.y, new.right(), old.y),
            IRect::from_ltrb(new.x, old.bottom(), new.right(), new.bottom()),
            IRect::from_ltrb(new.x, old.y, old.x, old.bottom()),
            IRect::from_ltrb(old.right(), old.y, new.right(), old.bottom()),
        ] {
            c.invalidate(strip.intersect(&new));
        }
    }
    ctx.renderer.clear();
    ctx.dirty_all();
}

fn check_size(width: u32, height: u32) -> Result<()> {
    if width == 0 || height == 0 || width > 300_000 || height > 300_000 {
        return Err(PsdError::invalid("the canvas size is out of range"));
    }
    Ok(())
}

pub(super) fn crop(ctx: &mut Ctx<'_>, rect: IRect) -> Result<()> {
    check_size(rect.w.max(0) as u32, rect.h.max(0) as u32)?;
    shift_everything(ctx, -rect.x, -rect.y);
    let old = ctx.doc.bounds().translate(-rect.x, -rect.y);
    ctx.doc.width = rect.w as u32;
    ctx.doc.height = rect.h as u32;
    resized(ctx, old);
    Ok(())
}

pub(super) fn canvas_size(
    ctx: &mut Ctx<'_>,
    width: u32,
    height: u32,
    anchor: (f32, f32),
) -> Result<()> {
    check_size(width, height)?;
    let dx = ((width as f32 - ctx.doc.width as f32) * anchor.0.clamp(0.0, 1.0)).round() as i32;
    let dy = ((height as f32 - ctx.doc.height as f32) * anchor.1.clamp(0.0, 1.0)).round() as i32;
    shift_everything(ctx, dx, dy);
    let old = ctx.doc.bounds().translate(dx, dy);
    ctx.doc.width = width;
    ctx.doc.height = height;
    // The Background stays opaque: new canvas around it is white.
    let canvas = ctx.doc.bounds();
    for i in all_layers(ctx) {
        if ctx.doc.layer(i).background {
            let layer = ctx.layer(i, flags::PIXELS);
            for strip in [
                IRect::from_ltrb(canvas.x, canvas.y, canvas.right(), old.y),
                IRect::from_ltrb(canvas.x, old.bottom(), canvas.right(), canvas.bottom()),
                IRect::from_ltrb(canvas.x, old.y, old.x, old.bottom()),
                IRect::from_ltrb(old.right(), old.y, canvas.right(), old.bottom()),
            ] {
                let strip = strip.intersect(&canvas);
                if !strip.is_empty() {
                    let white = vec![255u8; strip.area() as usize * 4];
                    layer.pixels.write(strip, &white);
                }
            }
        }
    }
    resized(ctx, old);
    Ok(())
}

pub(super) fn image_size(
    ctx: &mut Ctx<'_>,
    width: u32,
    height: u32,
    interpolation: Interpolation,
) -> Result<()> {
    check_size(width, height)?;
    let sx = f64::from(width) / f64::from(ctx.doc.width.max(1));
    let sy = f64::from(height) / f64::from(ctx.doc.height.max(1));
    let m: Matrix = [sx, 0.0, 0.0, sy, 0.0, 0.0];
    let scale = ((sx + sy) / 2.0) as f32;
    for i in all_layers(ctx) {
        let edits = layer_edits(ctx.doc.layer(i)) | flags::EFFECTS;
        let generation = ctx.doc.allocate_id();
        let layer = ctx.layer(i, edits);
        transform_layer(layer, &m, interpolation, generation);
        // Unlinked masks scale with the canvas too.
        if let Some(mask) = &layer.mask
            && !mask.linked
        {
            let mut moved = transform_mask(mask, &m, interpolation);
            moved.generation = generation;
            layer.mask = Some(moved);
        }
        if let Some(v) = &mut layer.vector_mask
            && v.unlinked
        {
            map_vector(v, &m);
        }
        // Styles scale with the image (Scale Styles).
        if let Some(fx) = &mut layer.effects {
            fx.scale *= scale;
        }
    }
    if let Some(c) = &mut ctx.doc.composite {
        c.raster = transform::transform(&c.raster, m, interpolation).realigned((0, 0));
        let stale: Vec<IRect> = c.stale.drain(..).collect();
        for s in stale {
            let a = apply(&m, (f64::from(s.x), f64::from(s.y)));
            let b = apply(&m, (f64::from(s.right()), f64::from(s.bottom())));
            c.invalidate(IRect::from_ltrb(
                a.0.floor() as i32,
                a.1.floor() as i32,
                b.0.ceil() as i32,
                b.1.ceil() as i32,
            ));
        }
    }
    for g in &mut ctx.doc.guides {
        g.position *= if g.vertical { sx } else { sy };
    }
    ctx.doc.width = width;
    ctx.doc.height = height;
    ctx.doc.edits |= flags::DOC_CANVAS;
    ctx.renderer.clear();
    ctx.dirty_all();
    Ok(())
}

/// Applies an exact map to every layer, the composite, and the guides.
fn remap_canvas(ctx: &mut Ctx<'_>, m: &Matrix, pixels: &dyn Fn(&Raster) -> Raster) {
    let layers = all_layers(ctx);
    remap_exact(ctx, &layers, m, pixels, true);
    if let Some(c) = &mut ctx.doc.composite {
        c.raster = pixels(&c.raster).realigned((0, 0));
        let stale: Vec<IRect> = c.stale.drain(..).collect();
        for s in stale {
            let a = apply(m, (f64::from(s.x), f64::from(s.y)));
            let b = apply(m, (f64::from(s.right()), f64::from(s.bottom())));
            c.invalidate(IRect::from_ltrb(
                a.0.min(b.0).round() as i32,
                a.1.min(b.1).round() as i32,
                a.0.max(b.0).round() as i32,
                a.1.max(b.1).round() as i32,
            ));
        }
    }
}

pub(super) fn rotate_canvas(ctx: &mut Ctx<'_>, quarters: i32) -> Result<()> {
    let q = quarters.rem_euclid(4);
    if q == 0 {
        return Ok(());
    }
    let (w, h) = (f64::from(ctx.doc.width), f64::from(ctx.doc.height));
    // Turn about the origin, then move the canvas back to positive space.
    let turn = quarter_matrix(q, (0.0, 0.0));
    let shift = match q {
        1 => translation(h, 0.0),
        2 => translation(w, h),
        _ => translation(0.0, w),
    };
    let m = concat(&shift, &turn);
    let (sx, sy) = (shift[4] as i32, shift[5] as i32);
    let pixels = move |r: &Raster| {
        let mut out = transform::rotate_quarters(r, q, (0.0, 0.0));
        out.translate(sx, sy);
        out
    };
    remap_canvas(ctx, &m, &pixels);
    let guides: Vec<_> = ctx.doc.guides.drain(..).collect();
    for g in guides {
        let p = if g.vertical {
            apply(&m, (g.position, 0.0))
        } else {
            apply(&m, (0.0, g.position))
        };
        let vertical = if q % 2 == 1 { !g.vertical } else { g.vertical };
        ctx.doc.guides.push(crate::model::Guide {
            vertical,
            position: if vertical { p.0 } else { p.1 },
        });
    }
    if q % 2 == 1 {
        std::mem::swap(&mut ctx.doc.width, &mut ctx.doc.height);
    }
    ctx.doc.edits |= flags::DOC_CANVAS;
    ctx.renderer.clear();
    ctx.dirty_all();
    Ok(())
}

pub(super) fn flip_canvas(ctx: &mut Ctx<'_>, horizontal: bool) -> Result<()> {
    let (w, h) = (f64::from(ctx.doc.width), f64::from(ctx.doc.height));
    let (m, axis) = if horizontal {
        ([-1.0, 0.0, 0.0, 1.0, w, 0.0], w / 2.0)
    } else {
        ([1.0, 0.0, 0.0, -1.0, 0.0, h], h / 2.0)
    };
    let flip = move |r: &Raster| {
        if horizontal {
            transform::flip_horizontal(r, axis)
        } else {
            transform::flip_vertical(r, axis)
        }
    };
    remap_canvas(ctx, &m, &flip);
    for g in &mut ctx.doc.guides {
        if g.vertical == horizontal {
            g.position = if horizontal { w } else { h } - g.position;
        }
    }
    ctx.doc.edits |= flags::DOC_CANVAS;
    ctx.renderer.clear();
    ctx.dirty_all();
    Ok(())
}

pub(super) fn convert_to_rgb(ctx: &mut Ctx<'_>) -> Result<()> {
    if ctx.doc.mode == ColorMode::Rgb && ctx.doc.depth == 8 {
        return Ok(());
    }
    // Layers already hold RGBA: saving writes every one again in RGB.
    for i in all_layers(ctx) {
        let mut edits = flags::PIXELS | flags::KIND;
        if ctx.doc.layer(i).mask.is_some() {
            edits |= flags::MASK;
        }
        ctx.layer(i, edits);
    }
    ctx.doc.mode = ColorMode::Rgb;
    ctx.doc.depth = 8;
    ctx.doc.edits |= flags::DOC_MODE;
    ctx.dirty_all();
    Ok(())
}
