//! Borders of paragraphs, tables, cells, runs and pages.

use super::color::{ColorRef, ThemeInfo, read_color};
use crate::units::eighth_points;
use crate::xml::{NodeId, XmlTree, parse_int};

/// A border line style, reduced to what drawing needs.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LineStyle {
    /// One line.
    Single,
    /// A thick line.
    Thick,
    /// Two lines.
    Double,
    /// Three lines.
    Triple,
    /// Dots.
    Dotted,
    /// Dashes.
    Dashed,
    /// Dash-dot pattern.
    DotDash,
    /// Two lines of different weights.
    ThinThick,
    /// A wavy line.
    Wave,
    /// Raised or sunken 3-D effect, drawn as a single line.
    ThreeD,
}

/// One border edge.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Border {
    /// Style.
    pub style: LineStyle,
    /// Line width in points.
    pub width: f32,
    /// Distance from the text in points.
    pub space: f32,
    /// Color (`Auto` = black).
    pub color: ColorRef,
}

impl Border {
    /// Total width the border occupies, counting all its lines.
    pub fn total_width(&self) -> f32 {
        match self.style {
            LineStyle::Double => self.width * 3.0,
            LineStyle::Triple => self.width * 5.0,
            LineStyle::ThinThick => self.width * 2.0,
            _ => self.width,
        }
    }
}

/// Reads a border element (`w:top`, `w:bottom`...). `None` for `nil`/`none`.
pub fn read_border(t: &XmlTree, n: NodeId, theme: &ThemeInfo) -> Option<Border> {
    let val = t.val(n).unwrap_or("none");
    let style = match val {
        "nil" | "none" => return None,
        "single" | "hairline" => LineStyle::Single,
        "thick" => LineStyle::Thick,
        "double" | "doubleWave" => LineStyle::Double,
        "triple" => LineStyle::Triple,
        "dotted" => LineStyle::Dotted,
        "dashed" | "dashSmallGap" => LineStyle::Dashed,
        "dotDash" | "dotDotDash" | "dashDotStroked" => LineStyle::DotDash,
        "wave" => LineStyle::Wave,
        "threeDEmboss" | "threeDEngrave" | "outset" | "inset" => LineStyle::ThreeD,
        v if v.starts_with("thinThick") || v.starts_with("thickThin") => LineStyle::ThinThick,
        // Art borders (apples, stars...) and anything else: a plain line.
        _ => LineStyle::Single,
    };
    // `sz` is in eighths of a point; Word clamps to 1/4..12 points.
    let size = t.w_attr(n, "sz").and_then(parse_int).unwrap_or(4);
    let width = eighth_points(size).clamp(0.25, 12.0);
    let width = if val == "hairline" { 0.25 } else { width };
    let space = t
        .w_attr(n, "space")
        .and_then(parse_int)
        .map_or(0.0, |v| v as f32);
    let color = read_color(t, n, "color", "theme", theme).unwrap_or(ColorRef::Auto);
    Some(Border {
        style,
        width,
        space,
        color,
    })
}
