//! The document model: what a node is and looks like, independent of the
//! kiwi encoding.
//!
//! A [`Props`] holds every property a node change can carry, each optional:
//! nodes, instance overrides, and the layout Figma derived for instance
//! sublayers are all partial descriptions of a node, merged with
//! [`Props::merge`].

use serde::Serialize;
use std::fmt;
use std::sync::Arc;

pub mod geom;
pub mod handoff;
pub mod paint;
pub mod prototype;
pub mod text;
pub mod variables;

pub use geom::{Affine, Rect, Vec2};
pub use handoff::{
    Axis, ExportConstraint, ExportFormat, ExportSetting, GridAlign, GridPattern, Guide, LayoutGrid,
};
pub use paint::{
    BlendMode, Color, ColorStop, Effect, EffectKind, GradientKind, ImageFilters, ImagePaint,
    ImageScaleMode, Paint, PaintKind,
};
pub use prototype::{Action, FlowStart, Interaction, OverlaySettings};
pub use text::{Baseline, Decoration, Glyph, StyleRun, TextContent, TextLayout, TextStyle};
pub use variables::{Variable, VariableMode, VariableType, VariableValue};

/// A node id, written `session:local` (Figma's node ids).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct Guid {
    pub session: u32,
    pub local: u32,
}

impl fmt::Display for Guid {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}:{}", self.session, self.local)
    }
}

