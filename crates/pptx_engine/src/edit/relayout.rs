//! Changing a slide's layout, and binding a slide's placeholders to the
//! placeholders of its (new) layout, as PowerPoint's Layout menu does.
//!
//! A slide placeholder inherits its position (and text style) from the
//! layout placeholder with the same index, else the same type. After a
//! layout change, each slide placeholder is matched to a placeholder of the
//! new layout (same index and a compatible type, else the same type, else a
//! compatible type) and its `p:ph` is rewritten to that placeholder's type
//! and index, so it takes the new position. Placeholders without a match
//! keep the position they had, written into their own transform.

use super::group::Frame;
use super::shapes::{append_to_tree, effective_xfrm, ensure_xfrm, xfrm_element};
use super::slides::{find_layout, layout_of, placeholder_xml};
use super::xmlutil::{fresh_shape_id, import_fragment};
use crate::error::{Error, Result};
use crate::model::presentation::Presentation;
use crate::model::shape::{Placeholder, c_nv_pr, placeholder_of, sp_tree, tree_children};
use crate::opc::{Relationship, TargetMode, rel_type, relative_target};
use crate::xml::{NodeId, Ns, XmlDoc};
use std::collections::HashMap;

/// Placeholder types that hold "content" (an object placeholder accepts them).
const CONTENT_KINDS: &[&str] = &["pic", "chart", "tbl", "dgm", "media", "clipArt"];

/// Placeholders of a shape tree (group members included), in tree order.
pub(super) fn placeholders(doc: &XmlDoc) -> Vec<(NodeId, Placeholder)> {
    fn walk(doc: &XmlDoc, parent: NodeId, out: &mut Vec<(NodeId, Placeholder)>) {
        for n in tree_children(doc, parent) {
            if let Some(p) = placeholder_of(doc, n) {
                out.push((n, p));
            } else if doc.local(n) == "grpSp" {
                walk(doc, n, out);
            }
        }
    }
    let mut out = Vec::new();
    if let Some(tree) = sp_tree(doc) {
        walk(doc, tree, &mut out);
    }
    out
}

fn shape_id(doc: &XmlDoc, node: NodeId) -> Option<u32> {
    c_nv_pr(doc, node)
        .and_then(|c| doc.attr_i64(c, "id"))
        .and_then(|id| u32::try_from(id).ok())
}

/// The frames that a slide's placeholders without their own transform
/// inherit (from the current layout or master), by shape id.
pub(super) fn inherited_frames(pres: &mut Presentation, part: &str) -> Result<HashMap<u32, Frame>> {
    let doc = pres.xml(part)?;
    let ids: Vec<u32> = placeholders(&doc)
        .into_iter()
        .filter(|(n, _)| xfrm_element(&doc, *n).is_none())
        .filter_map(|(n, _)| shape_id(&doc, n))
        .collect();
    let mut out = HashMap::new();
    for id in ids {
        out.insert(id, Frame::from_xfrm(&effective_xfrm(pres, part, id)?));
    }
    Ok(out)
}

/// Whether a slide placeholder of type `a` can take a layout placeholder of type `b`.
fn compatible(a: &str, b: &str) -> bool {
    let titles = ["title", "ctrTitle"];
    let bodies = ["body", "subTitle", "obj"];
    a == b
        || titles.contains(&a) && titles.contains(&b)
        || bodies.contains(&a) && bodies.contains(&b)
        || (a == "obj" && CONTENT_KINDS.contains(&b))
        || (b == "obj" && CONTENT_KINDS.contains(&a))
}

/// The layout placeholder a slide placeholder binds to.
fn pick(ph: &Placeholder, targets: &[(NodeId, Placeholder)], used: &[bool]) -> Option<usize> {
    let free = |j: &usize| !used[*j];
    let indices = || (0..targets.len()).filter(free);
    if ph.idx != 0
        && let Some(j) = indices()
            .find(|&j| targets[j].1.idx == ph.idx && compatible(&ph.kind, &targets[j].1.kind))
    {
        return Some(j);
    }
    indices()
        .find(|&j| targets[j].1.kind == ph.kind)
        .or_else(|| indices().find(|&j| compatible(&ph.kind, &targets[j].1.kind)))
}

