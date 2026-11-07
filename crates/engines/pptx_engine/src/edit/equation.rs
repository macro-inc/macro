//! Equation edits (PowerPoint's Insert ▸ Equation): inserting an equation
//! into text or a new text box, replacing one, formatting one, and keeping
//! the fallbacks of PowerPoint's shape-wrapped equations in step.
//!
//! The engine writes each equation as a paragraph child of its own:
//! `mc:AlternateContent` whose `a14` choice holds the OMML and whose
//! fallback is a text run of the equation's linear form, which readers
//! without DrawingML 2010 math (LibreOffice) show. PowerPoint itself wraps
//! a whole shape instead, with a picture of its text as the fallback; when
//! an edit changes such a shape, it becomes a plain shape whose equations
//! are wrapped one by one, so no reader is left with a stale picture.

use super::ops::{NewShape, RunPatch, TextPos};
use super::shapes;
use super::text::{
    items, para_len, paragraph_at, paragraphs, rpr_template, split_at, split_paragraph,
};
use super::xmlutil::{FILL_NAMES, set_off_ext};
use crate::error::{Error, Result};
use crate::math::omml::{A_NS, A14_NS, MC_NS, RunTemplate, a14_xml, alternate_content_xml};
use crate::math::{
    Equation, equation_element, is_equation_item, parse_latex, plain_text, read_equation,
};
use crate::model::presentation::Presentation;
use crate::model::shape::{Xfrm, c_nv_pr, sp_tree};
use crate::xml::{NodeId, Ns, XmlDoc};

/// Reads an op's linear text.
fn parse(latex: &str, display: bool) -> Result<Equation> {
    parse_latex(latex, display).map_err(|e| Error::InvalidEdit(format!("equation: {e}")))
}

