//! Changes to a drawing the engine does not lay out again (layouts it has
//! no algorithm for, or arrangements customized in PowerPoint): a node's
//! new text goes into the shapes that show it, and new colors or styles
//! repaint every shape by its presentation point's style label.

use super::colors::ColorsDef;
use super::data::{CxnKind, Model, PtKind};
use super::drawing::{Paint, import};
use super::quick_style::StyleDef;
use super::{Parts, definitions};
use crate::error::Result;
use crate::model::presentation::Presentation;
use crate::xml::{NodeId, Ns, XmlDoc};

/// Fill elements of `spPr`.
const FILLS: &[&str] = &[
    "noFill",
    "solidFill",
    "gradFill",
    "blipFill",
    "pattFill",
    "grpFill",
];

/// Puts the text of `node` (already changed in the data part) into the
/// drawing shapes that show it, replacing its `old_count` paragraphs there
/// and keeping their paragraph and character formatting.
pub(crate) fn update_text(
    pres: &mut Presentation,
    data_part: &str,
    drawing_part: &str,
    node: &str,
    old_count: usize,
) -> Result<()> {
    let data = pres.xml(data_part)?;
    let model = Model::read(&data)?;
    let Some(pt) = model.point(node) else {
        return Ok(());
    };
    let new_paras: Vec<NodeId> = data
        .child(pt.el, Ns::DGM, "t")
        .map(|t| data.children_named(t, Ns::A, "p").collect())
        .unwrap_or_default();
    let count_of = |id: &str| {
        model
            .point(id)
            .and_then(|p| data.child(p.el, Ns::DGM, "t"))
            .map_or(1, |t| data.children_named(t, Ns::A, "p").count().max(1))
    };
    // (drawing modelId, index of the node's first paragraph there).
    let mut targets: Vec<(String, usize)> = vec![(node.to_owned(), 0)];
    for c in model
        .cxns
        .iter()
        .filter(|c| c.kind == CxnKind::PresOf && c.src == node)
    {
        let start: usize = model
            .pres_sources(&c.dest)
            .iter()
            .filter(|o| o.dest_ord < c.dest_ord)
            .map(|o| count_of(&o.src))
            .sum();
        targets.push((c.dest.clone(), start));
    }
    let doc = pres.xml_mut(drawing_part)?;
    let sps: Vec<NodeId> = doc
        .descendants(doc.root())
        .into_iter()
        .filter(|&n| doc.ns(n) == Ns::DSP && doc.local(n) == "sp")
        .collect();
    for (model_id, start) in targets {
        for &sp in &sps {
            if doc.attr(sp, "modelId") != Some(model_id.as_str()) {
                continue;
            }
            let Some(body) = doc.child(sp, Ns::DSP, "txBody") else {
                continue;
            };
            replace_paragraphs(doc, body, start, old_count.max(1), &data, &new_paras);
        }
    }
    Ok(())
}

fn replace_paragraphs(
    doc: &mut XmlDoc,
    body: NodeId,
    start: usize,
    count: usize,
    src: &XmlDoc,
    new_paras: &[NodeId],
) {
    let paras: Vec<NodeId> = doc.children_named(body, Ns::A, "p").collect();
    let Some(&first) = paras.get(start) else {
        return;
    };
    let ppr = doc.child(first, Ns::A, "pPr");
    let rpr = doc
        .children(first)
        .find(|&c| matches!(doc.local(c), "r" | "fld"))
        .and_then(|r| doc.child(r, Ns::A, "rPr"))
        .or_else(|| doc.child(first, Ns::A, "endParaRPr"));
    let size = rpr.and_then(|r| doc.attr(r, "sz").map(str::to_owned));
    let template_ppr = ppr.map(|p| doc.deep_clone(p));
    let mut inserted = Vec::new();
    for &p in new_paras {
        let copy = doc.import(src, p);
        doc.remove_children_named(copy, Ns::A, "pPr");
        if let Some(t) = template_ppr {
            let c = doc.deep_clone(t);
            doc.insert_child(copy, 0, c);
        }
        if let Some(sz) = &size {
            let items: Vec<NodeId> = doc.descendants(copy);
            for n in items {
                if matches!(doc.local(n), "rPr" | "endParaRPr") {
                    doc.set_attr(n, "sz", sz);
                }
            }
        }
        inserted.push(copy);
    }
    for c in inserted.into_iter().rev() {
        doc.insert_after(first, c);
    }
    let end = (start + count).min(paras.len());
    for &p in &paras[start..end] {
        doc.detach(p);
    }
}

