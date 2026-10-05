//! Editing: operations on a [`Document`], with undo and redo.
//!
//! Operations name nodes by their Figma ids (`12:34`) and arrive as JSON
//! from the editor. Each call to [`History::apply`] is one undoable step:
//! every node it touches is snapshotted before its first change, so undo
//! restores those snapshots and redo the ones taken after. Nodes an edit
//! creates start out removed, so undoing their creation removes them again.
//!
//! Edited properties are recorded per node in [`Node::edits`]; saving
//! (see [`crate::save`]) rewrites only those fields of the original file.
//! Instance sublayers (`I…` ids) are not editable here.

use crate::document::{Document, Node, NodeIdx};
use crate::error::{FigError, Result};
use crate::geometry;
use crate::model::{
    Affine, BlendMode, Color, CornerRadii, Effect, EffectKind, Guid, NodeType, Paint, PathRef,
    Props, Rect, StrokeAlign, Vec2,
};
use serde::Deserialize;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

/// Bits of [`Node::edits`].
pub mod flags {
    pub const TRANSFORM: u32 = 1 << 0;
    pub const SIZE: u32 = 1 << 1;
    pub const NAME: u32 = 1 << 2;
    pub const VISIBLE: u32 = 1 << 3;
    pub const LOCKED: u32 = 1 << 4;
    pub const OPACITY: u32 = 1 << 5;
    pub const FILLS: u32 = 1 << 6;
    pub const STROKES: u32 = 1 << 7;
    /// Stroke weight and dashes.
    pub const STROKE_WEIGHT: u32 = 1 << 8;
    pub const STROKE_ALIGN: u32 = 1 << 9;
    pub const RADIUS: u32 = 1 << 10;
    pub const TEXT: u32 = 1 << 11;
    /// Parent or position among siblings.
    pub const PARENT: u32 = 1 << 12;
    pub const BLEND: u32 = 1 << 13;
    pub const CLIP: u32 = 1 << 14;
    /// Fill and stroke geometry replaced (or dropped to be recomputed).
    pub const GEOMETRY: u32 = 1 << 15;
    pub const EFFECTS: u32 = 1 << 16;
    /// The node did not exist in the file.
    pub const CREATED: u32 = 1 << 17;
    /// A page's canvas color.
    pub const BACKGROUND: u32 = 1 << 18;
    /// Auto layout settings of a frame.
    pub const AUTO_LAYOUT: u32 = 1 << 19;
    /// How a layer sits in its auto layout parent.
    pub const LAYOUT_CHILD: u32 = 1 << 20;
    /// How a layer follows its frame when the frame is resized.
    pub const CONSTRAINTS: u32 = 1 << 21;
    /// The node's type changed (a frame made a component, an instance
    /// detached).
    pub const TYPE: u32 = 1 << 22;
    /// Which component an instance shows.
    pub const INSTANCE_OF: u32 = 1 << 23;
    /// An instance's overrides (edits to the layers inside it).
    pub const OVERRIDES: u32 = 1 << 24;
    /// An instance's component property values.
    pub const PROP_ASSIGNMENTS: u32 = 1 << 25;
    /// How open paths end (lines, arrows).
    pub const STROKE_CAP: u32 = 1 << 26;
    /// An instance's derived layout (where its layers are at its size).
    pub const DERIVED: u32 = 1 << 27;
    /// A boolean layer's operation.
    pub const BOOLEAN: u32 = 1 << 28;
    /// A vector layer's network.
    pub const VECTOR: u32 = 1 << 29;
    /// Component properties and variants: a component's (or set's)
    /// property definitions and variant value orders, a variant's values,
    /// a layer's bindings to properties, and nested instances' exposure.
    pub const COMPONENT: u32 = 1 << 30;
    /// Shared styles: the styles a layer uses, and a style node's kind.
    pub const STYLES: u32 = 1 << 31;
}

/// A paint as the editor describes it.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaintSpec {
    /// Keep the node's existing paint at this index (gradients and images
    /// the editor does not rebuild), with the overrides below applied.
    pub keep: Option<usize>,
    /// `RRGGBB` or `RRGGBBAA` for a solid paint.
    pub color: Option<String>,
    /// An image fill: the SHA-1 (hex) of an image added with
    /// [`Document::add_image`], filling the layer.
    pub image: Option<String>,
    pub opacity: Option<f32>,
    pub visible: Option<bool>,
    pub blend_mode: Option<String>,
    /// Switches the paint's kind: `SOLID`, `GRADIENT_LINEAR`,
    /// `GRADIENT_RADIAL`, `GRADIENT_ANGULAR`, or `GRADIENT_DIAMOND` (an image
    /// is set with `image`).
    #[serde(rename = "type")]
    pub kind: Option<String>,
    /// A gradient's stops, replacing its current ones.
    pub stops: Option<Vec<StopSpec>>,
}

/// A gradient stop as the editor describes it.
#[derive(Clone, Debug, Deserialize)]
pub struct StopSpec {
    /// `RRGGBB` or `RRGGBBAA`.
    pub color: String,
    /// Along the gradient, `0..=1`.
    pub position: f32,
}

/// Properties to set; absent fields are left alone.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Patch {
    pub name: Option<String>,
    /// Position of the node's origin relative to its coordinate parent (the
    /// nearest frame-like ancestor; the page for top-level layers), as the
    /// design panel shows it.
    pub x: Option<f64>,
    pub y: Option<f64>,
    pub width: Option<f64>,
    pub height: Option<f64>,
    /// Degrees, counter-clockwise as Figma shows them; about the center.
    pub rotation: Option<f64>,
    pub opacity: Option<f32>,
    pub visible: Option<bool>,
    pub locked: Option<bool>,
    pub fills: Option<Vec<PaintSpec>>,
    pub strokes: Option<Vec<PaintSpec>>,
    pub stroke_weight: Option<f32>,
    /// `INSIDE`, `OUTSIDE`, or `CENTER`.
    pub stroke_align: Option<String>,
    pub corner_radius: Option<f32>,
    pub clip_content: Option<bool>,
    pub blend_mode: Option<String>,
    /// Replaces a text layer's characters (laid out by [`crate::text`]).
    pub characters: Option<String>,
    pub font_size: Option<f32>,
    pub font_family: Option<String>,
    /// Figma's style name: `Regular`, `Semi Bold`, `Bold Italic`…
    pub font_style: Option<String>,
    pub line_height: Option<Measure>,
    pub letter_spacing: Option<Measure>,
    pub paragraph_spacing: Option<f32>,
    /// `LEFT`, `CENTER`, `RIGHT`, or `JUSTIFIED`.
    pub text_align_horizontal: Option<String>,
    /// `TOP`, `CENTER`, or `BOTTOM`.
    pub text_align_vertical: Option<String>,
    /// `WIDTH_AND_HEIGHT`, `HEIGHT`, or `NONE`.
    pub text_auto_resize: Option<String>,
    /// `NONE`, `UNDERLINE`, or `STRIKETHROUGH`.
    pub text_decoration: Option<String>,
    /// `ORIGINAL`, `UPPER`, `LOWER`, or `TITLE`.
    pub text_case: Option<String>,
    /// Auto layout: `HORIZONTAL`, `VERTICAL`, or `NONE` to remove it.
    pub layout_mode: Option<String>,
    pub item_spacing: Option<f32>,
    pub padding_top: Option<f32>,
    pub padding_right: Option<f32>,
    pub padding_bottom: Option<f32>,
    pub padding_left: Option<f32>,
    /// `MIN`, `CENTER`, `MAX`, or `SPACE_BETWEEN` along the flow.
    pub primary_align: Option<String>,
    /// `MIN`, `CENTER`, or `MAX` across it.
    pub counter_align: Option<String>,
    /// How the width follows auto layout: `FIXED`, `HUG` (the content),
    /// or `FILL` (the parent).
    pub sizing_horizontal: Option<String>,
    pub sizing_vertical: Option<String>,
    /// `ABSOLUTE` takes a layer out of its auto layout parent's flow;
    /// `AUTO` puts it back.
    pub layout_positioning: Option<String>,
    /// How the layer follows its frame's resizing: `MIN` (left or top),
    /// `MAX`, `CENTER`, `STRETCH` (both sides), or `SCALE`.
    pub constraint_horizontal: Option<String>,
    pub constraint_vertical: Option<String>,
    /// Replaces the effects, bottom first.
    pub effects: Option<Vec<EffectSpec>>,
    /// `NONE`, `ROUND`, `SQUARE`, `ARROW_LINES`, or `ARROW_EQUILATERAL`.
    pub stroke_cap: Option<String>,
    /// Dash and gap lengths along strokes; empty for a solid stroke.
    pub dash_pattern: Option<Vec<f32>>,
}

