//! Layer operations: properties, the layer tree (new, delete, duplicate,
//! move, group, ungroup), masks, and content (text, fills, adjustments,
//! styles).

use super::{Ctx, LayerPatch, MaskInit, MaskPatch, NewLayer, Position};
use crate::error::{PsdError, Result};
use crate::model::{
    Adjustment, BlendMode, BlendRanges, Effects, Fill, Layer, LayerIdx, LayerKind, LayerMask,
    TextLayer, VectorMask, VectorStroke, flags,
};
use crate::raster::{IRect, Raster};

pub(super) fn set_layer(ctx: &mut Ctx<'_>, ids: &[u32], patch: &LayerPatch) -> Result<()> {
    for i in ctx.find_all(ids) {
        ctx.dirty_layer(i);
        let is_group = ctx.doc.layer(i).is_group();
        let layer = ctx.layer(i, 0);
        let mut edits = 0;
        if let Some(name) = &patch.name
            && *name != layer.name
        {
            layer.name = name.clone();
            edits |= flags::NAME;
        }
        if let Some(v) = patch.visible {
            layer.visible = v;
            edits |= flags::VISIBLE;
        }
        if let Some(v) = patch.opacity {
            layer.opacity = v;
            edits |= flags::OPACITY;
        }
        if let Some(v) = patch.fill_opacity {
            layer.fill_opacity = v;
            edits |= flags::FILL_OPACITY;
        }
        if let Some(v) = patch.blend {
            // Pass Through is for groups alone.
            if v != BlendMode::PassThrough || is_group {
                layer.blend = v;
                edits |= flags::BLEND;
            }
        }
        if let Some(v) = patch.clipping
            && !layer.background
        {
            layer.clipping = v;
            edits |= flags::CLIPPING;
        }
        if let Some(v) = patch.locks {
            layer.locks = v;
            edits |= flags::LOCKS;
        }
        if let Some(v) = patch.color_tag {
            layer.color_tag = v.min(7);
            edits |= flags::COLOR_TAG;
        }
        if let (Some(v), LayerKind::Group { open }) = (patch.open, &mut layer.kind) {
            *open = v;
            edits |= flags::OPEN;
        }
        if let Some(v) = patch.knockout {
            layer.knockout = v.min(2);
            edits |= flags::ADVANCED;
        }
        if let Some(v) = patch.blend_clipped_as_group {
            layer.blend_clipped_as_group = v;
            edits |= flags::ADVANCED;
        }
        if let Some(v) = patch.blend_interior_as_group {
            layer.blend_interior_as_group = v;
            edits |= flags::ADVANCED;
        }
        if let Some(v) = patch.transparency_shapes {
            layer.transparency_shapes = v;
            edits |= flags::ADVANCED;
        }
        layer.edits |= edits;
        ctx.dirty_layer(i);
    }
    Ok(())
}

/// The index in `stack` a layer goes at for a position (anchors not in the
/// stack put it on top).
fn slot(ctx: &Ctx<'_>, stack: &[LayerIdx], position: Position) -> usize {
    let anchor = |id: u32| {
        ctx.doc
            .find(id)
            .and_then(|a| stack.iter().position(|&s| s == a))
    };
    match position {
        Position::Top => stack.len(),
        Position::Bottom => 0,
        Position::Above(id) => anchor(id).map_or(stack.len(), |at| at + 1),
        Position::Below(id) => anchor(id).unwrap_or(stack.len()),
    }
}

/// Takes a layer out of its stack.
pub(super) fn detach(ctx: &mut Ctx<'_>, i: LayerIdx) {
    let parent = ctx.doc.layer(i).parent;
    ctx.stack_of(parent).retain(|&c| c != i);
    ctx.layer(i, flags::PARENT).parent = None;
    ctx.structure();
}

