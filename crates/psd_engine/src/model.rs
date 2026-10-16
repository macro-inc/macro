//! The document model: a canvas and its layer tree, with every property the
//! engine renders and edits in typed form.
//!
//! Layers live in an arena ([`Document::layers`]) and refer to each other by
//! [`LayerIdx`]. Stacks (the document's [`Document::roots`] and a group's
//! children) list layers bottom to top, as Photoshop files store them.
//! Removed layers stay in the arena, out of every stack, so undo and other
//! people's changes can bring them back.
//!
//! Colors are straight sRGB in `0..=1`; positions are canvas pixels.

use crate::raster::{IRect, Raster};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

mod adjustment;
mod effects;
mod paint;
mod text;
mod vector;

pub use adjustment::*;
pub use effects::*;
pub use paint::*;
pub use text::*;
pub use vector::*;

/// Index of a layer in [`Document::layers`].
pub type LayerIdx = u32;

/// The color mode a file stores its pixels in.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ColorMode {
    /// One bit per pixel.
    Bitmap,
    /// One gray channel.
    Grayscale,
    /// Indices into a 256-color palette.
    Indexed,
    /// Red, green, and blue.
    Rgb,
    /// Cyan, magenta, yellow, and black.
    Cmyk,
    /// Channels without a color model.
    Multichannel,
    /// Gray with ink curves.
    Duotone,
    /// CIE L*a*b*.
    Lab,
}

impl ColorMode {
    /// The mode stored in a file header.
    pub fn from_code(code: u16) -> Option<ColorMode> {
        Some(match code {
            0 => ColorMode::Bitmap,
            1 => ColorMode::Grayscale,
            2 => ColorMode::Indexed,
            3 => ColorMode::Rgb,
            4 => ColorMode::Cmyk,
            7 => ColorMode::Multichannel,
            8 => ColorMode::Duotone,
            9 => ColorMode::Lab,
            _ => return None,
        })
    }

    /// The header code of the mode.
    pub fn code(self) -> u16 {
        match self {
            ColorMode::Bitmap => 0,
            ColorMode::Grayscale => 1,
            ColorMode::Indexed => 2,
            ColorMode::Rgb => 3,
            ColorMode::Cmyk => 4,
            ColorMode::Multichannel => 7,
            ColorMode::Duotone => 8,
            ColorMode::Lab => 9,
        }
    }

    /// Color channels (without alpha) a layer has in this mode.
    pub fn color_channels(self) -> usize {
        match self {
            ColorMode::Rgb | ColorMode::Lab => 3,
            ColorMode::Cmyk => 4,
            _ => 1,
        }
    }
}