impl Guid {
    pub fn parse(s: &str) -> Option<Guid> {
        let (a, b) = s.split_once(':').or_else(|| s.split_once('-'))?;
        Some(Guid {
            session: a.parse().ok()?,
            local: b.parse().ok()?,
        })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum NodeType {
    Document,
    Canvas,
    Group,
    Frame,
    BooleanOperation,
    Vector,
    Star,
    Line,
    Ellipse,
    Rectangle,
    RegularPolygon,
    RoundedRectangle,
    Text,
    Slice,
    Symbol,
    Instance,
    Sticky,
    ShapeWithText,
    Connector,
    CodeBlock,
    Widget,
    Stamp,
    Media,
    Highlight,
    Section,
    SectionOverlay,
    WashiTape,
    Table,
    TableCell,
    Slide,
    TextPath,
    Other,
}

impl NodeType {
    pub fn parse(s: &str) -> NodeType {
        use NodeType::*;
        match s {
            "DOCUMENT" => Document,
            "CANVAS" => Canvas,
            "GROUP" => Group,
            "FRAME" => Frame,
            "BOOLEAN_OPERATION" => BooleanOperation,
            "VECTOR" => Vector,
            "STAR" => Star,
            "LINE" => Line,
            "ELLIPSE" => Ellipse,
            "RECTANGLE" => Rectangle,
            "REGULAR_POLYGON" => RegularPolygon,
            "ROUNDED_RECTANGLE" => RoundedRectangle,
            "TEXT" => Text,
            "SLICE" => Slice,
            "SYMBOL" => Symbol,
            "INSTANCE" => Instance,
            "STICKY" => Sticky,
            "SHAPE_WITH_TEXT" => ShapeWithText,
            "CONNECTOR" => Connector,
            "CODE_BLOCK" => CodeBlock,
            "WIDGET" => Widget,
            "STAMP" => Stamp,
            "MEDIA" => Media,
            "HIGHLIGHT" => Highlight,
            "SECTION" => Section,
            "SECTION_OVERLAY" => SectionOverlay,
            "WASHI_TAPE" => WashiTape,
            "TABLE" => Table,
            "TABLE_CELL" => TableCell,
            "SLIDE" => Slide,
            "TEXT_PATH" => TextPath,
            _ => Other,
        }
    }

    /// Frame-like containers: they have their own fills and strokes, may
    /// clip their children, and are selected directly on the canvas.
    pub fn is_frame_like(self) -> bool {
        matches!(
            self,
            NodeType::Frame
                | NodeType::Symbol
                | NodeType::Instance
                | NodeType::Section
                | NodeType::Table
                | NodeType::TableCell
                | NodeType::Slide
                | NodeType::Sticky
                | NodeType::ShapeWithText
        )
    }

    /// Text, laid out in lines or along a path.
    pub fn is_text(self) -> bool {
        matches!(self, NodeType::Text | NodeType::TextPath)
    }

    /// Nodes whose children are drawn (boolean operations draw only their
    /// combined geometry; their children are operands).
    pub fn draws_children(self) -> bool {
        !matches!(self, NodeType::BooleanOperation)
    }

    /// The label the layers panel and inspector use.
    pub fn label(self) -> &'static str {
        use NodeType::*;
        match self {
            Document => "Document",
            Canvas => "Page",
            Group => "Group",
            Frame => "Frame",
            BooleanOperation => "Boolean",
            Vector => "Vector",
            Star => "Star",
            Line => "Line",
            Ellipse => "Ellipse",
            Rectangle | RoundedRectangle => "Rectangle",
            RegularPolygon => "Polygon",
            Text => "Text",
            Slice => "Slice",
            Symbol => "Component",
            Instance => "Instance",
            Sticky => "Sticky",
            ShapeWithText => "Shape",
            Connector => "Connector",
            CodeBlock => "Code block",
            Widget => "Widget",
            Stamp => "Stamp",
            Media => "Media",
            Highlight => "Highlight",
            Section => "Section",
            SectionOverlay => "Section",
            WashiTape => "Washi tape",
            Table => "Table",
            TableCell => "Cell",
            Slide => "Slide",
            TextPath => "Text",
            Other => "Layer",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum StrokeAlign {
    #[default]
    Center,
    Inside,
    Outside,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum WindingRule {
    #[default]
    NonZero,
    EvenOdd,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MaskType {
    #[default]
    Alpha,
    Outline,
    Luminance,
}

/// One geometry path of a node: an index into the file's blobs.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PathRef {
    pub winding: WindingRule,
    pub blob: u32,
    /// The vector region style it is filled with (an id in
    /// [`Props::vector_styles`]); 0 for the node's own fills.
    pub style: u32,
}

/// Per-corner radii, clockwise from the top left.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize)]
pub struct CornerRadii {
    pub top_left: f32,
    pub top_right: f32,
    pub bottom_right: f32,
    pub bottom_left: f32,
}

impl CornerRadii {
    pub fn uniform(r: f32) -> Self {
        Self {
            top_left: r,
            top_right: r,
            bottom_right: r,
            bottom_left: r,
        }
    }

    pub fn is_zero(&self) -> bool {
        self.top_left <= 0.0
            && self.top_right <= 0.0
            && self.bottom_right <= 0.0
            && self.bottom_left <= 0.0
    }
}

/// Auto layout, for the inspector.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoLayout {
    pub mode: String,
    pub spacing: f32,
    pub padding_top: f32,
    pub padding_right: f32,
    pub padding_bottom: f32,
    pub padding_left: f32,
    pub primary_align: Option<String>,
    pub counter_align: Option<String>,
    pub wrap: bool,
    /// `FIXED`, or the frame hugs its content (`RESIZE_TO_FIT…`; the
    /// default along the primary axis).
    pub primary_sizing: Option<String>,
    /// Along the counter axis the default is `FIXED`.
    pub counter_sizing: Option<String>,
    pub counter_spacing: f32,
    /// Earlier children draw on top.
    pub reverse_z: bool,
    /// Strokes take up space: the frame's own pad its content, and its
    /// children's outer strokes count in their size.
    pub strokes_in_layout: bool,
}

impl AutoLayout {
    pub fn horizontal(&self) -> bool {
        self.mode == "HORIZONTAL"
    }

    /// Whether children are placed in a single row or column (the layouts
    /// the engine reflows; wrapping and grids keep Figma's positions).
    pub fn is_stack(&self) -> bool {
        (self.mode == "HORIZONTAL" || self.mode == "VERTICAL") && !self.wrap
    }

    pub fn hugs_primary(&self) -> bool {
        self.primary_sizing.as_deref() != Some("FIXED")
    }

    pub fn hugs_counter(&self) -> bool {
        self.counter_sizing
            .as_deref()
            .is_some_and(|s| s.starts_with("RESIZE_TO_FIT"))
    }
}

/// How a layer sits in its auto layout parent.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct LayoutChild {
    /// Share of the free space along the primary axis ("fill"); 0 is fixed.
    pub grow: Option<f32>,
    /// `STRETCH` fills the counter axis; `MIN`, `CENTER`, `MAX` override the
    /// parent's alignment; `AUTO` follows it.
    pub align: Option<Arc<str>>,
    /// Positioned freely, outside the flow.
    pub absolute: Option<bool>,
    /// Size limits (0 means none), kept when the layout sizes the layer.
    pub min_size: Option<Vec2>,
    pub max_size: Option<Vec2>,
}

impl LayoutChild {
    pub fn fills_primary(&self) -> bool {
        self.grow.unwrap_or(0.0) > 0.0
    }

    pub fn stretches(&self) -> bool {
        self.align.as_deref() == Some("STRETCH")
    }

    pub fn is_absolute(&self) -> bool {
        self.absolute.unwrap_or(false)
    }

    /// `v` within the limits on one axis (`x` or not).
    pub fn clamp(&self, v: f64, x: bool) -> f64 {
        let pick = |s: Option<Vec2>| s.map(|s| if x { s.x } else { s.y }).filter(|&l| l > 0.0);
        let v = match pick(self.max_size) {
            Some(max) => v.min(max),
            None => v,
        };
        match pick(self.min_size) {
            Some(min) => v.max(min),
            None => v,
        }
    }
}

/// A reference from a component's sublayer to one of the component's
/// properties: the sublayer's `field` follows the property's value.
#[derive(Clone, Debug, PartialEq)]
pub struct PropRef {
    pub def_id: Guid,
    pub field: PropField,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PropField {
    Visible,
    Text,
    SwappedSymbol,
    Other,
}

/// A value assigned to a component property by an instance.
#[derive(Clone, Debug, PartialEq)]
pub struct PropAssignment {
    pub def_id: Guid,
    pub value: PropValue,
}

#[derive(Clone, Debug, PartialEq)]
pub enum PropValue {
    Bool(bool),
    Text(Arc<str>),
    Symbol(Guid),
    Other,
}

/// A component property definition (on a component or component set).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PropDef {
    #[serde(skip)]
    pub id: Guid,
    pub name: String,
    /// `BOOL`, `TEXT`, `INSTANCE_SWAP`, `VARIANT`, …
    pub kind: String,
    /// The value instances show unless they assign another.
    #[serde(skip)]
    pub initial: Option<PropValue>,
    /// For instance swap properties: keys of the components (or component
    /// sets) offered first.
    #[serde(skip)]
    pub preferred: Arc<[Arc<str>]>,
}

/// A variant's value for one of its component set's variant properties.
#[derive(Clone, Debug, PartialEq)]
pub struct VariantSpec {
    pub def_id: Guid,
    pub value: Arc<str>,
}

/// The order a component set lists a variant property's values in.
#[derive(Clone, Debug, PartialEq)]
pub struct VariantOrder {
    pub property: Arc<str>,
    pub values: Arc<[Arc<str>]>,
}

/// What a shared style node styles.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum StyleType {
    Fill,
    Text,
    Effect,
    Grid,
    Other,
}

impl StyleType {
    pub fn parse(s: &str) -> StyleType {
        match s {
            "FILL" => StyleType::Fill,
            "TEXT" => StyleType::Text,
            "EFFECT" => StyleType::Effect,
            "GRID" => StyleType::Grid,
            _ => StyleType::Other,
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            StyleType::Fill => "FILL",
            StyleType::Text => "TEXT",
            StyleType::Effect => "EFFECT",
            StyleType::Grid => "GRID",
            StyleType::Other => "NONE",
        }
    }
}

/// What makes a node an instance.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct SymbolData {
    pub symbol_id: Option<Guid>,
    pub overrides: Arc<[Props]>,
    pub uniform_scale: Option<f32>,
}

/// A vector layer's editable geometry (`vectorData`): its network blob,
/// whose coordinates the layer's size scales from `normalized_size`.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct VectorData {
    pub network_blob: Option<u32>,
    pub normalized_size: Option<Vec2>,
}

