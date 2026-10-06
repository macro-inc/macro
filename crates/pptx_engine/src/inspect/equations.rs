//! Equations in outlines and text layouts: where each is and its linear form.

use crate::math::{OBJECT_CHAR, equation_element, read_equation, to_latex};
use crate::model::text::{Paragraph, RunKind};
use crate::render::text::EquationBox;
use crate::xml::{NodeId, XmlDoc};
use serde::Serialize;

/// An equation in a paragraph (it counts as one character, U+FFFC in the
/// paragraph's text).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EquationOutline {
    /// Character index in the paragraph (what `setEquation` takes).
    pub index: usize,
    /// The equation in the LaTeX-style linear format.
    pub latex: String,
    /// A display equation (its own line, centered) rather than inline.
    pub display: bool,
}

/// An equation as laid out, for selecting and editing it.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EquationLayout {
    /// Paragraph index.
    pub paragraph: usize,
    /// Character index in the paragraph.
    pub index: usize,
    /// Left in layout space (points).
    pub x: f32,
    /// Top in layout space.
    pub y: f32,
    /// Width.
    pub w: f32,
    /// Height.
    pub h: f32,
    /// The equation in the linear format.
    pub latex: String,
    /// A display equation.
    pub display: bool,
}

/// The text of a paragraph child as text operations count it, when it is
/// an equation.
pub(super) fn equation_text(doc: &XmlDoc, item: NodeId) -> Option<String> {
    equation_element(doc, item).map(|_| OBJECT_CHAR.to_string())
}

/// The equations of an `a:p`, by character index.
pub(super) fn paragraph_equations(doc: &XmlDoc, p: NodeId) -> Vec<EquationOutline> {
    let mut out = Vec::new();
    let mut index = 0;
    for c in doc.children(p) {
        if let Some(m) = equation_element(doc, c) {
            let eq = read_equation(doc, m, &|_| None);
            out.push(EquationOutline {
                index,
                latex: to_latex(&eq),
                display: eq.display,
            });
            index += 1;
            continue;
        }
        index += match doc.local(c) {
            "r" | "fld" => doc
                .child(c, crate::xml::Ns::A, "t")
                .map_or(0, |t| doc.text(t).chars().count()),
            "br" => 1,
            _ => 0,
        };
    }
    out
}

/// The laid-out equations of resolved paragraphs.
pub(super) fn layout_equations(
    paragraphs: &[Paragraph],
    boxes: &[EquationBox],
) -> Vec<EquationLayout> {
    boxes
        .iter()
        .filter_map(|b| {
            let para = paragraphs.get(b.paragraph)?;
            let mut index = 0;
            let eq = para.runs.iter().find_map(|r| {
                let len = if r.kind == RunKind::Break {
                    1
                } else {
                    r.text.chars().count()
                };
                let found = match &r.kind {
                    RunKind::Math(eq) if index == b.index => Some(eq),
                    _ => None,
                };
                index += len;
                found
            })?;
            Some(EquationLayout {
                paragraph: b.paragraph,
                index: b.index,
                x: b.x,
                y: b.y,
                w: b.w,
                h: b.h,
                latex: to_latex(eq),
                display: eq.display,
            })
        })
        .collect()
}
