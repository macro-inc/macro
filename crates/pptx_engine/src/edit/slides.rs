//! Slide operations: add from a layout, duplicate, delete, move, hide, and
//! set the background. Sections and custom shows are kept consistent.

use super::ops::FillSpec;
use super::parts::copy_part_tree;
use super::shapes::fill_element;
use super::text;
use super::xmlutil::esc;
use crate::error::{Error, Result};
use crate::model::presentation::Presentation;
use crate::model::shape::{c_nv_pr, placeholder_of, sp_tree, tree_children};
use crate::opc::{Relationships, TargetMode, content_type, rel_type};
use crate::xml::{NodeId, Ns, STANDARD_DECLARATION, XmlDoc};
use serde::Serialize;
use std::collections::HashMap;

/// Child order of `p:presentation`.
pub const PRESENTATION_ORDER: &[&str] = &[
    "sldMasterIdLst",
    "notesMasterIdLst",
    "handoutMasterIdLst",
    "sldIdLst",
    "sldSz",
    "notesSz",
    "smartTags",
    "embeddedFontLst",
    "custShowLst",
    "photoAlbum",
    "custDataLst",
    "kinsoku",
    "defaultTextStyle",
    "modifyVerifier",
    "extLst",
];

/// Namespace declarations for parts the engine writes from scratch.
pub const PML_NAMESPACES: &str = "xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\"";

/// The empty group properties every shape tree starts with.
pub const TREE_HEADER: &str = "<p:nvGrpSpPr><p:cNvPr id=\"1\" name=\"\"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x=\"0\" y=\"0\"/><a:ext cx=\"0\" cy=\"0\"/><a:chOff x=\"0\" y=\"0\"/><a:chExt cx=\"0\" cy=\"0\"/></a:xfrm></p:grpSpPr>";

/// A slide layout new slides can use.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutInfo {
    /// Layout part name.
    pub part: String,
    /// Display name (`p:cSld/@name`).
    pub name: String,
    /// Layout type (`title`, `obj`, `twoObj`, `titleOnly`, `blank`, `cust`...).
    pub kind: String,
    /// The master it belongs to.
    pub master: String,
}

fn targets_of(doc: &XmlDoc, list: Option<NodeId>, item: &str, rels: &Relationships) -> Vec<String> {
    list.map(|l| {
        doc.children_named(l, Ns::P, item)
            .filter_map(|x| doc.attr_ns(x, Ns::R, "id"))
            .filter_map(|rid| rels.target_part(rid))
            .collect()
    })
    .unwrap_or_default()
}

/// Every layout of every master, in master order.
pub fn layouts(pres: &mut Presentation) -> Result<Vec<LayoutInfo>> {
    let main_name = pres.main_part.clone();
    let main = pres.part(&main_name)?;
    let masters = targets_of(
        &main.doc,
        main.doc.child(main.doc.root(), Ns::P, "sldMasterIdLst"),
        "sldMasterId",
        &main.rels,
    );
    let mut out = Vec::new();
    for m in masters {
        let Ok(master) = pres.part(&m) else { continue };
        let list = master.doc.child(master.doc.root(), Ns::P, "sldLayoutIdLst");
        for lp in targets_of(&master.doc, list, "sldLayoutId", &master.rels) {
            let Ok(layout) = pres.part(&lp) else { continue };
            let d = &layout.doc;
            let name = d
                .child(d.root(), Ns::P, "cSld")
                .and_then(|c| d.attr(c, "name"))
                .unwrap_or("")
                .to_owned();
            let kind = d.attr(d.root(), "type").unwrap_or("cust").to_owned();
            out.push(LayoutInfo {
                part: layout.name.clone(),
                name,
                kind,
                master: master.name.clone(),
            });
        }
    }
    Ok(out)
}

/// The layout part of a slide part.
pub fn layout_of(pres: &mut Presentation, slide_part: &str) -> Option<String> {
    let rels = pres.part_rels(slide_part).ok()?;
    let rel = rels.first_of_type(rel_type::SLIDE_LAYOUT)?;
    let target = rels.resolve(rel);
    pres.pkg.canonical_name(&target).map(str::to_owned)
}

