//! Colors, shading and highlighting.

use crate::xml::{NodeId, XmlTree};
use pptx_engine::model::color::{ColorScheme, Rgba};

/// The theme colors and fonts property parsing needs.
#[derive(Clone, Debug, Default)]
pub struct ThemeInfo {
    /// Theme color scheme.
    pub colors: ColorScheme,
    /// Heading (major) fonts.
    pub major: pptx_engine::model::theme::FontCollection,
    /// Body (minor) fonts.
    pub minor: pptx_engine::model::theme::FontCollection,
}

impl ThemeInfo {
    /// A WordprocessingML theme color name (`accent1`, `text1`, `background2`...).
    pub fn color(&self, name: &str) -> Option<Rgba> {
        let slot = match name {
            "dark1" | "text1" => "dk1",
            "light1" | "background1" => "lt1",
            "dark2" | "text2" => "dk2",
            "light2" | "background2" => "lt2",
            "hyperlink" => "hlink",
            "followedHyperlink" => "folHlink",
            other => other,
        };
        self.colors.slot(slot)
    }

    /// Resolves a theme font slot (`majorHAnsi`, `minorEastAsia`...).
    pub fn font(&self, slot: &str) -> Option<&str> {
        let (collection, kind) = match slot {
            "majorAscii" | "majorHAnsi" => (&self.major, 0),
            "majorEastAsia" => (&self.major, 1),
            "majorBidi" => (&self.major, 2),
            "minorAscii" | "minorHAnsi" => (&self.minor, 0),
            "minorEastAsia" => (&self.minor, 1),
            "minorBidi" => (&self.minor, 2),
            _ => return None,
        };
        let face = match kind {
            0 => &collection.latin,
            1 => &collection.ea,
            _ => &collection.cs,
        };
        (!face.is_empty()).then_some(face.as_str())
    }
}

/// Applies `w:themeTint` / `w:themeShade` (hex bytes) to a theme color.
fn tint_shade(mut c: Rgba, tint: Option<&str>, shade: Option<&str>) -> Rgba {
    let byte = |v: Option<&str>| v.and_then(|s| u8::from_str_radix(s.trim(), 16).ok());
    if let Some(t) = byte(tint) {
        let k = f32::from(t) / 255.0;
        c.r = c.r * k + (1.0 - k);
        c.g = c.g * k + (1.0 - k);
        c.b = c.b * k + (1.0 - k);
    }
    if let Some(s) = byte(shade) {
        let k = f32::from(s) / 255.0;
        c.r *= k;
        c.g *= k;
        c.b *= k;
    }
    c
}

/// A run or border color: `auto` (context decides) or a value.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum ColorRef {
    /// Automatic (black text, or white on dark shading).
    Auto,
    /// An explicit color.
    Rgb(Rgba),
}

impl ColorRef {
    /// The color, `None` for automatic.
    pub fn rgb(self) -> Option<Rgba> {
        match self {
            ColorRef::Auto => None,
            ColorRef::Rgb(c) => Some(c),
        }
    }
}

/// Reads a color from `val`-style attributes: `attr` (hex or `auto`) and the
/// theme attributes `{prefix}Color`, `{prefix}Tint`, `{prefix}Shade`.
pub fn read_color(
    t: &XmlTree,
    n: NodeId,
    attr: &str,
    theme_prefix: &str,
    theme: &ThemeInfo,
) -> Option<ColorRef> {
    let theme_name = t.w_attr(n, &format!("{theme_prefix}Color"));
    if let Some(name) = theme_name
        && let Some(c) = theme.color(name)
    {
        return Some(ColorRef::Rgb(tint_shade(
            c,
            t.w_attr(n, &format!("{theme_prefix}Tint")),
            t.w_attr(n, &format!("{theme_prefix}Shade")),
        )));
    }
    let v = t.w_attr(n, attr)?;
    if v.eq_ignore_ascii_case("auto") {
        return Some(ColorRef::Auto);
    }
    Rgba::from_hex(v).map(ColorRef::Rgb)
}

/// The effective background of a `w:shd` element (`None` = no shading).
pub fn read_shading(t: &XmlTree, n: NodeId, theme: &ThemeInfo) -> Option<Rgba> {
    let pattern = t.val(n).unwrap_or("clear");
    let fill = match t.w_attr(n, "themeFill").and_then(|name| theme.color(name)) {
        Some(c) => Some(tint_shade(
            c,
            t.w_attr(n, "themeFillTint"),
            t.w_attr(n, "themeFillShade"),
        )),
        None => t
            .w_attr(n, "fill")
            .filter(|v| !v.eq_ignore_ascii_case("auto"))
            .and_then(Rgba::from_hex),
    };
    let color = match read_color(t, n, "color", "theme", theme) {
        Some(ColorRef::Rgb(c)) => Some(c),
        _ => None,
    };
    let pct = |p: f32| {
        let fg = color.unwrap_or(Rgba::BLACK);
        let bg = fill.unwrap_or(Rgba::WHITE);
        Some(bg.lerp(fg, p))
    };
    match pattern {
        "nil" => None,
        "clear" => fill,
        "solid" => color.or(Some(Rgba::BLACK)),
        p if p.starts_with("pct") => {
            let v: f32 = p[3..].parse().unwrap_or(0.0);
            pct(v / 100.0)
        }
        // Stripes and grids average to roughly a quarter coverage.
        _ => pct(0.25),
    }
}

/// A highlight color name (`w:highlight`).
pub fn highlight_color(name: &str) -> Option<Rgba> {
    let hex = match name {
        "black" => "000000",
        "blue" => "0000FF",
        "cyan" => "00FFFF",
        "green" => "00FF00",
        "magenta" => "FF00FF",
        "red" => "FF0000",
        "yellow" => "FFFF00",
        "white" => "FFFFFF",
        "darkBlue" => "000080",
        "darkCyan" => "008080",
        "darkGreen" => "008000",
        "darkMagenta" => "800080",
        "darkRed" => "800000",
        "darkYellow" => "808000",
        "darkGray" => "808080",
        "lightGray" => "C0C0C0",
        _ => return None,
    };
    Rgba::from_hex(hex)
}
