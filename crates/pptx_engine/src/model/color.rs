//! DrawingML colors: scheme mapping and color transforms.

use crate::xml::{Ns, NodeId, XmlDoc};

/// A straight-alpha sRGB color with components in `0..=1`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rgba {
    /// Red.
    pub r: f32,
    /// Green.
    pub g: f32,
    /// Blue.
    pub b: f32,
    /// Alpha (opacity).
    pub a: f32,
}

impl Rgba {
    /// Opaque black.
    pub const BLACK: Rgba = Rgba { r: 0.0, g: 0.0, b: 0.0, a: 1.0 };
    /// Opaque white.
    pub const WHITE: Rgba = Rgba { r: 1.0, g: 1.0, b: 1.0, a: 1.0 };
    /// Fully transparent.
    pub const TRANSPARENT: Rgba = Rgba { r: 0.0, g: 0.0, b: 0.0, a: 0.0 };

    /// From 8-bit components.
    pub fn from_u8(r: u8, g: u8, b: u8) -> Self {
        Self { r: f32::from(r) / 255.0, g: f32::from(g) / 255.0, b: f32::from(b) / 255.0, a: 1.0 }
    }

    /// Parses `RRGGBB` hex.
    pub fn from_hex(hex: &str) -> Option<Self> {
        let hex = hex.trim().trim_start_matches('#');
        if hex.len() != 6 {
            return None;
        }
        let v = u32::from_str_radix(hex, 16).ok()?;
        Some(Self::from_u8((v >> 16) as u8, (v >> 8) as u8, v as u8))
    }

    /// `RRGGBB` hex of the color (alpha ignored).
    pub fn to_hex(&self) -> String {
        let c = |v: f32| (v.clamp(0.0, 1.0) * 255.0).round() as u8;
        format!("{:02X}{:02X}{:02X}", c(self.r), c(self.g), c(self.b))
    }

    /// The same color with alpha multiplied by `k`.
    pub fn with_alpha_mul(self, k: f32) -> Self {
        Self { a: (self.a * k).clamp(0.0, 1.0), ..self }
    }

    /// Linear interpolation between two colors.
    pub fn lerp(self, o: Rgba, t: f32) -> Self {
        Self {
            r: self.r + (o.r - self.r) * t,
            g: self.g + (o.g - self.g) * t,
            b: self.b + (o.b - self.b) * t,
            a: self.a + (o.a - self.a) * t,
        }
    }
}

/// Theme color slots in `clrScheme` order.
pub const SCHEME_SLOTS: [&str; 12] =
    ["dk1", "lt1", "dk2", "lt2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"];

/// A theme color scheme.
#[derive(Clone, Debug, PartialEq)]
pub struct ColorScheme {
    /// Colors in [`SCHEME_SLOTS`] order.
    pub colors: [Rgba; 12],
}

impl Default for ColorScheme {
    /// The Office 2013+ default theme colors.
    fn default() -> Self {
        let h = |s: &str| Rgba::from_hex(s).unwrap_or(Rgba::BLACK);
        Self {
            colors: [
                h("000000"),
                h("FFFFFF"),
                h("44546A"),
                h("E7E6E6"),
                h("4472C4"),
                h("ED7D31"),
                h("A5A5A5"),
                h("FFC000"),
                h("5B9BD5"),
                h("70AD47"),
                h("0563C1"),
                h("954F72"),
            ],
        }
    }
}

impl ColorScheme {
    /// Color of a slot name (`dk1`, `accent3`...).
    pub fn slot(&self, name: &str) -> Option<Rgba> {
        SCHEME_SLOTS.iter().position(|s| *s == name).map(|i| self.colors[i])
    }
}

/// Maps logical scheme colors (`bg1`, `tx1`...) to theme slots.
#[derive(Clone, Debug, PartialEq)]
pub struct ColorMap {
    /// `(logical name, slot name)` pairs.
    pub map: Vec<(String, String)>,
}

impl Default for ColorMap {
    fn default() -> Self {
        let pairs = [
            ("bg1", "lt1"),
            ("tx1", "dk1"),
            ("bg2", "lt2"),
            ("tx2", "dk2"),
            ("accent1", "accent1"),
            ("accent2", "accent2"),
            ("accent3", "accent3"),
            ("accent4", "accent4"),
            ("accent5", "accent5"),
            ("accent6", "accent6"),
            ("hlink", "hlink"),
            ("folHlink", "folHlink"),
        ];
        Self { map: pairs.iter().map(|(a, b)| ((*a).to_owned(), (*b).to_owned())).collect() }
    }
}

