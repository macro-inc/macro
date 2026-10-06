//! Editing: operations on the document, applied as undoable steps.
//!
//! Operations ([`Op`], sent as JSON by the web editor) name layers by id.
//! [`History::apply`] runs a batch as one step: before an operation changes
//! a layer it snapshots it (cheap: rasters share their tiles), so undo puts
//! back exactly what changed, and a batch that fails part way leaves the
//! document as it was. Steps given the same coalescing key in a row (one
//! drag, one brush stroke) undo together. Every change sets the layer's
//! edit flags ([`crate::model::flags`]), so saving rewrites only what
//! changed, and marks the canvas area it changed stale in the stored
//! composite.
//!
//! The tools that work on pixels live in submodules: painting, selections,
//! transforms, and filters.

mod canvas;
pub mod filters;
mod layers;
mod ops;
pub mod paint;
mod pixels;
pub mod select;
pub mod transform;

use crate::error::{PsdError, Result};
use crate::model::{Composite, Document, Guide, Layer, LayerIdx, flags};
use crate::raster::{IRect, Selection};
use crate::render::Renderer;
use paint::{Brush, Stroke};
use serde::Serialize;
use std::collections::{BTreeMap, HashMap};

pub use ops::*;

/// What a step changed.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Applied {
    /// Layers it changed (indices).
    #[serde(skip)]
    pub touched: Vec<LayerIdx>,
    /// Ids of layers it created.
    pub created: Vec<u32>,
    /// Canvas area whose pixels may have changed; `None` with `all` for
    /// everything.
    pub dirty: Option<IRect>,
    /// Everything may have changed (canvas size, mode, resampling).
    pub all: bool,
    /// The layer tree changed (layers added, removed, moved, regrouped).
    pub structure: bool,
}

/// Document-level state a step can change.
#[derive(Clone)]
struct DocState {
    width: u32,
    height: u32,
    mode: crate::model::ColorMode,
    depth: u16,
    resolution: f64,
    roots: Vec<LayerIdx>,
    guides: Vec<Guide>,
    composite: Option<Composite>,
    edits: u64,
    layer_count: usize,
}

impl DocState {
    fn of(doc: &Document) -> DocState {
        DocState {
            width: doc.width,
            height: doc.height,
            mode: doc.mode,
            depth: doc.depth,
            resolution: doc.resolution,
            roots: doc.roots.clone(),
            guides: doc.guides.clone(),
            composite: doc.composite.clone(),
            edits: doc.edits,
            layer_count: doc.layers.len(),
        }
    }

    fn restore(self, doc: &mut Document) {
        doc.width = self.width;
        doc.height = self.height;
        doc.mode = self.mode;
        doc.depth = self.depth;
        doc.resolution = self.resolution;
        doc.roots = self.roots;
        doc.guides = self.guides;
        doc.composite = self.composite;
        doc.edits = self.edits;
    }
}

/// One undoable step: the state of what it changed, before it changed.
struct Step {
    id: u64,
    key: Option<String>,
    layers: BTreeMap<LayerIdx, Layer>,
    doc: DocState,
    applied: Applied,
}

/// The context an operation runs in: the document, the snapshots of the
/// step so far, the selection, and what the step changed.
pub(crate) struct Ctx<'a> {
    pub doc: &'a mut Document,
    saved: &'a mut BTreeMap<LayerIdx, Layer>,
    pub selection: &'a Selection,
    pub renderer: &'a mut Renderer,
    pub applied: Applied,
    strokes: &'a mut HashMap<u32, Stroke>,
}

