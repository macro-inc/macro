//! Re-fitting text after edits, as PowerPoint does while you type:
//! shrink-on-overflow (`normAutofit`) recomputes its stored font scale, and
//! resize-shape-to-fit (`spAutoFit`) changes the shape's height.

use super::shapes::ensure_xfrm;
use super::xmlutil::{BODY_PR_ORDER, find_shape, set_off_ext};
use crate::error::Result;
use crate::font::FontDb;
use crate::model::presentation::Presentation;
use crate::model::shape::{Inherit, WalkCtx, resolve_shape};
use crate::model::text::{Autofit, Vert};
use crate::render::build::shape_geometry;
use crate::render::text::{LayoutParams, layout};
use crate::xml::Ns;
use std::collections::HashSet;

/// PowerPoint's shrink steps: (font scale, line spacing reduction).
const LADDER: &[(f32, f32)] = &[
    (1.0, 0.0),
    (0.925, 0.1),
    (0.85, 0.2),
    (0.775, 0.2),
    (0.7, 0.2),
    (0.625, 0.2),
    (0.55, 0.2),
    (0.475, 0.2),
    (0.4, 0.2),
    (0.325, 0.2),
    (0.25, 0.2),
];

/// Overflow smaller than this (points) still counts as fitting.
const TOLERANCE: f32 = 0.5;

/// Re-fits the text of each `(slide part, shape id)`.
pub fn refit(pres: &mut Presentation, targets: &[(String, u32)], fonts: &FontDb) -> Result<()> {
    let mut seen = HashSet::new();
    for (part, id) in targets {
        if seen.insert((part.as_str(), *id)) {
            refit_shape(pres, part, *id, fonts)?;
        }
    }
    Ok(())
}

fn refit_shape(pres: &mut Presentation, part: &str, id: u32, fonts: &FontDb) -> Result<()> {
    let slide = pres.part(part)?;
    let Some(node) = find_shape(&slide.doc, id) else { return Ok(()) };
    if slide.doc.local(node) != "sp" {
        return Ok(());
    }
    let ctx = pres.context_for(slide.clone(), 1)?;
    let walk = WalkCtx { ctx: &ctx, inherit: Inherit::Slide };
    let Some(shape) = resolve_shape(&walk, &slide, node) else { return Ok(()) };
    let Some(text) = shape.text.as_ref() else { return Ok(()) };
    if !matches!(text.body.vert, Vert::Horz) {
        return Ok(());
    }
    let rect = shape_geometry(&shape).text_rect;
    match text.body.autofit {
        Autofit::Normal { font_scale, line_reduction } => {
            let fits = |&(s, r): &(f32, f32)| {
                let lay = layout(text, rect.w, rect.h, fonts, LayoutParams { font_scale: s, line_reduction: r });
                lay.content_height <= rect.h + TOLERANCE
            };
            let (scale, reduction) = LADDER.iter().copied().find(fits).unwrap_or(LADDER[LADDER.len() - 1]);
            if (scale - font_scale).abs() < 1e-3 && (reduction - line_reduction).abs() < 1e-3 {
                return Ok(());
            }
            let doc = pres.xml_mut(part)?;
            let Some(node) = find_shape(doc, id) else { return Ok(()) };
            let Some(body) = doc.children(node).find(|&c| doc.local(c) == "txBody") else { return Ok(()) };
            let bpr = match doc.child(body, Ns::A, "bodyPr") {
                Some(b) => b,
                None => {
                    let b = doc.create_element(Ns::A, "bodyPr");
                    doc.insert_child(body, 0, b);
                    b
                }
            };
            let fit = doc.ensure_child(bpr, Ns::A, "normAutofit", BODY_PR_ORDER);
            if scale >= 0.9995 {
                doc.remove_attr(fit, "fontScale");
            } else {
                doc.set_attr(fit, "fontScale", &((scale * 100_000.0).round() as i64).to_string());
            }
            if reduction <= 0.0005 {
                doc.remove_attr(fit, "lnSpcReduction");
            } else {
                doc.set_attr(fit, "lnSpcReduction", &((reduction * 100_000.0).round() as i64).to_string());
            }
        }
        Autofit::Shape => {
            if shape.xfrm.rot != 0.0 {
                return Ok(());
            }
            let lay = layout(text, rect.w, rect.h, fonts, LayoutParams::from_body(text));
            let h = (lay.content_height + (shape.xfrm.h - rect.h)).max(1.0);
            let w = if text.body.wrap { shape.xfrm.w } else { (lay.content_width + (shape.xfrm.w - rect.w)).max(1.0) };
            if (h - shape.xfrm.h).abs() < TOLERANCE && (w - shape.xfrm.w).abs() < TOLERANCE {
                return Ok(());
            }
            let x = shape.xfrm;
            let doc = pres.xml_mut(part)?;
            let Some(node) = find_shape(doc, id) else { return Ok(()) };
            let xfrm = ensure_xfrm(doc, node);
            set_off_ext(doc, xfrm, x.x, x.y, w, h);
        }
        Autofit::None => {}
    }
    Ok(())
}
