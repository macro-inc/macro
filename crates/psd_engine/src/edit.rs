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
pub mod paint;
mod pixels;
pub mod select;
pub mod transform;

use crate::error::{PsdError, Result};
use crate::model::{
    Adjustment, BlendMode, BlendRanges, Composite, Document, Effects, Fill, Gradient, Guide, Layer,
    LayerIdx, Locks, Rgb, TextLayer, VectorMask, VectorStroke, flags,
};
use crate::raster::{IRect, Selection};
use crate::render::Renderer;
use paint::{Brush, Stroke};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;
use transform::Interpolation;

/// Where in a stack a layer goes.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type", content = "id")]
pub enum Position {
    /// On top of the stack.
    #[default]
    Top,
    /// At the bottom of the stack.
    Bottom,
    /// Directly above a layer.
    Above(u32),
    /// Directly below a layer.
    Below(u32),
}

/// What a pixel operation changes.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Target {
    /// The layer's pixels.
    #[default]
    Pixels,
    /// The layer's pixel mask.
    Mask,
}

/// What a new pixel mask starts as.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MaskInit {
    /// White: shows everything.
    #[default]
    RevealAll,
    /// Black: hides everything.
    HideAll,
    /// Shows the selection.
    RevealSelection,
    /// Hides the selection.
    HideSelection,
    /// The layer's own transparency.
    Transparency,
}

/// A filter applied to pixels.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum FilterSpec {
    /// Gaussian Blur.
    GaussianBlur {
        /// Radius in pixels.
        radius: f32,
    },
    /// Unsharp Mask.
    UnsharpMask {
        /// Amount (1.0 is 100%).
        amount: f32,
        /// Radius in pixels.
        radius: f32,
        /// Threshold in levels.
        threshold: u8,
    },
    /// Add Noise.
    AddNoise {
        /// Amount, `0..=1`.
        amount: f32,
        /// Gaussian rather than uniform.
        gaussian: bool,
        /// The same noise in every channel.
        monochrome: bool,
        /// Random seed.
        seed: u64,
    },
    /// Mosaic.
    Mosaic {
        /// Cell size in pixels.
        cell: u32,
    },
    /// Motion Blur.
    MotionBlur {
        /// Direction in degrees.
        angle: f32,
        /// Distance in pixels.
        distance: f32,
    },
    /// An adjustment applied to the pixels themselves (Image >
    /// Adjustments).
    Adjust {
        /// The adjustment.
        adjustment: Adjustment,
    },
    /// Desaturate.
    Desaturate,
}

/// What a new layer is.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum NewLayer {
    /// An empty pixel layer.
    Pixel,
    /// An empty group.
    Group,
    /// A fill layer (a shape layer with `path`).
    Fill {
        /// What it paints.
        fill: Fill,
        /// The shape, when a shape layer.
        path: Option<VectorMask>,
        /// The shape's stroke.
        stroke: Option<VectorStroke>,
    },
    /// An adjustment layer.
    Adjustment {
        /// Its settings.
        adjustment: Adjustment,
    },
    /// A text layer.
    Text {
        /// The text.
        text: TextLayer,
    },
}

/// Changes to a layer's simple properties; absent fields stay.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayerPatch {
    /// Name.
    pub name: Option<String>,
    /// Shown.
    pub visible: Option<bool>,
    /// Opacity, `0..=255`.
    pub opacity: Option<u8>,
    /// Fill opacity, `0..=255`.
    pub fill_opacity: Option<u8>,
    /// Blend mode.
    pub blend: Option<BlendMode>,
    /// Clipped to the layer below.
    pub clipping: Option<bool>,
    /// Locks.
    pub locks: Option<Locks>,
    /// Color tag.
    pub color_tag: Option<u8>,
    /// A group is expanded.
    pub open: Option<bool>,
    /// Knockout (0 none, 1 shallow, 2 deep).
    pub knockout: Option<u8>,
    /// Blend Clipped Layers as Group.
    pub blend_clipped_as_group: Option<bool>,
    /// Blend Interior Effects as Group.
    pub blend_interior_as_group: Option<bool>,
    /// Transparency Shapes Layer.
    pub transparency_shapes: Option<bool>,
}

/// Changes to a pixel mask's settings; absent fields stay.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MaskPatch {
    /// Turned off.
    pub disabled: Option<bool>,
    /// Moves with the layer.
    pub linked: Option<bool>,
    /// Density, `0..=1`.
    pub density: Option<f32>,
    /// Feather in pixels.
    pub feather: Option<f32>,
}