/// The `p:ph` element of a shape.
fn ph_element(doc: &XmlDoc, node: NodeId) -> Option<NodeId> {
    let nv = doc
        .children(node)
        .find(|&c| doc.local(c).starts_with("nv"))?;
    doc.child(nv, Ns::P, "nvPr")
        .and_then(|nv| doc.child(nv, Ns::P, "ph"))
}

/// Binds the placeholders of `slide_part` to those of `layout_part`.
///
/// Matched placeholders take the layout placeholder's type and index;
/// unmatched ones without their own transform get the frame recorded in
/// `inherited`. With `add_missing`, layout placeholders nothing matched are
/// added to the slide empty (footers, dates, and slide numbers excepted).
pub(super) fn rebind_placeholders(
    pres: &mut Presentation,
    slide_part: &str,
    layout_part: &str,
    inherited: &HashMap<u32, Frame>,
    add_missing: bool,
) -> Result<()> {
    let layout = pres.xml(layout_part)?;
    let targets = placeholders(&layout);
    let random = pres.pkg.ids().cloned();
    let doc = pres.xml_mut(slide_part)?;
    let mut used = vec![false; targets.len()];
    for (node, ph) in placeholders(doc) {
        match pick(&ph, &targets, &used) {
            Some(j) => {
                used[j] = true;
                let (Some(ph_el), Some(target)) =
                    (ph_element(doc, node), ph_element(&layout, targets[j].0))
                else {
                    continue;
                };
                for a in ["type", "idx"] {
                    match layout.attr(target, a) {
                        Some(v) => doc.set_attr(ph_el, a, v),
                        None => doc.remove_attr(ph_el, a),
                    }
                }
            }
            None => {
                if xfrm_element(doc, node).is_none()
                    && let Some(frame) = shape_id(doc, node).and_then(|id| inherited.get(&id))
                {
                    let xfrm = ensure_xfrm(doc, node);
                    frame.write(doc, xfrm, true);
                }
            }
        }
    }
    if add_missing {
        let tree =
            sp_tree(doc).ok_or_else(|| Error::InvalidEdit("slide has no shape tree".into()))?;
        for (j, (node, _)) in targets.iter().enumerate() {
            if used[j] {
                continue;
            }
            let id = fresh_shape_id(doc, random.as_deref());
            if let Some(xml) = placeholder_xml(&layout, *node, id) {
                let el = import_fragment(doc, &xml)?;
                append_to_tree(doc, tree, el);
            }
        }
    }
    Ok(())
}

/// Gives a slide the layout named `name` (see the module docs).
pub(super) fn set_slide_layout(pres: &mut Presentation, slide: u32, name: &str) -> Result<()> {
    let part = pres.slide_part(slide)?;
    if name.trim().is_empty() {
        return Err(Error::InvalidEdit("the layout name is empty".into()));
    }
    let layout = find_layout(pres, Some(name), Some(slide))?;
    if layout_of(pres, &part).as_deref() == Some(layout.as_str()) {
        return Ok(());
    }
    let inherited = inherited_frames(pres, &part)?;
    let rels = pres.rels_mut(&part)?;
    let target = relative_target(&part, &layout);
    match rels
        .first_of_type(rel_type::SLIDE_LAYOUT)
        .map(|r| r.id.clone())
    {
        Some(id) => rels.push(Relationship {
            id,
            rel_type: rel_type::SLIDE_LAYOUT.to_owned(),
            target,
            mode: TargetMode::Internal,
        }),
        None => {
            rels.add_internal(rel_type::SLIDE_LAYOUT, &layout);
        }
    }
    rebind_placeholders(pres, &part, &layout, &inherited, true)
}

#[cfg(test)]
mod test;
