//! Run (character) properties.

use super::border::{Border, read_border};
use super::color::{ColorRef, ThemeInfo, highlight_color, read_color, read_shading};
use crate::units::{half_points, twips};
use crate::xml::{NodeId, Ns, XmlTree, parse_int, parse_on_off};
use pptx_engine::model::color::Rgba;

/// Underline styles, reduced to what drawing needs.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UnderlineStyle {
    /// One line.
    Single,
    /// Under words only (not spaces).
    Words,
    /// Two lines.
    Double,
    /// A thick line.
    Thick,
    /// Dots.
    Dotted,
    /// Thick dots.
    DottedHeavy,
    /// Dashes.
    Dash,
    /// Thick dashes.
    DashHeavy,
    /// Long dashes.
    DashLong,
    /// Dash-dot.
    DotDash,
    /// Dash-dot-dot.
    DotDotDash,
    /// Wavy.
    Wave,
    /// Double wave.
    WavyDouble,
    /// Thick wave.
    WavyHeavy,
}

/// An underline with its color (`None` = the text color).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Underline {
    /// Style.
    pub style: UnderlineStyle,
    /// Color.
    pub color: Option<Rgba>,
}

/// Vertical alignment of a run.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum VertAlign {
    /// On the baseline.
    #[default]
    Baseline,
    /// Superscript.
    Super,
    /// Subscript.
    Sub,
}

/// Run properties as one level of the style hierarchy states them: every
/// field is optional, and levels are merged in order.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct RPr {
    /// Character style (`w:rStyle`).
    pub style: Option<String>,
    /// Font for ASCII characters.
    pub ascii: Option<String>,
    /// Font for other Latin, Greek, Cyrillic... characters.
    pub h_ansi: Option<String>,
    /// Font for East Asian characters.
    pub east_asia: Option<String>,
    /// Font for complex-script characters.
    pub cs: Option<String>,
    /// Which slot ambiguous characters use (`eastAsia`, `cs`).
    pub hint: Option<String>,
    /// Bold.
    pub bold: Option<bool>,
    /// Bold (complex script).
    pub bold_cs: Option<bool>,
    /// Italic.
    pub italic: Option<bool>,
    /// Italic (complex script).
    pub italic_cs: Option<bool>,
    /// All capitals.
    pub caps: Option<bool>,
    /// Small capitals.
    pub small_caps: Option<bool>,
    /// Strikethrough.
    pub strike: Option<bool>,
    /// Double strikethrough.
    pub dstrike: Option<bool>,
    /// Outline.
    pub outline: Option<bool>,
    /// Shadow.
    pub shadow: Option<bool>,
    /// Embossed.
    pub emboss: Option<bool>,
    /// Engraved.
    pub imprint: Option<bool>,
    /// Hidden.
    pub vanish: Option<bool>,
    /// Hidden paragraph mark that joins paragraphs (`w:specVanish`).
    pub spec_vanish: Option<bool>,
    /// Right-to-left run.
    pub rtl: Option<bool>,
    /// Treat as complex script.
    pub cs_flag: Option<bool>,
    /// Text color.
    pub color: Option<ColorRef>,
    /// Extra spacing between characters (points).
    pub spacing: Option<f32>,
    /// Horizontal scale (1.0 = 100%).
    pub scale: Option<f32>,
    /// Kerning threshold font size (points, 0 = off).
    pub kern: Option<f32>,
    /// Raise (positive) or lower (points).
    pub position: Option<f32>,
    /// Font size (points).
    pub size: Option<f32>,
    /// Font size, complex script (points).
    pub size_cs: Option<f32>,
    /// Highlight (`Some(None)` = explicitly none).
    pub highlight: Option<Option<Rgba>>,
    /// Underline (`Some(None)` = explicitly none).
    pub underline: Option<Option<Underline>>,
    /// Run border.
    pub border: Option<Option<Border>>,
    /// Run shading.
    pub shading: Option<Option<Rgba>>,
    /// Superscript/subscript.
    pub vert_align: Option<VertAlign>,
    /// Inserted paragraph mark (tracked change), on a paragraph's mark properties.
    pub mark_inserted: Option<bool>,
    /// Deleted paragraph mark (tracked change).
    pub mark_deleted: Option<bool>,
}

