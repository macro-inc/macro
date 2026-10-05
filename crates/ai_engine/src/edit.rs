//! Editing: operations on the document, applied as undoable steps.
//!
//! Operations ([`Op`], sent as JSON by the web editor) name nodes by id.
//! [`History::apply`] runs a batch as one step: before an operation changes
//! a node it snapshots it, so undo puts back exactly what changed, and a
//! batch that fails part way leaves the document as it was. Steps given
//! the same coalescing key in a row (one drag) undo together. Every change
//! sets the node's edit flags ([`crate::model::flags`]), so saving writes
//! unchanged objects back as the file drew them.

mod nodes;
pub mod shapes;
mod tree;

pub use nodes::text_outlines;
pub use tree::artboard_for;

use crate::build::node_bounds;
use crate::error::{AiError, Result};
use crate::geom::{Affine, PathData, Point, Rect};
use crate::model::{
    AddedImage, Artboard, BlendMode, Document, Node, NodeIdx, Paint, Stroke, TextAlign,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Steps kept for undo.
const UNDO_LIMIT: usize = 200;

/// Where in a stack a node goes.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type", content = "id")]
pub enum Position {
    /// On top.
    #[default]
    Top,
    /// At the bottom.
    Bottom,
    /// Directly above a node.
    Above(u32),
    /// Directly below a node.
    Below(u32),
}

/// Changes to a node's properties (absent fields stay).
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodePatch {
    /// Name.
    pub name: Option<String>,
    /// Hidden.
    pub hidden: Option<bool>,
    /// Locked.
    pub locked: Option<bool>,
    /// Opacity.
    pub opacity: Option<f32>,
    /// Blend mode.
    pub blend: Option<BlendMode>,
    /// A layer's color.
    pub color: Option<[u8; 3]>,
}

/// Changes to a text object (absent fields stay).
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextPatch {
    /// The characters.
    pub text: Option<String>,
    /// Font family.
    pub family: Option<String>,
    /// Font style.
    pub style: Option<String>,
    /// Size.
    pub size: Option<f64>,
    /// Alignment.
    pub align: Option<TextAlign>,
    /// Line height (sizes).
    pub line_height: Option<f64>,
    /// Tracking (thousandths of an em).
    pub tracking: Option<f64>,
    /// Area text width (`Some(None)`: point text).
    #[serde(default, with = "double_option")]
    pub width: Option<Option<f64>>,
}

/// A new object.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(
    rename_all = "camelCase",
    tag = "type",
    rename_all_fields = "camelCase"
)]
pub enum NewNode {
    /// A path in canvas space.
    Path {
        /// Its outline.
        data: PathData,
        /// Fill.
        fill: Option<Paint>,
        /// Stroke.
        stroke: Option<Stroke>,
        /// Even-odd fill rule.
        #[serde(default)]
        even_odd: bool,
    },
    /// A rectangle (rounded when `radius` is set).
    Rect {
        /// Where it is.
        rect: Rect,
        /// Corner radius.
        #[serde(default)]
        radius: f64,
        /// Fill.
        fill: Option<Paint>,
        /// Stroke.
        stroke: Option<Stroke>,
    },
    /// An ellipse in a rectangle.
    Ellipse {
        /// Its bounds.
        rect: Rect,
        /// Fill.
        fill: Option<Paint>,
        /// Stroke.
        stroke: Option<Stroke>,
    },
    /// A regular polygon, or a star when `inner` is set.
    Polygon {
        /// Its bounds.
        rect: Rect,
        /// Corners (points of a star).
        sides: u32,
        /// A star's inner radius as a fraction of the outer.
        inner: Option<f64>,
        /// Fill.
        fill: Option<Paint>,
        /// Stroke.
        stroke: Option<Stroke>,
    },
    /// Text whose first baseline starts at a point.
    Text {
        /// Where the first baseline starts.
        at: Point,
        /// The characters.
        text: String,
        /// Font family.
        family: String,
        /// Font style.
        style: String,
        /// Size.
        size: f64,
        /// Fill.
        fill: Option<Paint>,
        /// Area text width.
        width: Option<f64>,
        /// Alignment.
        #[serde(default)]
        align: TextAlign,
    },
}

/// Boolean path operations.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BooleanMode {
    /// Everything covered by any.
    Unite,
    /// The bottom one minus the others.
    Subtract,
    /// What all of them cover.
    Intersect,
    /// What an odd number of them cover.
    Exclude,
}