/// Photoshop's blend modes.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BlendMode {
    /// Groups only: the group's layers blend straight into what is below.
    PassThrough,
    /// Normal.
    #[default]
    Normal,
    /// Dissolve.
    Dissolve,
    /// Darken.
    Darken,
    /// Multiply.
    Multiply,
    /// Color Burn.
    ColorBurn,
    /// Linear Burn.
    LinearBurn,
    /// Darker Color.
    DarkerColor,
    /// Lighten.
    Lighten,
    /// Screen.
    Screen,
    /// Color Dodge.
    ColorDodge,
    /// Linear Dodge (Add).
    LinearDodge,
    /// Lighter Color.
    LighterColor,
    /// Overlay.
    Overlay,
    /// Soft Light.
    SoftLight,
    /// Hard Light.
    HardLight,
    /// Vivid Light.
    VividLight,
    /// Linear Light.
    LinearLight,
    /// Pin Light.
    PinLight,
    /// Hard Mix.
    HardMix,
    /// Difference.
    Difference,
    /// Exclusion.
    Exclusion,
    /// Subtract.
    Subtract,
    /// Divide.
    Divide,
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
    /// Every mode, in Photoshop's menu order.
    pub const ALL: [BlendMode; 28] = [
        BlendMode::PassThrough,
        BlendMode::Normal,
        BlendMode::Dissolve,
        BlendMode::Darken,
        BlendMode::Multiply,
        BlendMode::ColorBurn,
        BlendMode::LinearBurn,
        BlendMode::DarkerColor,
        BlendMode::Lighten,
        BlendMode::Screen,
        BlendMode::ColorDodge,
        BlendMode::LinearDodge,
        BlendMode::LighterColor,
        BlendMode::Overlay,
        BlendMode::SoftLight,
        BlendMode::HardLight,
        BlendMode::VividLight,
        BlendMode::LinearLight,
        BlendMode::PinLight,
        BlendMode::HardMix,
        BlendMode::Difference,
        BlendMode::Exclusion,
        BlendMode::Subtract,
        BlendMode::Divide,
        BlendMode::Hue,
        BlendMode::Saturation,
        BlendMode::Color,
        BlendMode::Luminosity,
    ];

    /// The four-byte key layer records store.
    pub fn key(self) -> [u8; 4] {
        *match self {
            BlendMode::PassThrough => b"pass",
            BlendMode::Normal => b"norm",
            BlendMode::Dissolve => b"diss",
            BlendMode::Darken => b"dark",
            BlendMode::Multiply => b"mul ",
            BlendMode::ColorBurn => b"idiv",
            BlendMode::LinearBurn => b"lbrn",
            BlendMode::DarkerColor => b"dkCl",
            BlendMode::Lighten => b"lite",
            BlendMode::Screen => b"scrn",
            BlendMode::ColorDodge => b"div ",
            BlendMode::LinearDodge => b"lddg",
            BlendMode::LighterColor => b"lgCl",
            BlendMode::Overlay => b"over",
            BlendMode::SoftLight => b"sLit",
            BlendMode::HardLight => b"hLit",
            BlendMode::VividLight => b"vLit",
            BlendMode::LinearLight => b"lLit",
            BlendMode::PinLight => b"pLit",
            BlendMode::HardMix => b"hMix",
            BlendMode::Difference => b"diff",
            BlendMode::Exclusion => b"smud",
            BlendMode::Subtract => b"fsub",
            BlendMode::Divide => b"fdiv",
            BlendMode::Hue => b"hue ",
            BlendMode::Saturation => b"sat ",
            BlendMode::Color => b"colr",
            BlendMode::Luminosity => b"lum ",
        }
    }

    /// The mode a layer record's key names.
    pub fn from_key(key: &[u8; 4]) -> Option<BlendMode> {
        BlendMode::ALL.into_iter().find(|m| &m.key() == key)
    }

    /// The name Photoshop's menu shows.
    pub fn label(self) -> &'static str {
        match self {
            BlendMode::PassThrough => "Pass Through",
            BlendMode::Normal => "Normal",
            BlendMode::Dissolve => "Dissolve",
            BlendMode::Darken => "Darken",
            BlendMode::Multiply => "Multiply",
            BlendMode::ColorBurn => "Color Burn",
            BlendMode::LinearBurn => "Linear Burn",
            BlendMode::DarkerColor => "Darker Color",
            BlendMode::Lighten => "Lighten",
            BlendMode::Screen => "Screen",
            BlendMode::ColorDodge => "Color Dodge",
            BlendMode::LinearDodge => "Linear Dodge (Add)",
            BlendMode::LighterColor => "Lighter Color",
            BlendMode::Overlay => "Overlay",
            BlendMode::SoftLight => "Soft Light",
            BlendMode::HardLight => "Hard Light",
            BlendMode::VividLight => "Vivid Light",
            BlendMode::LinearLight => "Linear Light",
            BlendMode::PinLight => "Pin Light",
            BlendMode::HardMix => "Hard Mix",
            BlendMode::Difference => "Difference",
            BlendMode::Exclusion => "Exclusion",
            BlendMode::Subtract => "Subtract",
            BlendMode::Divide => "Divide",
            BlendMode::Hue => "Hue",
            BlendMode::Saturation => "Saturation",
            BlendMode::Color => "Color",
            BlendMode::Luminosity => "Luminosity",
        }
    }
}

