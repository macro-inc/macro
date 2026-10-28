//! Pixel operations: painting, fills, gradients, clearing, filters, copying
//! the selection to a layer, merging, flattening, rasterizing, and placing
//! images.

use super::layers::{attach, delete, paint_sorted};
use super::paint::{Brush, BrushMode};
use super::{Ctx, FilterSpec, Position, Target, filters, paint};
use crate::error::{PsdError, Result};
use crate::model::{Document, Gradient, Layer, LayerIdx, LayerKind, Rgb, flags};
use crate::raster::{IRect, Raster, Selection};
use crate::render::Renderer;

/// The selection, when something is selected.
fn selection<'a>(ctx: &'a Ctx<'_>) -> Option<&'a Selection> {
    (!ctx.selection.is_empty()).then_some(ctx.selection)
}

/// Checks a layer can take a pixel operation on `target`; returns its edit
/// flag.
fn editable(ctx: &Ctx<'_>, i: LayerIdx, target: Target) -> Result<u64> {
    let layer = ctx.doc.layer(i);
    match target {
        Target::Mask => {
            if layer.mask.is_none() {
                return Err(PsdError::invalid("the layer has no mask"));
            }
            Ok(flags::MASK)
        }
        Target::Pixels => {
            if layer.locks.pixels {
                return Err(PsdError::invalid(format!(
                    "\"{}\" is locked against painting",
                    layer.name
                )));
            }
            match layer.kind {
                LayerKind::Pixel => Ok(flags::PIXELS),
                LayerKind::Group { .. } => Err(PsdError::invalid("groups have no pixels")),
                LayerKind::Adjustment { .. } => {
                    Err(PsdError::invalid("adjustment layers have no pixels"))
                }
                _ => Err(PsdError::invalid(format!(
                    "rasterize \"{}\" before editing its pixels",
                    layer.name
                ))),
            }
        }
    }
}

/// The raster a target names.
fn raster(layer: &mut Layer, target: Target) -> &mut Raster {
    match target {
        Target::Pixels => &mut layer.pixels,
        Target::Mask => &mut layer.mask.as_mut().expect("checked by editable").raster,
    }
}

/// Grows a changed pixel area by what the layer's style reaches.
fn reach(ctx: &Ctx<'_>, i: LayerIdx, rect: IRect) -> IRect {
    let layer = ctx.doc.layer(i);
    let r = layer.effects.as_ref().map_or(0, |fx| fx.reach());
    let shadow = layer
        .effects
        .as_ref()
        .map_or(0.0, |fx| {
            fx.drop_shadows
                .iter()
                .chain(&fx.inner_shadows)
                .filter(|s| s.enabled)
                .map(|s| s.distance)
                .fold(0.0, f32::max)
        })
        .ceil() as i32;
    rect.outset(r + shadow)
}

/// A mask grows its rectangle to cover what was painted into it.
fn grow_mask(layer: &mut Layer, changed: IRect) {
    if let Some(mask) = &mut layer.mask {
        if mask.rect.is_empty() {
            mask.rect = changed;
        } else if !mask.rect.contains_rect(&changed) {
            // Outside the old rectangle the mask was its default.
            let grown = mask.rect.union(&changed);
            if mask.default_color != 0 {
                for strip in [
                    IRect::from_ltrb(grown.x, grown.y, grown.right(), mask.rect.y),
                    IRect::from_ltrb(grown.x, mask.rect.bottom(), grown.right(), grown.bottom()),
                    IRect::from_ltrb(grown.x, mask.rect.y, mask.rect.x, mask.rect.bottom()),
                    IRect::from_ltrb(
                        mask.rect.right(),
                        mask.rect.y,
                        grown.right(),
                        mask.rect.bottom(),
                    ),
                ] {
                    if !strip.is_empty() {
                        let fill = vec![mask.default_color; strip.area() as usize];
                        mask.raster.write(strip, &fill);
                    }
                }
            }
            mask.rect = grown;
        }
    }
}