/// Puts a detached layer into a stack.
pub(super) fn attach(
    ctx: &mut Ctx<'_>,
    i: LayerIdx,
    parent: Option<LayerIdx>,
    position: Position,
) -> Result<()> {
    if let Some(p) = parent {
        if !ctx.doc.layer(p).is_group() {
            return Err(PsdError::invalid("layers only go inside groups"));
        }
        if ctx.doc.is_within(p, i) {
            return Err(PsdError::invalid("a group cannot go inside itself"));
        }
    }
    let at = slot(ctx, ctx.doc.stack(parent), position);
    let stack = ctx.stack_of(parent);
    let at = at.min(stack.len());
    stack.insert(at, i);
    ctx.layer(i, flags::PARENT).parent = parent;
    ctx.structure();
    Ok(())
}

/// Photoshop's name for the next new layer of a kind ("Layer 3").
fn next_name(ctx: &Ctx<'_>, base: &str) -> String {
    let taken = |n: usize| {
        let name = format!("{base} {n}");
        ctx.doc.layers.iter().any(|l| !l.removed && l.name == name)
    };
    let mut n = 1;
    while taken(n) {
        n += 1;
    }
    format!("{base} {n}")
}

fn parent_index(ctx: &Ctx<'_>, parent: Option<u32>) -> Result<Option<LayerIdx>> {
    parent.map(|p| ctx.find(p)).transpose()
}

pub(super) fn new_layer(
    ctx: &mut Ctx<'_>,
    parent: Option<u32>,
    position: Position,
    name: Option<&str>,
    kind: &NewLayer,
) -> Result<LayerIdx> {
    let parent = parent_index(ctx, parent)?;
    let id = ctx.doc.allocate_id();
    let (default_name, kind_value, vector_mask) = match kind {
        NewLayer::Pixel => (next_name(ctx, "Layer"), LayerKind::Pixel, None),
        NewLayer::Group => (
            next_name(ctx, "Group"),
            LayerKind::Group { open: true },
            None,
        ),
        NewLayer::Fill { fill, path, stroke } => {
            let base = match (path, fill) {
                (Some(_), _) => "Shape",
                (None, Fill::Solid { .. }) => "Color Fill",
                (None, Fill::Gradient { .. }) => "Gradient Fill",
                (None, Fill::Pattern { .. }) => "Pattern Fill",
            };
            (
                next_name(ctx, base),
                LayerKind::Fill {
                    fill: fill.clone(),
                    stroke: stroke.clone().map(Box::new),
                },
                path.clone(),
            )
        }
        NewLayer::Adjustment { adjustment } => (
            next_name(ctx, adjustment.label()),
            LayerKind::Adjustment {
                adjustment: Box::new(adjustment.clone()),
            },
            None,
        ),
        NewLayer::Text { text } => (
            text.text
                .split(['\r', '\n'])
                .next()
                .unwrap_or_default()
                .chars()
                .take(64)
                .collect::<String>(),
            LayerKind::Text {
                text: Box::new(text.clone()),
            },
            None,
        ),
    };
    let mut layer = Layer::new(id, name.map_or(default_name, str::to_owned));
    if layer.name.trim().is_empty() {
        layer.name = next_name(ctx, "Layer");
    }
    if matches!(kind_value, LayerKind::Group { .. }) {
        layer.blend = BlendMode::PassThrough;
    }
    if let LayerKind::Text { text } = &kind_value {
        layer.pixels = crate::text::render(text);
    }
    layer.kind = kind_value;
    layer.vector_mask = vector_mask;
    layer.edits = flags::CREATED;
    let i = ctx.push_layer(layer);
    attach(ctx, i, parent, position)?;
    ctx.dirty_layer(i);
    Ok(i)
}

/// A layer and everything in it, depth first.
pub(super) fn subtree(ctx: &Ctx<'_>, i: LayerIdx) -> Vec<LayerIdx> {
    let mut out = vec![i];
    let mut at = 0;
    while at < out.len() {
        let l = ctx.doc.layer(out[at]);
        if l.is_group() {
            out.extend(l.children.iter().copied());
        }
        at += 1;
    }
    out
}