/// A straight sRGB color, each component in `0..=1`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Rgb {
    /// Red.
    pub r: f32,
    /// Green.
    pub g: f32,
    /// Blue.
    pub b: f32,
}

impl Rgb {
    /// Black.
    pub const BLACK: Rgb = Rgb {
        r: 0.0,
        g: 0.0,
        b: 0.0,
    };
    /// White.
    pub const WHITE: Rgb = Rgb {
        r: 1.0,
        g: 1.0,
        b: 1.0,
    };

    /// A color from components in `0..=1`.
    pub const fn new(r: f32, g: f32, b: f32) -> Rgb {
        Rgb { r, g, b }
    }

    /// A color from 8-bit components.
    pub fn from_u8(r: u8, g: u8, b: u8) -> Rgb {
        Rgb::new(r as f32 / 255.0, g as f32 / 255.0, b as f32 / 255.0)
    }

    /// The color as 8-bit components (rounded, clamped).
    pub fn to_u8(self) -> [u8; 3] {
        let q = |v: f32| (v.clamp(0.0, 1.0) * 255.0).round() as u8;
        [q(self.r), q(self.g), q(self.b)]
    }

    /// `#rrggbb`.
    pub fn hex(self) -> String {
        let [r, g, b] = self.to_u8();
        format!("#{r:02x}{g:02x}{b:02x}")
    }

    /// Parses `#rrggbb` or `rrggbb`.
    pub fn parse_hex(s: &str) -> Option<Rgb> {
        let s = s.trim().trim_start_matches('#');
        if s.len() != 6 {
            return None;
        }
        let v = u32::from_str_radix(s, 16).ok()?;
        Some(Rgb::from_u8((v >> 16) as u8, (v >> 8) as u8, v as u8))
    }
}

/// A ruler guide.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Guide {
    /// A vertical line (at an x position) rather than a horizontal one.
    pub vertical: bool,
    /// Position in canvas pixels.
    pub position: f64,
}

/// A smart object's placement.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartObject {
    /// The placed content's unique id.
    pub id: String,
    /// The embedded or linked file's name.
    pub file_name: Option<String>,
    /// The content's corners on the canvas (top left, top right, bottom
    /// right, bottom left), `[x0, y0, … x3, y3]`.
    pub corners: [f64; 8],
    /// The content is linked to a file outside the document.
    pub linked: bool,
}

/// What an artboard is drawn on.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum ArtboardBackground {
    /// White.
    #[default]
    White,
    /// Black.
    Black,
    /// Nothing: what is below shows through.
    Transparent,
    /// A color of its own.
    Color {
        /// The color.
        color: Rgb,
    },
}

impl ArtboardBackground {
    /// The color it paints; `None` when transparent.
    pub fn color(&self) -> Option<Rgb> {
        match self {
            ArtboardBackground::White => Some(Rgb::WHITE),
            ArtboardBackground::Black => Some(Rgb::BLACK),
            ArtboardBackground::Transparent => None,
            ArtboardBackground::Color { color } => Some(*color),
        }
    }
}

/// An artboard: a group drawn on its own background and cut to its
/// rectangle.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Artboard {
    /// Its rectangle on the canvas.
    pub rect: IRect,
    /// What it is drawn on.
    pub background: ArtboardBackground,
}

/// What a layer is.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum LayerKind {
    /// Pixels.
    Pixel,
    /// A group of layers.
    Group {
        /// Expanded in the layers panel.
        open: bool,
        /// The group is an artboard.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        artboard: Option<Artboard>,
    },
    /// Text, drawn from its stored pixels until edited.
    Text {
        /// The text.
        text: Box<TextLayer>,
    },
    /// A fill: one color, a gradient, or a pattern, shaped by the vector
    /// mask when it has one (a shape layer).
    Fill {
        /// What it paints.
        fill: Fill,
        /// A shape layer's stroke.
        stroke: Option<Box<VectorStroke>>,
    },
    /// An adjustment of everything below it.
    Adjustment {
        /// The settings.
        adjustment: Box<Adjustment>,
    },
    /// Placed content, drawn from its stored pixels.
    SmartObject {
        /// The placement.
        object: Box<SmartObject>,
    },
}

