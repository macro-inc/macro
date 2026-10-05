//! The document model: artboards on one canvas, and a tree of layers,
//! groups, and objects (paths, text, images, and content kept as the file
//! draws it).
//!
//! Positions are canvas points, y down; artboards sit side by side on the
//! canvas, each one a page of the file. Objects keep their own coordinate
//! space (`transform` maps it to the canvas), so moving or scaling an
//! object changes one matrix and keeps its points exact. An object read
//! from a file remembers how the file drew it ([`Source`]) and is written
//! back that way until it is edited.

use crate::geom::{Affine, PathData, Point, Rect};
use crate::pdf::content::Op;
use serde::{Deserialize, Serialize};

/// Index of a node in [`Document::nodes`].
pub type NodeIdx = u32;

/// A color in the space it was given in.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "space")]
pub enum Color {
    /// Gray, `0..=1` (0 black).
    Gray {
        /// The gray level.
        g: f32,
    },
    /// RGB, `0..=1` each.
    Rgb {
        /// Red.
        r: f32,
        /// Green.
        g: f32,
        /// Blue.
        b: f32,
    },
    /// CMYK, `0..=1` each.
    Cmyk {
        /// Cyan.
        c: f32,
        /// Magenta.
        m: f32,
        /// Yellow.
        y: f32,
        /// Black.
        k: f32,
    },
    /// A spot color: an ink and its tint, with the RGB it shows as.
    Spot {
        /// The ink's name.
        name: String,
        /// Tint, `0..=1`.
        tint: f32,
        /// The color it shows as on screen.
        rgb: [f32; 3],
    },
}

impl Color {
    /// Black.
    pub const BLACK: Color = Color::Gray { g: 0.0 };

    /// The color as straight sRGB.
    pub fn to_rgb(&self) -> [f32; 3] {
        match *self {
            Color::Gray { g } => [g, g, g],
            Color::Rgb { r, g, b } => [r, g, b],
            Color::Cmyk { c, m, y, k } => [
                (1.0 - c) * (1.0 - k),
                (1.0 - m) * (1.0 - k),
                (1.0 - y) * (1.0 - k),
            ],
            Color::Spot { rgb, .. } => rgb,
        }
    }

    /// `#rrggbb` of its sRGB.
    pub fn hex(&self) -> String {
        let [r, g, b] = self
            .to_rgb()
            .map(|v| (v.clamp(0.0, 1.0) * 255.0).round() as u8);
        format!("#{r:02x}{g:02x}{b:02x}")
    }
}

/// PDF blend modes.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BlendMode {
    /// Normal.
    #[default]
    Normal,
    /// Multiply.
    Multiply,
    /// Screen.
    Screen,
    /// Overlay.
    Overlay,
    /// Darken.
    Darken,
    /// Lighten.
    Lighten,
    /// Color Dodge.
    ColorDodge,
    /// Color Burn.
    ColorBurn,
    /// Hard Light.
    HardLight,
    /// Soft Light.
    SoftLight,
    /// Difference.
    Difference,
    /// Exclusion.
    Exclusion,
    /// Hue.
    Hue,
    /// Saturation.
    Saturation,
    /// Color.
    Color,
    /// Luminosity.
    Luminosity,
}

impl BlendMode {
    /// Every mode.
    pub const ALL: [BlendMode; 16] = [
        BlendMode::Normal,
        BlendMode::Multiply,
        BlendMode::Screen,
        BlendMode::Overlay,
        BlendMode::Darken,
        BlendMode::Lighten,
        BlendMode::ColorDodge,
        BlendMode::ColorBurn,
        BlendMode::HardLight,
        BlendMode::SoftLight,
        BlendMode::Difference,
        BlendMode::Exclusion,
        BlendMode::Hue,
        BlendMode::Saturation,
        BlendMode::Color,
        BlendMode::Luminosity,
    ];