impl Ctx<'_> {
    /// A layer to change: snapshotted first (once per step), flagged
    /// edited with `edit`, and reported touched.
    pub fn layer(&mut self, i: LayerIdx, edit: u64) -> &mut Layer {
        if !self.saved.contains_key(&i) {
            self.saved.insert(i, self.doc.layers[i as usize].clone());
        }
        if !self.applied.touched.contains(&i) {
            self.applied.touched.push(i);
        }
        let layer = &mut self.doc.layers[i as usize];
        layer.edits |= edit;
        layer
    }

    /// The live layer with an id.
    pub fn find(&self, id: u32) -> Result<LayerIdx> {
        self.doc
            .find(id)
            .filter(|&i| !self.doc.layer(i).removed)
            .ok_or_else(|| PsdError::invalid(format!("no layer {id}")))
    }

    /// Live layers by id, in the order given (unknown ids skipped).
    pub fn find_all(&self, ids: &[u32]) -> Vec<LayerIdx> {
        ids.iter().filter_map(|&id| self.find(id).ok()).collect()
    }

    /// Adds a layer to the arena; undo leaves it removed.
    pub fn push_layer(&mut self, mut layer: Layer) -> LayerIdx {
        layer.edits |= flags::CREATED;
        let i = self.doc.push_layer(layer);
        let mut gone = self.doc.layers[i as usize].clone();
        gone.removed = true;
        gone.parent = None;
        self.saved.insert(i, gone);
        self.applied.touched.push(i);
        self.applied.created.push(self.doc.layers[i as usize].id);
        self.applied.structure = true;
        i
    }

    /// Marks a canvas area changed.
    pub fn dirty(&mut self, rect: Option<IRect>) {
        let Some(rect) = rect else { return };
        if rect.is_empty() {
            return;
        }
        self.applied.dirty = Some(self.applied.dirty.map_or(rect, |d| d.union(&rect)));
        if let Some(c) = &mut self.doc.composite {
            c.invalidate(rect);
        }
    }

    /// Marks a layer's visual area (effects included) changed.
    pub fn dirty_layer(&mut self, i: LayerIdx) {
        let r = crate::render::visual_bounds(self.doc, i);
        self.dirty(r);
    }

    /// Marks everything changed.
    pub fn dirty_all(&mut self) {
        self.applied.all = true;
        let all = self.doc.bounds();
        self.dirty(Some(all));
    }

    /// Records that the layer tree changed.
    pub fn structure(&mut self) {
        self.applied.structure = true;
        self.doc.edits |= flags::DOC_LAYERS;
    }

    /// The stack (group children or the top level) a layer is in, to change.
    pub fn stack_of(&mut self, parent: Option<LayerIdx>) -> &mut Vec<LayerIdx> {
        match parent {
            Some(p) => &mut self.layer(p, flags::PARENT).children,
            None => &mut self.doc.roots,
        }
    }

    /// Takes the brush stroke with an id out (started when new); put it
    /// back with [`Ctx::put_stroke`] unless it ended.
    pub fn take_stroke(&mut self, id: u32, brush: &Brush) -> Stroke {
        self.strokes
            .remove(&id)
            .unwrap_or_else(|| Stroke::new(brush.clone()))
    }

    /// Keeps a brush stroke for its next points.
    pub fn put_stroke(&mut self, id: u32, stroke: Stroke) {
        self.strokes.insert(id, stroke);
    }
}

/// Steps kept for undo.
const UNDO_LIMIT: usize = 100;

/// Undo and redo over [`Op`] batches.
#[derive(Default)]
pub struct History {
    undo: Vec<Step>,
    redo: Vec<Step>,
    next_step: u64,
    strokes: HashMap<u32, Stroke>,
}

impl History {
    /// Applies operations as one step (merged with the previous step when
    /// both have the same `coalesce` key). The selection limits pixel
    /// operations. On error the document is left as it was.
    pub fn apply(
        &mut self,
        doc: &mut Document,
        ops: &[Op],
        selection: &Selection,
        renderer: &mut Renderer,
        coalesce: Option<&str>,
    ) -> Result<Applied> {
        let doc_before = DocState::of(doc);
        let mut saved = BTreeMap::new();
        let result = {
            let mut ctx = Ctx {
                doc: &mut *doc,
                saved: &mut saved,
                selection,
                renderer: &mut *renderer,
                applied: Applied::default(),
                strokes: &mut self.strokes,
            };
            ops.iter()
                .try_for_each(|op| run(&mut ctx, op))
                .map(|()| ctx.applied)
        };
        let applied = match result {
            Ok(applied) => applied,
            Err(e) => {
                restore(doc, &mut saved, doc_before);
                return Err(e);
            }
        };
        if saved.is_empty() && doc_before.edits == doc.edits && !applied.all {
            return Ok(applied);
        }
        self.redo.clear();
        let merge = coalesce.is_some()
            && self
                .undo
                .last()
                .is_some_and(|s| s.key.as_deref() == coalesce);
        if merge {
            let last = self.undo.last_mut().expect("checked above");
            for (i, layer) in saved {
                last.layers.entry(i).or_insert(layer);
            }
            merge_applied(&mut last.applied, &applied);
        } else {
            self.next_step += 1;
            self.undo.push(Step {
                id: self.next_step,
                key: coalesce.map(str::to_owned),
                layers: saved,
                doc: doc_before,
                applied: applied.clone(),
            });
            if self.undo.len() > UNDO_LIMIT {
                self.undo.remove(0);
            }
        }
        Ok(applied)
    }

