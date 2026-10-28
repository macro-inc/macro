//! GDI objects: pens, brushes, palettes, regions, and the stock objects.

use super::text::LogFont;
use crate::model::color::Rgba;
use crate::render::scene::Raster;
use std::sync::Arc;

/// `PS_NULL`: the pen draws nothing.
pub(super) const PS_NULL: u32 = 5;
/// `PS_INSIDEFRAME`: figures shrink so the pen stays inside the bounding box.
pub(super) const PS_INSIDEFRAME: u32 = 6;
/// `PS_USERSTYLE`: dash lengths come from the pen.
pub(super) const PS_USERSTYLE: u32 = 7;
/// `PS_ALTERNATE`: every other pixel.
pub(super) const PS_ALTERNATE: u32 = 8;
/// Mask of the dash style in a pen style.
pub(super) const PS_STYLE_MASK: u32 = 0xF;
/// `PS_GEOMETRIC`: the width is in logical units.
pub(super) const PS_GEOMETRIC: u32 = 0x1_0000;
/// `PS_ENDCAP_SQUARE`.
pub(super) const PS_ENDCAP_SQUARE: u32 = 0x100;
/// `PS_ENDCAP_FLAT`.
pub(super) const PS_ENDCAP_FLAT: u32 = 0x200;
/// Mask of the end cap in a pen style.
pub(super) const PS_ENDCAP_MASK: u32 = 0xF00;
/// `PS_JOIN_BEVEL`.
pub(super) const PS_JOIN_BEVEL: u32 = 0x1000;
/// `PS_JOIN_MITER`.
pub(super) const PS_JOIN_MITER: u32 = 0x2000;
/// Mask of the join in a pen style.
pub(super) const PS_JOIN_MASK: u32 = 0xF000;

/// A pen.
#[derive(Clone, Debug)]
pub(super) struct Pen {
    /// `PS_*` style bits (dash style, end cap, join, type).
    pub(super) style: u32,
    /// Width in logical units (ignored for cosmetic pens).
    pub(super) width: f64,
    /// Color.
    pub(super) color: Rgba,
    /// One device pixel wide whatever the transform.
    pub(super) cosmetic: bool,
    /// `PS_USERSTYLE` dash and gap lengths.
    pub(super) dashes: Vec<f64>,
}

impl Pen {
    /// A solid pen (`width` 0 = cosmetic).
    pub(super) fn solid(color: Rgba, width: f64) -> Self {
        Self {
            style: 0,
            width,
            color,
            cosmetic: width <= 0.0,
            dashes: Vec::new(),
        }
    }

    /// A `CreatePen` pen: dash styles turn solid when wider than one unit.
    pub(super) fn create(style: u32, width: f64, color: Rgba) -> Self {
        let style = if width > 1.0 && (1..=4).contains(&(style & PS_STYLE_MASK)) {
            style & !PS_STYLE_MASK
        } else {
            style
        };
        Self {
            style,
            width,
            color,
            cosmetic: width == 0.0,
            dashes: Vec::new(),
        }
    }

    /// `NULL_PEN`.
    pub(super) fn null() -> Self {
        Self {
            style: PS_NULL,
            ..Self::solid(Rgba::BLACK, 0.0)
        }
    }
}

/// A monochrome pattern; set bits take the background color, clear bits the text color.
#[derive(Debug)]
pub(super) struct MonoPattern {
    /// Width in pixels.
    pub(super) width: u32,
    /// Height in pixels.
    pub(super) height: u32,
    /// Row-major bits, top row first.
    pub(super) bits: Vec<bool>,
}

/// A brush.
#[derive(Clone, Debug)]
pub(super) enum Brush {
    /// `BS_NULL`: nothing is painted.
    Null,
    /// A solid color.
    Solid(Rgba),
    /// An 8×8 `HS_*` hatch in a color over the background.
    Hatch(u32, Rgba),
    /// A color bitmap tiled from the brush origin.
    Pattern(Arc<Raster>),
    /// A monochrome bitmap colored by the text and background colors.
    Mono(Arc<MonoPattern>),
}

/// A GDI object in the object table.
#[derive(Clone, Debug)]
pub(super) enum Object {
    /// A pen.
    Pen(Pen),
    /// A brush.
    Brush(Brush),
    /// A logical font.
    Font(LogFont),
    /// A logical palette (empty = the default palette).
    Palette(Arc<Vec<[u8; 3]>>),
    /// A WMF region: rectangles in logical units.
    Region(Vec<[i32; 4]>),
    /// Anything else that still occupies a slot.
    Other,
}

/// A stock object (`0x80000000 | index` in EMF).
pub(super) fn stock_object(index: u32) -> Option<Object> {
    let gray = |v: u8| Object::Brush(Brush::Solid(Rgba::from_u8(v, v, v)));
    Some(match index {
        0 | 18 => gray(255),
        1 => gray(192),
        2 => gray(128),
        3 => gray(64),
        4 => gray(0),
        5 => Object::Brush(Brush::Null),
        6 => Object::Pen(Pen::solid(Rgba::WHITE, 0.0)),
        7 | 19 => Object::Pen(Pen::solid(Rgba::BLACK, 0.0)),
        8 => Object::Pen(Pen::null()),
        10 | 11 | 16 => Object::Font(LogFont::stock("Courier New", -13, 400)),
        12 => Object::Font(LogFont::stock("Arial", -13, 400)),
        13 | 14 => Object::Font(LogFont::stock("Arial", -16, 700)),
        17 => Object::Font(LogFont::stock("Tahoma", -11, 400)),
        15 => Object::Palette(Arc::new(Vec::new())),
        _ => return None,
    })
}

/// The 20 static colors of the default logical palette.
pub(super) const DEFAULT_PALETTE: [[u8; 3]; 20] = [
    [0, 0, 0],
    [128, 0, 0],
    [0, 128, 0],
    [128, 128, 0],
    [0, 0, 128],
    [128, 0, 128],
    [0, 128, 128],
    [192, 192, 192],
    [192, 220, 192],
    [166, 202, 240],
    [255, 251, 240],
    [160, 160, 164],
    [128, 128, 128],
    [255, 0, 0],
    [0, 255, 0],
    [255, 255, 0],
    [0, 0, 255],
    [255, 0, 255],
    [0, 255, 255],
    [255, 255, 255],
];