impl LayerKind {
    /// Whether the layer is a group.
    pub fn is_group(&self) -> bool {
        matches!(self, LayerKind::Group { .. })
    }

    /// Whether its pixels are what it shows (pixel, text, and smart object
    /// layers).
    pub fn has_pixels(&self) -> bool {
        matches!(
            self,
            LayerKind::Pixel | LayerKind::Text { .. } | LayerKind::SmartObject { .. }
        )
    }
}

/// A layer's pixel mask.
#[derive(Clone, Debug, PartialEq)]
pub struct LayerMask {
    /// Mask values (one channel); pixels outside its tiles take
    /// `default_color`.
    pub raster: Raster,
    /// The canvas rectangle the mask's pixels cover; outside it every pixel
    /// is `default_color`.
    pub rect: IRect,
    /// Value outside `rect` (0 or 255).
    pub default_color: u8,
    /// Turned off (kept but not applied).
    pub disabled: bool,
    /// Moves with the layer.
    pub linked: bool,
    /// Density, `0..=1`.
    pub density: f32,
    /// Feather, in pixels.
    pub feather: f32,
    /// Bumped whenever the mask's values are replaced wholesale, as
    /// [`Layer::generation`] is for pixels.
    pub generation: u32,
}

impl LayerMask {
    /// The mask value at canvas `(x, y)`.
    pub fn value(&self, x: i32, y: i32) -> u8 {
        if self.rect.contains(x, y) {
            self.raster.get(x, y)[0]
        } else {
            self.default_color
        }
    }
}

/// Blend If ranges: for the gray composite and then each color channel,
/// the source (this layer) and destination (what is below) ranges, each
/// `[black low, black high, white low, white high]`.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlendRanges {
    /// `(source, destination)` per channel, gray first.
    pub channels: Vec<([u8; 4], [u8; 4])>,
}

impl BlendRanges {
    /// Whether the ranges let everything through (Photoshop's default).
    pub fn is_default(&self) -> bool {
        self.channels
            .iter()
            .all(|(s, d)| *s == [0, 0, 255, 255] && *d == [0, 0, 255, 255])
    }
}

/// Lock settings.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Locks {
    /// Transparent pixels stay transparent.
    pub transparency: bool,
    /// Pixels cannot be painted.
    pub pixels: bool,
    /// The layer cannot move.
    pub position: bool,
    /// The layer cannot nest in or out of artboards.
    pub artboard: bool,
}

impl Locks {
    /// Everything locked.
    pub fn all(&self) -> bool {
        self.transparency && self.pixels && self.position
    }
}

/// Edit flags: which of a layer's properties changed since the file was
/// opened (saving rewrites only those), and which document properties did.
pub mod flags {
    /// The layer was created (it has no record in the file).
    pub const CREATED: u64 = 1 << 0;
    /// Name.
    pub const NAME: u64 = 1 << 1;
    /// Visibility.
    pub const VISIBLE: u64 = 1 << 2;
    /// Opacity.
    pub const OPACITY: u64 = 1 << 3;
    /// Fill opacity.
    pub const FILL_OPACITY: u64 = 1 << 4;
    /// Blend mode.
    pub const BLEND: u64 = 1 << 5;
    /// Clipping.
    pub const CLIPPING: u64 = 1 << 6;
    /// Locks.
    pub const LOCKS: u64 = 1 << 7;
    /// Color tag.
    pub const COLOR_TAG: u64 = 1 << 8;
    /// Pixels.
    pub const PIXELS: u64 = 1 << 9;
    /// Mask pixels.
    pub const MASK: u64 = 1 << 10;
    /// Mask settings (enabled, linked, density, feather, default color).
    pub const MASK_SETTINGS: u64 = 1 << 11;
    /// Vector mask.
    pub const VECTOR_MASK: u64 = 1 << 12;
    /// Effects.
    pub const EFFECTS: u64 = 1 << 13;
    /// Text.
    pub const TEXT: u64 = 1 << 14;
    /// Fill content or shape stroke.
    pub const FILL: u64 = 1 << 15;
    /// Adjustment settings.
    pub const ADJUSTMENT: u64 = 1 << 16;
    /// Parent or position among siblings.
    pub const PARENT: u64 = 1 << 17;
    /// Group open state.
    pub const OPEN: u64 = 1 << 18;
    /// Smart object placement.
    pub const PLACEMENT: u64 = 1 << 19;
    /// Blend If ranges.
    pub const BLEND_RANGES: u64 = 1 << 20;
    /// Kind (a layer converted: rasterized text, a group's kind, …).
    pub const KIND: u64 = 1 << 21;
    /// Advanced blending (knockout, blend clipped layers as group, …).
    pub const ADVANCED: u64 = 1 << 22;
    /// The pixels (and a linked mask) moved by whole pixels, unchanged
    /// otherwise: saving shifts their rectangles and keeps their data.
    pub const OFFSET: u64 = 1 << 23;
    /// An artboard's rectangle or background.
    pub const ARTBOARD: u64 = 1 << 24;