/// An editing operation.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "op", rename_all_fields = "camelCase")]
pub enum Op {
    /// Sets properties of nodes.
    SetNode {
        /// The nodes.
        ids: Vec<u32>,
        /// The changes.
        #[serde(flatten)]
        patch: NodePatch,
    },
    /// Sets the fill of paths and text (in groups too).
    SetFill {
        /// The nodes.
        ids: Vec<u32>,
        /// The fill (none when absent).
        fill: Option<Paint>,
    },
    /// Sets the stroke of paths and text (in groups too).
    SetStroke {
        /// The nodes.
        ids: Vec<u32>,
        /// The stroke (none when absent).
        stroke: Option<Stroke>,
    },
    /// Replaces a path's outline (in its own space).
    SetPath {
        /// The path.
        id: u32,
        /// The outline.
        data: PathData,
        /// Even-odd fill rule.
        even_odd: Option<bool>,
    },
    /// Changes text.
    SetText {
        /// The text object.
        id: u32,
        /// The changes.
        #[serde(flatten)]
        patch: TextPatch,
    },
    /// Transforms nodes on the canvas (after what they have).
    Transform {
        /// The nodes.
        ids: Vec<u32>,
        /// Canvas to canvas.
        matrix: Affine,
    },
    /// Sets a node's transform.
    SetTransform {
        /// The node.
        id: u32,
        /// Object space to canvas.
        transform: Affine,
    },
    /// Adds an object.
    Create {
        /// What it is.
        node: NewNode,
        /// The layer or group it goes in (the top unlocked layer when
        /// absent).
        parent: Option<u32>,
        /// Where among the parent's children.
        #[serde(default)]
        position: Position,
    },
    /// Deletes nodes.
    Delete {
        /// The nodes.
        ids: Vec<u32>,
    },
    /// Copies nodes (above each, moved by `offset`).
    Duplicate {
        /// The nodes.
        ids: Vec<u32>,
        /// Canvas offset.
        offset: Option<[f64; 2]>,
    },
    /// Moves nodes into a layer or group.
    Move {
        /// The nodes (kept in their order).
        ids: Vec<u32>,
        /// The new parent (`None`: the nodes are layers, reordered).
        parent: Option<u32>,
        /// Where.
        position: Position,
    },
    /// Groups nodes.
    Group {
        /// The nodes.
        ids: Vec<u32>,
    },
    /// Ungroups groups.
    Ungroup {
        /// The groups.
        ids: Vec<u32>,
    },
    /// Clips the nodes below with the topmost (a path), into a clip group.
    MakeClip {
        /// The nodes.
        ids: Vec<u32>,
    },
    /// Releases clip groups: their clipping path becomes a path again.
    ReleaseClip {
        /// The clip groups.
        ids: Vec<u32>,
    },
    /// Adds a layer.
    NewLayer {
        /// Its name.
        name: Option<String>,
        /// Where among the layers.
        #[serde(default)]
        position: Position,
    },
    /// Turns text into paths.
    Outline {
        /// The text objects.
        ids: Vec<u32>,
    },
    /// Combines paths.
    Boolean {
        /// The paths (bottom first).
        ids: Vec<u32>,
        /// How.
        mode: BooleanMode,
    },
    /// Renames or resizes an artboard.
    SetArtboard {
        /// The artboard.
        id: u32,
        /// Its name.
        name: Option<String>,
        /// Where it is.
        rect: Option<Rect>,
    },
    /// Adds an artboard.
    NewArtboard {
        /// Where it is.
        rect: Rect,
        /// Its name.
        name: Option<String>,
    },
    /// Removes an artboard (its objects stay).
    DeleteArtboard {
        /// The artboard.
        id: u32,
    },
    /// Places an image (its pixels given beside the operation).
    PlaceImage {
        /// Its name.
        name: String,
        /// Where it goes.
        rect: Rect,
        /// The layer or group it goes in.
        parent: Option<u32>,
        /// The image's content hash (the key it is shared by).
        hash: String,
        /// The pixels.
        #[serde(skip)]
        image: Option<AddedImage>,
    },
}

/// What a batch changed.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Applied {
    /// Nodes changed (indices).
    #[serde(skip)]
    pub touched: Vec<NodeIdx>,
    /// Ids of nodes created.
    pub created: Vec<u32>,
    /// The canvas area to draw again.
    pub dirty: Option<Rect>,
    /// Layers, groups, or artboards changed (panels to refresh).
    pub structure: bool,
}

/// Document fields a step snapshots.
#[derive(Clone)]
struct DocState {
    layers: Vec<NodeIdx>,
    artboards: Vec<Artboard>,
    images: BTreeMap<String, AddedImage>,
    edits: u64,
    next_id: u32,
    node_count: usize,
}

impl DocState {
    fn of(doc: &Document) -> DocState {
        DocState {
            layers: doc.layers.clone(),
            artboards: doc.artboards.clone(),
            images: doc.images.clone(),
            edits: doc.edits,
            next_id: doc.next_id,
            node_count: doc.nodes.len(),
        }
    }