fn on_off(t: &XmlTree, n: NodeId) -> bool {
    parse_on_off(t.val(n))
}

impl RPr {
    /// Reads the children of a `w:rPr` element.
    pub fn read(t: &XmlTree, rpr: NodeId, theme: &ThemeInfo) -> Self {
        let mut p = RPr::default();
        for c in t.children(rpr) {
            p.read_child(t, c, theme);
        }
        p
    }

    /// Reads one property element.
    pub fn read_child(&mut self, t: &XmlTree, c: NodeId, theme: &ThemeInfo) {
        if t.ns(c) != Ns::W {
            return;
        }
        match t.local(c) {
            "rStyle" => self.style = t.val(c).map(str::to_owned),
            "rFonts" => {
                let slot = |name: &str, theme_attr: &str| -> Option<String> {
                    t.w_attr(c, theme_attr)
                        .and_then(|s| theme.font(s))
                        .map(str::to_owned)
                        .or_else(|| t.w_attr(c, name).map(str::to_owned))
                };
                if let Some(v) = slot("ascii", "asciiTheme") {
                    self.ascii = Some(v);
                }
                if let Some(v) = slot("hAnsi", "hAnsiTheme") {
                    self.h_ansi = Some(v);
                }
                if let Some(v) = slot("eastAsia", "eastAsiaTheme") {
                    self.east_asia = Some(v);
                }
                if let Some(v) = slot("cs", "cstheme") {
                    self.cs = Some(v);
                }
                if let Some(h) = t.w_attr(c, "hint") {
                    self.hint = Some(h.to_owned());
                }
            }
            "b" => self.bold = Some(on_off(t, c)),
            "bCs" => self.bold_cs = Some(on_off(t, c)),
            "i" => self.italic = Some(on_off(t, c)),
            "iCs" => self.italic_cs = Some(on_off(t, c)),
            "caps" => self.caps = Some(on_off(t, c)),
            "smallCaps" => self.small_caps = Some(on_off(t, c)),
            "strike" => self.strike = Some(on_off(t, c)),
            "dstrike" => self.dstrike = Some(on_off(t, c)),
            "outline" => self.outline = Some(on_off(t, c)),
            "shadow" => self.shadow = Some(on_off(t, c)),
            "emboss" => self.emboss = Some(on_off(t, c)),
            "imprint" => self.imprint = Some(on_off(t, c)),
            "vanish" => self.vanish = Some(on_off(t, c)),
            "specVanish" => self.spec_vanish = Some(on_off(t, c)),
            "rtl" => self.rtl = Some(on_off(t, c)),
            "cs" => self.cs_flag = Some(on_off(t, c)),
            "color" => {
                if let Some(col) = read_color(t, c, "val", "theme", theme) {
                    self.color = Some(col);
                }
            }
            "spacing" => self.spacing = t.val(c).and_then(parse_int).map(twips),
            "w" => {
                self.scale = t
                    .val(c)
                    .and_then(|v| v.trim_end_matches('%').trim().parse::<f32>().ok())
                    .map(|v| (v / 100.0).clamp(0.01, 6.0));
            }
            "kern" => self.kern = t.val(c).and_then(parse_int).map(half_points),
            "position" => self.position = t.val(c).and_then(parse_int).map(half_points),
            "sz" => self.size = t.val(c).and_then(parse_int).map(half_points),
            "szCs" => self.size_cs = t.val(c).and_then(parse_int).map(half_points),
            "highlight" => self.highlight = Some(t.val(c).and_then(highlight_color)),
            "u" => {
                let val = t.val(c).unwrap_or("single");
                let style = match val {
                    "none" => None,
                    "words" => Some(UnderlineStyle::Words),
                    "double" => Some(UnderlineStyle::Double),
                    "thick" => Some(UnderlineStyle::Thick),
                    "dotted" => Some(UnderlineStyle::Dotted),
                    "dottedHeavy" => Some(UnderlineStyle::DottedHeavy),
                    "dash" => Some(UnderlineStyle::Dash),
                    "dashedHeavy" => Some(UnderlineStyle::DashHeavy),
                    "dashLong" | "dashLongHeavy" => Some(UnderlineStyle::DashLong),
                    "dotDash" | "dashDotHeavy" => Some(UnderlineStyle::DotDash),
                    "dotDotDash" | "dashDotDotHeavy" => Some(UnderlineStyle::DotDotDash),
                    "wave" => Some(UnderlineStyle::Wave),
                    "wavyDouble" => Some(UnderlineStyle::WavyDouble),
                    "wavyHeavy" => Some(UnderlineStyle::WavyHeavy),
                    _ => Some(UnderlineStyle::Single),
                };
                let color = match read_color(t, c, "color", "theme", theme) {
                    Some(ColorRef::Rgb(rgb)) => Some(rgb),
                    _ => None,
                };
                self.underline = Some(style.map(|style| Underline { style, color }));
            }
            "bdr" => self.border = Some(read_border(t, c, theme)),
            "shd" => self.shading = Some(read_shading(t, c, theme)),
            "vertAlign" => {
                self.vert_align = Some(match t.val(c) {
                    Some("superscript") => VertAlign::Super,
                    Some("subscript") => VertAlign::Sub,
                    _ => VertAlign::Baseline,
                });
            }
            "ins" | "moveTo" => self.mark_inserted = Some(true),
            "del" | "moveFrom" => self.mark_deleted = Some(true),
            _ => {}
        }
    }