fn find_layout(pres: &mut Presentation, name: Option<&str>, after: Option<u32>) -> Result<String> {
    let all = layouts(pres)?;
    if all.is_empty() {
        return Err(Error::InvalidEdit(
            "the presentation has no slide layouts".into(),
        ));
    }
    let reference = after
        .and_then(|id| pres.slide_part(id).ok())
        .or_else(|| pres.slides.last().map(|s| s.part.clone()));
    let ref_layout = reference.and_then(|p| layout_of(pres, &p));
    let ref_master = ref_layout
        .as_ref()
        .and_then(|l| all.iter().find(|x| &x.part == l))
        .map(|x| x.master.clone());
    let same_master = |l: &&LayoutInfo| ref_master.as_ref().is_none_or(|m| &l.master == m);
    if let Some(n) = name.map(str::trim).filter(|n| !n.is_empty()) {
        return all
            .iter()
            .filter(same_master)
            .find(|l| l.name.eq_ignore_ascii_case(n))
            .or_else(|| all.iter().find(|l| l.name.eq_ignore_ascii_case(n)))
            .or_else(|| {
                all.iter()
                    .filter(same_master)
                    .find(|l| l.kind.eq_ignore_ascii_case(n))
            })
            .or_else(|| all.iter().find(|l| l.kind.eq_ignore_ascii_case(n)))
            .map(|l| l.part.clone())
            .ok_or_else(|| {
                let names: Vec<&str> = all.iter().map(|l| l.name.as_str()).collect();
                Error::InvalidEdit(format!(
                    "no layout named `{n}` (available: {})",
                    names.join(", ")
                ))
            });
    }
    // Like PowerPoint's "New Slide": reuse the current layout, except after a title slide.
    if let Some(l) = &ref_layout
        && all
            .iter()
            .find(|x| &x.part == l)
            .is_some_and(|i| i.kind != "title")
    {
        return Ok(l.clone());
    }
    Ok(all
        .iter()
        .filter(same_master)
        .find(|l| l.kind == "obj")
        .or_else(|| all.iter().find(|l| same_master(l)))
        .unwrap_or(&all[0])
        .part
        .clone())
}

/// Placeholder types whose slide copies start with an empty text body.
fn has_text_body(kind: &str) -> bool {
    matches!(kind, "title" | "ctrTitle" | "subTitle" | "body" | "obj")
}

/// Markup of a new slide carrying the layout's content placeholders.
fn slide_from_layout(layout: &XmlDoc) -> String {
    let mut shapes = String::new();
    let mut id = 2;
    if let Some(tree) = sp_tree(layout) {
        for node in tree_children(layout, tree) {
            let Some(ph) = placeholder_of(layout, node) else {
                continue;
            };
            if matches!(ph.kind.as_str(), "dt" | "ftr" | "sldNum" | "hdr") {
                continue;
            }
            let Some(ph_el) = layout
                .children(node)
                .find(|&c| layout.local(c).starts_with("nv"))
                .and_then(|nv| layout.child(nv, Ns::P, "nvPr"))
                .and_then(|nv| layout.child(nv, Ns::P, "ph"))
            else {
                continue;
            };
            let attrs: String = ["type", "orient", "sz", "idx"]
                .iter()
                .filter_map(|a| {
                    layout
                        .attr(ph_el, a)
                        .map(|v| format!(" {a}=\"{}\"", esc(v)))
                })
                .collect();
            let name = c_nv_pr(layout, node)
                .and_then(|c| layout.attr(c, "name"))
                .unwrap_or("Placeholder");
            let locks = if ph.kind == "pic" {
                "<a:spLocks noGrp=\"1\" noChangeAspect=\"1\"/>"
            } else {
                "<a:spLocks noGrp=\"1\"/>"
            };
            let body = if has_text_body(&ph.kind) {
                "<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang=\"en-US\" dirty=\"0\"/></a:p></p:txBody>"
            } else {
                ""
            };
            shapes.push_str(&format!(
                "<p:sp><p:nvSpPr><p:cNvPr id=\"{id}\" name=\"{}\"/><p:cNvSpPr>{locks}</p:cNvSpPr><p:nvPr><p:ph{attrs}/></p:nvPr></p:nvSpPr><p:spPr/>{body}</p:sp>",
                esc(name)
            ));
            id += 1;
        }
    }
    format!(
        "{STANDARD_DECLARATION}<p:sld {PML_NAMESPACES}><p:cSld><p:spTree>{TREE_HEADER}{shapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>"
    )
}