/// Every property of a node change; `None` means "not set here".
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Props {
    pub guid: Option<Guid>,
    pub parent: Option<Guid>,
    pub position: Option<Arc<str>>,
    pub node_type: Option<NodeType>,
    pub name: Option<Arc<str>>,
    pub visible: Option<bool>,
    pub locked: Option<bool>,
    pub opacity: Option<f32>,
    pub blend_mode: Option<BlendMode>,
    pub size: Option<Vec2>,
    pub transform: Option<Affine>,
    pub mask: Option<bool>,
    pub mask_type: Option<MaskType>,
    pub fills: Option<Arc<[Paint]>>,
    pub strokes: Option<Arc<[Paint]>>,
    pub stroke_weight: Option<f32>,
    /// Stroke weights per side (top, right, bottom, left) when they are
    /// set independently.
    pub stroke_sides: Option<[f32; 4]>,
    pub stroke_align: Option<StrokeAlign>,
    pub stroke_cap: Option<Arc<str>>,
    pub stroke_join: Option<Arc<str>>,
    pub dash_pattern: Option<Arc<[f32]>>,
    pub fill_geometry: Option<Arc<[PathRef]>>,
    pub stroke_geometry: Option<Arc<[PathRef]>>,
    pub effects: Option<Arc<[Effect]>>,
    pub corner_radius: Option<f32>,
    pub corner_radii: Option<CornerRadii>,
    pub corner_smoothing: Option<f32>,
    /// `frameMaskDisabled`: frames clip their content unless this is set.
    pub clip_disabled: Option<bool>,
    pub background_color: Option<Color>,
    pub internal_only: Option<bool>,
    pub text_content: Option<Arc<TextContent>>,
    pub text_layout: Option<Arc<TextLayout>>,
    pub text_style: Option<Arc<TextStyle>>,
    pub symbol: Option<Arc<SymbolData>>,
    pub derived: Option<Arc<[Props]>>,
    pub swapped_symbol: Option<Guid>,
    pub prop_assignments: Option<Arc<[PropAssignment]>>,
    pub prop_refs: Option<Arc<[PropRef]>>,
    pub prop_defs: Option<Arc<[PropDef]>>,
    pub guid_path: Option<Arc<[Guid]>>,
    pub override_key: Option<Guid>,
    pub auto_layout: Option<Arc<AutoLayout>>,
    pub layout_child: Option<LayoutChild>,
    pub export_settings: Option<Arc<[ExportSetting]>>,
    pub boolean_operation: Option<Arc<str>>,
    pub vector_data: Option<Arc<VectorData>>,
    pub constraints: Option<(Arc<str>, Arc<str>)>,
    pub description: Option<Arc<str>>,
    pub is_state_group: Option<bool>,
    /// Shared styles the fills, strokes, and effects come from.
    pub fill_style: Option<Guid>,
    pub stroke_style: Option<Guid>,
    pub effect_style: Option<Guid>,
    /// The shared text style a text layer's type comes from.
    pub text_style_id: Option<Guid>,
    /// A component's (or style's) library key; set on those imported from
    /// libraries.
    pub key: Option<Arc<str>>,
    /// On shared style nodes: what they style, their place in the styles
    /// list, and whether they were deleted (kept for layers using them).
    pub style_type: Option<StyleType>,
    pub sort_position: Option<Arc<str>>,
    pub soft_deleted: Option<bool>,
    /// On a variant: its value for each of its set's variant properties.
    pub variant_specs: Option<Arc<[VariantSpec]>>,
    /// On a component set: the order of each variant property's values.
    pub variant_orders: Option<Arc<[VariantOrder]>>,
    /// On an instance in a component: its properties show on the
    /// component's instances ("exposed" nested instances).
    pub props_bubbled: Option<bool>,
    /// On variable nodes: the variable's collection, kind, and values.
    pub variable: Option<Arc<Variable>>,
    /// On variable collections: their modes, in order (the first is the
    /// default).
    pub variable_modes: Option<Arc<[VariableMode]>>,
    /// The mode a frame (or page) picks per collection: `(collection, mode)`.
    pub mode_by_set: Option<Arc<[(Guid, Guid)]>>,
    /// The layers Figma generates for FigJam objects (a sticky's or shape's
    /// background and text, a connector's line and label): paints and text
    /// from `nodeGenerationData` merged with the layout Figma derived for
    /// them (`derivedImmutableFrameData`), each with its guid path.
    pub generated: Option<Arc<[Props]>>,
    /// Fills of a vector network's regions that have their own
    /// (`vectorData.styleOverrideTable`), by the style id their geometry
    /// carries.
    pub vector_styles: Option<Arc<[StyleRun]>>,
    /// A frame's layout grids (drawn over the canvas, never exported).
    pub layout_grids: Option<Arc<[LayoutGrid]>>,
    /// Ruler guides of a page or frame.
    pub guides: Option<Arc<[Guide]>>,
    /// Prototype interactions on the layer.
    pub interactions: Option<Arc<[Interaction]>>,
    /// A flow starting point on a top-level frame.
    pub flow_start: Option<Arc<FlowStart>>,
    /// How the frame shows as an overlay.
    pub overlay: Option<Arc<OverlaySettings>>,
    /// A page's prototype start frame, in files from before flows.
    pub prototype_start: Option<Guid>,
    /// On an instance's override or derived layout entry: made by the
    /// editor (and written when saving); the file's own are kept as they
    /// are.
    pub recomputed: bool,
}