/// An effect as the editor describes it: an existing one kept (and
/// adjusted), or a new one (a drop shadow unless `type` says otherwise).
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectSpec {
    pub keep: Option<usize>,
    /// `DROP_SHADOW`, `INNER_SHADOW`, `LAYER_BLUR`, or `BACKGROUND_BLUR`.
    #[serde(rename = "type")]
    pub kind: Option<String>,
    /// `RRGGBB` or `RRGGBBAA`.
    pub color: Option<String>,
    pub x: Option<f64>,
    pub y: Option<f64>,
    pub radius: Option<f32>,
    pub spread: Option<f32>,
    pub visible: Option<bool>,
}

/// The effects `specs` describe, given the layer's current ones.
pub(crate) fn effects_from(existing: &[Effect], specs: &[EffectSpec]) -> Arc<[Effect]> {
    specs
        .iter()
        .filter_map(|s| {
            let mut e = match s.keep {
                Some(k) => existing.get(k)?.clone(),
                None => Effect {
                    kind: EffectKind::DropShadow,
                    visible: true,
                    color: Color {
                        r: 0.0,
                        g: 0.0,
                        b: 0.0,
                        a: 0.25,
                    },
                    offset: Vec2::new(0.0, 4.0),
                    radius: 4.0,
                    spread: 0.0,
                    blend_mode: BlendMode::Normal,
                    show_behind_node: false,
                },
            };
            if let Some(k) = &s.kind {
                e.kind = match k.as_str() {
                    "INNER_SHADOW" => EffectKind::InnerShadow,
                    "LAYER_BLUR" | "FOREGROUND_BLUR" => EffectKind::LayerBlur,
                    "BACKGROUND_BLUR" => EffectKind::BackgroundBlur,
                    _ => EffectKind::DropShadow,
                };
            }
            if let Some(c) = s.color.as_deref().and_then(parse_hex) {
                e.color = c;
            }
            if let Some(x) = s.x {
                e.offset.x = x;
            }
            if let Some(y) = s.y {
                e.offset.y = y;
            }
            if let Some(r) = s.radius {
                e.radius = r.max(0.0);
            }
            if let Some(sp) = s.spread {
                e.spread = sp;
            }
            if let Some(v) = s.visible {
                e.visible = v;
            }
            Some(e)
        })
        .collect()
}

/// A length as the design panel shows it: `PIXELS`, `PERCENT` (of the font
/// size), or `AUTO` (line height only).
#[derive(Clone, Debug, Deserialize)]
pub struct Measure {
    #[serde(default)]
    pub value: f32,
    pub unit: String,
}

impl Patch {
    fn text_change(&self) -> Option<crate::text::Change<'_>> {
        let line_height = self.line_height.as_ref().map(|m| match m.unit.as_str() {
            "PIXELS" => (m.value, "PIXELS"),
            "PERCENT" => (m.value / 100.0, "RAW"),
            _ => (100.0, "PERCENT"),
        });
        let letter_spacing = self.letter_spacing.as_ref().map(|m| match m.unit.as_str() {
            "PERCENT" => (m.value, "PERCENT"),
            _ => (m.value, "PIXELS"),
        });
        let change = crate::text::Change {
            characters: self.characters.as_deref(),
            font_family: self.font_family.as_deref(),
            font_style: self.font_style.as_deref(),
            font_size: self.font_size,
            line_height,
            letter_spacing,
            paragraph_spacing: self.paragraph_spacing,
            align_horizontal: self.text_align_horizontal.as_deref(),
            align_vertical: self.text_align_vertical.as_deref(),
            auto_resize: self.text_auto_resize.as_deref(),
            decoration: self.text_decoration.as_deref(),
            case: self.text_case.as_deref(),
        };
        let any = change.characters.is_some()
            || change.font_family.is_some()
            || change.font_style.is_some()
            || change.font_size.is_some()
            || change.line_height.is_some()
            || change.letter_spacing.is_some()
            || change.paragraph_spacing.is_some()
            || change.align_horizontal.is_some()
            || change.align_vertical.is_some()
            || change.auto_resize.is_some()
            || change.decoration.is_some()
            || change.case.is_some();
        any.then_some(change)
    }
}

/// A layer to create.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewNode {
    /// `FRAME`, `RECTANGLE`, `ELLIPSE`, `TEXT`, `LINE`, `GROUP`.
    #[serde(rename = "type")]
    pub node_type: String,
    pub name: Option<String>,
    /// Page coordinates of the top left.
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    #[serde(default)]
    pub props: Patch,
}

/// How [`Op::Arrange`] moves layers among their siblings.
#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Arrangement {
    Forward,
    Backward,
    Front,
    Back,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase")]