/// The placeholder shape of a slide whose type matches `kinds`.
fn placeholder_node(doc: &XmlDoc, kinds: &[&str]) -> Option<NodeId> {
    let tree = sp_tree(doc)?;
    tree_children(doc, tree).into_iter().find(|&n| {
        doc.local(n) == "sp"
            && placeholder_of(doc, n).is_some_and(|p| kinds.contains(&p.kind.as_str()))
    })
}

/// Adds a slide from a layout; returns its id.
pub fn add_slide(
    pres: &mut Presentation,
    layout: Option<&str>,
    after: Option<u32>,
    title: Option<&str>,
    body: Option<&str>,
) -> Result<u32> {
    if let Some(a) = after {
        pres.slide_part(a)?;
    }
    let layout_part = find_layout(pres, layout, after)?;
    let layout_doc = pres.xml(&layout_part)?;
    let xml = slide_from_layout(&layout_doc);
    let part = pres.pkg.unique_part_name("/ppt/slides/slide", ".xml");
    pres.pkg
        .write(&part, xml.into_bytes(), Some(content_type::SLIDE));
    let mut rels = Relationships::empty(&part);
    rels.add_internal(rel_type::SLIDE_LAYOUT, &layout_part);
    pres.put_rels(rels);
    let id = register_slide(pres, &part, after)?;
    let layout_name = layout_doc
        .child(layout_doc.root(), Ns::P, "cSld")
        .and_then(|c| layout_doc.attr(c, "name"))
        .unwrap_or("")
        .to_owned();
    let doc = pres.xml_mut(&part)?;
    for (value, kinds, what) in [
        (title, &["title", "ctrTitle"][..], "title"),
        (body, &["body", "obj", "subTitle"][..], "body"),
    ] {
        let Some(value) = value else { continue };
        let node = placeholder_node(doc, kinds).ok_or_else(|| {
            Error::InvalidEdit(format!(
                "layout `{layout_name}` has no {what} placeholder; add a text box instead"
            ))
        })?;
        let tx = super::shapes::ensure_tx_body(doc, node)?;
        text::set_text(doc, tx, value)?;
    }
    Ok(id)
}

/// Adds a slide part to the slide list after `after` (or at the end); returns its id.
fn register_slide(pres: &mut Presentation, part: &str, after: Option<u32>) -> Result<u32> {
    let main = pres.main_part.clone();
    let rid = pres.rels_mut(&main)?.add_internal(rel_type::SLIDE, part);
    let random = pres.pkg.ids().cloned();
    let doc = pres.xml_mut(&main)?;
    let root = doc.root();
    let list = doc.ensure_child(root, Ns::P, "sldIdLst", PRESENTATION_ORDER);
    let ids: Vec<i64> = doc
        .children_named(list, Ns::P, "sldId")
        .filter_map(|s| doc.attr_i64(s, "id"))
        .collect();
    let id = match random {
        Some(random) => loop {
            let id = random.next_in(256..2_147_483_648) as i64;
            if !ids.contains(&id) {
                break id;
            }
        },
        None => ids.iter().copied().max().unwrap_or(255).max(255) + 1,
    };
    let id = if id < 2_147_483_648 {
        id
    } else {
        (256..2_147_483_648)
            .find(|c| !ids.contains(c))
            .ok_or_else(|| Error::LimitExceeded("slide ids".into()))?
    };
    let el = doc.create_element(Ns::P, "sldId");
    doc.set_attr(el, "id", &id.to_string());
    doc.set_attr_ns(el, Ns::R, "id", &rid);
    let previous = after.and_then(|a| {
        doc.children_named(list, Ns::P, "sldId")
            .find(|&s| doc.attr_i64(s, "id") == Some(i64::from(a)))
    });
    match previous {
        Some(p) => doc.insert_after(p, el),
        None => doc.append_child(list, el),
    }
    sections_insert(doc, id, after);
    pres.reload_structure()?;
    Ok(id as u32)
}

/// The `p14:sldIdLst` element of every section, in order.
fn section_lists(doc: &XmlDoc) -> Vec<NodeId> {
    let Some(ext) = doc.child(doc.root(), Ns::P, "extLst") else {
        return Vec::new();
    };
    let Some(sections) = doc
        .descendants(ext)
        .into_iter()
        .find(|&n| doc.local(n) == "sectionLst")
    else {
        return Vec::new();
    };
    doc.children(sections)
        .filter(|&s| doc.local(s) == "section")
        .filter_map(|s| doc.children(s).find(|&c| doc.local(c) == "sldIdLst"))
        .collect()
}