macro_rules! merge_fields {
    ($dst:ident, $src:ident; $($f:ident),* $(,)?) => {
        $(
            if $src.$f.is_some() {
                $dst.$f = $src.$f.clone();
            }
        )*
    };
}

impl Props {
    /// Sets every field `other` sets, leaving identity (guid, parent, and
    /// position) alone.
    pub fn merge(&mut self, other: &Props) {
        merge_fields!(self, other;
            node_type, name, visible, locked, opacity, blend_mode, size, transform, mask,
            mask_type, fills, strokes, stroke_weight, stroke_sides, stroke_align, stroke_cap,
            stroke_join,
            dash_pattern, fill_geometry, stroke_geometry, effects, corner_radius, corner_radii,
            corner_smoothing, clip_disabled, background_color, internal_only, text_content,
            text_layout, text_style,
            symbol, derived, swapped_symbol, prop_assignments, prop_refs, prop_defs,
            override_key, auto_layout, layout_child, export_settings, boolean_operation, vector_data, constraints,
            description, is_state_group, fill_style, stroke_style, effect_style, generated,
            vector_styles,
            text_style_id, key, style_type, sort_position, soft_deleted, variant_specs,
            variant_orders, props_bubbled, variable, variable_modes, mode_by_set,
            layout_grids, guides,
            interactions, flow_start, overlay, prototype_start,
        );
    }