/// The given layers without those inside another of them.
pub(super) fn outermost(ctx: &Ctx<'_>, layers: &[LayerIdx]) -> Vec<LayerIdx> {
    layers
        .iter()
        .copied()
        .filter(|&i| !layers.iter().any(|&o| o != i && ctx.doc.is_within(i, o)))
        .collect()
}

pub(super) fn delete(ctx: &mut Ctx<'_>, ids: &[u32]) -> Result<()> {
    let layers = ctx.find_all(ids);
    for i in outermost(ctx, &layers) {
        ctx.dirty_layer(i);
        detach(ctx, i);
        for j in subtree(ctx, i) {
            ctx.layer(j, 0).removed = true;
        }
    }
    Ok(())
}

/// Copies a layer (and what it holds) into the arena with new ids; returns
/// the copy, detached.
fn copy_tree(ctx: &mut Ctx<'_>, i: LayerIdx, rename: bool) -> LayerIdx {
    let mut copy = ctx.doc.layer(i).clone();
    copy.id = ctx.doc.allocate_id();
    copy.parent = None;
    copy.children = Vec::new();
    copy.edits = flags::CREATED;
    copy.background = false;
    if copy.locks.position && ctx.doc.layer(i).background {
        copy.locks.position = false;
    }
    if rename {
        copy.name = format!("{} copy", copy.name);
    }
    let children = ctx.doc.layer(i).children.clone();
    let at = ctx.push_layer(copy);
    let kids: Vec<LayerIdx> = children
        .into_iter()
        .map(|c| {
            let k = copy_tree(ctx, c, false);
            ctx.layer(k, flags::PARENT).parent = Some(at);
            k
        })
        .collect();
    ctx.layer(at, 0).children = kids;
    at
}

pub(super) fn duplicate(ctx: &mut Ctx<'_>, ids: &[u32]) -> Result<()> {
    let layers = ctx.find_all(ids);
    for i in outermost(ctx, &layers) {
        let copy = copy_tree(ctx, i, true);
        let parent = ctx.doc.layer(i).parent;
        let id = ctx.doc.layer(i).id;
        attach(ctx, copy, parent, Position::Above(id))?;
        ctx.dirty_layer(copy);
    }
    Ok(())
}

/// Layers in the order they appear bottom to top in the document.
pub(super) fn paint_sorted(ctx: &Ctx<'_>, layers: &[LayerIdx]) -> Vec<LayerIdx> {
    let order = ctx.doc.paint_order();
    let mut out: Vec<LayerIdx> = layers.to_vec();
    out.sort_by_key(|i| order.iter().position(|o| o == i).unwrap_or(usize::MAX));
    out.dedup();
    out
}

pub(super) fn move_layers(
    ctx: &mut Ctx<'_>,
    ids: &[u32],
    parent: Option<u32>,
    position: Position,
) -> Result<()> {
    let parent = parent_index(ctx, parent)?;
    let found = ctx.find_all(ids);
    let layers = paint_sorted(ctx, &outermost(ctx, &found));
    if let Some(p) = parent
        && layers.iter().any(|&i| ctx.doc.is_within(p, i))
    {
        return Err(PsdError::invalid("a group cannot go inside itself"));
    }
    // Insert bottom to top, each above the last, so their order stays.
    let mut position = match position {
        // An anchor among the moved layers falls back to the top.
        Position::Above(a) | Position::Below(a)
            if layers.iter().any(|&i| ctx.doc.layer(i).id == a) =>
        {
            Position::Top
        }
        p => p,
    };
    for i in layers {
        ctx.dirty_layer(i);
        detach(ctx, i);
        attach(ctx, i, parent, position)?;
        position = Position::Above(ctx.doc.layer(i).id);
        ctx.dirty_layer(i);
    }
    Ok(())
}