    /// The PDF name (`/BM`).
    pub fn pdf_name(self) -> &'static str {
        match self {
            BlendMode::Normal => "Normal",
            BlendMode::Multiply => "Multiply",
            BlendMode::Screen => "Screen",
            BlendMode::Overlay => "Overlay",
            BlendMode::Darken => "Darken",
            BlendMode::Lighten => "Lighten",
            BlendMode::ColorDodge => "ColorDodge",
            BlendMode::ColorBurn => "ColorBurn",
            BlendMode::HardLight => "HardLight",
            BlendMode::SoftLight => "SoftLight",
            BlendMode::Difference => "Difference",
            BlendMode::Exclusion => "Exclusion",
            BlendMode::Hue => "Hue",
            BlendMode::Saturation => "Saturation",
            BlendMode::Color => "Color",
            BlendMode::Luminosity => "Luminosity",
        }
    }

    /// The mode a PDF name gives (`Compatible` is Normal).
    pub fn from_pdf(name: &str) -> BlendMode {
        BlendMode::ALL
            .into_iter()
            .find(|m| m.pdf_name() == name)
            .unwrap_or_default()
    }

    /// As tiny-skia's mode.
    pub fn to_skia(self) -> tiny_skia::BlendMode {
        use tiny_skia::BlendMode as B;
        match self {
            BlendMode::Normal => B::SourceOver,
            BlendMode::Multiply => B::Multiply,
            BlendMode::Screen => B::Screen,
            BlendMode::Overlay => B::Overlay,
            BlendMode::Darken => B::Darken,
            BlendMode::Lighten => B::Lighten,
            BlendMode::ColorDodge => B::ColorDodge,
            BlendMode::ColorBurn => B::ColorBurn,
            BlendMode::HardLight => B::HardLight,
            BlendMode::SoftLight => B::SoftLight,
            BlendMode::Difference => B::Difference,
            BlendMode::Exclusion => B::Exclusion,
            BlendMode::Hue => B::Hue,
            BlendMode::Saturation => B::Saturation,
            BlendMode::Color => B::Color,
            BlendMode::Luminosity => B::Luminosity,
        }
    }
}

/// A color stop of a gradient.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GradientStop {
    /// Position, `0..=1`.
    pub offset: f32,
    /// Its color.
    pub color: Color,
    /// Its opacity, `0..=1`.
    pub opacity: f32,
}

/// A linear or radial gradient.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Gradient {
    /// Gradient space (where the points and radii are) to the object's
    /// space; a radial gradient scaled unevenly is elliptical.
    pub transform: Affine,
    /// Radial rather than linear.
    pub radial: bool,
    /// Start point (radial: the start circle's center).
    pub start: Point,
    /// End point (radial: the end circle's center).
    pub end: Point,
    /// Radial: the start circle's radius.
    pub start_radius: f64,
    /// Radial: the end circle's radius.
    pub end_radius: f64,
    /// Stops, by offset.
    pub stops: Vec<GradientStop>,
    /// Paints past the start and the end.
    pub extend: [bool; 2],
}

/// What fills or strokes.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum Paint {
    /// A color.
    Solid {
        /// The color.
        color: Color,
    },
    /// A gradient.
    Gradient {
        /// The gradient.
        gradient: Gradient,
    },
}

/// Line caps.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LineCap {
    /// Flat at the end.
    #[default]
    Butt,
    /// Rounded.
    Round,
    /// Square past the end.
    Square,
}

/// Line joins.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LineJoin {
    /// Mitered.
    #[default]
    Miter,
    /// Rounded.
    Round,
    /// Beveled.
    Bevel,
}

/// A stroke.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Stroke {
    /// What it paints.
    pub paint: Paint,
    /// Width, in the object's units.
    pub width: f64,
    /// Caps.
    pub cap: LineCap,
    /// Joins.
    pub join: LineJoin,
    /// Miter limit.
    pub miter_limit: f64,
    /// Dash lengths (empty: solid).
    pub dash: Vec<f64>,
    /// Dash offset.
    pub dash_offset: f64,
}

impl Stroke {
    /// A solid stroke of a color.
    pub fn solid(color: Color, width: f64) -> Stroke {
        Stroke {
            paint: Paint::Solid { color },
            width,
            cap: LineCap::Butt,
            join: LineJoin::Miter,
            miter_limit: 10.0,
            dash: Vec::new(),
            dash_offset: 0.0,
        }
    }
}

/// A path object.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PathNode {
    /// The outline, in the object's space.
    pub data: PathData,
    /// The fill.
    pub fill: Option<Paint>,
    /// Fill with the even-odd rule rather than nonzero winding.
    pub even_odd: bool,
    /// The stroke.
    pub stroke: Option<Stroke>,
}

/// Text alignment of edited text.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TextAlign {
    /// Left.
    #[default]
    Left,
    /// Center.
    Center,
    /// Right.
    Right,
}