impl ColorMap {
    /// Reads a `clrMap` (or `overrideClrMapping`) element.
    pub fn parse(doc: &XmlDoc, node: NodeId) -> Self {
        let mut m = Self::default();
        for (logical, slot) in &mut m.map {
            if let Some(v) = doc.attr(node, logical) {
                v.clone_into(slot);
            }
        }
        m
    }

    /// The theme slot a logical color maps to.
    pub fn resolve<'a>(&'a self, name: &'a str) -> &'a str {
        self.map.iter().find(|(l, _)| l == name).map_or(name, |(_, s)| s.as_str())
    }
}

/// Everything needed to turn a color element into an [`Rgba`].
#[derive(Clone, Copy)]
pub struct ColorContext<'a> {
    /// The theme's color scheme.
    pub scheme: &'a ColorScheme,
    /// The effective color map.
    pub map: &'a ColorMap,
    /// The placeholder color (`phClr`) supplied by a style reference.
    pub ph_clr: Option<Rgba>,
}

impl<'a> ColorContext<'a> {
    /// The same context with a different `phClr`.
    pub fn with_ph(self, ph: Option<Rgba>) -> ColorContext<'a> {
        ColorContext { ph_clr: ph, ..self }
    }

    /// Resolves a scheme color name.
    pub fn scheme_color(&self, name: &str) -> Option<Rgba> {
        if name == "phClr" {
            return Some(self.ph_clr.unwrap_or(Rgba::BLACK));
        }
        self.scheme.slot(self.map.resolve(name)).or_else(|| self.scheme.slot(name))
    }
}

const COLOR_ELEMENTS: [&str; 6] = ["srgbClr", "schemeClr", "sysClr", "prstClr", "hslClr", "scrgbClr"];

/// Whether `node` is one of the six DrawingML color elements.
pub fn is_color_element(doc: &XmlDoc, node: NodeId) -> bool {
    doc.ns(node) == Ns::A && COLOR_ELEMENTS.contains(&doc.local(node))
}

/// Resolves the first color-choice child of `parent`.
pub fn find_color(doc: &XmlDoc, parent: NodeId, ctx: &ColorContext<'_>) -> Option<Rgba> {
    doc.children(parent).find(|&c| is_color_element(doc, c)).and_then(|c| parse_color(doc, c, ctx))
}

/// Resolves a color element (with its transforms).
pub fn parse_color(doc: &XmlDoc, node: NodeId, ctx: &ColorContext<'_>) -> Option<Rgba> {
    let base = match doc.local(node) {
        "srgbClr" => Rgba::from_hex(doc.attr(node, "val")?)?,
        "schemeClr" => ctx.scheme_color(doc.attr(node, "val")?)?,
        "sysClr" => doc
            .attr(node, "lastClr")
            .and_then(Rgba::from_hex)
            .or_else(|| system_color(doc.attr(node, "val")?))?,
        "prstClr" => preset_color(doc.attr(node, "val")?)?,
        "hslClr" => {
            let h = doc.attr_f64(node, "hue").unwrap_or(0.0) / 60000.0;
            let s = percent(doc.attr(node, "sat").unwrap_or("0"));
            let l = percent(doc.attr(node, "lum").unwrap_or("0"));
            hsl_to_rgb(h, s, l)
        }
        "scrgbClr" => {
            let c = |a: &str| to_srgb(percent(doc.attr(node, a).unwrap_or("0")).clamp(0.0, 1.0));
            Rgba { r: c("r") as f32, g: c("g") as f32, b: c("b") as f32, a: 1.0 }
        }
        _ => return None,
    };
    Some(apply_transforms(doc, node, base))
}

/// Parses an ST_Percentage (`"50000"` or `"50%"`) to a fraction.
pub fn percent(v: &str) -> f64 {
    let v = v.trim();
    if let Some(p) = v.strip_suffix('%') {
        return p.trim().parse::<f64>().unwrap_or(0.0) / 100.0;
    }
    v.parse::<f64>().unwrap_or(0.0) / 100_000.0
}

/// LibreOffice-compatible gamma used for DrawingML's linear-RGB transforms.
const GAMMA: f64 = 2.3;

fn to_linear(c: f64) -> f64 {
    c.clamp(0.0, 1.0).powf(GAMMA)
}

fn to_srgb(c: f64) -> f64 {
    c.clamp(0.0, 1.0).powf(1.0 / GAMMA)
}