    /// Overlays `other` (a later level) onto these properties.
    ///
    /// With `toggle`, the on/off properties Word treats as toggles (bold,
    /// italic, caps...) flip when `other` turns them on, as style levels do;
    /// otherwise later values simply win, as direct formatting does.
    pub fn apply(&mut self, other: &RPr, toggle: bool) {
        macro_rules! set {
            ($($f:ident),*) => {$(
                if other.$f.is_some() {
                    self.$f = other.$f.clone();
                }
            )*};
        }
        macro_rules! toggles {
            ($($f:ident),*) => {$(
                match other.$f {
                    Some(true) if toggle => self.$f = Some(!self.$f.unwrap_or(false)),
                    Some(v) if !toggle => self.$f = Some(v),
                    _ => {}
                }
            )*};
        }
        set!(
            style,
            ascii,
            h_ansi,
            east_asia,
            cs,
            hint,
            spec_vanish,
            rtl,
            cs_flag,
            color,
            spacing,
            scale,
            kern,
            position,
            size,
            size_cs,
            highlight,
            underline,
            border,
            shading,
            vert_align,
            mark_inserted,
            mark_deleted
        );
        toggles!(
            bold, bold_cs, italic, italic_cs, caps, small_caps, strike, dstrike, outline, shadow,
            emboss, imprint, vanish
        );
    }

    /// Overlays within one style's `basedOn` chain: later values win.
    pub fn inherit(&mut self, child: &RPr) {
        self.apply(child, false);
    }
}