    /// Document: canvas size (or every layer moved with a crop).
    pub const DOC_CANVAS: u64 = 1 << 0;
    /// Document: guides.
    pub const DOC_GUIDES: u64 = 1 << 1;
    /// Document: resolution.
    pub const DOC_RESOLUTION: u64 = 1 << 2;
    /// Document: the layer stack (layers added, removed, or moved).
    pub const DOC_LAYERS: u64 = 1 << 3;
    /// Document: color mode (converted to RGB).
    pub const DOC_MODE: u64 = 1 << 4;
}

/// A layer.
#[derive(Clone, Debug, PartialEq)]
pub struct Layer {
    /// Stable id (the file's `lyid`), unique in the document.
    pub id: u32,
    /// Name.
    pub name: String,
    /// What it is.
    pub kind: LayerKind,
    /// The group it is in (`None`: the document's top level).
    pub parent: Option<LayerIdx>,
    /// A group's layers, bottom to top.
    pub children: Vec<LayerIdx>,
    /// Shown.
    pub visible: bool,
    /// Opacity, `0..=255`.
    pub opacity: u8,
    /// Fill opacity (opacity of the pixels, not the effects), `0..=255`.
    pub fill_opacity: u8,
    /// Blend mode.
    pub blend: BlendMode,
    /// Clipped to the layer below.
    pub clipping: bool,
    /// Locks.
    pub locks: Locks,
    /// Color tag (`0` none, then red, orange, yellow, green, blue, violet,
    /// gray).
    pub color_tag: u8,
    /// The layer is the document's Background (opaque, bottom, locked in
    /// place).
    pub background: bool,
    /// Pixels (RGBA, straight alpha).
    pub pixels: Raster,
    /// Pixel mask.
    pub mask: Option<LayerMask>,
    /// Vector mask.
    pub vector_mask: Option<VectorMask>,
    /// Layer style.
    pub effects: Option<Effects>,
    /// Blend If.
    pub blend_ranges: Option<BlendRanges>,
    /// Knockout: 0 none, 1 shallow, 2 deep.
    pub knockout: u8,
    /// Blend Clipped Layers as Group (on by default).
    pub blend_clipped_as_group: bool,
    /// Blend Interior Effects as Group (off by default).
    pub blend_interior_as_group: bool,
    /// Transparency Shapes Layer (on by default).
    pub transparency_shapes: bool,
    /// Layer Mask Hides Effects.
    pub mask_hides_effects: bool,
    /// Vector Mask Hides Effects.
    pub vector_mask_hides_effects: bool,
    /// The record in the opened file this layer saves from: its own, or
    /// for a copy, the original's (fields the engine does not model are
    /// kept from it).
    pub record: Option<u32>,
    /// Edit flags ([`flags`]) of properties changed since opening.
    pub edits: u64,
    /// Deleted (kept for undo and for other people's changes).
    pub removed: bool,
    /// Pixel generation: a new value (unique among the people editing)
    /// whenever the pixels are replaced wholesale (a transform, text laid
    /// out again), so shared tile changes are only applied to the pixels
    /// they were made on. Files open at generation 0.
    pub generation: u32,
}