/// Before painting into a mask, its default must cover the area the paint
/// may touch, so the raster holds every value there.
fn prepare_mask(layer: &mut Layer, area: IRect) {
    grow_mask(layer, area);
}

pub(super) fn paint(
    ctx: &mut Ctx<'_>,
    id: u32,
    target: Target,
    stroke_id: u32,
    brush: &Brush,
    points: &[[f32; 3]],
    done: bool,
) -> Result<()> {
    let i = ctx.find(id)?;
    let edit = editable(ctx, i, target)?;
    let mut brush = brush.clone();
    let layer = ctx.doc.layer(i);
    // The Background has no transparency: the eraser paints white.
    if target == Target::Pixels && layer.background && brush.mode == BrushMode::Erase {
        brush.mode = BrushMode::Paint;
        brush.color = Rgb::WHITE;
    }
    let lock_alpha = target == Target::Pixels && (layer.locks.transparency || layer.background);
    let selection = selection(ctx).cloned();
    let pts: Vec<(f32, f32, f32)> = points.iter().map(|p| (p[0], p[1], p[2])).collect();
    let mut stroke = ctx.take_stroke(stroke_id, &brush);
    let pad = (brush.size.max(1.0) / 2.0).ceil() as i32 + 2;
    let area = pts
        .iter()
        .map(|&(x, y, _)| {
            IRect::new(
                x.floor() as i32 - pad,
                y.floor() as i32 - pad,
                2 * pad + 1,
                2 * pad + 1,
            )
        })
        .reduce(|a, b| a.union(&b));
    let layer = ctx.layer(i, edit);
    if target == Target::Mask
        && let Some(area) = area
    {
        prepare_mask(layer, area);
    }
    let changed = stroke.add(raster(layer, target), selection.as_ref(), lock_alpha, &pts);
    if !done {
        ctx.put_stroke(stroke_id, stroke);
    }
    if let Some(changed) = changed {
        let r = reach(ctx, i, changed);
        ctx.dirty(Some(r));
    }
    Ok(())
}

fn to_rgba8(color: Rgb) -> [u8; 4] {
    let [r, g, b] = color.to_u8();
    [r, g, b, 255]
}

/// The canvas area a selection-limited operation covers.
fn work_area(ctx: &Ctx<'_>) -> IRect {
    match selection(ctx).and_then(Selection::bounds) {
        Some(b) => b,
        None => ctx.doc.bounds(),
    }
}

pub(super) fn fill(
    ctx: &mut Ctx<'_>,
    id: u32,
    target: Target,
    color: Rgb,
    opacity: f32,
) -> Result<()> {
    let i = ctx.find(id)?;
    let edit = editable(ctx, i, target)?;
    let area = work_area(ctx);
    let sel = selection(ctx).cloned();
    let lock_alpha = target == Target::Pixels && ctx.doc.layer(i).locks.transparency;
    let layer = ctx.layer(i, edit);
    if target == Target::Mask {
        prepare_mask(layer, area);
    }
    let changed = paint::fill(
        raster(layer, target),
        area,
        sel.as_ref(),
        to_rgba8(color),
        opacity,
        lock_alpha,
    );
    if let Some(c) = changed {
        let r = reach(ctx, i, c);
        ctx.dirty(Some(r));
    }
    Ok(())
}

/// The merged image over a canvas area, as straight RGBA.
fn composite_rgba(doc: &Document, renderer: &mut Renderer, rect: IRect) -> Vec<u8> {
    renderer.render(doc, rect, 0)
}