/// RGB → HSL (`h` in degrees, `s`/`l` in `0..=1`).
pub fn rgb_to_hsl(r: f64, g: f64, b: f64) -> (f64, f64, f64) {
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let l = (max + min) / 2.0;
    if (max - min).abs() < 1e-12 {
        return (0.0, 0.0, l);
    }
    let d = max - min;
    let s = if l > 0.5 { d / (2.0 - max - min) } else { d / (max + min) };
    let h = if max == r {
        (g - b) / d + if g < b { 6.0 } else { 0.0 }
    } else if max == g {
        (b - r) / d + 2.0
    } else {
        (r - g) / d + 4.0
    };
    (h * 60.0, s, l)
}

/// HSL → RGB.
pub fn hsl_to_rgb(h: f64, s: f64, l: f64) -> Rgba {
    let (r, g, b) = hsl_to_rgb_f64(h, s, l);
    Rgba { r: r as f32, g: g as f32, b: b as f32, a: 1.0 }
}

fn hsl_to_rgb_f64(h: f64, s: f64, l: f64) -> (f64, f64, f64) {
    if s <= 0.0 {
        return (l, l, l);
    }
    let q = if l < 0.5 { l * (1.0 + s) } else { l + s - l * s };
    let p = 2.0 * l - q;
    let hk = h.rem_euclid(360.0) / 360.0;
    let f = |t: f64| {
        let t = t.rem_euclid(1.0);
        if t < 1.0 / 6.0 {
            p + (q - p) * 6.0 * t
        } else if t < 0.5 {
            q
        } else if t < 2.0 / 3.0 {
            p + (q - p) * (2.0 / 3.0 - t) * 6.0
        } else {
            p
        }
    };
    (f(hk + 1.0 / 3.0), f(hk), f(hk - 1.0 / 3.0))
}

/// Applies the transform children of a color element in document order.
pub fn apply_transforms(doc: &XmlDoc, node: NodeId, base: Rgba) -> Rgba {
    let mut r = f64::from(base.r);
    let mut g = f64::from(base.g);
    let mut b = f64::from(base.b);
    let mut a = f64::from(base.a);
    for t in doc.children(node) {
        let val = doc.attr(t, "val").map_or(0.0, percent);
        let hsl_op = |r: &mut f64, g: &mut f64, b: &mut f64, f: &dyn Fn(&mut f64, &mut f64, &mut f64)| {
            let (mut h, mut s, mut l) = rgb_to_hsl(*r, *g, *b);
            f(&mut h, &mut s, &mut l);
            let (nr, ng, nb) = hsl_to_rgb_f64(h, s.clamp(0.0, 1.0), l.clamp(0.0, 1.0));
            *r = nr;
            *g = ng;
            *b = nb;
        };
        let lin_op = |r: &mut f64, g: &mut f64, b: &mut f64, f: &dyn Fn(f64) -> f64| {
            *r = to_srgb(f(to_linear(*r)));
            *g = to_srgb(f(to_linear(*g)));
            *b = to_srgb(f(to_linear(*b)));
        };
        match doc.local(t) {
            "alpha" => a = val,
            "alphaMod" => a *= val,
            "alphaOff" => a += val,
            "lum" => hsl_op(&mut r, &mut g, &mut b, &|_, _, l| *l = val),
            "lumMod" => hsl_op(&mut r, &mut g, &mut b, &|_, _, l| *l *= val),
            "lumOff" => hsl_op(&mut r, &mut g, &mut b, &|_, _, l| *l += val),
            "sat" => hsl_op(&mut r, &mut g, &mut b, &|_, s, _| *s = val),
            "satMod" => hsl_op(&mut r, &mut g, &mut b, &|_, s, _| *s *= val),
            "satOff" => hsl_op(&mut r, &mut g, &mut b, &|_, s, _| *s += val),
            "hue" => {
                let deg = doc.attr_f64(t, "val").unwrap_or(0.0) / 60000.0;
                hsl_op(&mut r, &mut g, &mut b, &|h, _, _| *h = deg);
            }
            "hueMod" => hsl_op(&mut r, &mut g, &mut b, &|h, _, _| *h = (*h * val).clamp(0.0, 360.0)),
            "hueOff" => {
                let deg = doc.attr_f64(t, "val").unwrap_or(0.0) / 60000.0;
                hsl_op(&mut r, &mut g, &mut b, &|h, _, _| *h = (*h + deg).rem_euclid(360.0));
            }
            "comp" => hsl_op(&mut r, &mut g, &mut b, &|h, _, _| *h = (*h + 180.0).rem_euclid(360.0)),
            "tint" => {
                if val < 1.0 {
                    lin_op(&mut r, &mut g, &mut b, &|c| 1.0 - (1.0 - c) * val);
                }
            }
            "shade" => {
                if val < 1.0 {
                    lin_op(&mut r, &mut g, &mut b, &|c| c * val);
                }
            }
            "inv" => {
                r = 1.0 - r;
                g = 1.0 - g;
                b = 1.0 - b;
            }
            "gray" => {
                let y = r * 0.22 + g * 0.72 + b * 0.06;
                r = y;
                g = y;
                b = y;
            }
            "gamma" => {
                r = to_srgb(r);
                g = to_srgb(g);
                b = to_srgb(b);
            }
            "invGamma" => {
                r = to_linear(r);
                g = to_linear(g);
                b = to_linear(b);
            }
            "red" | "redMod" | "redOff" | "green" | "greenMod" | "greenOff" | "blue" | "blueMod" | "blueOff" => {
                let name = doc.local(t);
                let channel: &mut f64 = match name.as_bytes()[0] {
                    b'r' => &mut r,
                    b'g' => &mut g,
                    _ => &mut b,
                };
                let lin = to_linear(*channel);
                let out = if name.ends_with("Mod") {
                    lin * val
                } else if name.ends_with("Off") {
                    lin + val
                } else {
                    val
                };
                *channel = to_srgb(out);
            }
            _ => {}
        }
        r = r.clamp(0.0, 1.0);
        g = g.clamp(0.0, 1.0);
        b = b.clamp(0.0, 1.0);
        a = a.clamp(0.0, 1.0);
    }
    Rgba { r: r as f32, g: g as f32, b: b as f32, a: a as f32 }
}

