//! Slide sections (PowerPoint 2010 and later): named runs of consecutive
//! slides, stored as `p14:sectionLst` in an extension of the presentation part
//! (`p:extLst/p:ext[@uri="{521415D9-...}"]`). Applications that do not know
//! the extension ignore it, so a deck with sections opens everywhere.
//!
//! Sections stay consistent with the slide list under every slide operation:
//! a new or moved slide joins the section of the slide before it (the first
//! section at the start of the deck), a deleted slide leaves its section, and
//! sections may be empty, as in PowerPoint.

use super::slides::PRESENTATION_ORDER;
use super::xmlutil::new_guid;
use crate::error::{Error, Result};
use crate::inspect::SectionOutline;
use crate::model::presentation::Presentation;
use crate::xml::{NodeId, Ns, XmlDoc};
use std::collections::HashMap;

/// The extension URI PowerPoint stores the section list under.
const SECTION_LIST_URI: &str = "{521415D9-36F7-43E2-AB2F-B90AF26B5E84}";
/// The section PowerPoint creates for the slides before the first new section.
const DEFAULT_SECTION: &str = "Default Section";
/// The name of a new section given no name.
const UNTITLED_SECTION: &str = "Untitled Section";
/// Child order of `p14:section`.
const SECTION_ORDER: &[&str] = &["sldIdLst", "extLst"];

/// The `p:ext` holding the section list, and the `p14:sectionLst` in it.
fn section_ext(doc: &XmlDoc) -> Option<(NodeId, NodeId)> {
    let ext_lst = doc.child(doc.root(), Ns::P, "extLst")?;
    doc.children_named(ext_lst, Ns::P, "ext")
        .filter(|&e| doc.attr(e, "uri") == Some(SECTION_LIST_URI))
        .find_map(|e| doc.child(e, Ns::P14, "sectionLst").map(|l| (e, l)))
}

/// The `p14:section` elements, in order.
fn section_nodes(doc: &XmlDoc) -> Vec<NodeId> {
    section_ext(doc)
        .map(|(_, list)| doc.children_named(list, Ns::P14, "section").collect())
        .unwrap_or_default()
}

/// The slide ids a section lists, in order.
fn listed(doc: &XmlDoc, section: NodeId) -> Vec<i64> {
    doc.child(section, Ns::P14, "sldIdLst")
        .map(|l| {
            doc.children_named(l, Ns::P14, "sldId")
                .filter_map(|s| doc.attr_i64(s, "id"))
                .collect()
        })
        .unwrap_or_default()
}

/// The slide ids of `p:sldIdLst`, in deck order.
fn slide_order(doc: &XmlDoc) -> Vec<i64> {
    doc.child(doc.root(), Ns::P, "sldIdLst")
        .map(|l| {
            doc.children_named(l, Ns::P, "sldId")
                .filter_map(|s| doc.attr_i64(s, "id"))
                .collect()
        })
        .unwrap_or_default()
}

/// Each section's slides, made consistent with the deck order: slides that
/// no longer exist are dropped, slides no section lists (and `unlisted`)
/// join the section of the slide before them (the first section at the
/// start), and sections never run backwards, so each is a contiguous run.
fn members(doc: &XmlDoc, sections: &[NodeId], unlisted: Option<i64>) -> Vec<Vec<i64>> {
    let mut owner: HashMap<i64, usize> = HashMap::new();
    for (i, &s) in sections.iter().enumerate() {
        for id in listed(doc, s) {
            owner.entry(id).or_insert(i);
        }
    }
    if let Some(id) = unlisted {
        owner.remove(&id);
    }
    let mut out = vec![Vec::new(); sections.len()];
    if sections.is_empty() {
        return out;
    }
    let mut current = 0;
    for id in slide_order(doc) {
        let section = owner
            .get(&id)
            .copied()
            .filter(|&s| s >= current)
            .unwrap_or(current);
        out[section].push(id);
        current = section;
    }
    out
}

/// Rewrites each section's slide list.
fn write_members(doc: &mut XmlDoc, sections: &[NodeId], members: &[Vec<i64>]) {
    for (&section, ids) in sections.iter().zip(members) {
        if listed(doc, section) == *ids && doc.child(section, Ns::P14, "sldIdLst").is_some() {
            continue;
        }
        let list = doc.ensure_child(section, Ns::P14, "sldIdLst", SECTION_ORDER);
        for c in doc.child_nodes(list).to_vec() {
            doc.detach(c);
        }
        for id in ids {
            let el = doc.create_element(Ns::P14, "sldId");
            doc.set_attr(el, "id", &id.to_string());
            doc.append_child(list, el);
        }
    }
}