pub enum Op {
    Set {
        ids: Vec<String>,
        props: Patch,
    },
    /// Moves layers by a page-space offset. In an auto layout frame the
    /// layers float where they are put while the others make room, until a
    /// [`Op::Reflow`] (the end of the drag) settles them into the flow.
    Translate {
        ids: Vec<String>,
        dx: f64,
        dy: f64,
    },
    /// Lays out the auto layout frames holding these layers again.
    Reflow {
        ids: Vec<String>,
    },
    /// Figma's "Add auto layout" (⇧A): a frame without it gets it; other
    /// layers are wrapped in a new auto layout frame.
    AutoLayout {
        ids: Vec<String>,
    },
    /// "Create component" (⌥⌘K): a frame becomes a component; other layers
    /// are wrapped in a new one.
    CreateComponent {
        ids: Vec<String>,
    },
    /// Places an instance of a component with its top left at a page point,
    /// on top of `parent` (a page or frame).
    Instantiate {
        component: String,
        parent: String,
        x: f64,
        y: f64,
    },
    /// "Detach instance" (⌥⌘B).
    Detach {
        ids: Vec<String>,
    },
    /// "Flip horizontal" (⇧H) or "Flip vertical" (⇧V): mirrors layers
    /// about their centers.
    Flip {
        ids: Vec<String>,
        #[serde(default)]
        vertical: bool,
    },
    /// Creates a layer in `parent` (a page or layer id), on top unless
    /// `index` (bottom is 0) says otherwise.
    Create {
        parent: String,
        index: Option<usize>,
        node: NewNode,
    },
    Delete {
        ids: Vec<String>,
    },
    /// Moves layers into `parent` at `index`, keeping their page position.
    Reorder {
        ids: Vec<String>,
        parent: String,
        index: usize,
    },
    Arrange {
        ids: Vec<String>,
        how: Arrangement,
    },
    /// Copies layers (with their children) above the originals, offset.
    Duplicate {
        ids: Vec<String>,
        #[serde(default)]
        dx: f64,
        #[serde(default)]
        dy: f64,
    },
    /// Wraps layers in a group (or a frame) in their common parent.
    Group {
        ids: Vec<String>,
        #[serde(default)]
        frame: bool,
    },
    /// Replaces groups (and frames) by their children.
    Ungroup {
        ids: Vec<String>,
    },
    /// Figma's boolean operations (`UNION`, `SUBTRACT`, `INTERSECT`, or
    /// `XOR` for Exclude): the layers become the operands of a boolean
    /// layer; a lone boolean layer takes the operation instead.
    Boolean {
        ids: Vec<String>,
        operation: String,
    },
    /// "Flatten" (⌘E): the layers become one vector layer.
    Flatten {
        ids: Vec<String>,
    },
    /// Creates a vector layer drawing `network` (page coordinates) in
    /// `parent`, on top unless `index` says otherwise.
    CreateVector {
        parent: String,
        index: Option<usize>,
        network: crate::vector::Network,
        name: Option<String>,
        #[serde(default)]
        props: Patch,
    },
    // ---- design systems (see `edit::design`) ------------------------------
    /// Sets a component property of instances (`I…` ids for nested ones):
    /// a boolean, text, or instance swap property by its definition id, or
    /// a variant property by name, which switches to the matching variant.
    SetProperty {
        ids: Vec<String>,
        property: String,
        value: PropertyInput,
    },
    /// "Swap instance": instances show another component, keeping the
    /// overrides that still apply.
    SwapInstance {
        ids: Vec<String>,
        component: String,
    },
    /// "Reset all changes" of instances, or one property's value.
    ResetInstance {
        ids: Vec<String>,
        property: Option<String>,
    },
    /// "Combine as variants": components become the variants of a new
    /// component set.
    CombineAsVariants {
        ids: Vec<String>,
    },
    /// Adds a variant to a component set, copying `from` (or its last).
    AddVariant {
        set: String,
        from: Option<String>,
    },
    /// Adds a variant property to a component set; every variant takes
    /// `value`.
    AddVariantProperty {
        set: String,
        name: String,
        value: String,
    },
    /// Renames a component set's variant property.
    RenameVariantProperty {
        set: String,
        from: String,
        to: String,
    },
    /// Removes a variant property from a component set.
    RemoveVariantProperty {
        set: String,
        name: String,
    },
    /// Sets variants' value of a variant property.
    SetVariantValue {
        ids: Vec<String>,
        property: String,
        value: String,
    },
    /// "Create component property" on a component (or its set): `BOOL`,
    /// `TEXT`, or `INSTANCE_SWAP`, bound to `layer` when given (its value
    /// becomes the default).
    AddComponentProperty {
        component: String,
        name: String,
        kind: String,
        value: Option<PropertyInput>,
        layer: Option<String>,
    },
    /// Renames a component property or changes its default (which the
    /// component's bound layers show).
    EditComponentProperty {
        component: String,
        property: String,
        name: Option<String>,
        value: Option<PropertyInput>,
    },
    DeleteComponentProperty {
        component: String,
        property: String,
    },
    /// Binds a field (`VISIBLE`, `TEXT`, or `INSTANCE_SWAP`) of layers in a
    /// main component to a property, or unbinds it (`property` absent).
    BindProperty {
        ids: Vec<String>,
        field: String,
        property: Option<String>,
    },
    /// Shows (or stops showing) nested instances' properties on the
    /// instances of the component holding them.
    ExposeInstance {
        ids: Vec<String>,
        exposed: bool,
    },
    /// Applies a shared style (`FILL`, `STROKE`, `TEXT`, or `EFFECT`) to
    /// layers, or detaches it (`style` absent), keeping the values.
    ApplyStyle {
        ids: Vec<String>,
        kind: String,
        style: Option<String>,
    },
    /// Creates a local style from a layer's fills (`FILL`), strokes
    /// (`STROKE`, a color style too), type (`TEXT`), or effects (`EFFECT`),
    /// and applies it to the layer.
    CreateStyle {
        kind: String,
        name: String,
        from: String,
    },
    /// Changes a style; every layer using it follows.
    EditStyle {
        style: String,
        name: Option<String>,
        #[serde(default)]
        props: Patch,
    },
    /// Replaces a layer's network (page coordinates); other shapes become
    /// vector layers, as editing their points does in Figma.
    SetVector {
        id: String,
        network: crate::vector::Network,
    },
    /// Deletes local styles; layers using them keep their values.
    DeleteStyle {
        ids: Vec<String>,
    },
    /// Binds paint `index` of layers' fills (`FILL`) or strokes (`STROKE`)
    /// to a color variable, or unbinds it (`variable` absent).
    BindVariable {
        ids: Vec<String>,
        field: String,
        index: usize,
        variable: Option<String>,
    },
    /// Makes frames use a mode of a variable collection (or inherit one,
    /// `mode` absent).
    SetVariableMode {
        ids: Vec<String>,
        collection: String,
        mode: Option<String>,
    },
}

/// A component property value as the editor sends it: `{"bool": true}`,
/// `{"text": "Label"}`, `{"component": "12:34"}`, or `{"variant": "Large"}`.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PropertyInput {
    Bool(bool),
    Text(String),
    Component(String),
    Variant(String),
}

/// What an applied step changed.
#[derive(Debug, Default)]
pub struct Applied {
    /// Every node the step changed (including created and removed ones).
    pub touched: Vec<NodeIdx>,
    /// Ids of created layers, in operation order (for selecting them).
    pub created: Vec<String>,
}

struct Step {
    before: Vec<(NodeIdx, Node)>,
    after: Vec<(NodeIdx, Node)>,
    coalesce: Option<String>,
}

/// The undo and redo stacks of one editing session.
#[derive(Default)]
pub struct History {
    undo: Vec<Step>,
    redo: Vec<Step>,
}

const MAX_UNDO: usize = 200;

/// Snapshots nodes before their first change in a step.
struct Txn<'a> {
    doc: &'a mut Document,
    before: Vec<(NodeIdx, Node)>,
    seen: HashSet<NodeIdx>,
    created: Vec<String>,
    /// Layers being dragged: auto layout leaves them where they are.
    floating: HashSet<NodeIdx>,
    /// Layers whose auto layout parents lay out again regardless.
    relayout: Vec<NodeIdx>,
}

mod components;
mod design;
mod flip;
mod instance_layout;
mod overrides;
mod paint;
mod paste;
pub mod shapes;
pub(crate) use design::parse_variant_name;
pub(crate) use overrides::guid_of;
pub use paste::{At, PasteSpec, View};
pub(crate) mod layout;

impl<'a> Txn<'a> {
    fn touch(&mut self, i: NodeIdx) -> &mut Node {
        if self.seen.insert(i) {
            self.before.push((i, self.doc.nodes[i as usize].clone()));
        }
        &mut self.doc.nodes[i as usize]
    }

    fn edit(&mut self, i: NodeIdx, flag: u32) -> &mut Props {
        let node = self.touch(i);
        node.edits |= flag;
        &mut node.props
    }

    fn resolve(&self, id: &str) -> Result<NodeIdx> {
        let i = self.resolve_any(id)?;
        if self.doc.node(i).removed {
            return Err(FigError::NoSuchNode(id.into()));
        }
        Ok(i)
    }

    /// Like [`Txn::resolve`], but deleted layers resolve too (pasting what
    /// was cut).
    fn resolve_any(&self, id: &str) -> Result<NodeIdx> {
        if id.starts_with('I') {
            return Err(FigError::Unsupported(
                "layers inside an instance cannot be edited".into(),
            ));
        }
        let guid = Guid::parse(id).ok_or_else(|| FigError::NoSuchNode(id.into()))?;
        self.doc
            .find(guid)
            .ok_or_else(|| FigError::NoSuchNode(id.into()))
    }

    fn resolve_all(&self, ids: &[String]) -> Result<Vec<NodeIdx>> {
        let mut out = Vec::with_capacity(ids.len());
        for id in ids {
            let i = self.resolve(id)?;
            if !out.contains(&i) {
                out.push(i);
            }
        }
        Ok(out)
    }