#[expect(clippy::too_many_arguments, reason = "the paint bucket's options")]
pub(super) fn bucket(
    ctx: &mut Ctx<'_>,
    id: u32,
    target: Target,
    seed: (i32, i32),
    color: Rgb,
    opacity: f32,
    tolerance: u8,
    contiguous: bool,
    antialias: bool,
    sample_all: bool,
) -> Result<()> {
    let i = ctx.find(id)?;
    let edit = editable(ctx, i, target)?;
    let canvas = ctx.doc.bounds();
    if !canvas.contains(seed.0, seed.1) {
        return Ok(());
    }
    let sel = selection(ctx).cloned();
    // What the bucket compares: the merged image or the layer itself.
    let sampled: Raster = if sample_all {
        let rgba = composite_rgba(ctx.doc, ctx.renderer, canvas);
        Raster::from_region(4, canvas, &rgba)
    } else {
        let layer = ctx.doc.layer(i);
        match target {
            Target::Pixels => layer.pixels.clone(),
            Target::Mask => {
                let mask = layer.mask.as_ref().expect("checked by editable");
                let mut gray = mask.raster.clone();
                if mask.default_color != 0 {
                    let mut l = layer.clone();
                    grow_mask(&mut l, canvas);
                    gray = l.mask.map(|m| m.raster).unwrap_or(gray);
                }
                gray
            }
        }
    };
    let gray = sampled.channels() == 1;
    let sample = move |x: i32, y: i32| {
        let p = sampled.get(x, y);
        if gray { [p[0], p[0], p[0], 255] } else { p }
    };
    let layer = ctx.layer(i, edit);
    if target == Target::Mask {
        prepare_mask(layer, canvas);
    }
    let changed = paint::flood_fill(
        raster(layer, target),
        &sample,
        canvas,
        sel.as_ref(),
        seed,
        tolerance,
        contiguous,
        antialias,
        to_rgba8(color),
        opacity,
    );
    if let Some(c) = changed {
        let r = reach(ctx, i, c);
        ctx.dirty(Some(r));
    }
    Ok(())
}

pub(super) fn gradient(
    ctx: &mut Ctx<'_>,
    id: u32,
    target: Target,
    gradient: &Gradient,
    from: (f32, f32),
    to: (f32, f32),
    opacity: f32,
) -> Result<()> {
    let i = ctx.find(id)?;
    let edit = editable(ctx, i, target)?;
    let area = work_area(ctx);
    let sel = selection(ctx).cloned();
    let lock_alpha = target == Target::Pixels && ctx.doc.layer(i).locks.transparency;
    let layer = ctx.layer(i, edit);
    if target == Target::Mask {
        prepare_mask(layer, area);
    }
    let changed = paint::gradient(
        raster(layer, target),
        gradient,
        from,
        to,
        area,
        sel.as_ref(),
        opacity,
        lock_alpha,
    );
    if let Some(c) = changed {
        let r = reach(ctx, i, c);
        ctx.dirty(Some(r));
    }
    Ok(())
}

pub(super) fn clear(ctx: &mut Ctx<'_>, id: u32, target: Target) -> Result<()> {
    let i = ctx.find(id)?;
    let edit = editable(ctx, i, target)?;
    let Some(sel) = selection(ctx).cloned() else {
        return Ok(());
    };
    let area = sel.bounds().unwrap_or_default();
    let background = ctx.doc.layer(i).background;
    let layer = ctx.layer(i, edit);
    let changed = match target {
        // On the Background, clearing paints white.
        Target::Pixels if background => paint::fill(
            &mut layer.pixels,
            area,
            Some(&sel),
            [255, 255, 255, 255],
            1.0,
            false,
        ),
        Target::Pixels => filters::map_pixels(&mut layer.pixels, Some(&sel), &mut |px| px[3] = 0),
        Target::Mask => {
            prepare_mask(layer, area);
            paint::fill(
                raster(layer, target),
                area,
                Some(&sel),
                [0, 0, 0, 255],
                1.0,
                false,
            )
        }
    };
    if target == Target::Pixels {
        layer.pixels.prune();
    }
    if let Some(c) = changed {
        let r = reach(ctx, i, c);
        ctx.dirty(Some(r));
    }
    Ok(())
}

