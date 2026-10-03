//! Single-line text labels (chart labels, metafile text) without a text body.

use super::scene::{Node, Paint};
use crate::font::{FontDb, SymbolFont, remap_symbol};
use crate::model::color::Rgba;
use crate::path::{Affine, Path, Rect};

/// Style of a label.
#[derive(Clone, Debug, PartialEq)]
pub struct LabelStyle {
    /// Font family (substituted like run text).
    pub family: String,
    /// Size in points.
    pub size: f32,
    /// Bold.
    pub bold: bool,
    /// Italic.
    pub italic: bool,
    /// Underline.
    pub underline: bool,
    /// Color.
    pub color: Rgba,
}

impl Default for LabelStyle {
    fn default() -> Self {
        Self { family: "Calibri".into(), size: 10.0, bold: false, italic: false, underline: false, color: Rgba::BLACK }
    }
}

/// Horizontal anchoring of a label relative to its x coordinate.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HAlign {
    /// x is the left edge.
    Left,
    /// x is the center.
    Center,
    /// x is the right edge.
    Right,
}

struct Shaped {
    face: crate::font::FaceId,
    glyph: Option<u16>,
    adv: f32,
    synthetic_bold: bool,
    synthetic_italic: bool,
}

fn shape(fonts: &FontDb, text: &str, style: &LabelStyle) -> Vec<Shaped> {
    let lower = style.family.to_lowercase();
    let sym = SymbolFont::from_family(&lower);
    let family = if sym.is_some() { "DejaVu Sans" } else { style.family.as_str() };
    let Some(choice) = fonts.select(family, style.bold, style.italic) else { return Vec::new() };
    let mut out: Vec<Shaped> = Vec::new();
    let mut prev: Option<(crate::font::FaceId, u16)> = None;
    for c in text.chars() {
        let c = match sym {
            Some(s) => remap_symbol(s, c),
            None => c,
        };
        let (face, glyph, sb, si) = match fonts.glyph(choice.face, c) {
            Some(g) => (choice.face, Some(g), choice.synthetic_bold, choice.synthetic_italic),
            None => match fonts.fallback_for(c, choice.face, style.bold, style.italic) {
                Some(fb) => (fb.face, fonts.glyph(fb.face, c), fb.synthetic_bold, fb.synthetic_italic),
                None => (choice.face, None, false, false),
            },
        };
        let adv = match glyph {
            Some(g) => fonts.advance(face, g) * style.size,
            None if c == ' ' => style.size * 0.25,
            None => style.size * 0.5,
        };
        if let (Some(g), Some((pf, pg))) = (glyph, prev) {
            if pf == face {
                if let Some(last) = out.last_mut() {
                    last.adv += fonts.kerning(face, pg, g) * style.size;
                }
            }
        }
        prev = glyph.map(|g| (face, g));
        out.push(Shaped { face, glyph, adv, synthetic_bold: sb, synthetic_italic: si });
    }
    out
}

/// Width of a label in points.
pub fn measure(fonts: &FontDb, text: &str, style: &LabelStyle) -> f32 {
    shape(fonts, text, style).iter().map(|s| s.adv).sum()
}

/// Bounding box of a label whose baseline starts at (x, y) (before alignment).
pub fn label_box(fonts: &FontDb, text: &str, style: &LabelStyle, x: f32, y: f32, align: HAlign) -> Rect {
    let w = measure(fonts, text, style);
    let left = match align {
        HAlign::Left => x,
        HAlign::Center => x - w / 2.0,
        HAlign::Right => x - w,
    };
    Rect::from_xywh(left, y - style.size, w, style.size * 1.2)
}

/// Appends nodes drawing `text` with its baseline at (x, y) in label space, mapped by `t`.
pub fn label_nodes(fonts: &FontDb, text: &str, style: &LabelStyle, x: f32, y: f32, align: HAlign, t: &Affine, out: &mut Vec<Node>) {
    let shaped = shape(fonts, text, style);
    let width: f32 = shaped.iter().map(|s| s.adv).sum();
    let mut pen = match align {
        HAlign::Left => x,
        HAlign::Center => x - width / 2.0,
        HAlign::Right => x - width,
    };
    let start = pen;
    let mut path = Path::new();
    let mut bold = false;
    for s in &shaped {
        if let Some(g) = s.glyph {
            if let Some(outline) = fonts.outline(s.face, g) {
                let skew = if s.synthetic_italic { -0.2 } else { 0.0 };
                let gt = t
                    .pre_concat(&Affine::translate(f64::from(pen), f64::from(y)))
                    .pre_concat(&Affine { a: 1.0, b: 0.0, c: skew, d: 1.0, e: 0.0, f: 0.0 })
                    .pre_concat(&Affine::scale(f64::from(style.size), f64::from(style.size)));
                path.extend(&outline.transform(&gt));
                bold |= s.synthetic_bold;
            }
        }
        pen += s.adv;
    }
    if path.is_empty() {
        return;
    }
    out.push(Node::Fill { path: path.clone(), paint: Paint::Solid(style.color), even_odd: false });
    if bold {
        out.push(Node::Stroke {
            path,
            paint: Paint::Solid(style.color),
            stroke: super::scene::Stroke {
                width: style.size * 0.035 * t.mean_scale() as f32,
                cap: super::scene::LineCap::Round,
                join: super::scene::LineJoin::Round,
                miter_limit: 4.0,
                dash: None,
            },
        });
    }
    if style.underline {
        let thick = (style.size * 0.05).max(0.5);
        let r = Rect::from_ltrb(start, y + style.size * 0.1, pen, y + style.size * 0.1 + thick);
        out.push(Node::Fill { path: Path::rect(r).transform(t), paint: Paint::Solid(style.color), even_odd: false });
    }
}