    /// Editable layers only (not pages or the document).
    fn layers(&self, ids: &[String]) -> Result<Vec<NodeIdx>> {
        let all = self.resolve_all(ids)?;
        Ok(all
            .into_iter()
            .filter(|&i| {
                !matches!(
                    self.doc.props(i).node_type(),
                    NodeType::Canvas | NodeType::Document
                ) && self.doc.node(i).parent.is_some()
            })
            .collect())
    }

    // ---- structure -------------------------------------------------------

    fn detach(&mut self, i: NodeIdx) {
        if let Some(p) = self.doc.node(i).parent {
            self.touch(p).children.retain(|&c| c != i);
        }
        self.touch(i).parent = None;
    }

    /// Inserts `i` into `parent` at `index` (0 = bottom), keeping its page
    /// transform when `keep_world`.
    fn attach(&mut self, i: NodeIdx, parent: NodeIdx, index: usize, keep_world: bool) {
        let world = self.doc.world(i);
        self.detach(i);
        let len = self.doc.node(parent).children.len();
        let index = index.min(len);
        self.touch(parent).children.insert(index, i);
        self.touch(i).parent = Some(parent);
        self.edit(i, flags::PARENT);
        let parent_guid = self.doc.props(parent).guid;
        self.edit(i, flags::PARENT).parent = parent_guid;
        if keep_world {
            let parent_world = self.doc.world(parent);
            let local = parent_world.invert().unwrap_or_default().mul(&world);
            self.edit(i, flags::TRANSFORM).transform = Some(local);
        }
        self.position(parent, index);
    }

    /// Gives the child at `index` a position string between its neighbors,
    /// renumbering the siblings when there is no room.
    fn position(&mut self, parent: NodeIdx, index: usize) {
        let children = self.doc.node(parent).children.clone();
        let pos = |doc: &Document, at: Option<usize>| {
            at.and_then(|a| children.get(a))
                .and_then(|&c| doc.props(c).position.clone())
        };
        let lo = index.checked_sub(1).and_then(|a| pos(self.doc, Some(a)));
        let hi = pos(self.doc, Some(index + 1));
        let lo_s = lo.as_deref().unwrap_or("");
        if let Some(p) = between(lo_s, hi.as_deref()) {
            self.edit(children[index], flags::PARENT).position = Some(p.into());
            return;
        }
        // No room between the neighbors (or they are out of order):
        // renumber every sibling.
        let mut last = String::new();
        for &c in &children {
            let p = between(&last, None).unwrap_or_else(|| format!("{last}O"));
            self.edit(c, flags::PARENT).position = Some(p.as_str().into());
            last = p;
        }
    }

    // ---- geometry --------------------------------------------------------

    /// The nearest frame-like ancestor, whose space x and y are shown in.
    fn coordinate_parent(&self, i: NodeIdx) -> Option<NodeIdx> {
        let mut at = self.doc.node(i).parent?;
        loop {
            let t = self.doc.props(at).node_type();
            if matches!(t, NodeType::Canvas | NodeType::Document) {
                return None;
            }
            if t.is_frame_like() || t == NodeType::BooleanOperation {
                return Some(at);
            }
            at = self.doc.node(at).parent?;
        }
    }

    fn translate(&mut self, i: NodeIdx, dx: f64, dy: f64) {
        if dx == 0.0 && dy == 0.0 {
            return;
        }
        let parent_world = self
            .doc
            .node(i)
            .parent
            .map(|p| self.doc.world(p))
            .unwrap_or_default();
        let inv = parent_world.invert().unwrap_or_default();
        // The page offset in the parent's space (linear part only).
        let d = Vec2::new(inv.m00 * dx + inv.m01 * dy, inv.m10 * dx + inv.m11 * dy);
        let mut t = self.doc.props(i).transform();
        t.m02 += d.x;
        t.m12 += d.y;
        self.edit(i, flags::TRANSFORM).transform = Some(t);
    }

    fn set_position(&mut self, i: NodeIdx, x: Option<f64>, y: Option<f64>) {
        let origin = self.doc.world(i).apply(Vec2::default());
        let space = self
            .coordinate_parent(i)
            .map(|p| self.doc.world(p))
            .unwrap_or_default();
        let current = space.invert().unwrap_or_default().apply(origin);
        let target = space.apply(Vec2::new(x.unwrap_or(current.x), y.unwrap_or(current.y)));
        self.translate(i, target.x - origin.x, target.y - origin.y);
    }

    fn set_rotation(&mut self, i: NodeIdx, degrees: f64) {
        let props = self.doc.props(i);
        let size = props.size();
        let t = props.transform();
        let center = t.apply(Vec2::new(size.x / 2.0, size.y / 2.0));
        // Figma's rotation is counter-clockwise in a y-down space.
        let r = Affine::rotate(-degrees.to_radians());
        let mut next = r;
        let c = next.apply(Vec2::new(size.x / 2.0, size.y / 2.0));
        next.m02 = center.x - c.x;
        next.m12 = center.y - c.y;
        self.edit(i, flags::TRANSFORM).transform = Some(next);
    }

    fn resize(&mut self, i: NodeIdx, width: Option<f64>, height: Option<f64>) {
        let props = self.doc.props(i);
        let old = props.size();
        // An axis left alone keeps its size (a flat vector stays flat).
        let w = width.map_or(old.x, |w| w.max(0.01));
        // Lines have no height.
        let min_h = if props.node_type() == NodeType::Line {
            0.0
        } else {
            0.01
        };
        let h = height.map_or(old.y, |h| h.max(min_h));
        if (w - old.x).abs() < 1e-9 && (h - old.y).abs() < 1e-9 {
            return;
        }
        let node_type = props.node_type();
        self.apply_constraints(i, old, Vec2::new(w, h));
        let props = self.doc.props(i);
        let sx = if old.x > 0.0 { w / old.x } else { 1.0 };
        let sy = if old.y > 0.0 { h / old.y } else { 1.0 };
        let fill = props.fill_geometry.clone();
        let stroke = props.stroke_geometry.clone();
        self.edit(i, flags::SIZE).size = Some(Vec2::new(w, h));
        let boxy = node_type.is_frame_like()
            || matches!(
                node_type,
                NodeType::Rectangle | NodeType::RoundedRectangle | NodeType::Ellipse
            );
        if node_type == NodeType::Text {
            return;
        }
        if boxy {
            // Rebuilt from the size when drawn.
            let p = self.edit(i, flags::GEOMETRY);
            p.fill_geometry = None;
            p.stroke_geometry = None;
            return;
        }
        let scale = Affine::scale(sx, sy);
        let fill = fill.map(|g| self.scaled(&g, &scale));
        let stroke = stroke.map(|g| self.scaled(&g, &scale));
        let p = self.edit(i, flags::GEOMETRY);
        p.fill_geometry = fill;
        p.stroke_geometry = stroke;
        // A network scales with the size; its strokes keep their weight.
        if self.doc.props(i).vector_data.is_some() {
            self.vector_geometry(i);
        }
    }

    fn scaled(&mut self, paths: &[PathRef], t: &Affine) -> Arc<[PathRef]> {
        paths
            .iter()
            .filter_map(|r| {
                let path = self.doc.blobs.path(r.blob)?;
                let scaled = path.path.clone().transform(t.to_skia())?;
                let blob = self.doc.blobs.push(&geometry::encode_blob(&scaled));
                Some(PathRef { blob, ..*r })
            })
            .collect()
    }

    // ---- properties ------------------------------------------------------

    fn paints(existing: &[Paint], specs: &[PaintSpec]) -> Arc<[Paint]> {
        paint::paints(existing, specs)
    }