impl Layer {
    /// A new, empty, visible pixel layer.
    pub fn new(id: u32, name: impl Into<String>) -> Layer {
        Layer {
            id,
            name: name.into(),
            kind: LayerKind::Pixel,
            parent: None,
            children: Vec::new(),
            visible: true,
            opacity: 255,
            fill_opacity: 255,
            blend: BlendMode::Normal,
            clipping: false,
            locks: Locks::default(),
            color_tag: 0,
            background: false,
            pixels: Raster::rgba(),
            mask: None,
            vector_mask: None,
            effects: None,
            blend_ranges: None,
            knockout: 0,
            blend_clipped_as_group: true,
            blend_interior_as_group: false,
            transparency_shapes: true,
            mask_hides_effects: false,
            vector_mask_hides_effects: false,
            record: None,
            edits: flags::CREATED,
            removed: false,
            generation: 0,
        }
    }

    /// Whether the layer is a group.
    pub fn is_group(&self) -> bool {
        self.kind.is_group()
    }
}

/// The merged image the file stores (Photoshop's own rendering of every
/// layer), shown where no edit has changed what it would look like.
#[derive(Clone, Debug, PartialEq)]
pub struct Composite {
    /// The pixels (RGBA, grid at the canvas origin).
    pub raster: Raster,
    /// Canvas areas edits changed since opening: the engine composites
    /// the layers there itself.
    pub stale: Vec<IRect>,
}

impl Composite {
    /// Whether no part of `rect` is stale.
    pub fn covers(&self, rect: &IRect) -> bool {
        !self.stale.iter().any(|s| s.intersects(rect))
    }

    /// Marks an area stale.
    pub fn invalidate(&mut self, rect: IRect) {
        if rect.is_empty() {
            return;
        }
        if self.stale.iter().any(|s| s.contains_rect(&rect)) {
            return;
        }
        self.stale.retain(|s| !rect.contains_rect(s));
        self.stale.push(rect);
        // Many small areas cost more to test than one large one.
        if self.stale.len() > 64 {
            let all = self
                .stale
                .iter()
                .fold(IRect::default(), |acc, r| acc.union(r));
            self.stale = vec![all];
        }
    }
}

/// A document: the canvas and its layers.
#[derive(Clone, Debug)]
pub struct Document {
    /// Canvas width in pixels.
    pub width: u32,
    /// Canvas height in pixels.
    pub height: u32,
    /// The file's color mode.
    pub mode: ColorMode,
    /// The file's bits per channel (1, 8, 16, or 32).
    pub depth: u16,
    /// Pixels per inch.
    pub resolution: f64,
    /// Every layer, removed ones included.
    pub layers: Vec<Layer>,
    /// The top-level stack, bottom to top.
    pub roots: Vec<LayerIdx>,
    /// Ruler guides.
    pub guides: Vec<Guide>,
    /// Patterns fills and effects use.
    pub patterns: Vec<Pattern>,
    /// Global light angle, in degrees.
    pub global_angle: f32,
    /// Global light altitude, in degrees.
    pub global_altitude: f32,
    /// The stored merged image, when the file has a real one.
    pub composite: Option<Composite>,
    /// The opened file (saving patches it).
    pub source: Option<Arc<crate::file::PsdFile>>,
    /// Document edit flags ([`flags`]`::DOC_*`).
    pub edits: u64,
    /// The id the next new layer gets.
    pub next_id: u32,
}

impl Document {
    /// A blank document with no layers.
    pub fn new(width: u32, height: u32) -> Document {
        Document {
            width,
            height,
            mode: ColorMode::Rgb,
            depth: 8,
            resolution: 72.0,
            layers: Vec::new(),
            roots: Vec::new(),
            guides: Vec::new(),
            patterns: Vec::new(),
            global_angle: 120.0,
            global_altitude: 30.0,
            composite: None,
            source: None,
            edits: 0,
            next_id: 1,
        }
    }