/// The deck's sections (`None` when it has none), consistent with the slide
/// list.
pub(crate) fn read(doc: &XmlDoc) -> Option<Vec<SectionOutline>> {
    let nodes = section_nodes(doc);
    if nodes.is_empty() {
        return None;
    }
    let members = members(doc, &nodes, None);
    Some(
        nodes
            .iter()
            .zip(members)
            .map(|(&s, ids)| SectionOutline {
                id: doc.attr(s, "id").unwrap_or_default().to_owned(),
                name: doc.attr(s, "name").unwrap_or_default().to_owned(),
                slide_ids: ids
                    .into_iter()
                    .filter_map(|i| u32::try_from(i).ok())
                    .collect(),
            })
            .collect(),
    )
}

/// The sections of a presentation state without touching its caches (for
/// comparing two states).
pub(crate) fn snapshot(pres: &Presentation) -> Option<Vec<SectionOutline>> {
    match pres.xml.get(&pres.main_part) {
        Some(doc) => read(doc),
        None => {
            let bytes = pres.pkg.read(&pres.main_part).ok()?;
            read(&XmlDoc::parse(&bytes, &pres.main_part).ok()?)
        }
    }
}

/// Puts slide `id` (new, or just moved in `p:sldIdLst`) into the section of
/// the slide now before it.
pub(super) fn place(doc: &mut XmlDoc, id: i64) {
    let nodes = section_nodes(doc);
    let members = members(doc, &nodes, Some(id));
    write_members(doc, &nodes, &members);
}

/// Takes a deleted slide out of its section.
pub(super) fn remove(doc: &mut XmlDoc, id: i64) {
    for section in section_nodes(doc) {
        let Some(list) = doc.child(section, Ns::P14, "sldIdLst") else {
            continue;
        };
        let doomed: Vec<NodeId> = doc
            .children_named(list, Ns::P14, "sldId")
            .filter(|&s| doc.attr_i64(s, "id") == Some(id))
            .collect();
        for d in doomed {
            doc.detach(d);
        }
    }
}

/// The section element with id `id` (GUIDs compare ignoring case).
fn find(doc: &XmlDoc, nodes: &[NodeId], id: &str) -> Result<usize> {
    let id = id.trim();
    nodes
        .iter()
        .position(|&s| {
            doc.attr(s, "id")
                .is_some_and(|v| v.eq_ignore_ascii_case(id))
        })
        .ok_or_else(|| Error::NotFound(format!("section {id}")))
}

/// The section list, created (with its extension) when the deck has none.
fn ensure_section_list(doc: &mut XmlDoc) -> NodeId {
    if let Some((_, list)) = section_ext(doc) {
        return list;
    }
    let root = doc.root();
    let ext_lst = doc.ensure_child(root, Ns::P, "extLst", PRESENTATION_ORDER);
    let ext = doc.create_element(Ns::P, "ext");
    doc.set_attr(ext, "uri", SECTION_LIST_URI);
    // PowerPoint writes the section list first among the extensions.
    match doc.first_child(ext_lst) {
        Some(first) => doc.insert_before(first, ext),
        None => doc.append_child(ext_lst, ext),
    }
    let list = doc.create_element(Ns::P14, "sectionLst");
    doc.append_child(ext, list);
    list
}

/// Removes the section list (and an extension list left empty).
fn drop_section_list(doc: &mut XmlDoc) {
    let Some((ext, _)) = section_ext(doc) else {
        return;
    };
    let ext_lst = doc.parent(ext);
    doc.detach(ext);
    if let Some(l) = ext_lst
        && doc.children(l).next().is_none()
    {
        doc.detach(l);
    }
}

/// Creates a detached section element.
fn new_section(doc: &mut XmlDoc, name: &str, id: &str) -> NodeId {
    let s = doc.create_element(Ns::P14, "section");
    doc.set_attr(s, "name", name);
    doc.set_attr(s, "id", id);
    s
}

fn section_name(name: &str) -> &str {
    match name.trim() {
        "" => UNTITLED_SECTION,
        n => n,
    }
}