    fn set(&mut self, i: NodeIdx, patch: &Patch) -> Result<()> {
        if let Some(name) = &patch.name {
            self.edit(i, flags::NAME).name = Some(name.as_str().into());
        }
        if let Some(v) = patch.visible {
            self.edit(i, flags::VISIBLE).visible = Some(v);
        }
        if let Some(v) = patch.locked {
            self.edit(i, flags::LOCKED).locked = Some(v);
        }
        if let Some(v) = patch.opacity {
            self.edit(i, flags::OPACITY).opacity = Some(v.clamp(0.0, 1.0));
        }
        if let Some(b) = &patch.blend_mode {
            self.edit(i, flags::BLEND).blend_mode = Some(BlendMode::parse(b));
        }
        if let Some(specs) = &patch.fills {
            let fills = Self::paints(self.doc.props(i).fills(), specs);
            let p = self.edit(i, flags::FILLS);
            p.fills = Some(fills);
            // Fills now draw directly; drop a shared style reference.
            p.fill_style = None;
        }
        if let Some(specs) = &patch.strokes {
            let strokes = Self::paints(self.doc.props(i).strokes(), specs);
            let p = self.edit(i, flags::STROKES);
            p.strokes = Some(strokes);
            p.stroke_style = None;
        }
        if let Some(w) = patch.stroke_weight {
            self.edit(i, flags::STROKE_WEIGHT | flags::GEOMETRY)
                .stroke_weight = Some(w.max(0.0));
            self.drop_stroke_geometry(i);
        }
        if let Some(a) = &patch.stroke_align {
            self.edit(i, flags::STROKE_ALIGN).stroke_align = Some(match a.as_str() {
                "INSIDE" => StrokeAlign::Inside,
                "OUTSIDE" => StrokeAlign::Outside,
                _ => StrokeAlign::Center,
            });
            self.drop_stroke_geometry(i);
        }
        if let Some(r) = patch.corner_radius {
            let p = self.edit(i, flags::RADIUS | flags::GEOMETRY);
            p.corner_radius = Some(r.max(0.0));
            p.corner_radii = Some(CornerRadii::uniform(r.max(0.0)));
            p.fill_geometry = None;
            p.stroke_geometry = None;
        }
        if patch.constraint_horizontal.is_some() || patch.constraint_vertical.is_some() {
            let (h, v) = self
                .doc
                .props(i)
                .constraints
                .clone()
                .unwrap_or_else(|| ("MIN".into(), "MIN".into()));
            let pick = |new: &Option<String>, old: Arc<str>| -> Arc<str> {
                new.as_deref().map(Into::into).unwrap_or(old)
            };
            self.edit(i, flags::CONSTRAINTS).constraints = Some((
                pick(&patch.constraint_horizontal, h),
                pick(&patch.constraint_vertical, v),
            ));
        }
        if let Some(cap) = &patch.stroke_cap {
            self.edit(i, flags::STROKE_CAP | flags::GEOMETRY).stroke_cap =
                Some(cap.as_str().into());
            self.drop_stroke_geometry(i);
        }
        if let Some(dashes) = &patch.dash_pattern {
            let dashes: Vec<f32> = dashes.iter().map(|d| d.max(0.0)).collect();
            self.edit(i, flags::STROKE_WEIGHT | flags::GEOMETRY)
                .dash_pattern = (!dashes.is_empty()).then(|| dashes.into());
            self.drop_stroke_geometry(i);
        }
        if let Some(specs) = &patch.effects {
            let effects = effects_from(self.doc.props(i).effects(), specs);
            let p = self.edit(i, flags::EFFECTS);
            p.effects = Some(effects);
            p.effect_style = None;
        }
        if let Some(c) = patch.clip_content {
            self.edit(i, flags::CLIP).clip_disabled = Some(!c);
        }
        let text = self.doc.props(i).node_type() == NodeType::Text;
        let text_sizing = self.set_layout(i, patch);
        let mut resized_text = None;
        if patch.width.is_some() || patch.height.is_some() {
            let before = self.doc.props(i).size();
            self.resize(i, patch.width, patch.height);
            let after = self.doc.props(i).size();
            if before != after && self.doc.props(i).node_type() == NodeType::Instance {
                self.relayout_instance(i, before, &[])?;
            }
            if text && before != after {
                // Figma: dragging a width fixes it; a height fixes both.
                let auto = self
                    .doc
                    .props(i)
                    .text_style
                    .as_ref()
                    .and_then(|s| s.auto_resize.clone());
                resized_text = Some(if (after.y - before.y).abs() > 1e-9 {
                    "NONE"
                } else if auto.as_deref() == Some("WIDTH_AND_HEIGHT") {
                    "HEIGHT"
                } else {
                    auto.as_deref().map_or("NONE", |a| match a {
                        "HEIGHT" => "HEIGHT",
                        _ => "NONE",
                    })
                });
            }
        }
        if let Some(r) = patch.rotation {
            self.set_rotation(i, r);
        }
        if patch.x.is_some() || patch.y.is_some() {
            self.set_position(i, patch.x, patch.y);
        }
        if text {
            self.detach_text_style(i, patch);
            let mut change = patch.text_change();
            if let Some(auto) = text_sizing {
                change.get_or_insert_with(Default::default).auto_resize = Some(auto);
                resized_text = None;
            }
            if let Some(auto) = resized_text {
                // Text in a missing font keeps Figma's layout when resized.
                let family = self
                    .doc
                    .props(i)
                    .text_style
                    .as_ref()
                    .and_then(|s| s.font_family.clone());
                let edited = self.doc.node(i).edits & flags::TEXT != 0;
                if change.is_some() || edited || family.as_deref().is_none_or(crate::text::has_font)
                {
                    let c = change.get_or_insert_with(Default::default);
                    c.auto_resize = c.auto_resize.or(Some(auto));
                }
            }
            if let Some(change) = change {
                // Snapshot before the layout changes the node.
                self.touch(i).edits |= flags::TEXT | flags::SIZE;
                crate::text::edit(self.doc, i, &change)?;
            }
        }
        Ok(())
    }

    fn drop_stroke_geometry(&mut self, i: NodeIdx) {
        // Stroke outlines are precomputed for one weight and alignment;
        // without them the stroke is drawn from the shape.
        if self.doc.props(i).node_type() == NodeType::Text || self.redraw_stroke(i) {
            return;
        }
        self.edit(i, flags::GEOMETRY).stroke_geometry = None;
    }

    // ---- creation --------------------------------------------------------

    fn new_node(&mut self, props: Props) -> NodeIdx {
        let i = self.doc.nodes.len() as NodeIdx;
        let guid = props.guid.expect("new nodes have ids");
        // Before its creation the node has only its id (undo keeps it).
        self.doc.nodes.push(Node {
            props: Props {
                guid: Some(guid),
                ..Props::default()
            },
            parent: None,
            children: Vec::new(),
            edits: flags::CREATED,
            removed: true,
            source: None,
        });
        self.doc.by_guid.insert(guid, i);
        let node = self.touch(i);
        node.props = props;
        node.removed = false;
        node.edits = u32::MAX;
        i
    }