/// A glyph placed by the file.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlacedGlyph {
    /// The character code.
    pub code: u32,
    /// Bytes the code is written in.
    pub len: u8,
    /// Offset from the run's first glyph along its baseline, in ems.
    pub x: f64,
    /// Its advance, in ems.
    pub advance: f64,
    /// The text it stands for.
    pub text: String,
}

/// Glyphs drawn with one font, size, and paint, as the file placed them.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlyphRun {
    /// The font: `obj:<number>` for a font object of the file.
    pub font: String,
    /// Font size.
    pub size: f64,
    /// Glyph space (ems, y up) to the text's space, at the run's first
    /// glyph: the size, horizontal scale, and rise are in it.
    pub matrix: Affine,
    /// The glyphs.
    pub glyphs: Vec<PlacedGlyph>,
    /// Fill (render modes that fill).
    pub fill: Option<Paint>,
    /// Stroke (render modes that stroke).
    pub stroke: Option<Stroke>,
}

/// A text object.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextNode {
    /// The characters, lines separated by `\n`.
    pub text: String,
    /// The font family.
    pub family: String,
    /// The font style ("Bold Italic").
    pub style: String,
    /// Size in points.
    pub size: f64,
    /// Fill.
    pub fill: Option<Paint>,
    /// Stroke.
    pub stroke: Option<Stroke>,
    /// Alignment.
    pub align: TextAlign,
    /// Distance between baselines, as a multiple of the size.
    pub line_height: f64,
    /// Tracking, in thousandths of an em.
    pub tracking: f64,
    /// Area text: the width lines wrap at (point text when `None`).
    pub width: Option<f64>,
    /// The glyphs as the file placed them; dropped when the text, font, or
    /// size is edited (then the text is laid out again).
    pub runs: Option<Vec<GlyphRun>>,
}

/// Where an image's pixels come from.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum ImageSource {
    /// An image object of the file (`obj:<number>`), or an inline image
    /// (`inline:<page>:<index>`).
    File {
        /// Its key.
        key: String,
    },
    /// An image added here (`Document::images`, by content hash).
    Added {
        /// Its content hash.
        hash: String,
    },
}

/// An image object: the unit square, mapped to the canvas.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageNode {
    /// Its pixels.
    pub source: ImageSource,
    /// Width in samples.
    pub width: u32,
    /// Height in samples.
    pub height: u32,
}

/// A clipping path.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Clip {
    /// The path, in canvas space.
    pub path: PathData,
    /// Even-odd rule.
    pub even_odd: bool,
}

/// What a node is.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum NodeKind {
    /// A layer.
    Layer {
        /// Its color in the layers panel.
        color: [u8; 3],
        /// Printed.
        printable: bool,
    },
    /// A group (a clip group when it has a clipping path).
    Group {
        /// The clipping path.
        clip: Option<Clip>,
        /// Isolated (a transparency group).
        isolated: bool,
        /// Knockout.
        knockout: bool,
    },
    /// A path.
    Path(PathNode),
    /// Text.
    Text(TextNode),
    /// An image.
    Image(ImageNode),
    /// Content drawn as the file draws it (shadings, patterns, and the
    /// rest the model does not edit); it moves and transforms as a whole.
    Raw {
        /// Its bounds in canvas space.
        bounds: Rect,
    },
}

/// How a file drew a node: the page, the operators that drew it, and the
/// graphics state they ran in. Clipping is not here: the node's clip
/// groups hold it.
#[derive(Clone, Debug, PartialEq)]
pub struct Source {
    /// The page (in the opened file) it is on.
    pub page: u32,
    /// The operators (a path and its painting, a text block, `Do`, `sh`).
    pub ops: Vec<Op>,
    /// User space to page space when it drew.
    pub ctm: Affine,
    /// The CTM its content stream started with (patterns are placed in
    /// it).
    pub base: Affine,
    /// Operators that set the rest of the graphics state it drew with
    /// (colors, `gs`, line settings, text state), each with the resource
    /// dictionary it names things in (an index in
    /// [`crate::file::SourceFile::resources`]).
    pub state: Vec<(Op, u32)>,
    /// The resource dictionary the operators name things in (an index in
    /// [`crate::file::SourceFile::resources`]).
    pub resources: u32,
    /// The node's transform when it was read: after a move, the operators
    /// are written with the change in front of them.
    pub transform: Affine,
}

