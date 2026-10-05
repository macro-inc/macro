//! Text: the characters and styles a node holds, and the glyph layout Figma
//! derived for it. Figma stores each glyph's outline, so text renders
//! exactly as laid out in Figma without the fonts.

use super::geom::Vec2;
use super::paint::Paint;
use serde::Serialize;
use std::sync::Arc;

/// The characters of a text node and their styling.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct TextContent {
    pub characters: Arc<str>,
    /// Style id per character (UTF-16 code unit); empty means all base style.
    pub style_ids: Arc<[u32]>,
    /// Styles that differ from the node's base style, by style id.
    pub styles: Arc<[StyleRun]>,
}

/// One entry of a text node's style override table.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct StyleRun {
    pub id: u32,
    pub fills: Option<Arc<[Paint]>>,
    pub font_family: Option<Arc<str>>,
    pub font_style: Option<Arc<str>>,
    pub font_size: Option<f32>,
    pub decoration: Option<Arc<str>>,
}

/// One positioned glyph.
#[derive(Clone, Debug, PartialEq)]
pub struct Glyph {
    /// Outline in em units, y up; `None` for glyphs without an outline
    /// (spaces, emoji).
    pub blob: Option<u32>,
    /// Baseline origin in node coordinates.
    pub x: f32,
    pub y: f32,
    pub font_size: f32,
    pub style_id: u32,
    pub first_char: u32,
    pub advance: f32,
    pub rotation: f32,
    pub emoji: Option<Arc<[u32]>>,
}

/// Underlines and strikethroughs, as rectangles in node coordinates.
#[derive(Clone, Debug, PartialEq)]
pub struct Decoration {
    pub rects: Arc<[[f32; 4]]>,
    pub style_id: u32,
}

/// The layout Figma derived for a text node.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct TextLayout {
    pub glyphs: Arc<[Glyph]>,
    pub decorations: Arc<[Decoration]>,
    pub layout_size: Option<Vec2>,
    /// Number of lines (from the baselines).
    pub lines: u32,
    /// Where Figma puts the first line's baseline (its top plus ascent),
    /// which auto layout aligns on.
    pub first_baseline: Option<f32>,
}

/// The base style of a text node, for the inspector.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextStyle {
    pub font_family: Option<String>,
    pub font_style: Option<String>,
    pub font_size: Option<f32>,
    /// `(value, "PIXELS" | "PERCENT" | "RAW")`.
    pub line_height: Option<(f32, String)>,
    pub letter_spacing: Option<(f32, String)>,
    pub paragraph_spacing: Option<f32>,
    pub align_horizontal: Option<String>,
    pub align_vertical: Option<String>,
    pub decoration: Option<String>,
    pub case: Option<String>,
    pub auto_resize: Option<String>,
}