/// Applies an adjustment to a raster's pixels (within the selection).
fn adjust_raster(
    r: &mut Raster,
    sel: Option<&Selection>,
    adjustment: &crate::model::Adjustment,
) -> Option<IRect> {
    let keys: Vec<(i32, i32)> = r.tile_keys().collect();
    let mut changed: Option<IRect> = None;
    let limit = sel.and_then(Selection::bounds);
    for (tx, ty) in keys {
        let rect = r.tile_rect(tx, ty);
        if limit.is_some_and(|l| !l.intersects(&rect)) {
            continue;
        }
        let before = r.tile(tx, ty).map(<[u8]>::to_vec).unwrap_or_default();
        let mut after = before.clone();
        crate::render::adjust::apply(adjustment, &mut after);
        if let Some(sel) = sel {
            for (k, (a, b)) in after
                .chunks_exact_mut(4)
                .zip(before.chunks_exact(4))
                .enumerate()
            {
                let x = rect.x + (k as i32 % rect.w);
                let y = rect.y + (k as i32 / rect.w);
                let c = sel.coverage(x, y) as u32;
                for ch in 0..3 {
                    a[ch] = ((a[ch] as u32 * c + b[ch] as u32 * (255 - c) + 127) / 255) as u8;
                }
                a[3] = b[3];
            }
        }
        r.tile_mut(tx, ty).copy_from_slice(&after);
        changed = Some(changed.map_or(rect, |c| c.union(&rect)));
    }
    changed
}

pub(super) fn filter(ctx: &mut Ctx<'_>, id: u32, target: Target, spec: &FilterSpec) -> Result<()> {
    let i = ctx.find(id)?;
    let edit = editable(ctx, i, target)?;
    let sel = selection(ctx).cloned();
    let layer = ctx.layer(i, edit);
    let r = raster(layer, target);
    let sel = sel.as_ref();
    let changed = match spec {
        FilterSpec::GaussianBlur { radius } => filters::gaussian_blur(r, sel, *radius),
        FilterSpec::UnsharpMask {
            amount,
            radius,
            threshold,
        } => filters::unsharp_mask(r, sel, *amount, *radius, *threshold),
        FilterSpec::AddNoise {
            amount,
            gaussian,
            monochrome,
            seed,
        } => filters::add_noise(r, sel, *amount, *gaussian, *monochrome, *seed),
        FilterSpec::Mosaic { cell } => filters::mosaic(r, sel, *cell),
        FilterSpec::MotionBlur { angle, distance } => {
            filters::motion_blur(r, sel, *angle, *distance)
        }
        FilterSpec::Adjust { adjustment } if r.channels() == 4 => adjust_raster(r, sel, adjustment),
        FilterSpec::Adjust { .. } => None,
        FilterSpec::Desaturate if r.channels() == 4 => filters::map_pixels(r, sel, &mut |px| {
            let y =
                (0.299 * px[0] as f32 + 0.587 * px[1] as f32 + 0.114 * px[2] as f32).round() as u8;
            px[0] = y;
            px[1] = y;
            px[2] = y;
        }),
        FilterSpec::Desaturate => None,
    };
    if let Some(c) = changed {
        let r = reach(ctx, i, c);
        ctx.dirty(Some(r));
    }
    Ok(())
}