    /// The canvas rectangle.
    pub fn bounds(&self) -> IRect {
        IRect::new(0, 0, self.width as i32, self.height as i32)
    }

    /// A layer.
    pub fn layer(&self, i: LayerIdx) -> &Layer {
        &self.layers[i as usize]
    }

    /// A layer, to change.
    pub fn layer_mut(&mut self, i: LayerIdx) -> &mut Layer {
        &mut self.layers[i as usize]
    }

    /// The layer with an id (removed ones included).
    pub fn find(&self, id: u32) -> Option<LayerIdx> {
        self.layers
            .iter()
            .position(|l| l.id == id)
            .map(|i| i as LayerIdx)
    }

    /// The stack a layer is in: its group's children or the top level.
    pub fn siblings(&self, i: LayerIdx) -> &[LayerIdx] {
        match self.layer(i).parent {
            Some(p) => &self.layer(p).children,
            None => &self.roots,
        }
    }

    /// The stack of a group (the top level for `None`).
    pub fn stack(&self, parent: Option<LayerIdx>) -> &[LayerIdx] {
        match parent {
            Some(p) => &self.layer(p).children,
            None => &self.roots,
        }
    }

    /// The stack of a group (the top level for `None`), to change.
    pub fn stack_mut(&mut self, parent: Option<LayerIdx>) -> &mut Vec<LayerIdx> {
        match parent {
            Some(p) => &mut self.layers[p as usize].children,
            None => &mut self.roots,
        }
    }

    /// Every live layer, depth first from the top of the document down
    /// (the layers panel's order), with its depth.
    pub fn panel_order(&self) -> Vec<(LayerIdx, usize)> {
        fn walk(
            doc: &Document,
            stack: &[LayerIdx],
            depth: usize,
            out: &mut Vec<(LayerIdx, usize)>,
        ) {
            for &i in stack.iter().rev() {
                out.push((i, depth));
                if doc.layer(i).is_group() {
                    walk(doc, &doc.layer(i).children, depth + 1, out);
                }
            }
        }
        let mut out = Vec::new();
        walk(self, &self.roots, 0, &mut out);
        out
    }

    /// Every live layer from the bottom of the document up (painting
    /// order, groups before their children).
    pub fn paint_order(&self) -> Vec<LayerIdx> {
        fn walk(doc: &Document, stack: &[LayerIdx], out: &mut Vec<LayerIdx>) {
            for &i in stack {
                out.push(i);
                if doc.layer(i).is_group() {
                    walk(doc, &doc.layer(i).children, out);
                }
            }
        }
        let mut out = Vec::new();
        walk(self, &self.roots, &mut out);
        out
    }

    /// Whether a layer and every group it is in are visible.
    pub fn is_shown(&self, i: LayerIdx) -> bool {
        let mut at = Some(i);
        while let Some(j) = at {
            let l = self.layer(j);
            if !l.visible || l.removed {
                return false;
            }
            at = l.parent;
        }
        true
    }

    /// Whether `ancestor` is `i` or contains it.
    pub fn is_within(&self, i: LayerIdx, ancestor: LayerIdx) -> bool {
        let mut at = Some(i);
        while let Some(j) = at {
            if j == ancestor {
                return true;
            }
            at = self.layer(j).parent;
        }
        false
    }

    /// The pattern with an id.
    pub fn pattern(&self, id: &str) -> Option<&Pattern> {
        self.patterns.iter().find(|p| p.id == id)
    }

    /// A fresh layer id.
    pub fn allocate_id(&mut self) -> u32 {
        let id = self.next_id;
        self.next_id = self.next_id.wrapping_add(1).max(1);
        id
    }

    /// Adds a layer to the arena (not to any stack); returns its index.
    pub fn push_layer(&mut self, layer: Layer) -> LayerIdx {
        self.layers.push(layer);
        (self.layers.len() - 1) as LayerIdx
    }
}

#[cfg(test)]
mod test;