pub(super) fn group(ctx: &mut Ctx<'_>, ids: &[u32], name: Option<&str>) -> Result<()> {
    let found = ctx.find_all(ids);
    let layers = paint_sorted(ctx, &outermost(ctx, &found));
    let Some(&top) = layers.last() else {
        return Ok(());
    };
    let parent = ctx.doc.layer(top).parent;
    let top_id = ctx.doc.layer(top).id;
    let group = new_layer(
        ctx,
        parent.map(|p| ctx.doc.layer(p).id),
        Position::Above(top_id),
        name,
        &NewLayer::Group,
    )?;
    let group_id = ctx.doc.layer(group).id;
    let moved: Vec<u32> = layers.iter().map(|&i| ctx.doc.layer(i).id).collect();
    move_layers(ctx, &moved, Some(group_id), Position::Top)
}

pub(super) fn ungroup(ctx: &mut Ctx<'_>, id: u32) -> Result<()> {
    let g = ctx.find(id)?;
    if !ctx.doc.layer(g).is_group() {
        return Err(PsdError::invalid("not a group"));
    }
    let parent = ctx.doc.layer(g).parent.map(|p| ctx.doc.layer(p).id);
    let children: Vec<u32> = ctx
        .doc
        .layer(g)
        .children
        .iter()
        .map(|&c| ctx.doc.layer(c).id)
        .collect();
    move_layers(ctx, &children, parent, Position::Below(id))?;
    delete(ctx, &[id])
}

pub(super) fn add_mask(ctx: &mut Ctx<'_>, id: u32, init: MaskInit) -> Result<()> {
    let i = ctx.find(id)?;
    if ctx.doc.layer(i).background {
        return Err(PsdError::invalid("the Background layer cannot have a mask"));
    }
    let canvas = ctx.doc.bounds();
    let selection = ctx.selection.clone();
    let (raster, rect, default_color) = match init {
        MaskInit::RevealAll => (Raster::gray(), IRect::default(), 255),
        MaskInit::HideAll => (Raster::gray(), IRect::default(), 0),
        MaskInit::RevealSelection => {
            let rect = selection.bounds().unwrap_or_default();
            (selection.mask, rect, 0)
        }
        MaskInit::HideSelection => {
            let inverted = super::select::invert(&selection, canvas);
            (inverted.mask, canvas, 255)
        }
        MaskInit::Transparency => {
            let pixels = &ctx.doc.layer(i).pixels;
            let rect = pixels.content_bounds().unwrap_or_default();
            let alpha = super::select::from_alpha(pixels);
            (alpha.mask, rect, 0)
        }
    };
    ctx.dirty_layer(i);
    let generation = ctx.doc.allocate_id();
    ctx.layer(i, flags::MASK | flags::MASK_SETTINGS).mask = Some(LayerMask {
        raster,
        rect,
        default_color,
        disabled: false,
        linked: true,
        density: 1.0,
        feather: 0.0,
        generation,
    });
    ctx.dirty_layer(i);
    Ok(())
}

pub(super) fn delete_mask(ctx: &mut Ctx<'_>, id: u32, apply: bool) -> Result<()> {
    let i = ctx.find(id)?;
    let Some(mask) = ctx.doc.layer(i).mask.clone() else {
        return Ok(());
    };
    ctx.dirty_layer(i);
    if apply && ctx.doc.layer(i).kind.has_pixels() {
        let layer = ctx.layer(i, flags::PIXELS | flags::KIND);
        let keys: Vec<(i32, i32)> = layer.pixels.tile_keys().collect();
        for (tx, ty) in keys {
            let r = layer.pixels.tile_rect(tx, ty);
            let tile = layer.pixels.tile_mut(tx, ty);
            for y in 0..r.h {
                for x in 0..r.w {
                    let m = mask.value(r.x + x, r.y + y) as u32;
                    let a = &mut tile[((y * r.w + x) * 4 + 3) as usize];
                    *a = ((*a as u32 * m + 127) / 255) as u8;
                }
            }
        }
        layer.pixels.prune();
    }
    ctx.layer(i, flags::MASK | flags::MASK_SETTINGS).mask = None;
    ctx.dirty_layer(i);
    Ok(())
}