    fn restore(self, doc: &mut Document) {
        doc.layers = self.layers;
        doc.artboards = self.artboards;
        doc.images = self.images;
        doc.edits = self.edits;
        doc.next_id = self.next_id;
    }
}

/// An undoable step.
struct Step {
    id: u64,
    key: Option<String>,
    nodes: BTreeMap<NodeIdx, Node>,
    doc: DocState,
    applied: Applied,
}

/// What operations work with.
pub struct Ctx<'a> {
    /// The document.
    pub doc: &'a mut Document,
    saved: &'a mut BTreeMap<NodeIdx, Node>,
    applied: Applied,
}

impl Ctx<'_> {
    /// A node to change: snapshotted once per step; its old bounds are
    /// marked dirty.
    pub fn node(&mut self, i: NodeIdx) -> &mut Node {
        if !self.saved.contains_key(&i) {
            self.saved.insert(i, self.doc.node(i).clone());
            self.dirty_node(i);
            self.applied.touched.push(i);
        }
        self.doc.node_mut(i)
    }

    /// The node with an id (live nodes only).
    pub fn find(&self, id: u32) -> Result<NodeIdx> {
        self.doc
            .find(id)
            .filter(|&i| !self.doc.node(i).removed)
            .ok_or_else(|| AiError::invalid(format!("no node {id}")))
    }

    /// Nodes by id, skipping missing and locked ones.
    pub fn find_all(&self, ids: &[u32]) -> Vec<NodeIdx> {
        ids.iter()
            .filter_map(|&id| self.find(id).ok())
            .filter(|&i| !self.doc.is_locked(i) || self.doc.node(i).is_layer())
            .collect()
    }

    /// Adds a node (undo removes it).
    pub fn push(&mut self, mut node: Node) -> NodeIdx {
        if node.id == 0 {
            node.id = self.doc.allocate_id();
        }
        let id = node.id;
        let mut before = node.clone();
        before.removed = true;
        before.children.clear();
        before.parent = None;
        let i = self.doc.push(node);
        self.saved.insert(i, before);
        self.applied.touched.push(i);
        self.applied.created.push(id);
        self.applied.structure = true;
        i
    }

    /// Marks a node's area dirty.
    pub fn dirty_node(&mut self, i: NodeIdx) {
        if let Some(b) = node_bounds(self.doc, i) {
            self.dirty(b);
        }
    }

    /// Marks a canvas area dirty.
    pub fn dirty(&mut self, r: Rect) {
        let r = r.outset(2.0);
        self.applied.dirty = Some(self.applied.dirty.map_or(r, |d| d.union(&r)));
    }

    /// Marks the layer tree changed.
    pub fn structure(&mut self) {
        self.applied.structure = true;
    }

    /// Marks every touched node's new area dirty.
    fn finish(&mut self) {
        let touched = self.applied.touched.clone();
        for i in touched {
            self.dirty_node(i);
        }
    }
}

/// Undo and redo.
#[derive(Default)]
pub struct History {
    undo: Vec<Step>,
    redo: Vec<Step>,
    next_step: u64,
}

impl History {
    /// A history with nothing in it.
    pub fn new() -> History {
        History::default()
    }