fn sections_insert(doc: &mut XmlDoc, id: i64, after: Option<u32>) {
    let lists = section_lists(doc);
    let Some(&last) = lists.last() else { return };
    let ns = doc.ns(last);
    let el = doc.create_element(ns, "sldId");
    doc.set_attr(el, "id", &id.to_string());
    let previous = after.and_then(|a| {
        lists.iter().find_map(|&l| {
            doc.children(l)
                .find(|&s| doc.attr_i64(s, "id") == Some(i64::from(a)))
        })
    });
    match previous {
        Some(p) => doc.insert_after(p, el),
        None => doc.append_child(last, el),
    }
}

fn sections_remove(doc: &mut XmlDoc, id: u32) {
    for l in section_lists(doc) {
        let doomed: Vec<NodeId> = doc
            .children(l)
            .filter(|&s| doc.attr_i64(s, "id") == Some(i64::from(id)))
            .collect();
        for d in doomed {
            doc.detach(d);
        }
    }
}

/// Re-derives section membership after a move: the moved slide joins the
/// section of the slide now before it, keeping every section contiguous.
fn sections_after_move(doc: &mut XmlDoc, order: &[i64], moved: i64) {
    let lists = section_lists(doc);
    if lists.is_empty() {
        return;
    }
    let mut member: HashMap<i64, usize> = HashMap::new();
    for (i, &l) in lists.iter().enumerate() {
        for s in doc.children(l) {
            if let Some(id) = doc.attr_i64(s, "id") {
                member.insert(id, i);
            }
        }
    }
    let pos = order.iter().position(|&x| x == moved).unwrap_or(0);
    let section = if pos == 0 {
        0
    } else {
        member.get(&order[pos - 1]).copied().unwrap_or(0)
    };
    member.insert(moved, section);
    let ns = doc.ns(lists[0]);
    for (i, &l) in lists.iter().enumerate() {
        for c in doc.child_nodes(l).to_vec() {
            doc.detach(c);
        }
        for &id in order.iter().filter(|id| member.get(id) == Some(&i)) {
            let el = doc.create_element(ns, "sldId");
            doc.set_attr(el, "id", &id.to_string());
            doc.append_child(l, el);
        }
    }
}

/// Duplicates a slide (with its notes, charts, and diagrams) right after itself.
pub fn duplicate_slide(pres: &mut Presentation, id: u32) -> Result<u32> {
    let part = pres.slide_part(id)?;
    let mut renamed = HashMap::new();
    let new = copy_part_tree(pres, &part, &mut renamed)?;
    // The creation id identifies the original slide for co-authoring.
    let doc = pres.xml_mut(&new)?;
    if let Some(ext_lst) = doc.child(doc.root(), Ns::P, "extLst") {
        let doomed: Vec<NodeId> = doc
            .children(ext_lst)
            .filter(|&e| {
                doc.descendants(e)
                    .iter()
                    .any(|&n| doc.local(n) == "creationId")
            })
            .collect();
        for d in doomed {
            doc.detach(d);
        }
    }
    register_slide(pres, &new, Some(id))
}