/// Fully resolved run properties.
#[derive(Clone, Debug, PartialEq)]
pub struct RunProps {
    /// Font for ASCII characters.
    pub ascii: String,
    /// Font for other Latin text.
    pub h_ansi: String,
    /// Font for East Asian text.
    pub east_asia: String,
    /// Font for complex scripts.
    pub cs: String,
    /// Which slot ambiguous characters use.
    pub hint: Option<String>,
    /// Bold.
    pub bold: bool,
    /// Italic.
    pub italic: bool,
    /// Bold (complex script).
    pub bold_cs: bool,
    /// Italic (complex script).
    pub italic_cs: bool,
    /// All caps.
    pub caps: bool,
    /// Small caps.
    pub small_caps: bool,
    /// Strikethrough.
    pub strike: bool,
    /// Double strikethrough.
    pub dstrike: bool,
    /// Outline.
    pub outline: bool,
    /// Shadow.
    pub shadow: bool,
    /// Embossed.
    pub emboss: bool,
    /// Engraved.
    pub imprint: bool,
    /// Hidden.
    pub vanish: bool,
    /// Hidden mark joining paragraphs.
    pub spec_vanish: bool,
    /// Right to left.
    pub rtl: bool,
    /// Complex script.
    pub cs_flag: bool,
    /// Text color (`None` = automatic).
    pub color: Option<Rgba>,
    /// Character spacing (points).
    pub spacing: f32,
    /// Horizontal scale.
    pub scale: f32,
    /// Kerning threshold (points; 0 = off).
    pub kern: f32,
    /// Baseline shift (points, positive = up).
    pub position: f32,
    /// Size (points).
    pub size: f32,
    /// Size, complex script (points).
    pub size_cs: f32,
    /// Highlight.
    pub highlight: Option<Rgba>,
    /// Underline.
    pub underline: Option<Underline>,
    /// Border around the run.
    pub border: Option<Border>,
    /// Shading behind the run.
    pub shading: Option<Rgba>,
    /// Superscript/subscript.
    pub vert_align: VertAlign,
    /// Tracked insertion of a paragraph mark.
    pub mark_inserted: bool,
    /// Tracked deletion of a paragraph mark.
    pub mark_deleted: bool,
}

/// Word's last-resort font and size when no level names one.
pub const DEFAULT_FONT: &str = "Times New Roman";
/// Word's last-resort font size.
pub const DEFAULT_SIZE: f32 = 10.0;

impl RPr {
    /// Resolves these (fully merged) properties.
    pub fn resolve(&self) -> RunProps {
        let ascii = self
            .ascii
            .clone()
            .or_else(|| self.h_ansi.clone())
            .unwrap_or_else(|| DEFAULT_FONT.to_owned());
        let h_ansi = self.h_ansi.clone().unwrap_or_else(|| ascii.clone());
        let size = self.size.unwrap_or(DEFAULT_SIZE).max(1.0);
        RunProps {
            east_asia: self.east_asia.clone().unwrap_or_else(|| h_ansi.clone()),
            cs: self.cs.clone().unwrap_or_else(|| h_ansi.clone()),
            ascii,
            h_ansi,
            hint: self.hint.clone(),
            bold: self.bold.unwrap_or(false),
            italic: self.italic.unwrap_or(false),
            bold_cs: self.bold_cs.unwrap_or(false),
            italic_cs: self.italic_cs.unwrap_or(false),
            caps: self.caps.unwrap_or(false),
            small_caps: self.small_caps.unwrap_or(false),
            strike: self.strike.unwrap_or(false),
            dstrike: self.dstrike.unwrap_or(false),
            outline: self.outline.unwrap_or(false),
            shadow: self.shadow.unwrap_or(false),
            emboss: self.emboss.unwrap_or(false),
            imprint: self.imprint.unwrap_or(false),
            vanish: self.vanish.unwrap_or(false),
            spec_vanish: self.spec_vanish.unwrap_or(false),
            rtl: self.rtl.unwrap_or(false),
            cs_flag: self.cs_flag.unwrap_or(false),
            color: self.color.and_then(ColorRef::rgb),
            spacing: self.spacing.unwrap_or(0.0),
            scale: self.scale.unwrap_or(1.0),
            kern: self.kern.unwrap_or(0.0),
            position: self.position.unwrap_or(0.0),
            size,
            size_cs: self.size_cs.unwrap_or(size).max(1.0),
            highlight: self.highlight.flatten(),
            underline: self.underline.flatten(),
            border: self.border.flatten(),
            shading: self.shading.flatten(),
            vert_align: self.vert_align.unwrap_or_default(),
            mark_inserted: self.mark_inserted.unwrap_or(false),
            mark_deleted: self.mark_deleted.unwrap_or(false),
        }
    }
}
