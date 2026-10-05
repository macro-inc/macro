//! Format painter: copies one shape's look (fill, outline, effects, theme
//! style reference, and text frame anchoring and margins) onto other shapes.
//! Character and paragraph formatting travel separately, through the text
//! ops with the source's resolved styles.

use super::shapes;
use super::xmlutil::{FILL_NAMES, SP_PR_ORDER, ensure_sp_pr};
use crate::error::{Error, Result};
use crate::model::presentation::Presentation;
use crate::xml::{NodeId, Ns, XmlDoc};

/// `spPr` children that make up a shape's look (everything but its frame
/// and geometry).
const LOOK: &[&str] = &[
    "noFill",
    "solidFill",
    "gradFill",
    "blipFill",
    "pattFill",
    "grpFill",
    "ln",
    "effectLst",
    "effectDag",
    "scene3d",
    "sp3d",
];

/// `bodyPr` attributes that position text inside its frame.
const FRAME_ATTRS: &[&str] = &[
    "anchor",
    "anchorCtr",
    "lIns",
    "tIns",
    "rIns",
    "bIns",
    "vert",
    "wrap",
];

/// Order of a shape's children, for re-inserting `p:style`.
const SP_ORDER: &[&str] = &[
    "nvSpPr",
    "nvPicPr",
    "nvCxnSpPr",
    "blipFill",
    "spPr",
    "style",
    "txBody",
    "extLst",
];

/// Shape elements whose look can be painted.
fn paintable(doc: &XmlDoc, shape: NodeId) -> bool {
    matches!(doc.local(shape), "sp" | "cxnSp" | "pic")
}

fn sp_pr(doc: &XmlDoc, shape: NodeId) -> Option<NodeId> {
    doc.child(shape, Ns::P, "spPr")
}

/// Copies the look of `from_shape` on `from_slide`'s part onto every shape
/// in `targets` (group members included) on `part`.
pub fn paste_format(
    pres: &mut Presentation,
    from_part: &str,
    from_shape: u32,
    part: &str,
    targets: &[u32],
) -> Result<()> {
    let source_doc = pres.xml(from_part)?;
    let source = shapes::find(&source_doc, from_shape)?;
    if !paintable(&source_doc, source) {
        return Err(Error::InvalidEdit(format!(
            "shape {from_shape} has no shape formatting to copy (pick a shape, line, or picture)"
        )));
    }
    let same_part = from_part == part;
    let doc = pres.xml_mut(part)?;
    let mut nodes = Vec::new();
    for &id in targets {
        let node = shapes::find(doc, id)?;
        collect(doc, node, &mut nodes);
    }
    for node in nodes {
        if same_part && node == source {
            continue;
        }
        paint(doc, &source_doc, source, node, same_part);
    }
    Ok(())
}

/// The paintable shapes of `node`: itself, or a group's members.
fn collect(doc: &XmlDoc, node: NodeId, out: &mut Vec<NodeId>) {
    if doc.local(node) == "grpSp" {
        for child in doc.children(node).collect::<Vec<_>>() {
            collect(doc, child, out);
        }
    } else if paintable(doc, node) {
        out.push(node);
    }
}

fn paint(doc: &mut XmlDoc, source_doc: &XmlDoc, source: NodeId, target: NodeId, same_part: bool) {
    let target_pr = ensure_sp_pr(doc, target);
    for old in doc
        .children(target_pr)
        .filter(|&c| LOOK.contains(&doc.local(c)))
        .collect::<Vec<_>>()
    {
        doc.detach(old);
    }
    if let Some(source_pr) = sp_pr(source_doc, source) {
        for el in source_doc.children(source_pr) {
            let name = source_doc.local(el);
            if !LOOK.contains(&name) {
                continue;
            }
            // Picture fills point at relationships of their own part.
            if name == "blipFill" && !same_part {
                continue;
            }
            // Lines and connectors have no fill to take.
            if FILL_NAMES.contains(&name) && doc.local(target) == "cxnSp" {
                continue;
            }
            let copy = doc.import(source_doc, el);
            doc.insert_in_order(target_pr, copy, SP_PR_ORDER);
        }
    }
    if let Some(old) = doc.child(target, Ns::P, "style") {
        doc.detach(old);
    }
    if let Some(style) = source_doc.child(source, Ns::P, "style") {
        let copy = doc.import(source_doc, style);
        doc.insert_in_order(target, copy, SP_ORDER);
    }
    let source_body = source_doc
        .child(source, Ns::P, "txBody")
        .and_then(|b| source_doc.child(b, Ns::A, "bodyPr"));
    let target_body = doc
        .child(target, Ns::P, "txBody")
        .and_then(|b| doc.child(b, Ns::A, "bodyPr"));
    if let (Some(from), Some(to)) = (source_body, target_body) {
        for attr in FRAME_ATTRS {
            match source_doc.attr(from, attr) {
                Some(value) => {
                    let value = value.to_owned();
                    doc.set_attr(to, attr, &value);
                }
                None => doc.remove_attr(to, attr),
            }
        }
    }
}

#[cfg(test)]
mod test;