pub(super) fn copy_to_layer(ctx: &mut Ctx<'_>, id: u32, cut: bool) -> Result<()> {
    let i = ctx.find(id)?;
    if !ctx.doc.layer(i).kind.has_pixels() {
        return Err(PsdError::invalid(
            "only pixel layers can be copied to a layer",
        ));
    }
    let sel = selection(ctx).cloned();
    let source = ctx.doc.layer(i).pixels.clone();
    let mut copied = source.clone();
    if let Some(sel) = &sel {
        let keys: Vec<(i32, i32)> = copied.tile_keys().collect();
        for (tx, ty) in keys {
            let rect = copied.tile_rect(tx, ty);
            let tile = copied.tile_mut(tx, ty);
            for (k, px) in tile.chunks_exact_mut(4).enumerate() {
                let x = rect.x + (k as i32 % rect.w);
                let y = rect.y + (k as i32 / rect.w);
                let c = sel.coverage(x, y) as u32;
                px[3] = ((px[3] as u32 * c + 127) / 255) as u8;
            }
        }
        copied.prune();
    }
    let name = format!(
        "{} {}",
        ctx.doc.layer(i).name,
        if cut { "cut" } else { "copy" }
    );
    let mut layer = Layer::new(ctx.doc.allocate_id(), name);
    layer.pixels = copied;
    let parent = ctx.doc.layer(i).parent;
    let new = ctx.push_layer(layer);
    attach(ctx, new, parent, Position::Above(id))?;
    if cut && let Some(sel) = &sel {
        let edit = editable(ctx, i, Target::Pixels)?;
        let layer = ctx.layer(i, edit);
        filters::map_pixels(&mut layer.pixels, Some(sel), &mut |px| px[3] = 0);
        layer.pixels.prune();
        ctx.dirty_layer(i);
    }
    ctx.dirty_layer(new);
    Ok(())
}

/// A document holding copies of some layers (and what they hold), for
/// rendering them together.
fn subset(doc: &Document, layers: &[LayerIdx]) -> Document {
    let mut out = Document::new(doc.width, doc.height);
    out.mode = doc.mode;
    out.patterns = doc.patterns.clone();
    out.global_angle = doc.global_angle;
    out.global_altitude = doc.global_altitude;
    fn copy(doc: &Document, out: &mut Document, i: LayerIdx, parent: Option<LayerIdx>) -> LayerIdx {
        let mut l = doc.layer(i).clone();
        l.parent = parent;
        let children = std::mem::take(&mut l.children);
        let at = out.push_layer(l);
        let kids: Vec<LayerIdx> = children
            .into_iter()
            .map(|c| copy(doc, out, c, Some(at)))
            .collect();
        out.layers[at as usize].children = kids;
        at
    }
    for &i in layers {
        let at = copy(doc, &mut out, i, None);
        out.roots.push(at);
    }
    out
}

/// Renders layers together into one raster (no stored composite).
fn render_together(doc: &Document, layers: &[LayerIdx]) -> Raster {
    let temp = subset(doc, layers);
    let Some(area) = temp
        .roots
        .iter()
        .filter_map(|&i| crate::render::visual_bounds(&temp, i))
        .reduce(|a, b| a.union(&b))
    else {
        return Raster::rgba();
    };
    let mut renderer = Renderer::new();
    let rgba = renderer.render(&temp, area, 0);
    Raster::from_region(4, area, &rgba)
}

pub(super) fn merge(ctx: &mut Ctx<'_>, ids: &[u32]) -> Result<()> {
    let found = ctx.find_all(ids);
    let mut layers = paint_sorted(ctx, &super::layers::outermost(ctx, &found));
    if layers.len() == 1 {
        // Merge Down: with the layer below in the same stack.
        let i = layers[0];
        let stack = ctx.doc.siblings(i);
        let at = stack.iter().position(|&s| s == i).unwrap_or(0);
        if at == 0 {
            return Err(PsdError::invalid("there is no layer below to merge into"));
        }
        layers.insert(0, stack[at - 1]);
    }
    let Some(&top) = layers.last() else {
        return Ok(());
    };
    let bottom = layers[0];
    let pixels = render_together(ctx.doc, &layers);
    let name = ctx.doc.layer(top).name.clone();
    let background = ctx.doc.layer(bottom).background;
    let parent = ctx.doc.layer(top).parent;
    let top_id = ctx.doc.layer(top).id;
    for &i in &layers {
        ctx.dirty_layer(i);
    }
    let mut merged = Layer::new(ctx.doc.allocate_id(), name);
    merged.pixels = pixels;
    merged.background = background;
    merged.locks.position = background;
    let new = ctx.push_layer(merged);
    attach(ctx, new, parent, Position::Above(top_id))?;
    let ids: Vec<u32> = layers.iter().map(|&i| ctx.doc.layer(i).id).collect();
    delete(ctx, &ids)?;
    ctx.dirty_layer(new);
    Ok(())
}