/// Deletes a slide, its private parts, and links pointing at it.
pub fn delete_slide(pres: &mut Presentation, id: u32) -> Result<()> {
    let part = pres.slide_part(id)?;
    let rid = pres
        .slides
        .iter()
        .find(|s| s.id == id)
        .map(|s| s.rid.clone())
        .unwrap_or_default();
    let main = pres.main_part.clone();
    {
        let doc = pres.xml_mut(&main)?;
        let root = doc.root();
        if let Some(list) = doc.child(root, Ns::P, "sldIdLst") {
            let doomed: Vec<NodeId> = doc
                .children_named(list, Ns::P, "sldId")
                .filter(|&s| doc.attr_i64(s, "id") == Some(i64::from(id)))
                .collect();
            for d in doomed {
                doc.detach(d);
            }
        }
        sections_remove(doc, id);
        if let Some(shows) = doc.child(root, Ns::P, "custShowLst") {
            let doomed: Vec<NodeId> = doc
                .descendants(shows)
                .into_iter()
                .filter(|&n| {
                    doc.local(n) == "sld" && doc.attr_ns(n, Ns::R, "id") == Some(rid.as_str())
                })
                .collect();
            for d in doomed {
                doc.detach(d);
            }
        }
    }
    pres.rels_mut(&main)?.remove(&rid);
    // Hyperlinks from other slides that jump to the deleted one.
    let others: Vec<String> = pres
        .slides
        .iter()
        .filter(|s| s.id != id)
        .map(|s| s.part.clone())
        .collect();
    for other in others {
        let rels = pres.part_rels(&other)?;
        let doomed: Vec<String> = rels
            .iter()
            .filter(|r| r.mode == TargetMode::Internal && r.rel_type == rel_type::SLIDE)
            .filter(|r| rels.resolve(r).eq_ignore_ascii_case(&part))
            .map(|r| r.id.clone())
            .collect();
        if doomed.is_empty() {
            continue;
        }
        let doc = pres.xml_mut(&other)?;
        let links: Vec<NodeId> = doc
            .descendants(doc.root())
            .into_iter()
            .filter(|&n| matches!(doc.local(n), "hlinkClick" | "hlinkMouseOver"))
            .filter(|&n| {
                doc.attr_ns(n, Ns::R, "id")
                    .is_some_and(|r| doomed.iter().any(|d| d == r))
            })
            .collect();
        for l in links {
            doc.detach(l);
        }
        let rels = pres.rels_mut(&other)?;
        for d in &doomed {
            rels.remove(d);
        }
    }
    pres.reload_structure()
}

/// Moves a slide to a 0-based position.
pub fn move_slide(pres: &mut Presentation, id: u32, to: usize) -> Result<()> {
    pres.slide_part(id)?;
    let main = pres.main_part.clone();
    let doc = pres.xml_mut(&main)?;
    let list = doc
        .child(doc.root(), Ns::P, "sldIdLst")
        .ok_or_else(|| Error::NotFound(format!("slide {id}")))?;
    let items: Vec<NodeId> = doc.children_named(list, Ns::P, "sldId").collect();
    let node = items
        .iter()
        .copied()
        .find(|&s| doc.attr_i64(s, "id") == Some(i64::from(id)))
        .ok_or_else(|| Error::NotFound(format!("slide {id}")))?;
    let others: Vec<NodeId> = items.into_iter().filter(|&s| s != node).collect();
    doc.detach(node);
    match others.get(to.min(others.len())) {
        Some(&before) => doc.insert_before(before, node),
        None => match others.last() {
            Some(&last) => doc.insert_after(last, node),
            None => doc.append_child(list, node),
        },
    }
    let order: Vec<i64> = doc
        .children_named(list, Ns::P, "sldId")
        .filter_map(|s| doc.attr_i64(s, "id"))
        .collect();
    sections_after_move(doc, &order, i64::from(id));
    pres.reload_structure()
}

/// Hides or shows a slide during slideshows.
pub fn set_hidden(pres: &mut Presentation, id: u32, hidden: bool) -> Result<()> {
    let part = pres.slide_part(id)?;
    let doc = pres.xml_mut(&part)?;
    let root = doc.root();
    if hidden {
        doc.set_attr(root, "show", "0");
    } else {
        doc.remove_attr(root, "show");
    }
    Ok(())
}

/// Sets (or removes, inheriting the layout's) a slide background.
pub fn set_background(pres: &mut Presentation, id: u32, fill: Option<&FillSpec>) -> Result<()> {
    let part = pres.slide_part(id)?;
    let doc = pres.xml_mut(&part)?;
    let c_sld = doc
        .child(doc.root(), Ns::P, "cSld")
        .ok_or_else(|| Error::InvalidEdit("slide has no cSld".into()))?;
    doc.remove_children_named(c_sld, Ns::P, "bg");
    if let Some(spec) = fill {
        let bg = doc.create_element(Ns::P, "bg");
        let pr = doc.create_element(Ns::P, "bgPr");
        let f = fill_element(doc, spec)?;
        doc.append_child(pr, f);
        let fx = doc.create_element(Ns::A, "effectLst");
        doc.append_child(pr, fx);
        doc.append_child(bg, pr);
        doc.insert_child(c_sld, 0, bg);
    }
    Ok(())
}
