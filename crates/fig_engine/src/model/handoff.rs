//! Handoff and layout aids: export presets (`exportSettings`), layout grids
//! (`layoutGrids`), and ruler guides (`guides`, on pages and frames).

use super::{Color, Guid};
use serde::{Deserialize, Serialize};

/// An export file format.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ExportFormat {
    #[default]
    Png,
    /// Figma's `JPEG` image type ("JPG" in its menus).
    #[serde(alias = "JPG")]
    Jpeg,
    Svg,
    Pdf,
}

impl ExportFormat {
    /// Figma's `ImageType` name.
    pub fn parse(s: &str) -> ExportFormat {
        match s {
            "JPEG" | "JPG" => ExportFormat::Jpeg,
            "SVG" => ExportFormat::Svg,
            "PDF" => ExportFormat::Pdf,
            _ => ExportFormat::Png,
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            ExportFormat::Png => "PNG",
            ExportFormat::Jpeg => "JPEG",
            ExportFormat::Svg => "SVG",
            ExportFormat::Pdf => "PDF",
        }
    }

    pub fn extension(self) -> &'static str {
        match self {
            ExportFormat::Png => "png",
            ExportFormat::Jpeg => "jpg",
            ExportFormat::Svg => "svg",
            ExportFormat::Pdf => "pdf",
        }
    }

    pub fn mime(self) -> &'static str {
        match self {
            ExportFormat::Png => "image/png",
            ExportFormat::Jpeg => "image/jpeg",
            ExportFormat::Svg => "image/svg+xml",
            ExportFormat::Pdf => "application/pdf",
        }
    }
}

/// How an export is sized.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ExportConstraint {
    /// `value` times the layer's size.
    #[default]
    ContentScale,
    /// `value` pixels wide.
    ContentWidth,
    /// `value` pixels high.
    ContentHeight,
}

impl ExportConstraint {
    pub fn parse(s: &str) -> ExportConstraint {
        match s {
            "CONTENT_WIDTH" => ExportConstraint::ContentWidth,
            "CONTENT_HEIGHT" => ExportConstraint::ContentHeight,
            _ => ExportConstraint::ContentScale,
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            ExportConstraint::ContentScale => "CONTENT_SCALE",
            ExportConstraint::ContentWidth => "CONTENT_WIDTH",
            ExportConstraint::ContentHeight => "CONTENT_HEIGHT",
        }
    }
}

/// An export preset of a layer (the Export section).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ExportSetting {
    pub format: ExportFormat,
    /// Appended to the file name (`@2x`, `-dark`).
    pub suffix: String,
    pub constraint: ExportConstraint,
    pub value: f32,
    /// SVG: text as outlines (Figma's default) rather than `<text>`.
    pub svg_outline_text: bool,
    /// SVG: an `id` on every layer (`svgIDMode: ALWAYS`).
    pub svg_include_id: bool,
    /// Only the layer, not what overlaps it (Figma's default).
    pub contents_only: bool,
    /// The layer's frame rather than its render bounds (shadows, strokes).
    pub use_absolute_bounds: bool,
    /// JPEG quality, `1..=100`. Figma's files have no field for it, so it
    /// lasts for the session (and is shared with collaborators).
    pub quality: u8,
}

impl Default for ExportSetting {
    fn default() -> Self {
        ExportSetting {
            format: ExportFormat::Png,
            suffix: String::new(),
            constraint: ExportConstraint::ContentScale,
            value: 1.0,
            svg_outline_text: true,
            svg_include_id: false,
            contents_only: true,
            use_absolute_bounds: false,
            quality: DEFAULT_JPEG_QUALITY,
        }
    }
}

/// The JPEG quality exports use unless a preset says otherwise.
pub const DEFAULT_JPEG_QUALITY: u8 = 90;

/// Columns, rows, or a square grid.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum GridPattern {
    /// Square cells of `section_size`.
    #[default]
    Grid,
    /// Columns (`Axis::X`) or rows (`Axis::Y`).
    Stripes,
}

/// An axis: `X` runs across (columns and vertical guides), `Y` down.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Axis {
    #[default]
    X,
    Y,
}

/// Where columns or rows sit in their frame.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum GridAlign {
    /// From the left (or top), `offset` in.
    Min,
    Center,
    /// Across the frame between margins of `offset`; sections widen.
    #[default]
    Stretch,
    /// From the right (or bottom), `offset` in.
    Max,
}

impl GridAlign {
    pub fn parse(s: &str) -> GridAlign {
        match s {
            "MIN" => GridAlign::Min,
            "CENTER" => GridAlign::Center,
            "MAX" => GridAlign::Max,
            _ => GridAlign::Stretch,
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            GridAlign::Min => "MIN",
            GridAlign::Center => "CENTER",
            GridAlign::Stretch => "STRETCH",
            GridAlign::Max => "MAX",
        }
    }
}

/// One layout grid of a frame (Figma's `LayoutGrid`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LayoutGrid {
    pub pattern: GridPattern,
    pub axis: Axis,
    pub align: GridAlign,
    pub visible: bool,
    /// Columns or rows; Figma stores "Auto" (as many as fit) as a large
    /// count, and anything `<= 0` is treated the same.
    pub count: i32,
    /// The margin (stretch) or the offset from the aligned side.
    pub offset: f32,
    /// A column's width or row's height (fixed alignments), or a cell's side.
    pub section_size: f32,
    pub gutter: f32,
    pub color: Color,
}

impl LayoutGrid {
    /// Figma's default grid: 10 px square cells in translucent red.
    pub fn default_grid() -> LayoutGrid {
        LayoutGrid {
            pattern: GridPattern::Grid,
            axis: Axis::X,
            align: GridAlign::Stretch,
            visible: true,
            count: 5,
            offset: 0.0,
            section_size: 10.0,
            gutter: 20.0,
            color: Color {
                r: 1.0,
                g: 0.0,
                b: 0.0,
                a: 0.1,
            },
        }
    }
}

/// A ruler guide on a page or frame (Figma's `Guide`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Guide {
    /// `X`: a vertical line at x = `offset`; `Y`: a horizontal one.
    pub axis: Axis,
    /// From the page origin, or the frame's top left.
    pub offset: f32,
    /// Figma gives guides ids; kept when the file has them.
    pub guid: Option<Guid>,
}