/// An edit operation.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "op")]
pub enum Op {
    /// Changes simple properties of layers.
    SetLayer {
        /// Layers.
        ids: Vec<u32>,
        /// The changes.
        #[serde(flatten)]
        patch: LayerPatch,
    },
    /// Adds a layer; the step's `created` reports its id.
    NewLayer {
        /// The group it goes in (`None`: the top level).
        parent: Option<u32>,
        /// Where in that stack.
        #[serde(default)]
        position: Position,
        /// Its name (Photoshop's default when absent).
        name: Option<String>,
        /// What it is.
        kind: NewLayer,
    },
    /// Deletes layers (a group with what it holds).
    Delete {
        /// Layers.
        ids: Vec<u32>,
    },
    /// Copies layers, each just above itself.
    Duplicate {
        /// Layers.
        ids: Vec<u32>,
    },
    /// Moves layers into a stack, keeping their order.
    Move {
        /// Layers.
        ids: Vec<u32>,
        /// The group (`None`: the top level).
        parent: Option<u32>,
        /// Where in that stack.
        position: Position,
    },
    /// Puts layers in a new group where the topmost of them was.
    Group {
        /// Layers.
        ids: Vec<u32>,
        /// The group's name.
        name: Option<String>,
    },
    /// Replaces a group by its layers.
    Ungroup {
        /// The group.
        id: u32,
    },
    /// Merges layers into one pixel layer (the topmost's place and name);
    /// a single layer merges into the one below it.
    Merge {
        /// Layers.
        ids: Vec<u32>,
    },
    /// Flattens every visible layer into a Background layer.
    Flatten,
    /// Turns text, fill, shape, and smart object layers into pixels.
    Rasterize {
        /// Layers.
        ids: Vec<u32>,
    },
    /// Moves layers (and what moves with them) by whole pixels.
    Translate {
        /// Layers (a group moves everything in it).
        ids: Vec<u32>,
        /// Horizontal offset.
        dx: i32,
        /// Vertical offset.
        dy: i32,
    },
    /// Free transform: maps layers through `matrix` (`[a, b, c, d, e, f]`,
    /// canvas `(x, y)` to `(a·x + c·y + e, b·x + d·y + f)`).
    Transform {
        /// Layers.
        ids: Vec<u32>,
        /// The map.
        matrix: [f64; 6],
        /// Resampling.
        #[serde(default)]
        interpolation: Interpolation,
    },
    /// Mirrors layers about the center of their combined bounds.
    Flip {
        /// Layers.
        ids: Vec<u32>,
        /// Left-right rather than top-bottom.
        horizontal: bool,
    },
    /// Turns layers by quarter turns clockwise about the center of their
    /// combined bounds.
    Rotate {
        /// Layers.
        ids: Vec<u32>,
        /// Quarter turns.
        quarters: i32,
    },
    /// Continues a brush stroke (`stroke` names it; send the same `stroke`
    /// with every batch of points, and `done` with the last).
    Paint {
        /// The layer.
        id: u32,
        /// Its pixels or its mask.
        #[serde(default)]
        target: Target,
        /// The stroke.
        stroke: u32,
        /// The brush.
        brush: Brush,
        /// Points: canvas x, y, and pen pressure `0..=1`.
        points: Vec<[f32; 3]>,
        /// The pointer was released.
        #[serde(default)]
        done: bool,
    },
    /// Fills the selection (or the whole layer) with a color.
    Fill {
        /// The layer.
        id: u32,
        /// Its pixels or its mask.
        #[serde(default)]
        target: Target,
        /// The color.
        color: Rgb,
        /// Opacity, `0..=1`.
        opacity: f32,
    },
    /// The paint bucket.
    Bucket {
        /// The layer.
        id: u32,
        /// Its pixels or its mask.
        #[serde(default)]
        target: Target,
        /// Where it was clicked.
        x: i32,
        /// Where it was clicked.
        y: i32,
        /// The color.
        color: Rgb,
        /// Opacity, `0..=1`.
        opacity: f32,
        /// Tolerance in levels.
        tolerance: u8,
        /// Only pixels connected to the click.
        contiguous: bool,
        /// Antialiased edges.
        antialias: bool,
        /// Compares the merged image rather than the layer.
        sample_all: bool,
    },
    /// The gradient tool.
    Gradient {
        /// The layer.
        id: u32,
        /// Its pixels or its mask.
        #[serde(default)]
        target: Target,
        /// The gradient.
        gradient: Gradient,
        /// Start point.
        from: (f32, f32),
        /// End point.
        to: (f32, f32),
        /// Opacity, `0..=1`.
        opacity: f32,
    },
    /// Deletes the selected pixels (on a mask: paints them black).
    Clear {
        /// The layer.
        id: u32,
        /// Its pixels or its mask.
        #[serde(default)]
        target: Target,
    },
    /// Applies a filter (within the selection).
    Filter {
        /// The layer.
        id: u32,
        /// Its pixels or its mask.
        #[serde(default)]
        target: Target,
        /// The filter.
        filter: FilterSpec,
    },
    /// Layer via Copy (or Cut): the selected pixels as a new layer above.
    CopyToLayer {
        /// The layer.
        id: u32,
        /// Removes them from the layer.
        cut: bool,
    },
    /// Adds a pixel mask.
    AddMask {
        /// The layer.
        id: u32,
        /// What it starts as.
        init: MaskInit,
    },
    /// Removes a pixel mask, first applying it to the pixels when `apply`.
    DeleteMask {
        /// The layer.
        id: u32,
        /// Bake it into the layer's transparency.
        apply: bool,
    },
    /// Changes a pixel mask's settings.
    SetMask {
        /// The layer.
        id: u32,
        /// The changes.
        #[serde(flatten)]
        patch: MaskPatch,
    },
    /// Sets or removes a vector mask.
    SetVectorMask {
        /// The layer.
        id: u32,
        /// The mask (`None` removes it).
        mask: Option<VectorMask>,
    },
    /// Replaces a text layer's text (its pixels are laid out again).
    SetText {
        /// The layer.
        id: u32,
        /// The text.
        text: TextLayer,
    },
    /// Changes a fill or shape layer's fill and stroke.
    SetFill {
        /// The layer.
        id: u32,
        /// What it paints.
        fill: Fill,
        /// The shape's stroke (`None` keeps it, `Some(None)` removes it).
        #[serde(default, with = "double_option")]
        stroke: Option<Option<VectorStroke>>,
    },
    /// Changes an adjustment layer's settings.
    SetAdjustment {
        /// The layer.
        id: u32,
        /// Its settings.
        adjustment: Adjustment,
    },
    /// Sets or removes a layer's style.
    SetEffects {
        /// The layer.
        id: u32,
        /// The style (`None` clears it).
        effects: Option<Effects>,
    },
    /// Sets or removes Blend If ranges.
    SetBlendRanges {
        /// The layer.
        id: u32,
        /// The ranges (`None`: everything blends).
        ranges: Option<BlendRanges>,
    },
    /// Crops the canvas (pixels outside stay in the layers).
    Crop {
        /// The new canvas, in current canvas pixels.
        rect: IRect,
    },
    /// Changes the canvas size, keeping pixels where `anchor` says
    /// (`(0, 0)` top left, `(0.5, 0.5)` center).
    CanvasSize {
        /// New width.
        width: u32,
        /// New height.
        height: u32,
        /// Anchor, `0..=1` each.
        anchor: (f32, f32),
    },
    /// Resamples the whole document.
    ImageSize {
        /// New width.
        width: u32,
        /// New height.
        height: u32,
        /// Resampling.
        #[serde(default)]
        interpolation: Interpolation,
    },
    /// Turns the canvas by quarter turns clockwise.
    RotateCanvas {
        /// Quarter turns.
        quarters: i32,
    },
    /// Mirrors the canvas.
    FlipCanvas {
        /// Left-right rather than top-bottom.
        horizontal: bool,
    },
    /// Replaces the ruler guides.
    SetGuides {
        /// Guides.
        guides: Vec<Guide>,
    },
    /// Sets the resolution.
    SetResolution {
        /// Pixels per inch.
        ppi: f64,
    },
    /// Converts a CMYK, Lab, grayscale, indexed, or high-bit document to
    /// 8-bit RGB (Image > Mode), so it can be edited.
    ConvertToRgb,
    /// Places pixels as a new layer (pasting, placing an image).
    Place {
        /// The new layer's name.
        name: String,
        /// Where the pixels go.
        rect: IRect,
        /// Straight RGBA, row by row (not sent as JSON).
        #[serde(skip)]
        rgba: Arc<[u8]>,
        /// The group it goes in.
        parent: Option<u32>,
        /// Where in that stack.
        #[serde(default)]
        position: Position,
    },
}

mod double_option {
    use serde::{Deserialize, Deserializer, Serialize, Serializer};

    pub fn serialize<T: Serialize, S: Serializer>(
        v: &Option<Option<T>>,
        s: S,
    ) -> Result<S::Ok, S::Error> {
        match v {
            None => s.serialize_none(),
            Some(inner) => inner.serialize(s),
        }
    }

    pub fn deserialize<'de, T: Deserialize<'de>, D: Deserializer<'de>>(
        d: D,
    ) -> Result<Option<Option<T>>, D::Error> {
        Option::<T>::deserialize(d).map(Some)
    }
}

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
