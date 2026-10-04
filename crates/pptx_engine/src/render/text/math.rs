//! Equations in text layout: one item per equation, drawn from its
//! typeset box, aligned on the line's baseline.

use super::{Decoration, Item, ItemKind, LayoutParams, TextLayout, push_glyph};
use crate::font::{FontChoice, FontDb};
use crate::math::layout::stroke_outline;
use crate::math::{Equation, Justify, MathBox, MathItem, OBJECT_CHAR, typeset};
use crate::model::fill::Fill;
use crate::model::text::{Align, Paragraph, Run, RunKind};
use crate::path::Rect;
use serde::Serialize;
use std::sync::Arc;

/// A filled outline drawn over the text (strokes in equations).
#[derive(Clone, Debug)]
pub struct TextPath {
    /// The outline, in layout coordinates.
    pub path: crate::path::Path,
    /// Its paint.
    pub fill: Fill,
}

/// Where an equation was laid out (layout coordinates).
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EquationBox {
    /// Paragraph index.
    pub paragraph: usize,
    /// Character index of the equation in the paragraph.
    pub index: usize,
    /// Left.
    pub x: f32,
    /// Top.
    pub y: f32,
    /// Width.
    pub w: f32,
    /// Height.
    pub h: f32,
    /// Baseline.
    pub baseline: f32,
}

/// The layout item of an equation run: an unbreakable box as wide as the
/// equation, as tall as it is (lines grow to fit it).
pub(super) fn math_item(
    eq: &Equation,
    run: &Run,
    ri: usize,
    src: usize,
    fonts: &FontDb,
    params: LayoutParams,
) -> Item {
    let bx = typeset(eq, &run.props, params.font_scale, fonts, false);
    let size = run.props.size * params.font_scale;
    Item {
        kind: ItemKind::Glyph,
        src,
        run: ri,
        choice: None,
        glyph: None,
        size,
        adv: bx.width,
        // Never shorter than the text it stands in.
        ascent: bx.ascent.max(size),
        descent: bx.descent.max(size * (super::LINE_HEIGHT_FACTOR - 1.0)),
        shift: 0.0,
        break_after: false,
        ch: OBJECT_CHAR,
        math: Some(Arc::new(bx)),
    }
}

/// The alignment of a paragraph that holds only display equations: theirs
/// (`m:jc`, centered by default) instead of the paragraph's.
pub(super) fn display_align(para: &Paragraph) -> Option<Align> {
    let mut found = None;
    for r in &para.runs {
        match &r.kind {
            RunKind::Math(eq) if eq.display => {
                found = Some(match eq.justify {
                    Justify::Left => Align::Left,
                    Justify::Right => Align::Right,
                    Justify::Center | Justify::CenterGroup => Align::Center,
                });
            }
            RunKind::Break => {}
            _ if r.text.trim().is_empty() => {}
            _ => return None,
        }
    }
    found
}

/// Draws an equation item with its origin at (`x`, `baseline`) and records
/// where it is.
pub(super) fn emit_math(
    out: &mut TextLayout,
    item: &Item,
    bx: &MathBox,
    para: &Paragraph,
    pi: usize,
    x: f32,
    baseline: f32,
) {
    let props = &para.runs[item.run].props;
    for it in &bx.items {
        match it {
            MathItem::Glyph(g) => push_glyph(
                out,
                FontChoice {
                    face: g.face,
                    synthetic_bold: g.synthetic_bold,
                    synthetic_italic: g.synthetic_italic,
                },
                g.size,
                g.glyph,
                x + g.x,
                baseline + g.y,
                &g.fill,
                &props.outline,
                &props.effects,
            ),
            MathItem::Rule { rect, fill } => out.decorations.push(Decoration {
                rect: Rect::from_xywh(x + rect.x, baseline + rect.y, rect.w, rect.h),
                fill: fill.clone(),
                behind: false,
            }),
            MathItem::Line {
                from,
                to,
                width,
                fill,
            } => out.paths.push(TextPath {
                path: stroke_outline(*from, *to, *width, x, baseline),
                fill: fill.clone(),
            }),
        }
    }
    out.equations.push(EquationBox {
        paragraph: pi,
        index: item.src,
        x,
        y: baseline - bx.ascent,
        w: bx.width,
        h: bx.ascent + bx.descent,
        baseline,
    });
}