/// Repaints a drawing with the diagram's current colors and style: each
/// shape whose presentation point names a style label gets that label's
/// fill, line, effects, and text color. Shapes formatted by hand keep theirs.
pub(crate) fn repaint(pres: &mut Presentation, slide_part: &str, parts: &Parts) -> Result<()> {
    let Some(drawing) = parts.drawing.clone() else {
        return Ok(());
    };
    let (colors, style): (ColorsDef, StyleDef) = definitions(pres, parts)?;
    let data = pres.xml(&parts.data)?;
    let model = Model::read(&data)?;
    let slide = pres.part(slide_part)?;
    let ctx = pres.context_for(slide, 1)?;
    let paint = Paint {
        ctx: &ctx,
        colors: &colors,
        style: &style,
    };
    // Nodes formatted by hand (their own fill or line).
    let custom_nodes: std::collections::HashSet<&str> = model
        .points
        .iter()
        .filter(|p| p.kind.is_node())
        .filter(|p| {
            data.child(p.el, Ns::DGM, "spPr").is_some_and(|s| {
                data.children(s)
                    .any(|c| FILLS.contains(&data.local(c)) || data.local(c) == "ln")
            })
        })
        .map(|p| p.id.as_str())
        .collect();
    let mut styles = std::collections::HashMap::new();
    for p in model.points.iter().filter(|p| p.kind == PtKind::Pres) {
        let Some(set) = data.child(p.el, Ns::DGM, "prSet") else {
            continue;
        };
        let custom = data
            .child(p.el, Ns::DGM, "spPr")
            .is_some_and(|s| data.first_child(s).is_some())
            || model
                .pres_sources(&p.id)
                .iter()
                .any(|c| custom_nodes.contains(c.src.as_str()));
        let (Some(label), false) = (data.attr(set, "presStyleLbl"), custom) else {
            continue;
        };
        let idx = data.attr_i64(set, "presStyleIdx").unwrap_or(0).max(0) as usize;
        let cnt = data.attr_i64(set, "presStyleCnt").unwrap_or(1).max(1) as usize;
        styles.insert(p.id.clone(), (label.to_owned(), idx, cnt));
    }
    let doc = pres.xml_mut(&drawing)?;
    let sps: Vec<NodeId> = doc
        .descendants(doc.root())
        .into_iter()
        .filter(|&n| doc.ns(n) == Ns::DSP && doc.local(n) == "sp")
        .collect();
    for sp in sps {
        let Some((label, idx, cnt)) = doc.attr(sp, "modelId").and_then(|m| styles.get(m)) else {
            continue;
        };
        let Some(sp_pr) = doc.child(sp, Ns::DSP, "spPr") else {
            continue;
        };
        let lines = doc.child(sp_pr, Ns::A, "custGeom").is_some()
            && doc.children(sp_pr).any(|c| doc.local(c) == "noFill");
        let (fill, line, effect, text, [ln, fl, ef]) =
            paint.shape_style(label, (*idx, (*cnt).max(1)), lines);
        for c in doc.child_nodes(sp_pr).to_vec() {
            let name = doc.local(c);
            if FILLS.contains(&name) || matches!(name, "ln" | "effectLst" | "effectDag") {
                doc.detach(c);
            }
        }
        let anchor = doc
            .children(sp_pr)
            .find(|&c| matches!(doc.local(c), "prstGeom" | "custGeom"))
            .or_else(|| doc.child(sp_pr, Ns::A, "xfrm"));
        let mut at = anchor;
        for xml in [&fill, &line, &effect] {
            let Ok(el) = import(doc, xml) else {
                continue;
            };
            match at {
                Some(a) => doc.insert_after(a, el),
                None => doc.insert_child(sp_pr, 0, el),
            }
            at = Some(el);
        }
        if let Some(st) = doc.child(sp, Ns::DSP, "style") {
            for (name, v) in [("lnRef", ln), ("fillRef", fl), ("effectRef", ef)] {
                if let Some(r) = doc.child(st, Ns::A, name) {
                    doc.set_attr(r, "idx", &v.to_string());
                }
            }
            if let Some(font) = doc.child(st, Ns::A, "fontRef") {
                for c in doc.child_nodes(font).to_vec() {
                    doc.detach(c);
                }
                if let Some(t) = &text
                    && let Ok(el) = import(doc, t)
                {
                    doc.append_child(font, el);
                }
            }
        }
    }
    Ok(())
}
