//! Character and paragraph formatting.

use super::revise::Revisor;
use super::txn::Txn;
use super::xmledit::{Element, PPR_ORDER};
use crate::layout::format::{Formats, ParaFormat};
use crate::model::block::BlockId;
use crate::model::content::{Attrs, key};
use crate::model::props::{RunProps, VertAlign};
use crate::xml::escape_attr;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

/// A character format that is either on or off.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Toggle {
    /// Bold.
    Bold,
    /// Italic.
    Italic,
    /// Single underline.
    Underline,
    /// Strikethrough.
    Strike,
    /// Superscript.
    Superscript,
    /// Subscript.
    Subscript,
    /// Small capitals.
    SmallCaps,
    /// All capitals.
    AllCaps,
}

impl Toggle {
    /// Whether resolved properties have the format.
    pub fn is_on(self, p: &RunProps) -> bool {
        match self {
            Toggle::Bold => p.bold,
            Toggle::Italic => p.italic,
            Toggle::Underline => p.underline.is_some(),
            Toggle::Strike => p.strike,
            Toggle::Superscript => p.vert_align == VertAlign::Super,
            Toggle::Subscript => p.vert_align == VertAlign::Sub,
            Toggle::SmallCaps => p.small_caps,
            Toggle::AllCaps => p.caps,
        }
    }

    /// The run property elements the format is written with.
    fn locals(self) -> &'static [&'static str] {
        match self {
            Toggle::Bold => &["b", "bCs"],
            Toggle::Italic => &["i", "iCs"],
            Toggle::Underline => &["u"],
            Toggle::Strike => &["strike"],
            Toggle::Superscript | Toggle::Subscript => &["vertAlign"],
            Toggle::SmallCaps => &["smallCaps"],
            Toggle::AllCaps => &["caps"],
        }
    }
}

fn q(w: &str, local: &str) -> String {
    if w.is_empty() {
        local.to_owned()
    } else {
        format!("{w}:{local}")
    }
}

/// The attribute key of run property `w:{local}`.
pub(super) fn run_key(w: &str, local: &str) -> String {
    format!("{}{}", key::RUN_PROP, q(w, local))
}

fn val_elem(w: &str, local: &str, val: &str) -> String {
    let mut s = format!("<{} {}=\"", q(w, local), q(w, "val"));
    escape_attr(&mut s, val);
    s.push_str("\"/>");
    s
}

/// The attributes with a toggle set on or off, given what the text would
/// have without direct formatting of it (`inherited`).
pub(super) fn toggled(attrs: &Attrs, t: Toggle, on: bool, inherited: bool, w: &str) -> Attrs {
    let mut out = attrs.clone();
    for local in t.locals() {
        let k = run_key(w, local);
        let value = match (t, on, inherited) {
            // Matching what the styles give: no direct formatting needed.
            (_, true, true) | (_, false, false) => None,
            (Toggle::Underline, true, false) => Some(val_elem(w, local, "single")),
            (Toggle::Underline, false, true) => Some(val_elem(w, local, "none")),
            (Toggle::Superscript, true, false) => Some(val_elem(w, local, "superscript")),
            (Toggle::Subscript, true, false) => Some(val_elem(w, local, "subscript")),
            (Toggle::Superscript | Toggle::Subscript, false, true) => {
                Some(val_elem(w, local, "baseline"))
            }
            (_, true, false) => Some(format!("<{}/>", q(w, local))),
            (_, false, true) => Some(val_elem(w, local, "0")),
        };
        out = out.with(&k, value.as_deref());
    }
    out
}

/// A change to character formatting: each field present sets (a value)
/// or clears (`null`) one property.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunPatch {
    /// Font family.
    #[serde(default, deserialize_with = "present")]
    pub font: Option<Option<String>>,
    /// Size in points.
    #[serde(default, deserialize_with = "present")]
    pub size: Option<Option<f32>>,
    /// Text color as `RRGGBB`.
    #[serde(default, deserialize_with = "present")]
    pub color: Option<Option<String>>,
    /// Highlight color name (`yellow`, `green`...).
    #[serde(default, deserialize_with = "present")]
    pub highlight: Option<Option<String>>,
}

/// Deserializes a present field (even `null`) as `Some`.
fn present<'de, D, T>(d: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    T::deserialize(d).map(Some)
}