    /// Undoes the last step; returns what it changed.
    pub fn undo(&mut self, doc: &mut Document) -> Option<Applied> {
        let step = self.undo.pop()?;
        self.strokes.clear();
        let back = swap(doc, step);
        let applied = back.applied.clone();
        self.redo.push(back);
        Some(applied)
    }

    /// Redoes the last undone step; returns what it changed.
    pub fn redo(&mut self, doc: &mut Document) -> Option<Applied> {
        let step = self.redo.pop()?;
        let back = swap(doc, step);
        let applied = back.applied.clone();
        self.undo.push(back);
        Some(applied)
    }

    /// Whether there is a step to undo.
    pub fn can_undo(&self) -> bool {
        !self.undo.is_empty()
    }

    /// Whether there is a step to redo.
    pub fn can_redo(&self) -> bool {
        !self.redo.is_empty()
    }

    /// The id of the step undo would undo.
    pub fn undo_step(&self) -> Option<u64> {
        self.undo.last().map(|s| s.id)
    }

    /// The id of the step redo would redo.
    pub fn redo_step(&self) -> Option<u64> {
        self.redo.last().map(|s| s.id)
    }

    /// Forgets every step (after the document is replaced).
    pub fn clear(&mut self) {
        self.undo.clear();
        self.redo.clear();
        self.strokes.clear();
    }
}

fn merge_applied(into: &mut Applied, more: &Applied) {
    for &i in &more.touched {
        if !into.touched.contains(&i) {
            into.touched.push(i);
        }
    }
    into.created.extend(more.created.iter().copied());
    into.dirty = match (into.dirty, more.dirty) {
        (Some(a), Some(b)) => Some(a.union(&b)),
        (a, b) => a.or(b),
    };
    into.all |= more.all;
    into.structure |= more.structure;
}

/// Puts back a failed batch's snapshots.
fn restore(doc: &mut Document, saved: &mut BTreeMap<LayerIdx, Layer>, before: DocState) {
    let count = before.layer_count;
    for (i, layer) in std::mem::take(saved) {
        if (i as usize) < count {
            doc.layers[i as usize] = layer;
        }
    }
    doc.layers.truncate(count);
    before.restore(doc);
}

/// Swaps a step's snapshots with the document's current state; returns
/// the step that swaps them back.
fn swap(doc: &mut Document, step: Step) -> Step {
    let current_doc = DocState::of(doc);
    let mut layers = BTreeMap::new();
    let mut dirty: Option<IRect> = step.applied.dirty;
    for (i, layer) in step.layers {
        let at = i as usize;
        if at >= doc.layers.len() {
            continue;
        }
        let before = crate::render::visual_bounds(doc, i);
        let current = std::mem::replace(&mut doc.layers[at], layer);
        layers.insert(i, current);
        let after = crate::render::visual_bounds(doc, i);
        for r in [before, after].into_iter().flatten() {
            dirty = Some(dirty.map_or(r, |d| d.union(&r)));
        }
    }
    let mut applied = step.applied;
    applied.touched = layers.keys().copied().collect();
    applied.dirty = dirty;
    applied.created.clear();
    let resized = current_doc.width != step.doc.width || current_doc.height != step.doc.height;
    applied.all |= resized;
    step.doc.restore(doc);
    if let (Some(c), Some(r)) = (&mut doc.composite, dirty) {
        c.invalidate(r);
    }
    Step {
        id: step.id,
        key: step.key,
        layers,
        doc: current_doc,
        applied,
    }
}