    fn create(&mut self, parent: NodeIdx, index: Option<usize>, spec: &NewNode) -> Result<NodeIdx> {
        let node_type = NodeType::parse(&spec.node_type);
        let siblings = self.doc.node(parent).children.len();
        let count = self
            .doc
            .node(parent)
            .children
            .iter()
            .filter(|&&c| self.doc.props(c).node_type() == node_type)
            .count();
        let label = match node_type {
            NodeType::RoundedRectangle => "Rectangle",
            NodeType::Line => "Line",
            _ => node_type.label(),
        };
        let guid = self.doc.new_guid();
        let gray = Color {
            r: 0.851,
            g: 0.851,
            b: 0.851,
            a: 1.0,
        };
        if node_type == NodeType::Canvas {
            let guid = self.doc.new_guid();
            let count = self.live_pages();
            let props = Props {
                guid: Some(guid),
                node_type: Some(NodeType::Canvas),
                name: Some(
                    spec.name
                        .clone()
                        .unwrap_or_else(|| format!("Page {}", count + 1))
                        .into(),
                ),
                visible: Some(true),
                opacity: Some(1.0),
                background_color: Some(Color {
                    r: 0.961,
                    g: 0.961,
                    b: 0.961,
                    a: 1.0,
                }),
                ..Props::default()
            };
            let i = self.new_node(props);
            self.attach(i, parent, index.unwrap_or(siblings), false);
            self.created.push(guid.to_string());
            return Ok(i);
        }
        let (fills, strokes): (Vec<Paint>, Vec<Paint>) = match node_type {
            NodeType::Frame | NodeType::Symbol => (vec![Paint::solid(Color::WHITE)], vec![]),
            NodeType::Text => (vec![Paint::solid(Color::BLACK)], vec![]),
            NodeType::Line => (vec![], vec![Paint::solid(Color::BLACK)]),
            NodeType::Group => (vec![], vec![]),
            _ => (vec![Paint::solid(gray)], vec![]),
        };
        let props = Props {
            guid: Some(guid),
            node_type: Some(node_type),
            name: Some(
                spec.name
                    .clone()
                    .unwrap_or_else(|| format!("{label} {}", count + 1))
                    .into(),
            ),
            visible: Some(true),
            locked: Some(false),
            opacity: Some(1.0),
            blend_mode: Some(BlendMode::PassThrough),
            size: Some(Vec2::new(
                spec.width.max(0.01),
                if node_type == NodeType::Line {
                    0.0
                } else {
                    spec.height.max(0.01)
                },
            )),
            transform: Some(Affine::IDENTITY),
            fills: Some(fills.into()),
            strokes: Some(strokes.into()),
            stroke_weight: Some(1.0),
            stroke_align: Some(match node_type {
                NodeType::Frame | NodeType::Rectangle | NodeType::Ellipse => StrokeAlign::Inside,
                _ => StrokeAlign::Center,
            }),
            corner_radius: Some(0.0),
            ..Props::default()
        };
        let i = self.new_node(props);
        self.attach(i, parent, index.unwrap_or(siblings), false);
        // Place it: the spec is in page coordinates.
        let parent_world = self.doc.world(parent);
        let local = parent_world
            .invert()
            .unwrap_or_default()
            .mul(&Affine::translate(spec.x, spec.y));
        self.edit(i, flags::TRANSFORM).transform = Some(local);
        let mut patch = spec.props.clone();
        if node_type == NodeType::Text {
            patch.characters.get_or_insert_with(String::new);
            patch.font_size.get_or_insert(12.0);
        }
        // The spec's size is already set; a text box sizes itself.
        patch.width = None;
        patch.height = None;
        self.set(i, &patch)?;
        self.created.push(guid.to_string());
        Ok(i)
    }

    /// Copies `i` and its subtree into `parent` at `index`.
    fn copy_tree(&mut self, i: NodeIdx, parent: NodeIdx, index: usize) -> NodeIdx {
        let mut props = self.doc.props(i).clone();
        let guid = self.doc.new_guid();
        let original = self.doc.node(i);
        // A copy of a file node is saved from that node's record, with its
        // edits; a copy of a new node is written from its properties.
        let source = if original.edits & flags::CREATED != 0 {
            original.source
        } else {
            props.guid
        };
        let edits = if source.is_some() {
            original.edits | flags::CREATED | flags::PARENT | flags::TRANSFORM
        } else {
            u32::MAX
        };
        props.guid = Some(guid);
        props.override_key = None;
        let copy = self.new_node(props);
        let node = self.touch(copy);
        node.source = source;
        node.edits = edits;
        self.attach(copy, parent, index, false);
        let children = self.doc.node(i).children.clone();
        for (k, c) in children.into_iter().enumerate() {
            if !self.doc.node(c).removed {
                self.copy_tree(c, copy, k);
            }
        }
        copy
    }

    fn remove_tree(&mut self, i: NodeIdx) {
        // Off its parent's list, but it keeps its parent link: undo puts it
        // back, and a cut layer can still be pasted where it was.
        if let Some(p) = self.doc.node(i).parent {
            self.touch(p).children.retain(|&c| c != i);
        }
        let mut stack = vec![i];
        while let Some(n) = stack.pop() {
            stack.extend(self.doc.node(n).children.clone());
            let node = self.touch(n);
            node.removed = true;
            node.edits |= flags::PARENT;
        }
    }

    /// Page-space bounds of a layer's frame.
    fn frame_bounds(&self, i: NodeIdx) -> Rect {
        let size = self.doc.props(i).size();
        self.doc
            .world(i)
            .map_rect(&Rect::new(0.0, 0.0, size.x, size.y))
    }

    fn group(&mut self, ids: &[NodeIdx], frame: bool) -> Result<Option<NodeIdx>> {
        let Some(&first) = ids.first() else {
            return Ok(None);
        };
        let parent = self
            .doc
            .node(first)
            .parent
            .ok_or_else(|| FigError::Unsupported("a page cannot be grouped".into()))?;
        // Members move into the first one's parent; the group goes where
        // the topmost of them was.
        let siblings = &self.doc.node(parent).children;
        let top = ids
            .iter()
            .filter_map(|i| siblings.iter().position(|c| c == i))
            .max()
            .unwrap_or(siblings.len());
        let bounds = ids
            .iter()
            .fold(Rect::EMPTY, |acc, &i| acc.union(&self.frame_bounds(i)));
        if bounds.is_empty() {
            return Ok(None);
        }
        let spec = NewNode {
            node_type: if frame { "FRAME" } else { "GROUP" }.into(),
            name: None,
            x: bounds.x,
            y: bounds.y,
            width: bounds.w,
            height: bounds.h,
            props: Patch::default(),
        };
        let g = self.create(parent, Some(top + 1), &spec)?;
        if frame {
            // "Frame selection" makes a frame with no fill around them.
            self.edit(g, flags::FILLS).fills = Some(Arc::from([]));
        }
        // Keep the members' stacking order.
        let order: Vec<NodeIdx> = self
            .doc
            .node(parent)
            .children
            .iter()
            .copied()
            .filter(|c| ids.contains(c))
            .collect();
        for (k, &m) in order.iter().enumerate() {
            self.attach(m, g, k, true);
        }
        Ok(Some(g))
    }

    fn ungroup(&mut self, g: NodeIdx) -> Vec<NodeIdx> {
        let node_type = self.doc.props(g).node_type();
        if !matches!(
            node_type,
            NodeType::Group | NodeType::Frame | NodeType::BooleanOperation | NodeType::Section
        ) {
            return Vec::new();
        }
        let Some(parent) = self.doc.node(g).parent else {
            return Vec::new();
        };
        let at = self
            .doc
            .node(parent)
            .children
            .iter()
            .position(|&c| c == g)
            .unwrap_or(0);
        let children = self.doc.node(g).children.clone();
        for (k, &c) in children.iter().enumerate() {
            self.attach(c, parent, at + k, true);
        }
        self.remove_tree(g);
        children
    }