fn esc(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// The size and fill of an `a:rPr`-like element, for the runs of an equation.
fn run_template(doc: &XmlDoc, rpr: Option<NodeId>) -> RunTemplate {
    let Some(rpr) = rpr else {
        return RunTemplate::default();
    };
    let attrs = doc
        .attr(rpr, "sz")
        .map(|sz| format!(r#" sz="{}""#, esc(sz)))
        .unwrap_or_default();
    let fill = doc
        .children(rpr)
        .find(|&c| doc.ns(c) == Ns::A && FILL_NAMES.contains(&doc.local(c)))
        .and_then(|f| drawingml_xml(doc, f))
        .unwrap_or_default();
    RunTemplate { attrs, fill }
}

/// A DrawingML-only subtree as markup with `a:` prefixes (`None` when it
/// holds anything else).
fn drawingml_xml(doc: &XmlDoc, n: NodeId) -> Option<String> {
    if doc.ns(n) != Ns::A {
        return None;
    }
    let mut out = format!("<a:{}", doc.local(n));
    for a in doc.attrs(n) {
        if a.ns() != Ns::NONE {
            return None;
        }
        out.push_str(&format!(r#" {}="{}""#, a.local(), esc(a.value())));
    }
    let children: Vec<NodeId> = doc.children(n).collect();
    if children.is_empty() {
        out.push_str("/>");
        return Some(out);
    }
    out.push('>');
    for c in children {
        out.push_str(&drawingml_xml(doc, c)?);
    }
    out.push_str(&format!("</a:{}>", doc.local(n)));
    Some(out)
}

/// The first `a:rPr` inside an equation (its first run's formatting).
fn first_rpr(doc: &XmlDoc, m: NodeId) -> Option<NodeId> {
    doc.descendants(m)
        .into_iter()
        .find(|&n| doc.is(n, Ns::A, "rPr"))
}

/// Parses markup that declares its own namespaces and adds it to `doc`
/// (detached), keeping its prefixes.
fn import_markup(doc: &mut XmlDoc, xml: &str) -> Result<NodeId> {
    let frag = XmlDoc::parse(xml.as_bytes(), "equation")?;
    Ok(doc.import_verbatim(&frag, frag.root()))
}

/// Inserts markup into paragraph `p` at character `offset`.
fn insert_item(doc: &mut XmlDoc, p: NodeId, offset: usize, xml: &str) -> Result<NodeId> {
    let index = split_at(doc, p, offset);
    let node = import_markup(doc, xml)?;
    doc.insert_child(p, index, node);
    doc.drop_redundant_ns_decls(node);
    Ok(node)
}

/// Inserts an equation into a text body at `at` (the end of the last
/// paragraph when `None`). A display equation gets a paragraph of its own.
/// Returns the position just after the equation.
pub(super) fn insert_into_body(
    doc: &mut XmlDoc,
    body: NodeId,
    at: Option<TextPos>,
    latex: &str,
    display: Option<bool>,
) -> Result<TextPos> {
    let ps = paragraphs(doc, body);
    let at = match at {
        Some(at) => at,
        None => {
            let last = ps.len().saturating_sub(1);
            TextPos {
                paragraph: last,
                offset: ps.get(last).map_or(0, |&p| para_len(doc, p)),
            }
        }
    };
    let p = paragraph_at(doc, body, at.paragraph)?;
    let len = para_len(doc, p);
    if at.offset > len {
        return Err(Error::InvalidEdit(format!(
            "offset {} is past the end of paragraph {}",
            at.offset, at.paragraph
        )));
    }
    let display = display.unwrap_or(len == 0);
    let eq = parse(latex, display)?;
    let template = rpr_template(doc, p, at.offset).or_else(|| doc.child(p, Ns::A, "endParaRPr"));
    let xml = alternate_content_xml(&eq, &run_template(doc, template), &plain_text(&eq));
    if !display || len == 0 {
        insert_item(doc, p, at.offset, &xml)?;
        return Ok(TextPos {
            paragraph: at.paragraph,
            offset: at.offset + 1,
        });
    }
    // A display equation stands alone: split the text around it.
    let mut pos = at;
    if pos.offset > 0 {
        pos = split_paragraph(doc, body, pos)?;
    }
    let p = paragraph_at(doc, body, pos.paragraph)?;
    insert_item(doc, p, 0, &xml)?;
    if para_len(doc, p) > 1 {
        split_paragraph(
            doc,
            body,
            TextPos {
                paragraph: pos.paragraph,
                offset: 1,
            },
        )?;
    }
    Ok(TextPos {
        paragraph: pos.paragraph,
        offset: 1,
    })
}

/// The equation item at character `index` of paragraph `p`.
fn equation_at(doc: &XmlDoc, p: NodeId, index: usize) -> Option<NodeId> {
    let mut pos = 0;
    for (node, len) in items(doc, p) {
        if pos == index && is_equation_item(doc, node) {
            return Some(node);
        }
        pos += len;
    }
    None
}

/// Replaces the equation at (`paragraph`, `index`) of a text body, keeping
/// its size and color; `display` switches between display and inline.
pub(super) fn set_in_body(
    doc: &mut XmlDoc,
    body: NodeId,
    paragraph: usize,
    index: usize,
    latex: &str,
    display: Option<bool>,
) -> Result<()> {
    let p = paragraph_at(doc, body, paragraph)?;
    let item = equation_at(doc, p, index).ok_or_else(|| {
        Error::InvalidEdit(format!(
            "paragraph {paragraph} has no equation at index {index}"
        ))
    })?;
    let m =
        equation_element(doc, item).ok_or_else(|| Error::InvalidEdit("not an equation".into()))?;
    let was_display = doc.children(m).any(|c| doc.local(c) == "oMathPara");
    let eq = parse(latex, display.unwrap_or(was_display))?;
    let template = run_template(doc, first_rpr(doc, m));
    let xml = if doc.is(item, Ns::MC, "AlternateContent") {
        alternate_content_xml(&eq, &template, &plain_text(&eq))
    } else {
        // A bare `a14:m`, inside a shape PowerPoint wrapped as a whole.
        a14_xml(&eq, &template)
    };
    let new = import_markup(doc, &xml)?;
    doc.insert_before(item, new);
    doc.detach(item);
    doc.drop_redundant_ns_decls(new);
    Ok(())
}

/// Applies the size and color of a character-format patch to every run
/// of an equation (and its text fallback); other formatting does not
/// apply to math.
pub(super) fn format_equation(doc: &mut XmlDoc, item: NodeId, patch: &RunPatch) -> Result<()> {
    let math_patch = RunPatch {
        size: patch.size,
        color: patch.color.clone(),
        highlight: patch.highlight.clone(),
        ..RunPatch::default()
    };
    if math_patch == RunPatch::default() {
        return Ok(());
    }
    let rprs: Vec<NodeId> = doc
        .descendants(item)
        .into_iter()
        .filter(|&n| doc.is(n, Ns::A, "rPr"))
        .collect();
    for rpr in rprs {
        super::text::patch_rpr(doc, rpr, &math_patch, None)?;
    }
    Ok(())
}

/// Adds a text box holding an equation, centered on the slide, as
/// PowerPoint's Insert ▸ Equation does with nothing selected. Returns the
/// new shape's id and the point its center stays on once it is sized.
pub(super) fn new_equation_box(
    pres: &mut Presentation,
    part: &str,
    latex: &str,
    display: Option<bool>,
) -> Result<(u32, f32, f32)> {
    // Check the text before adding anything.
    parse(latex, display.unwrap_or(true))?;
    let (sw, sh) = pres.slide_size();
    let (cx, cy) = (sw as f32 / 12_700.0 / 2.0, sh as f32 / 12_700.0 / 2.0);
    let (w, h) = (144.0, 40.0);
    let id = shapes::add_shape(
        pres,
        part,
        &NewShape::TextBox {
            text: String::new(),
        },
        [cx - w / 2.0, cy - h / 2.0, w, h],
    )?;
    let doc = pres.xml_mut(part)?;
    let node = shapes::find(doc, id)?;
    let body = shapes::ensure_tx_body(doc, node)?;
    // Equation boxes grow with the equation instead of wrapping it.
    if let Some(bpr) = doc.child(body, Ns::A, "bodyPr") {
        doc.set_attr(bpr, "wrap", "none");
    }
    insert_into_body(doc, body, None, latex, Some(display.unwrap_or(true)))?;
    Ok((id, cx, cy))
}

/// Moves shapes so their centers are at the given points (after their
/// size was fitted to their text).
pub(super) fn recenter(pres: &mut Presentation, targets: &[(String, u32, f32, f32)]) -> Result<()> {
    for (part, id, cx, cy) in targets {
        let doc = pres.xml_mut(part)?;
        let node = shapes::find(doc, *id)?;
        let Some(x) = shapes::xfrm_element(doc, node) else {
            continue;
        };
        let xf = Xfrm::parse(doc, x);
        set_off_ext(doc, x, cx - xf.w / 2.0, cy - xf.h / 2.0, xf.w, xf.h);
    }
    Ok(())
}

/// Shape-level `mc:AlternateContent` whose choice holds equations, with
/// the id of the shape in the choice.
fn math_wrappers(doc: &XmlDoc) -> Vec<(NodeId, u32)> {
    let Some(tree) = sp_tree(doc) else {
        return Vec::new();
    };
    doc.descendants(tree)
        .into_iter()
        .filter(|&n| doc.is(n, Ns::MC, "AlternateContent"))
        .filter_map(|ac| {
            let shape = choice_shape(doc, ac)?;
            let has_math = doc
                .descendants(shape)
                .into_iter()
                .any(|n| doc.is(n, Ns::A14, "m"));
            let id = c_nv_pr(doc, shape)
                .and_then(|c| doc.attr_i64(c, "id"))
                .and_then(|id| u32::try_from(id).ok())?;
            has_math.then_some((ac, id))
        })
        .collect()
}

/// The shape in the `a14` choice of a shape-level alternate content.
fn choice_shape(doc: &XmlDoc, ac: NodeId) -> Option<NodeId> {
    let choice = doc.children(ac).find(|&c| doc.is(c, Ns::MC, "Choice"))?;
    doc.children(choice).find(|&c| {
        matches!(
            doc.local(c),
            "sp" | "grpSp" | "graphicFrame" | "pic" | "cxnSp"
        )
    })
}

/// After a batch: every PowerPoint-wrapped equation shape the batch
/// changed is unwrapped (see the module docs). `pres.pkg` still holds the
/// slides as they were before the batch.
pub(super) fn sync_wrapped_shapes(pres: &mut Presentation) -> Result<()> {
    let parts: Vec<String> = pres
        .slides
        .iter()
        .filter(|s| pres.dirty_xml.contains(&s.part))
        .map(|s| s.part.clone())
        .collect();
    for part in parts {
        let doc = pres.xml(&part)?;
        let wrapped = math_wrappers(&doc);
        if wrapped.is_empty() {
            continue;
        }
        let old = pres
            .pkg
            .read(&part)
            .ok()
            .and_then(|b| XmlDoc::parse(&b, &part).ok());
        let shape_bytes =
            |d: &XmlDoc, ac: NodeId| choice_shape(d, ac).map(|s| d.fragment(s).to_bytes());
        let changed: Vec<u32> = wrapped
            .iter()
            .filter(|(ac, id)| {
                let before = old.as_ref().and_then(|o| {
                    math_wrappers(o)
                        .into_iter()
                        .find(|(_, i)| i == id)
                        .and_then(|(a, _)| shape_bytes(o, a))
                });
                before.is_none() || before != shape_bytes(&doc, *ac)
            })
            .map(|(_, id)| *id)
            .collect();
        if changed.is_empty() {
            continue;
        }
        let doc = pres.xml_mut(&part)?;
        for id in changed {
            if let Some((ac, _)) = math_wrappers(doc).into_iter().find(|(_, i)| *i == id) {
                unwrap(doc, ac)?;
            }
        }
    }
    Ok(())
}

/// Replaces a shape-level alternate content by its choice's shape, whose
/// equations are then wrapped one by one.
fn unwrap(doc: &mut XmlDoc, ac: NodeId) -> Result<()> {
    let Some(shape) = choice_shape(doc, ac) else {
        return Ok(());
    };
    // A fragment declares every namespace in scope, so the copy keeps them
    // outside the choice.
    let frag = doc.fragment(shape);
    let copy = doc.import_verbatim(&frag, frag.root());
    doc.insert_before(ac, copy);
    doc.detach(ac);
    doc.drop_redundant_ns_decls(copy);
    let bare: Vec<NodeId> = doc
        .descendants(copy)
        .into_iter()
        .filter(|&n| {
            doc.is(n, Ns::A14, "m") && doc.parent(n).is_some_and(|p| doc.is(p, Ns::A, "p"))
        })
        .collect();
    for m in bare {
        wrap_bare(doc, m)?;
    }
    Ok(())
}

/// Wraps a bare `a14:m` of a paragraph in alternate content with a text fallback.
fn wrap_bare(doc: &mut XmlDoc, m: NodeId) -> Result<()> {
    let eq = read_equation(doc, m, &|_| None);
    let tpl = run_template(doc, first_rpr(doc, m));
    let shell = format!(
        r#"<mc:AlternateContent xmlns:mc="{MC_NS}" xmlns:a="{A_NS}"><mc:Choice xmlns:a14="{A14_NS}" Requires="a14"/><mc:Fallback><a:r><a:rPr lang="en-US"{}>{}</a:rPr><a:t>{}</a:t></a:r></mc:Fallback></mc:AlternateContent>"#,
        tpl.attrs,
        tpl.fill,
        esc(&plain_text(&eq))
    );
    let ac = import_markup(doc, &shell)?;
    doc.insert_before(m, ac);
    let choice = doc.children(ac).find(|&c| doc.is(c, Ns::MC, "Choice"));
    if let Some(choice) = choice {
        doc.append_child(choice, m);
    }
    doc.drop_redundant_ns_decls(ac);
    Ok(())
}

#[cfg(test)]
mod test;