fn system_color(name: &str) -> Option<Rgba> {
    let hex = match name {
        "windowText" | "menuText" | "captionText" | "btnText" | "infoText" | "inactiveCaptionText" => "000000",
        "window" | "menu" | "highlightText" | "btnHighlight" | "3dLight" => "FFFFFF",
        "btnFace" | "menuBar" | "scrollBar" => "F0F0F0",
        "btnShadow" => "A0A0A0",
        "3dDkShadow" => "696969",
        "highlight" | "hotLight" | "menuHighlight" => "3399FF",
        "grayText" => "6D6D6D",
        "activeCaption" => "99B4D1",
        "inactiveCaption" => "BFCDDB",
        "activeBorder" => "B4B4B4",
        "inactiveBorder" => "F4F7FC",
        "appWorkspace" => "ABABAB",
        "background" => "000000",
        "infoBk" => "FFFFE1",
        "gradientActiveCaption" => "B9D1EA",
        "gradientInactiveCaption" => "D7E4F2",
        "windowFrame" => "646464",
        _ => return None,
    };
    Rgba::from_hex(hex)
}

/// Resolves a DrawingML preset color name (CSS names with `dk`/`lt`/`med` abbreviations).
pub fn preset_color(name: &str) -> Option<Rgba> {
    let lower = name.to_ascii_lowercase();
    let expanded = if let Some(rest) = lower.strip_prefix("dk") {
        format!("dark{rest}")
    } else if let Some(rest) = lower.strip_prefix("lt") {
        format!("light{rest}")
    } else if let Some(rest) = lower.strip_prefix("med") {
        if rest.starts_with("ium") { lower.clone() } else { format!("medium{rest}") }
    } else {
        lower.clone()
    };
    CSS_COLORS
        .iter()
        .find(|(n, _)| *n == expanded || *n == lower)
        .and_then(|(_, hex)| Rgba::from_hex(hex))
}