    fn apply(&mut self, op: &Op) -> Result<()> {
        match op {
            Op::Set { ids, props } => {
                // Layers inside instances take overrides.
                let (inside, ids): (Vec<String>, Vec<String>) =
                    ids.iter().cloned().partition(|id| id.starts_with('I'));
                for id in &inside {
                    self.set_override(id, props)?;
                }
                for i in self.resolve_all(&ids)? {
                    match self.doc.props(i).node_type() {
                        NodeType::Document => {}
                        // Pages take a name (their canvas color is a fill).
                        NodeType::Canvas => {
                            if let Some(name) = &props.name {
                                self.edit(i, flags::NAME).name = Some(name.as_str().into());
                            }
                            if let Some(c) = props
                                .fills
                                .as_ref()
                                .and_then(|f| f.first())
                                .and_then(|f| f.color.as_deref())
                                .and_then(parse_hex)
                            {
                                self.edit(i, flags::BACKGROUND).background_color = Some(c);
                            }
                        }
                        _ => {
                            let patch = self.user_resize(i, props);
                            self.set(i, &patch)?;
                        }
                    }
                }
            }
            Op::Translate { ids, dx, dy } => {
                let all = self.layers(ids)?;
                // Moving a layer moves its children; skip selected children
                // of selected layers.
                for &i in &all {
                    if !self.has_ancestor_in(i, &all) {
                        self.translate(i, *dx, *dy);
                        self.floating.insert(i);
                    }
                }
            }
            Op::CreateComponent { ids } => {
                let all = self.layers(ids)?;
                self.create_component(&all)?;
            }
            Op::Instantiate {
                component,
                parent,
                x,
                y,
            } => {
                let component = self.resolve(component)?;
                let parent = self.resolve(parent)?;
                self.place_instance(component, parent, Vec2::new(*x, *y))?;
            }
            Op::Detach { ids } => {
                for i in self.layers(ids)? {
                    self.detach_instance(i)?;
                }
            }
            Op::Flip { ids, vertical } => {
                let all = self.layers(ids)?;
                for &i in &all {
                    if !self.has_ancestor_in(i, &all) {
                        self.flip(i, *vertical);
                    }
                }
            }
            Op::AutoLayout { ids } => {
                let all = self.layers(ids)?;
                self.add_auto_layout(&all)?;
            }
            Op::Reflow { ids } => {
                let all = self.layers(ids)?;
                self.relayout.extend(all);
            }
            Op::Create {
                parent,
                index,
                node,
            } => {
                let parent = self.resolve(parent)?;
                self.create(parent, *index, node)?;
            }
            Op::Delete { ids } => {
                for i in self.resolve_all(ids)? {
                    let node_type = self.doc.props(i).node_type();
                    if node_type == NodeType::Document || self.doc.node(i).removed {
                        continue;
                    }
                    // A file keeps at least one page.
                    if node_type == NodeType::Canvas && self.live_pages() <= 1 {
                        continue;
                    }
                    self.remove_tree(i);
                }
            }
            Op::Reorder { ids, parent, index } => {
                let parent = self.resolve(parent)?;
                let all = self.layers(ids)?;
                let mut at = *index;
                for i in all {
                    if i == parent || self.is_ancestor(i, parent) {
                        continue;
                    }
                    // Removing it from below the target shifts the target.
                    if self.doc.node(i).parent == Some(parent)
                        && let Some(cur) =
                            self.doc.node(parent).children.iter().position(|&c| c == i)
                        && cur < at
                    {
                        at -= 1;
                    }
                    self.attach(i, parent, at, true);
                    at += 1;
                }
            }
            Op::Arrange { ids, how } => {
                let all = self.layers(ids)?;
                for i in all {
                    let Some(parent) = self.doc.node(i).parent else {
                        continue;
                    };
                    let children = &self.doc.node(parent).children;
                    let Some(cur) = children.iter().position(|&c| c == i) else {
                        continue;
                    };
                    let last = children.len() - 1;
                    let target = match how {
                        Arrangement::Forward => (cur + 1).min(last),
                        Arrangement::Backward => cur.saturating_sub(1),
                        Arrangement::Front => last,
                        Arrangement::Back => 0,
                    };
                    if target != cur {
                        self.attach(i, parent, target, false);
                    }
                }
            }
            Op::Duplicate { ids, dx, dy } => {
                let mut sources = Vec::new();
                for id in ids {
                    let i = self.resolve_any(id)?;
                    if !sources.contains(&i) {
                        sources.push(i);
                    }
                }
                for i in sources {
                    let Some(parent) = self.doc.node(i).parent else {
                        continue;
                    };
                    // A cut layer's parent may itself be gone.
                    if self.doc.node(parent).removed
                        || matches!(
                            self.doc.props(i).node_type(),
                            NodeType::Canvas | NodeType::Document
                        )
                    {
                        continue;
                    }
                    let siblings = &self.doc.node(parent).children;
                    let at = siblings
                        .iter()
                        .position(|&c| c == i)
                        .map_or(siblings.len(), |p| p + 1);
                    // Duplicating a main component makes an instance of it
                    // (but a cut component is pasted back as itself, and a
                    // variant copied in its set stays a variant).
                    let in_set = self.doc.props(parent).is_state_group == Some(true);
                    if self.doc.props(i).node_type() == NodeType::Symbol
                        && !self.doc.node(i).removed
                        && !in_set
                    {
                        let t = self.doc.props(i).transform();
                        let copy = self.instantiate(i, parent, at, t)?;
                        self.translate(copy, *dx, *dy);
                        continue;
                    }
                    let copy = self.copy_tree(i, parent, at);
                    self.translate(copy, *dx, *dy);
                    let guid = self.doc.props(copy).guid.unwrap_or_default();
                    self.created.push(guid.to_string());
                }
            }
            Op::Group { ids, frame } => {
                let all = self.layers(ids)?;
                // Only layers sharing the first one's parent are grouped.
                let parent = all.first().and_then(|&i| self.doc.node(i).parent);
                let same: Vec<NodeIdx> = all
                    .into_iter()
                    .filter(|&i| self.doc.node(i).parent == parent)
                    .collect();
                if let Some(g) = self.group(&same, *frame)? {
                    let _ = g;
                }
            }
            Op::Ungroup { ids } => {
                for i in self.layers(ids)? {
                    let children = self.ungroup(i);
                    for c in children {
                        let guid = self.doc.props(c).guid.unwrap_or_default();
                        self.created.push(guid.to_string());
                    }
                }
            }
            Op::Boolean { ids, operation } => {
                let op = crate::boolean::BoolOp::parse(operation).ok_or_else(|| {
                    FigError::Unsupported(format!("no boolean operation {operation}"))
                })?;
                let all = self.layers(ids)?;
                if let Some(b) = self.boolean(&all, op)? {
                    // A boolean whose operation changed stays selected too.
                    let id = self.guid_str(b).unwrap_or_default();
                    if !self.created.contains(&id) {
                        self.created.push(id);
                    }
                }
            }
            Op::Flatten { ids } => {
                let all = self.layers(ids)?;
                self.flatten(&all)?;
            }
            Op::CreateVector {
                parent,
                index,
                network,
                name,
                props,
            } => {
                if !network.is_valid() || network.vertices.is_empty() {
                    return Err(FigError::Unsupported(
                        "the vector network is malformed".into(),
                    ));
                }
                let parent = self.resolve(parent)?;
                self.create_vector(parent, *index, network, name.clone(), props)?;
            }
            Op::SetVector { id, network } => {
                if !network.is_valid() || network.vertices.is_empty() {
                    return Err(FigError::Unsupported(
                        "the vector network is malformed".into(),
                    ));
                }
                let i = self.resolve(id)?;
                self.set_vector(i, network)?;
            }
            Op::SetProperty { .. }
            | Op::SwapInstance { .. }
            | Op::ResetInstance { .. }
            | Op::CombineAsVariants { .. }
            | Op::AddVariant { .. }
            | Op::AddVariantProperty { .. }
            | Op::RenameVariantProperty { .. }
            | Op::RemoveVariantProperty { .. }
            | Op::SetVariantValue { .. }
            | Op::AddComponentProperty { .. }
            | Op::EditComponentProperty { .. }
            | Op::DeleteComponentProperty { .. }
            | Op::BindProperty { .. }
            | Op::ExposeInstance { .. }
            | Op::ApplyStyle { .. }
            | Op::CreateStyle { .. }
            | Op::EditStyle { .. }
            | Op::DeleteStyle { .. }
            | Op::BindVariable { .. }
            | Op::SetVariableMode { .. } => self.apply_design(op)?,
        }
        Ok(())
    }

    fn guid_str(&self, i: NodeIdx) -> Option<String> {
        self.doc.props(i).guid.map(|g| g.to_string())
    }

    fn live_pages(&self) -> usize {
        let root = self.doc.root;
        self.doc
            .node(root)
            .children
            .iter()
            .filter(|&&c| self.doc.props(c).node_type() == NodeType::Canvas)
            .count()
    }