pub(super) fn flatten(ctx: &mut Ctx<'_>) -> Result<()> {
    let canvas = ctx.doc.bounds();
    let mut rgba = composite_rgba(ctx.doc, ctx.renderer, canvas);
    // The Background is opaque: flatten over white.
    for px in rgba.chunks_exact_mut(4) {
        let a = px[3] as u32;
        for c in &mut px[..3] {
            *c = ((*c as u32 * a + 255 * (255 - a) + 127) / 255) as u8;
        }
        px[3] = 255;
    }
    let mut bg = Layer::new(ctx.doc.allocate_id(), "Background");
    bg.pixels = Raster::from_region(4, canvas, &rgba);
    bg.background = true;
    bg.locks.position = true;
    let roots: Vec<u32> = ctx.doc.roots.iter().map(|&i| ctx.doc.layer(i).id).collect();
    delete(ctx, &roots)?;
    let new = ctx.push_layer(bg);
    attach(ctx, new, None, Position::Bottom)?;
    ctx.dirty_all();
    Ok(())
}

pub(super) fn rasterize(ctx: &mut Ctx<'_>, ids: &[u32]) -> Result<()> {
    for i in ctx.find_all(ids) {
        let layer = ctx.doc.layer(i);
        let shape = matches!(layer.kind, LayerKind::Fill { .. });
        if !matches!(
            layer.kind,
            LayerKind::Text { .. } | LayerKind::Fill { .. } | LayerKind::SmartObject { .. }
        ) {
            continue;
        }
        // Render the content alone: no pixel mask or style.
        let mut bare = layer.clone();
        bare.mask = None;
        bare.effects = None;
        bare.opacity = 255;
        bare.fill_opacity = 255;
        bare.blend = crate::model::BlendMode::Normal;
        bare.visible = true;
        bare.clipping = false;
        if !shape {
            bare.vector_mask = None;
        }
        let mut temp = subset(ctx.doc, &[]);
        let at = temp.push_layer(bare);
        temp.roots.push(at);
        let area = crate::render::visual_bounds(&temp, at).map_or(ctx.doc.bounds(), |b| {
            b.intersect(&ctx.doc.bounds().outset(4096))
        });
        let mut renderer = Renderer::new();
        let rgba = renderer.render(&temp, area, 0);
        let pixels = Raster::from_region(4, area, &rgba);
        ctx.dirty_layer(i);
        let mut edits = flags::KIND | flags::PIXELS;
        if shape {
            edits |= flags::VECTOR_MASK | flags::FILL;
        }
        let generation = ctx.doc.allocate_id();
        let layer = ctx.layer(i, edits);
        layer.kind = LayerKind::Pixel;
        layer.pixels = pixels;
        if shape {
            layer.vector_mask = None;
        }
        layer.generation = generation;
        ctx.dirty_layer(i);
    }
    Ok(())
}

pub(super) fn place(
    ctx: &mut Ctx<'_>,
    name: &str,
    rect: IRect,
    rgba: &[u8],
    parent: Option<u32>,
    position: Position,
) -> Result<()> {
    if rect.is_empty() || rgba.len() < rect.area() as usize * 4 {
        return Err(PsdError::invalid("the placed image is empty"));
    }
    let parent = parent.map(|p| ctx.find(p)).transpose()?;
    let mut layer = Layer::new(
        ctx.doc.allocate_id(),
        if name.is_empty() { "Layer" } else { name },
    );
    layer.pixels = Raster::from_region(4, rect, rgba);
    let new = ctx.push_layer(layer);
    attach(ctx, new, parent, position)?;
    ctx.dirty_layer(new);
    Ok(())
}