    /// Applies operations as one step (merged with the previous step when
    /// both have the same `coalesce` key). On error the document is left
    /// as it was.
    pub fn apply(
        &mut self,
        doc: &mut Document,
        ops: &[Op],
        coalesce: Option<&str>,
    ) -> Result<Applied> {
        let doc_before = DocState::of(doc);
        let mut saved = BTreeMap::new();
        let result = {
            let mut ctx = Ctx {
                doc: &mut *doc,
                saved: &mut saved,
                applied: Applied::default(),
            };
            ops.iter().try_for_each(|op| run(&mut ctx, op)).map(|()| {
                ctx.finish();
                ctx.applied
            })
        };
        let applied = match result {
            Ok(applied) => applied,
            Err(e) => {
                let count = doc_before.node_count;
                for (i, node) in std::mem::take(&mut saved) {
                    if (i as usize) < count {
                        doc.nodes[i as usize] = node;
                    }
                }
                doc.nodes.truncate(count);
                doc_before.restore(doc);
                return Err(e);
            }
        };
        if saved.is_empty()
            && doc_before.edits == doc.edits
            && doc_before.artboards == doc.artboards
        {
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
            for (i, node) in saved {
                last.nodes.entry(i).or_insert(node);
            }
            merge_applied(&mut last.applied, &applied);
        } else {
            self.next_step += 1;
            self.undo.push(Step {
                id: self.next_step,
                key: coalesce.map(str::to_owned),
                nodes: saved,
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

    /// Forgets every step.
    pub fn clear(&mut self) {
        self.undo.clear();
        self.redo.clear();
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
    into.structure |= more.structure;
}

/// Swaps a step's snapshots with the document's current state; returns
/// the step that swaps them back.
fn swap(doc: &mut Document, step: Step) -> Step {
    let mut current_doc = DocState::of(doc);
    // Nodes added since stay (other people's); only the step's own come
    // and go, by their removed flag.
    current_doc.node_count = doc.nodes.len();
    let mut nodes = BTreeMap::new();
    let mut dirty = step.applied.dirty;
    for (i, node) in step.nodes {
        let at = i as usize;
        if at >= doc.nodes.len() {
            continue;
        }
        if let Some(b) = node_bounds(doc, i) {
            dirty = Some(dirty.map_or(b, |d| d.union(&b)));
        }
        let current = std::mem::replace(&mut doc.nodes[at], node);
        nodes.insert(i, current);
        if let Some(b) = node_bounds(doc, i) {
            dirty = Some(dirty.map_or(b, |d| d.union(&b)));
        }
    }
    let mut applied = step.applied;
    applied.touched = nodes.keys().copied().collect();
    applied.dirty = dirty;
    applied.created.clear();
    applied.structure = true;
    let next_id = doc.next_id;
    // Layers others added since the step stay where they are.
    let mut layers = step.doc.layers.clone();
    for (k, &l) in current_doc.layers.iter().enumerate() {
        if !layers.contains(&l) && !nodes.contains_key(&l) {
            layers.insert(k.min(layers.len()), l);
        }
    }
    let mut restored = step.doc;
    restored.layers = layers;
    restored.restore(doc);
    // Ids are never handed out twice.
    doc.next_id = doc.next_id.max(next_id);
    Step {
        id: step.id,
        key: step.key,
        nodes,
        doc: current_doc,
        applied,
    }
}

fn run(ctx: &mut Ctx<'_>, op: &Op) -> Result<()> {
    match op {
        Op::SetNode { ids, patch } => nodes::set_node(ctx, ids, patch),
        Op::SetFill { ids, fill } => nodes::set_fill(ctx, ids, fill.as_ref()),
        Op::SetStroke { ids, stroke } => nodes::set_stroke(ctx, ids, stroke.as_ref()),
        Op::SetPath { id, data, even_odd } => nodes::set_path(ctx, *id, data, *even_odd),
        Op::SetText { id, patch } => nodes::set_text(ctx, *id, patch),
        Op::Transform { ids, matrix } => nodes::transform(ctx, ids, matrix),
        Op::SetTransform { id, transform } => nodes::set_transform(ctx, *id, transform),
        Op::Create {
            node,
            parent,
            position,
        } => tree::create(ctx, node, *parent, *position).map(|_| ()),
        Op::Delete { ids } => tree::delete(ctx, ids),
        Op::Duplicate { ids, offset } => tree::duplicate(ctx, ids, *offset),
        Op::Move {
            ids,
            parent,
            position,
        } => tree::move_nodes(ctx, ids, *parent, *position),
        Op::Group { ids } => tree::group(ctx, ids),
        Op::Ungroup { ids } => tree::ungroup(ctx, ids),
        Op::MakeClip { ids } => tree::make_clip(ctx, ids),
        Op::ReleaseClip { ids } => tree::release_clip(ctx, ids),
        Op::NewLayer { name, position } => {
            tree::new_layer(ctx, name.as_deref(), *position).map(|_| ())
        }
        Op::Outline { ids } => nodes::outline(ctx, ids),
        Op::Boolean { ids, mode } => nodes::boolean(ctx, ids, *mode),
        Op::SetArtboard { id, name, rect } => tree::set_artboard(ctx, *id, name.as_deref(), *rect),
        Op::NewArtboard { rect, name } => tree::new_artboard(ctx, *rect, name.as_deref()),
        Op::DeleteArtboard { id } => tree::delete_artboard(ctx, *id),
        Op::PlaceImage {
            name,
            rect,
            parent,
            hash,
            image,
        } => tree::place_image(ctx, name, *rect, *parent, hash, image.as_ref()),
    }
}

/// `Option<Option<T>>` fields: absent, `null`, or a value.
mod double_option {
    use serde::{Deserialize, Deserializer, Serialize, Serializer};

    pub fn serialize<T: Serialize, S: Serializer>(
        v: &Option<Option<T>>,
        s: S,
    ) -> Result<S::Ok, S::Error> {
        match v {
            Some(inner) => inner.serialize(s),
            None => s.serialize_none(),
        }
    }

    pub fn deserialize<'de, T: Deserialize<'de>, D: Deserializer<'de>>(
        d: D,
    ) -> Result<Option<Option<T>>, D::Error> {
        Option::<T>::deserialize(d).map(Some)
    }
}

#[cfg(test)]
mod test;