const CSS_COLORS: &[(&str, &str)] = &[
    ("aliceblue", "F0F8FF"), ("antiquewhite", "FAEBD7"), ("aqua", "00FFFF"), ("aquamarine", "7FFFD4"),
    ("azure", "F0FFFF"), ("beige", "F5F5DC"), ("bisque", "FFE4C4"), ("black", "000000"),
    ("blanchedalmond", "FFEBCD"), ("blue", "0000FF"), ("blueviolet", "8A2BE2"), ("brown", "A52A2A"),
    ("burlywood", "DEB887"), ("cadetblue", "5F9EA0"), ("chartreuse", "7FFF00"), ("chocolate", "D2691E"),
    ("coral", "FF7F50"), ("cornflowerblue", "6495ED"), ("cornsilk", "FFF8DC"), ("crimson", "DC143C"),
    ("cyan", "00FFFF"), ("darkblue", "00008B"), ("darkcyan", "008B8B"), ("darkgoldenrod", "B8860B"),
    ("darkgray", "A9A9A9"), ("darkgrey", "A9A9A9"), ("darkgreen", "006400"), ("darkkhaki", "BDB76B"),
    ("darkmagenta", "8B008B"), ("darkolivegreen", "556B2F"), ("darkorange", "FF8C00"), ("darkorchid", "9932CC"),
    ("darkred", "8B0000"), ("darksalmon", "E9967A"), ("darkseagreen", "8FBC8F"), ("darkslateblue", "483D8B"),
    ("darkslategray", "2F4F4F"), ("darkslategrey", "2F4F4F"), ("darkturquoise", "00CED1"), ("darkviolet", "9400D3"),
    ("deeppink", "FF1493"), ("deepskyblue", "00BFFF"), ("dimgray", "696969"), ("dimgrey", "696969"),
    ("dodgerblue", "1E90FF"), ("firebrick", "B22222"), ("floralwhite", "FFFAF0"), ("forestgreen", "228B22"),
    ("fuchsia", "FF00FF"), ("gainsboro", "DCDCDC"), ("ghostwhite", "F8F8FF"), ("gold", "FFD700"),
    ("goldenrod", "DAA520"), ("gray", "808080"), ("grey", "808080"), ("green", "008000"),
    ("greenyellow", "ADFF2F"), ("honeydew", "F0FFF0"), ("hotpink", "FF69B4"), ("indianred", "CD5C5C"),
    ("indigo", "4B0082"), ("ivory", "FFFFF0"), ("khaki", "F0E68C"), ("lavender", "E6E6FA"),
    ("lavenderblush", "FFF0F5"), ("lawngreen", "7CFC00"), ("lemonchiffon", "FFFACD"), ("lightblue", "ADD8E6"),
    ("lightcoral", "F08080"), ("lightcyan", "E0FFFF"), ("lightgoldenrodyellow", "FAFAD2"), ("lightgray", "D3D3D3"),
    ("lightgrey", "D3D3D3"), ("lightgreen", "90EE90"), ("lightpink", "FFB6C1"), ("lightsalmon", "FFA07A"),
    ("lightseagreen", "20B2AA"), ("lightskyblue", "87CEFA"), ("lightslategray", "778899"), ("lightslategrey", "778899"),
    ("lightsteelblue", "B0C4DE"), ("lightyellow", "FFFFE0"), ("lime", "00FF00"), ("limegreen", "32CD32"),
    ("linen", "FAF0E6"), ("magenta", "FF00FF"), ("maroon", "800000"), ("mediumaquamarine", "66CDAA"),
    ("mediumblue", "0000CD"), ("mediumorchid", "BA55D3"), ("mediumpurple", "9370DB"), ("mediumseagreen", "3CB371"),
    ("mediumslateblue", "7B68EE"), ("mediumspringgreen", "00FA9A"), ("mediumturquoise", "48D1CC"),
    ("mediumvioletred", "C71585"), ("midnightblue", "191970"), ("mintcream", "F5FFFA"), ("mistyrose", "FFE4E1"),
    ("moccasin", "FFE4B5"), ("navajowhite", "FFDEAD"), ("navy", "000080"), ("oldlace", "FDF5E6"),
    ("olive", "808000"), ("olivedrab", "6B8E23"), ("orange", "FFA500"), ("orangered", "FF4500"),
    ("orchid", "DA70D6"), ("palegoldenrod", "EEE8AA"), ("palegreen", "98FB98"), ("paleturquoise", "AFEEEE"),
    ("palevioletred", "DB7093"), ("papayawhip", "FFEFD5"), ("peachpuff", "FFDAB9"), ("peru", "CD853F"),
    ("pink", "FFC0CB"), ("plum", "DDA0DD"), ("powderblue", "B0E0E6"), ("purple", "800080"),
    ("red", "FF0000"), ("rosybrown", "BC8F8F"), ("royalblue", "4169E1"), ("saddlebrown", "8B4513"),
    ("salmon", "FA8072"), ("sandybrown", "F4A460"), ("seagreen", "2E8B57"), ("seashell", "FFF5EE"),
    ("sienna", "A0522D"), ("silver", "C0C0C0"), ("skyblue", "87CEEB"), ("slateblue", "6A5ACD"),
    ("slategray", "708090"), ("slategrey", "708090"), ("snow", "FFFAFA"), ("springgreen", "00FF7F"),
    ("steelblue", "4682B4"), ("tan", "D2B48C"), ("teal", "008080"), ("thistle", "D8BFD8"),
    ("tomato", "FF6347"), ("turquoise", "40E0D0"), ("violet", "EE82EE"), ("wheat", "F5DEB3"),
    ("white", "FFFFFF"), ("whitesmoke", "F5F5F5"), ("yellow", "FFFF00"), ("yellowgreen", "9ACD32"),
];

#[cfg(test)]
mod test;