pub(super) fn set_mask(ctx: &mut Ctx<'_>, id: u32, patch: &MaskPatch) -> Result<()> {
    let i = ctx.find(id)?;
    if ctx.doc.layer(i).mask.is_none() {
        return Err(PsdError::invalid("the layer has no mask"));
    }
    ctx.dirty_layer(i);
    let layer = ctx.layer(i, flags::MASK_SETTINGS);
    let mask = layer.mask.as_mut().expect("checked above");
    if let Some(v) = patch.disabled {
        mask.disabled = v;
    }
    if let Some(v) = patch.linked {
        mask.linked = v;
    }
    if let Some(v) = patch.density {
        mask.density = v.clamp(0.0, 1.0);
    }
    if let Some(v) = patch.feather {
        mask.feather = v.clamp(0.0, 1000.0);
    }
    ctx.dirty_layer(i);
    Ok(())
}

pub(super) fn set_vector_mask(ctx: &mut Ctx<'_>, id: u32, mask: Option<VectorMask>) -> Result<()> {
    let i = ctx.find(id)?;
    ctx.dirty_layer(i);
    ctx.layer(i, flags::VECTOR_MASK).vector_mask = mask;
    ctx.dirty_layer(i);
    Ok(())
}

pub(super) fn set_text(ctx: &mut Ctx<'_>, id: u32, text: &TextLayer) -> Result<()> {
    let i = ctx.find(id)?;
    if !matches!(ctx.doc.layer(i).kind, LayerKind::Text { .. }) {
        return Err(PsdError::invalid("not a text layer"));
    }
    ctx.dirty_layer(i);
    let pixels = crate::text::render(text);
    let generation = ctx.doc.allocate_id();
    let layer = ctx.layer(i, flags::TEXT | flags::PIXELS);
    layer.kind = LayerKind::Text {
        text: Box::new(text.clone()),
    };
    layer.pixels = pixels;
    layer.generation = generation;
    ctx.dirty_layer(i);
    Ok(())
}

pub(super) fn set_fill(
    ctx: &mut Ctx<'_>,
    id: u32,
    fill: &Fill,
    stroke: Option<&Option<VectorStroke>>,
) -> Result<()> {
    let i = ctx.find(id)?;
    let LayerKind::Fill {
        stroke: current, ..
    } = &ctx.doc.layer(i).kind
    else {
        return Err(PsdError::invalid("not a fill or shape layer"));
    };
    let stroke = match stroke {
        Some(s) => s.clone().map(Box::new),
        None => current.clone(),
    };
    ctx.dirty_layer(i);
    ctx.layer(i, flags::FILL).kind = LayerKind::Fill {
        fill: fill.clone(),
        stroke,
    };
    ctx.dirty_layer(i);
    Ok(())
}

pub(super) fn set_adjustment(ctx: &mut Ctx<'_>, id: u32, adjustment: &Adjustment) -> Result<()> {
    let i = ctx.find(id)?;
    if !matches!(ctx.doc.layer(i).kind, LayerKind::Adjustment { .. }) {
        return Err(PsdError::invalid("not an adjustment layer"));
    }
    ctx.dirty_layer(i);
    ctx.layer(i, flags::ADJUSTMENT).kind = LayerKind::Adjustment {
        adjustment: Box::new(adjustment.clone()),
    };
    ctx.dirty_layer(i);
    Ok(())
}

pub(super) fn set_effects(ctx: &mut Ctx<'_>, id: u32, effects: Option<Effects>) -> Result<()> {
    let i = ctx.find(id)?;
    ctx.dirty_layer(i);
    ctx.layer(i, flags::EFFECTS).effects = effects;
    ctx.dirty_layer(i);
    Ok(())
}

pub(super) fn set_blend_ranges(
    ctx: &mut Ctx<'_>,
    id: u32,
    ranges: Option<BlendRanges>,
) -> Result<()> {
    let i = ctx.find(id)?;
    ctx.dirty_layer(i);
    ctx.layer(i, flags::BLEND_RANGES).blend_ranges = ranges.filter(|r| !r.is_default());
    ctx.dirty_layer(i);
    Ok(())
}