/// Highlight colors Word accepts.
const HIGHLIGHTS: &[&str] = &[
    "black",
    "blue",
    "cyan",
    "green",
    "magenta",
    "red",
    "yellow",
    "white",
    "darkBlue",
    "darkCyan",
    "darkGreen",
    "darkMagenta",
    "darkRed",
    "darkYellow",
    "darkGray",
    "lightGray",
];

fn hex_color(v: &str) -> Option<String> {
    let v = v.trim().trim_start_matches('#');
    (v.len() == 6 && v.chars().all(|c| c.is_ascii_hexdigit())).then(|| v.to_uppercase())
}

impl RunPatch {
    /// Applies the patch to a span's attributes.
    pub fn apply(&self, attrs: &Attrs, w: &str) -> Attrs {
        let mut out = attrs.clone();
        if let Some(font) = &self.font {
            let value = font.as_ref().filter(|f| !f.trim().is_empty()).map(|f| {
                let mut s = format!("<{}", q(w, "rFonts"));
                for slot in ["ascii", "hAnsi", "eastAsia", "cs"] {
                    s.push(' ');
                    s.push_str(&q(w, slot));
                    s.push_str("=\"");
                    escape_attr(&mut s, f.trim());
                    s.push('"');
                }
                s.push_str("/>");
                s
            });
            out = out.with(&run_key(w, "rFonts"), value.as_deref());
        }
        if let Some(size) = self.size {
            let half = size
                .filter(|s| s.is_finite() && *s > 0.0)
                .map(|s| ((s * 2.0).round() as i64).clamp(2, 3276).to_string());
            for local in ["sz", "szCs"] {
                let v = half.as_deref().map(|h| val_elem(w, local, h));
                out = out.with(&run_key(w, local), v.as_deref());
            }
        }
        if let Some(color) = &self.color {
            let v = color
                .as_deref()
                .and_then(hex_color)
                .map(|c| val_elem(w, "color", &c));
            out = out.with(&run_key(w, "color"), v.as_deref());
        }
        if let Some(h) = &self.highlight {
            let v = h
                .as_deref()
                .and_then(|h| HIGHLIGHTS.iter().find(|n| n.eq_ignore_ascii_case(h)))
                .map(|n| val_elem(w, "highlight", n));
            out = out.with(&run_key(w, "highlight"), v.as_deref());
        }
        out
    }
}

/// Removes direct character formatting (keeping the character style off
/// too, as Word's Clear Formatting does), wrappers and objects stay.
pub(super) fn cleared(attrs: &Attrs) -> Attrs {
    attrs.without(|k| {
        k.starts_with(key::RUN_PROP) && {
            let local = k.rsplit(':').next().unwrap_or(k);
            !matches!(local, "ins" | "del" | "moveFrom" | "moveTo" | "rPrChange")
        }
    })
}

/// Paragraph alignment as the API names it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Alignment {
    /// Left (start).
    Left,
    /// Centered.
    Center,
    /// Right (end).
    Right,
    /// Justified.
    Justify,
}

/// Line spacing as the API names it.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "rule", rename_all = "camelCase")]
pub enum Spacing {
    /// A multiple of single spacing.
    Auto {
        /// Multiple (1 = single).
        value: f32,
    },
    /// Exactly this many points.
    Exact {
        /// Points.
        value: f32,
    },
    /// At least this many points.
    AtLeast {
        /// Points.
        value: f32,
    },
}

/// A change to paragraph formatting; absent fields stay as they are.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParaPatch {
    /// Alignment.
    #[serde(default)]
    pub align: Option<Alignment>,
    /// Left indent (points).
    #[serde(default)]
    pub indent_left: Option<f32>,
    /// Right indent (points).
    #[serde(default)]
    pub indent_right: Option<f32>,
    /// First line indent (points; negative = hanging).
    #[serde(default)]
    pub first_line: Option<f32>,
    /// Space before (points).
    #[serde(default)]
    pub space_before: Option<f32>,
    /// Space after (points).
    #[serde(default)]
    pub space_after: Option<f32>,
    /// Line spacing.
    #[serde(default)]
    pub line_spacing: Option<Spacing>,
    /// Keep with next.
    #[serde(default)]
    pub keep_next: Option<bool>,
    /// Keep lines together.
    #[serde(default)]
    pub keep_lines: Option<bool>,
    /// Page break before.
    #[serde(default)]
    pub page_break_before: Option<bool>,
    /// Widow and orphan control.
    #[serde(default)]
    pub widow_control: Option<bool>,
}