/// Edit flags: what changed in a node since the file was opened.
pub mod flags {
    /// The node was created (it is not in the file).
    pub const CREATED: u64 = 1 << 0;
    /// Its shape (path points, image, text box).
    pub const GEOMETRY: u64 = 1 << 1;
    /// Its fill.
    pub const FILL: u64 = 1 << 2;
    /// Its stroke.
    pub const STROKE: u64 = 1 << 3;
    /// Its opacity or blend mode.
    pub const APPEARANCE: u64 = 1 << 4;
    /// Its name.
    pub const NAME: u64 = 1 << 5;
    /// Hidden or locked.
    pub const VISIBILITY: u64 = 1 << 6;
    /// Its parent or position among siblings.
    pub const PARENT: u64 = 1 << 7;
    /// Its text.
    pub const TEXT: u64 = 1 << 8;
    /// A group's clip.
    pub const CLIP: u64 = 1 << 9;
    /// The artboard it belongs to.
    pub const ARTBOARD: u64 = 1 << 10;
    /// Its transform (moved, scaled, rotated).
    pub const TRANSFORM: u64 = 1 << 11;

    /// Edits after which a node is written from the model rather than the
    /// operators that drew it (a transform change is written in front of
    /// them; copies keep their operators too).
    pub const REDRAWN: u64 = GEOMETRY | FILL | STROKE | APPEARANCE | TEXT | CLIP;
    /// Edits that move a node on the canvas.
    pub const MOVED: u64 = CREATED | GEOMETRY | TEXT | TRANSFORM;
}

/// A node of the layer tree.
#[derive(Clone, Debug, PartialEq)]
pub struct Node {
    /// Stable id, unique in the document.
    pub id: u32,
    /// What it is.
    pub kind: NodeKind,
    /// Its parent (`None` for layers).
    pub parent: Option<NodeIdx>,
    /// Children, bottom to top.
    pub children: Vec<NodeIdx>,
    /// Its name (layers' names; objects' names when given).
    pub name: String,
    /// Hidden.
    pub hidden: bool,
    /// Locked.
    pub locked: bool,
    /// Opacity, `0..=1`.
    pub opacity: f32,
    /// Blend mode.
    pub blend: BlendMode,
    /// Object space to canvas.
    pub transform: Affine,
    /// The artboard it belongs to (its page when saved).
    pub artboard: u32,
    /// How the file drew it. Unedited nodes are written back with it, and
    /// so are moved ones (with the move in front); nodes drawn differently
    /// are written from the model.
    pub source: Option<std::sync::Arc<Source>>,
    /// Edit flags.
    pub edits: u64,
    /// Deleted (kept for undo and other people's changes).
    pub removed: bool,
}

impl Node {
    /// A new node.
    pub fn new(id: u32, kind: NodeKind) -> Node {
        Node {
            id,
            kind,
            parent: None,
            children: Vec::new(),
            name: String::new(),
            hidden: false,
            locked: false,
            opacity: 1.0,
            blend: BlendMode::Normal,
            transform: Affine::IDENTITY,
            artboard: 0,
            source: None,
            edits: flags::CREATED,
            removed: false,
        }
    }

    /// Whether it is a layer.
    pub fn is_layer(&self) -> bool {
        matches!(self.kind, NodeKind::Layer { .. })
    }

    /// Whether it holds other nodes.
    pub fn is_container(&self) -> bool {
        matches!(self.kind, NodeKind::Layer { .. } | NodeKind::Group { .. })
    }
}

/// An artboard: a page of the file, placed on the canvas.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Artboard {
    /// Stable id.
    pub id: u32,
    /// Its name.
    pub name: String,
    /// Where it is on the canvas.
    pub rect: Rect,
    /// The page of the opened file it came from.
    pub page: Option<u32>,
    /// Removed.
    pub removed: bool,
}

/// Document-level edit flags.
pub mod doc_flags {
    /// Artboards added, removed, moved, or renamed.
    pub const ARTBOARDS: u64 = 1 << 0;
    /// Layers added, removed, or reordered.
    pub const LAYERS: u64 = 1 << 1;
}

/// An image added during editing.
#[derive(Clone, Debug, PartialEq)]
pub struct AddedImage {
    /// Width.
    pub width: u32,
    /// Height.
    pub height: u32,
    /// Straight RGBA.
    pub rgba: std::sync::Arc<[u8]>,
    /// The file it came from, when it was a JPEG (embedded as is).
    pub jpeg: Option<std::sync::Arc<[u8]>>,
}