    pub fn node_type(&self) -> NodeType {
        self.node_type.unwrap_or(NodeType::Other)
    }

    pub fn name(&self) -> &str {
        self.name.as_deref().unwrap_or("")
    }

    pub fn visible(&self) -> bool {
        self.visible.unwrap_or(true)
    }

    pub fn opacity(&self) -> f32 {
        self.opacity.unwrap_or(1.0).clamp(0.0, 1.0)
    }

    pub fn blend_mode(&self) -> BlendMode {
        self.blend_mode.unwrap_or(BlendMode::PassThrough)
    }

    pub fn size(&self) -> Vec2 {
        self.size.unwrap_or_default()
    }

    pub fn transform(&self) -> Affine {
        self.transform.unwrap_or_default()
    }

    pub fn is_mask(&self) -> bool {
        self.mask.unwrap_or(false)
    }

    pub fn fills(&self) -> &[Paint] {
        self.fills.as_deref().unwrap_or(&[])
    }

    pub fn strokes(&self) -> &[Paint] {
        self.strokes.as_deref().unwrap_or(&[])
    }

    pub fn effects(&self) -> &[Effect] {
        self.effects.as_deref().unwrap_or(&[])
    }

    pub fn fill_geometry(&self) -> &[PathRef] {
        self.fill_geometry.as_deref().unwrap_or(&[])
    }

    pub fn stroke_geometry(&self) -> &[PathRef] {
        self.stroke_geometry.as_deref().unwrap_or(&[])
    }

    pub fn stroke_weight(&self) -> f32 {
        self.stroke_weight.unwrap_or(1.0)
    }

    pub fn stroke_align(&self) -> StrokeAlign {
        self.stroke_align.unwrap_or_default()
    }

    /// The radii of a rectangle-like node.
    pub fn radii(&self) -> CornerRadii {
        self.corner_radii
            .unwrap_or_else(|| CornerRadii::uniform(self.corner_radius.unwrap_or(0.0)))
    }

    /// Whether the node clips its children to its shape.
    pub fn clips_content(&self) -> bool {
        self.node_type().is_frame_like() && !self.clip_disabled.unwrap_or(false)
    }

    /// Whether any paint is visible.
    pub fn has_visible_fills(&self) -> bool {
        self.fills().iter().any(Paint::is_visible)
    }

    pub fn has_visible_strokes(&self) -> bool {
        self.strokes().iter().any(Paint::is_visible) && self.stroke_weight() > 0.0
    }
}