fn twips(points: f32) -> String {
    ((points * 20.0).round() as i64).to_string()
}

impl ParaPatch {
    /// Applies the patch to `w:pPr` markup.
    pub(crate) fn apply(&self, e: &mut Element, decls: &[crate::xml::Decl]) {
        if let Some(a) = self.align {
            let v = match a {
                Alignment::Left => None,
                Alignment::Center => Some("center"),
                Alignment::Right => Some("right"),
                Alignment::Justify => Some("both"),
            };
            // Left is the default, but a style may say otherwise.
            e.set_val("jc", Some(v.unwrap_or("left")));
        }
        let mut ind: Vec<(&str, Option<String>)> = Vec::new();
        if let Some(v) = self.indent_left {
            ind.push(("left", Some(twips(v))));
            ind.push(("start", None));
        }
        if let Some(v) = self.indent_right {
            ind.push(("right", Some(twips(v))));
            ind.push(("end", None));
        }
        if let Some(v) = self.first_line {
            if v < 0.0 {
                ind.push(("hanging", Some(twips(-v))));
                ind.push(("firstLine", None));
            } else {
                ind.push(("firstLine", Some(twips(v))));
                ind.push(("hanging", None));
            }
        }
        if !ind.is_empty() {
            e.set_attrs("ind", &ind, decls);
        }
        let mut sp: Vec<(&str, Option<String>)> = Vec::new();
        if let Some(v) = self.space_before {
            sp.push(("before", Some(twips(v.max(0.0)))));
            sp.push(("beforeAutospacing", None));
            sp.push(("beforeLines", None));
        }
        if let Some(v) = self.space_after {
            sp.push(("after", Some(twips(v.max(0.0)))));
            sp.push(("afterAutospacing", None));
            sp.push(("afterLines", None));
        }
        if let Some(l) = self.line_spacing {
            let (line, rule) = match l {
                Spacing::Auto { value } => (
                    ((value.max(0.06) * 240.0).round() as i64).to_string(),
                    "auto",
                ),
                Spacing::Exact { value } => (twips(value.max(1.0)), "exact"),
                Spacing::AtLeast { value } => (twips(value.max(0.0)), "atLeast"),
            };
            sp.push(("line", Some(line)));
            sp.push(("lineRule", Some(rule.to_owned())));
        }
        if !sp.is_empty() {
            e.set_attrs("spacing", &sp, decls);
        }
        for (local, v) in [
            ("keepNext", self.keep_next),
            ("keepLines", self.keep_lines),
            ("pageBreakBefore", self.page_break_before),
            ("widowControl", self.widow_control),
        ] {
            if let Some(on) = v {
                e.set_flag(local, Some(on));
            }
        }
    }
}

/// Applies a function to the `w:pPr` of a paragraph, recording the
/// properties from before when tracking changes (`rev`).
pub(super) fn edit_ppr(
    txn: &mut Txn<'_>,
    id: &BlockId,
    rev: Option<&Revisor>,
    f: impl FnOnce(&mut Element),
) {
    let w = txn.doc.w_prefix().to_owned();
    let decls = Arc::clone(txn.doc.decls());
    let Some(b) = txn.get(id) else {
        return;
    };
    let mut e = Element::open(&b.props, "pPr", &w, &decls, PPR_ORDER);
    let before = rev.map(|_| e.clone());
    f(&mut e);
    if let (Some(r), Some(before)) = (rev, &before) {
        r.para_change(before, &mut e, &decls);
    }
    let xml = e.finish(true);
    if xml != b.props
        && let Some(b) = txn.block_mut(id)
    {
        b.props = xml;
    }
}

/// Whether a toggle would be on for `attrs` without its own direct keys.
pub(super) fn inherited(
    formats: &Formats<'_>,
    attrs: &Attrs,
    para: &Arc<ParaFormat>,
    t: Toggle,
    w: &str,
) -> bool {
    let keys: Vec<String> = t.locals().iter().map(|l| run_key(w, l)).collect();
    let bare = attrs.without(|k| keys.iter().any(|x| x == k));
    t.is_on(&formats.run(&bare, para))
}