/// A document.
#[derive(Clone, Debug)]
pub struct Document {
    /// Every node, removed ones included.
    pub nodes: Vec<Node>,
    /// Layers, bottom to top.
    pub layers: Vec<NodeIdx>,
    /// Artboards, in page order.
    pub artboards: Vec<Artboard>,
    /// Images added during editing, by content hash.
    pub images: std::collections::BTreeMap<String, AddedImage>,
    /// Document edit flags ([`doc_flags`]).
    pub edits: u64,
    /// The id the next new node gets.
    pub next_id: u32,
    /// The file the document was opened from.
    pub file: Option<std::sync::Arc<crate::file::SourceFile>>,
}

impl Document {
    /// A document with nothing in it.
    pub fn new() -> Document {
        Document {
            nodes: Vec::new(),
            layers: Vec::new(),
            artboards: Vec::new(),
            images: Default::default(),
            edits: 0,
            next_id: 1,
            file: None,
        }
    }

    /// A node.
    pub fn node(&self, i: NodeIdx) -> &Node {
        &self.nodes[i as usize]
    }

    /// A node, to change.
    pub fn node_mut(&mut self, i: NodeIdx) -> &mut Node {
        &mut self.nodes[i as usize]
    }

    /// The node with an id.
    pub fn find(&self, id: u32) -> Option<NodeIdx> {
        self.nodes
            .iter()
            .position(|n| n.id == id)
            .map(|i| i as NodeIdx)
    }

    /// A fresh id.
    pub fn allocate_id(&mut self) -> u32 {
        let id = self.next_id;
        self.next_id = self.next_id.wrapping_add(1).max(1);
        id
    }

    /// Adds a node to the arena (not to the tree).
    pub fn push(&mut self, node: Node) -> NodeIdx {
        self.nodes.push(node);
        (self.nodes.len() - 1) as NodeIdx
    }

    /// The stack a node is in: its parent's children or the layers.
    pub fn siblings(&self, i: NodeIdx) -> &[NodeIdx] {
        match self.node(i).parent {
            Some(p) => &self.node(p).children,
            None => &self.layers,
        }
    }

    /// The stack of a container (the layers for `None`), to change.
    pub fn stack_mut(&mut self, parent: Option<NodeIdx>) -> &mut Vec<NodeIdx> {
        match parent {
            Some(p) => &mut self.nodes[p as usize].children,
            None => &mut self.layers,
        }
    }

    /// Every live node in painting order (containers before what they hold).
    pub fn paint_order(&self) -> Vec<NodeIdx> {
        fn walk(doc: &Document, stack: &[NodeIdx], out: &mut Vec<NodeIdx>) {
            for &i in stack {
                if doc.node(i).removed {
                    continue;
                }
                out.push(i);
                walk(doc, &doc.node(i).children, out);
            }
        }
        let mut out = Vec::new();
        walk(self, &self.layers, &mut out);
        out
    }

    /// Whether a node and its ancestors are shown.
    pub fn is_shown(&self, i: NodeIdx) -> bool {
        let mut at = Some(i);
        while let Some(j) = at {
            let n = self.node(j);
            if n.hidden || n.removed {
                return false;
            }
            at = n.parent;
        }
        true
    }

    /// Whether a node or an ancestor is locked.
    pub fn is_locked(&self, i: NodeIdx) -> bool {
        let mut at = Some(i);
        while let Some(j) = at {
            if self.node(j).locked {
                return true;
            }
            at = self.node(j).parent;
        }
        false
    }

    /// Whether `ancestor` is `i` or contains it.
    pub fn is_within(&self, i: NodeIdx, ancestor: NodeIdx) -> bool {
        let mut at = Some(i);
        while let Some(j) = at {
            if j == ancestor {
                return true;
            }
            at = self.node(j).parent;
        }
        false
    }

    /// The layer a node is in.
    pub fn layer_of(&self, i: NodeIdx) -> NodeIdx {
        let mut at = i;
        while let Some(p) = self.node(at).parent {
            at = p;
        }
        at
    }

    /// The canvas rectangle covering every artboard.
    pub fn canvas(&self) -> Rect {
        self.artboards
            .iter()
            .filter(|a| !a.removed)
            .map(|a| a.rect)
            .reduce(|a, b| a.union(&b))
            .unwrap_or_else(|| Rect::from_xywh(0.0, 0.0, 612.0, 792.0))
    }

    /// The artboard with an id.
    pub fn artboard(&self, id: u32) -> Option<&Artboard> {
        self.artboards.iter().find(|a| a.id == id)
    }
}

impl Default for Document {
    fn default() -> Self {
        Document::new()
    }
}

#[cfg(test)]
mod test;