    fn is_ancestor(&self, ancestor: NodeIdx, mut i: NodeIdx) -> bool {
        while let Some(p) = self.doc.node(i).parent {
            if p == ancestor {
                return true;
            }
            i = p;
        }
        false
    }

    fn has_ancestor_in(&self, i: NodeIdx, set: &[NodeIdx]) -> bool {
        set.iter().any(|&a| a != i && self.is_ancestor(a, i))
    }
}

impl History {
    pub fn can_undo(&self) -> bool {
        !self.undo.is_empty()
    }

    pub fn can_redo(&self) -> bool {
        !self.redo.is_empty()
    }

    /// Applies `ops` as one undoable step. Consecutive steps with the same
    /// `coalesce` key (a drag, say) undo as one. On error nothing changes.
    pub fn apply(
        &mut self,
        doc: &mut Document,
        ops: &[Op],
        coalesce: Option<&str>,
    ) -> Result<Applied> {
        self.run(doc, coalesce, |txn| {
            for op in ops {
                txn.apply(op)?;
            }
            Ok(())
        })
    }

    /// Runs `step` as one undoable step (see [`History::apply`]).
    fn run(
        &mut self,
        doc: &mut Document,
        coalesce: Option<&str>,
        step: impl FnOnce(&mut Txn) -> Result<()>,
    ) -> Result<Applied> {
        let blobs_before = doc.blobs.len();
        let next_guid = doc.next_guid;
        let mut txn = Txn {
            doc,
            before: Vec::new(),
            seen: HashSet::new(),
            created: Vec::new(),
            floating: HashSet::new(),
            relayout: Vec::new(),
        };
        if let Err(e) = step(&mut txn) {
            let Txn { doc, before, .. } = txn;
            restore(doc, &before);
            doc.next_guid = next_guid;
            let _ = blobs_before;
            return Err(e);
        }
        // Boolean layers follow their operands.
        txn.refit_booleans(0);
        let settled = txn.before.len();
        // Auto layout follows what moved, resized, appeared, or went.
        let mut changed: Vec<(NodeIdx, bool)> = txn
            .before
            .iter()
            .filter_map(|(i, old)| layout_change(old, txn.doc.node(*i)).map(|own| (*i, own)))
            .collect();
        changed.extend(txn.relayout.drain(..).map(|i| (i, false)));
        if !changed.is_empty() {
            txn.reflow_after(&changed);
            txn.refit_booleans(settled);
        }
        let Txn {
            doc,
            before,
            created,
            ..
        } = txn;
        doc.refresh_pages();
        let touched: Vec<NodeIdx> = before.iter().map(|(i, _)| *i).collect();
        let after: Vec<(NodeIdx, Node)> = touched
            .iter()
            .map(|&i| (i, doc.nodes[i as usize].clone()))
            .collect();
        if touched.is_empty() {
            return Ok(Applied::default());
        }
        self.redo.clear();
        let merge = coalesce.is_some()
            && self
                .undo
                .last()
                .is_some_and(|s| s.coalesce.as_deref() == coalesce);
        if merge {
            let last = self.undo.last_mut().expect("checked above");
            let known: HashSet<NodeIdx> = last.before.iter().map(|(i, _)| *i).collect();
            for (i, n) in before {
                if !known.contains(&i) {
                    last.before.push((i, n));
                }
            }
            let mut after_map: HashMap<NodeIdx, Node> = last.after.drain(..).collect();
            for (i, n) in after {
                after_map.insert(i, n);
            }
            last.after = after_map.into_iter().collect();
        } else {
            self.undo.push(Step {
                before,
                after,
                coalesce: coalesce.map(str::to_owned),
            });
            if self.undo.len() > MAX_UNDO {
                self.undo.remove(0);
            }
        }
        Ok(Applied { touched, created })
    }

    /// Undoes the last step; returns the nodes it changed.
    pub fn undo(&mut self, doc: &mut Document) -> Option<Vec<NodeIdx>> {
        let step = self.undo.pop()?;
        restore(doc, &step.before);
        doc.refresh_pages();
        let touched = step.before.iter().map(|(i, _)| *i).collect();
        self.redo.push(step);
        Some(touched)
    }

    pub fn redo(&mut self, doc: &mut Document) -> Option<Vec<NodeIdx>> {
        let mut step = self.redo.pop()?;
        restore(doc, &step.after);
        doc.refresh_pages();
        let touched = step.after.iter().map(|(i, _)| *i).collect();
        step.coalesce = None;
        self.undo.push(step);
        Some(touched)
    }
}

/// How a node changed for auto layout: `None` if not at all, `Some(true)`
/// when its own content changed (its children, size, or settings), and
/// `Some(false)` when only its place in its parent did.
fn layout_change(old: &Node, new: &Node) -> Option<bool> {
    // A frame shown again is laid out again: hidden ones keep their layout.
    let own = old.children != new.children
        || old.props.size != new.props.size
        || old.props.auto_layout != new.props.auto_layout
        || old.props.visible != new.props.visible;
    let placed = old.removed != new.removed
        || old.parent != new.parent
        || old.props.transform != new.props.transform
        || old.props.visible != new.props.visible
        || old.props.layout_child != new.props.layout_child;
    (own || placed).then_some(own)
}

fn restore(doc: &mut Document, snapshots: &[(NodeIdx, Node)]) {
    for (i, n) in snapshots {
        doc.nodes[*i as usize] = n.clone();
    }
}

/// A fractional-index position strictly between `lo` and `hi` (`None`:
/// unbounded above), in Figma's alphabet of printable ASCII (`!`..`~`);
/// `None` when no such string exists (`hi` is `lo` followed by `!`s, or not
/// above `lo`).
pub fn between(lo: &str, hi: Option<&str>) -> Option<String> {
    const MIN: u32 = 1;
    const MAX: u32 = 94;
    let digit = |c: u8| u32::from(c.clamp(b'!', b'~') - b' ');
    let lob = lo.as_bytes();
    let hib = hi.map(str::as_bytes);
    let mut out = Vec::new();
    let (mut lo_bound, mut hi_bound) = (true, hib.is_some());
    let mut i = 0;
    loop {
        let x = if lo_bound {
            lob.get(i).map_or(0, |&c| digit(c))
        } else {
            0
        };
        let y = match (hi_bound, hib) {
            (true, Some(h)) => h.get(i).map_or(0, |&c| digit(c)),
            _ => MAX + 1,
        };
        if y > x + 1 {
            out.push(((x + y) / 2) as u8 + b' ');
            break;
        }
        if y <= x && hi_bound {
            // `hi` ended or dips below `lo` here: nothing fits.
            if y < x || y == 0 {
                return None;
            }
        }
        let d = if x >= MIN { x } else { y };
        if d < MIN {
            return None;
        }
        out.push(d as u8 + b' ');
        lo_bound = lo_bound && d == x;
        hi_bound = hi_bound && d == y;
        i += 1;
        if i > 64 {
            return None;
        }
    }
    let p = String::from_utf8(out).ok()?;
    let ok = p.as_str() > lo && hi.is_none_or(|h| p.as_str() < h);
    ok.then_some(p)
}

/// Parses `RRGGBB` or `RRGGBBAA` (with or without `#`).
pub fn parse_hex(s: &str) -> Option<Color> {
    let s = s.trim().trim_start_matches('#');
    let byte = |i: usize| u8::from_str_radix(s.get(i..i + 2)?, 16).ok();
    let c = |i: usize| byte(i).map(|b| f32::from(b) / 255.0);
    match s.len() {
        6 => Some(Color {
            r: c(0)?,
            g: c(2)?,
            b: c(4)?,
            a: 1.0,
        }),
        8 => Some(Color {
            r: c(0)?,
            g: c(2)?,
            b: c(4)?,
            a: c(6)?,
        }),
        _ => None,
    }
}

#[cfg(test)]
mod test;