fn run(ctx: &mut Ctx<'_>, op: &Op) -> Result<()> {
    match op {
        Op::SetLayer { ids, patch } => layers::set_layer(ctx, ids, patch),
        Op::NewLayer {
            parent,
            position,
            name,
            kind,
        } => layers::new_layer(ctx, *parent, *position, name.as_deref(), kind).map(|_| ()),
        Op::Delete { ids } => layers::delete(ctx, ids),
        Op::Duplicate { ids } => layers::duplicate(ctx, ids),
        Op::Move {
            ids,
            parent,
            position,
        } => layers::move_layers(ctx, ids, *parent, *position),
        Op::Group { ids, name } => layers::group(ctx, ids, name.as_deref()),
        Op::Ungroup { id } => layers::ungroup(ctx, *id),
        Op::Merge { ids } => pixels::merge(ctx, ids),
        Op::Flatten => pixels::flatten(ctx),
        Op::Rasterize { ids } => pixels::rasterize(ctx, ids),
        Op::Translate { ids, dx, dy } => canvas::translate(ctx, ids, *dx, *dy),
        Op::Transform {
            ids,
            matrix,
            interpolation,
        } => canvas::transform_layers(ctx, ids, *matrix, *interpolation),
        Op::Flip { ids, horizontal } => canvas::flip_layers(ctx, ids, *horizontal),
        Op::Rotate { ids, quarters } => canvas::rotate_layers(ctx, ids, *quarters),
        Op::Paint {
            id,
            target,
            stroke,
            brush,
            points,
            done,
        } => pixels::paint(ctx, *id, *target, *stroke, brush, points, *done),
        Op::Fill {
            id,
            target,
            color,
            opacity,
        } => pixels::fill(ctx, *id, *target, *color, *opacity),
        Op::Bucket {
            id,
            target,
            x,
            y,
            color,
            opacity,
            tolerance,
            contiguous,
            antialias,
            sample_all,
        } => pixels::bucket(
            ctx,
            *id,
            *target,
            (*x, *y),
            *color,
            *opacity,
            *tolerance,
            *contiguous,
            *antialias,
            *sample_all,
        ),
        Op::Gradient {
            id,
            target,
            gradient,
            from,
            to,
            opacity,
        } => pixels::gradient(ctx, *id, *target, gradient, *from, *to, *opacity),
        Op::Clear { id, target } => pixels::clear(ctx, *id, *target),
        Op::Filter { id, target, filter } => pixels::filter(ctx, *id, *target, filter),
        Op::CopyToLayer { id, cut } => pixels::copy_to_layer(ctx, *id, *cut),
        Op::AddMask { id, init } => layers::add_mask(ctx, *id, *init),
        Op::DeleteMask { id, apply } => layers::delete_mask(ctx, *id, *apply),
        Op::SetMask { id, patch } => layers::set_mask(ctx, *id, patch),
        Op::SetVectorMask { id, mask } => layers::set_vector_mask(ctx, *id, mask.clone()),
        Op::SetText { id, text } => layers::set_text(ctx, *id, text),
        Op::SetFill { id, fill, stroke } => layers::set_fill(ctx, *id, fill, stroke.as_ref()),
        Op::SetAdjustment { id, adjustment } => layers::set_adjustment(ctx, *id, adjustment),
        Op::SetEffects { id, effects } => layers::set_effects(ctx, *id, effects.clone()),
        Op::SetBlendRanges { id, ranges } => layers::set_blend_ranges(ctx, *id, ranges.clone()),
        Op::Crop { rect } => canvas::crop(ctx, *rect),
        Op::CanvasSize {
            width,
            height,
            anchor,
        } => canvas::canvas_size(ctx, *width, *height, *anchor),
        Op::ImageSize {
            width,
            height,
            interpolation,
        } => canvas::image_size(ctx, *width, *height, *interpolation),
        Op::RotateCanvas { quarters } => canvas::rotate_canvas(ctx, *quarters),
        Op::FlipCanvas { horizontal } => canvas::flip_canvas(ctx, *horizontal),
        Op::SetGuides { guides } => {
            ctx.doc.guides = guides.clone();
            ctx.doc.edits |= flags::DOC_GUIDES;
            Ok(())
        }
        Op::SetResolution { ppi } => {
            if !(1.0..=10_000.0).contains(ppi) {
                return Err(PsdError::invalid("resolution out of range"));
            }
            ctx.doc.resolution = *ppi;
            ctx.doc.edits |= flags::DOC_RESOLUTION;
            Ok(())
        }
        Op::ConvertToRgb => canvas::convert_to_rgb(ctx),
        Op::Place {
            name,
            rect,
            rgba,
            parent,
            position,
        } => pixels::place(ctx, name, *rect, rgba, *parent, *position),
    }
}

#[cfg(test)]
mod test;