/// Starts a new section at slide `before`; returns its id. The section takes
/// `before` and the slides after it in its old section. In a deck without
/// sections, the slides before `before` go into a "Default Section".
pub(super) fn add_section(pres: &mut Presentation, name: &str, before: u32) -> Result<String> {
    pres.slide_part(before)?;
    let ids = pres.pkg.ids().cloned();
    let main = pres.main_part.clone();
    let doc = pres.xml_mut(&main)?;
    let mut nodes = section_nodes(doc);
    let mut taken: Vec<String> = nodes
        .iter()
        .filter_map(|&s| doc.attr(s, "id").map(str::to_owned))
        .collect();
    let guid = |seed: &str, taken: &mut Vec<String>| {
        let id = new_guid(ids.as_deref(), seed, taken);
        taken.push(id.clone());
        id
    };
    let name = section_name(name);
    let seed = format!("section {name} {before} {}", taken.join(" "));
    let before = i64::from(before);
    let list = ensure_section_list(doc);
    let mut members = members(doc, &nodes, None);
    if nodes.is_empty() {
        let order = slide_order(doc);
        let at = order.iter().position(|&s| s == before).unwrap_or(0);
        if at > 0 {
            let id = guid(&format!("{seed} default"), &mut taken);
            let default = new_section(doc, DEFAULT_SECTION, &id);
            doc.append_child(list, default);
            nodes.push(default);
            members.push(order[..at].to_vec());
        }
        let id = guid(&seed, &mut taken);
        let section = new_section(doc, name, &id);
        doc.append_child(list, section);
        nodes.push(section);
        members.push(order[at..].to_vec());
        write_members(doc, &nodes, &members);
        return Ok(id);
    }
    let (k, at) = members
        .iter()
        .enumerate()
        .find_map(|(k, ids)| ids.iter().position(|&s| s == before).map(|at| (k, at)))
        .ok_or_else(|| Error::NotFound(format!("slide {before} in a section")))?;
    let tail = members[k].split_off(at);
    let id = guid(&seed, &mut taken);
    let section = new_section(doc, name, &id);
    doc.insert_after(nodes[k], section);
    nodes.insert(k + 1, section);
    members.insert(k + 1, tail);
    write_members(doc, &nodes, &members);
    Ok(id)
}

/// Renames a section.
pub(super) fn rename_section(pres: &mut Presentation, id: &str, name: &str) -> Result<()> {
    let main = pres.main_part.clone();
    let doc = pres.xml_mut(&main)?;
    let nodes = section_nodes(doc);
    let k = find(doc, &nodes, id)?;
    doc.set_attr(nodes[k], "name", section_name(name));
    Ok(())
}

/// Removes a section. Its slides join the previous section (the next one
/// for the first section), or are deleted with `delete_slides`. Removing the
/// last section leaves the deck without sections.
pub(super) fn remove_section(pres: &mut Presentation, id: &str, delete_slides: bool) -> Result<()> {
    let main = pres.main_part.clone();
    let doc = pres.xml_mut(&main)?;
    let mut nodes = section_nodes(doc);
    let k = find(doc, &nodes, id)?;
    let mut members = members(doc, &nodes, None);
    let slides = members.remove(k);
    doc.detach(nodes.remove(k));
    if nodes.is_empty() {
        drop_section_list(doc);
    } else if !delete_slides {
        match k.checked_sub(1) {
            Some(previous) => members[previous].extend(&slides),
            None => {
                members[0].splice(0..0, slides.iter().copied());
            }
        }
    }
    write_members(doc, &nodes, &members);
    if delete_slides {
        for slide in slides {
            super::slides::delete_slide(pres, slide as u32)?;
        }
    }
    Ok(())
}

/// Moves a section with its slides to position `to` among the sections
/// (0-based; past the end = last). The slides are reordered to match.
pub(super) fn move_section(pres: &mut Presentation, id: &str, to: usize) -> Result<()> {
    let main = pres.main_part.clone();
    let doc = pres.xml_mut(&main)?;
    let mut nodes = section_nodes(doc);
    let k = find(doc, &nodes, id)?;
    let mut members = members(doc, &nodes, None);
    let node = nodes.remove(k);
    let slides = members.remove(k);
    let to = to.min(nodes.len());
    match nodes.get(to) {
        Some(&next) => doc.insert_before(next, node),
        None => match nodes.last() {
            Some(&last) => doc.insert_after(last, node),
            None => return Ok(()),
        },
    }
    nodes.insert(to, node);
    members.insert(to, slides);
    write_members(doc, &nodes, &members);
    reorder_slides(doc, &members.concat());
    pres.reload_structure()
}

/// Reorders `p:sldIdLst` to `order` (slides it does not name stay last).
fn reorder_slides(doc: &mut XmlDoc, order: &[i64]) {
    let Some(list) = doc.child(doc.root(), Ns::P, "sldIdLst") else {
        return;
    };
    let mut items: Vec<(Option<i64>, NodeId)> = doc
        .children_named(list, Ns::P, "sldId")
        .map(|s| (doc.attr_i64(s, "id"), s))
        .collect();
    let rank = |id: Option<i64>| {
        id.and_then(|id| order.iter().position(|&o| o == id))
            .unwrap_or(usize::MAX)
    };
    items.sort_by_key(|&(id, _)| rank(id));
    for (_, node) in items {
        doc.append_child(list, node);
    }
}

#[cfg(test)]
mod test;
