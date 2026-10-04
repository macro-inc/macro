//! Slide Master view edits: adding, duplicating, renaming, and deleting
//! slide layouts (and masters), inserting placeholders on layouts, and a
//! layout's Title, Footers, and Hide Background Graphics options.
//!
//! Masters and layouts are addressed by their ids (see
//! [`crate::model::masters`]); their shapes are edited by the ordinary shape
//! and text operations, which take a master's or layout's id as their slide.
//! New layouts follow what PowerPoint writes for Insert Layout: a
//! `preserve`d, `userDrawn` custom layout listed in its master's
//! `p:sldLayoutIdLst` with a fresh id above every master and layout id, so
//! the ids stay unique and PowerPoint opens the file without repair.

use super::header_footer::MASTER_ORDER;
use super::ops::{ParaPatch, PlaceholderKind, RunPatch, TextPos};
use super::parts::copy_part_tree;
use super::shapes::append_to_tree;
use super::slides::{PML_NAMESPACES, TREE_HEADER, drop_creation_id, layout_of};
use super::text::{format_paragraphs, patch_rpr};
use super::xmlutil::{P_PR_ORDER, esc, fresh_shape_id, import_fragment};
use crate::error::{Error, Result};
use crate::model::masters::{MASTER_ID_BASE, MasterPage, entry_id};
use crate::model::presentation::Presentation;
use crate::model::shape::{Placeholder, c_nv_pr, placeholder_of, sp_tree, tree_children};
use crate::opc::{Relationships, rel_type};
use crate::units::pt_to_emu;
use crate::xml::{NodeId, Ns, STANDARD_DECLARATION, XmlDoc};
use std::collections::{HashMap, HashSet};

/// Content type of a slide layout part.
const LAYOUT_CONTENT_TYPE: &str =
    "application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml";
/// The name PowerPoint gives an inserted layout.
const NEW_LAYOUT_NAME: &str = "Custom Layout";
/// The prompt text of a layout's title placeholder.
const TITLE_PROMPT: &str = "Click to edit Master title style";
/// The prompt text of a content or text placeholder, by outline level.
const TEXT_PROMPTS: [&str; 5] = [
    "Click to edit Master text styles",
    "Second level",
    "Third level",
    "Fourth level",
    "Fifth level",
];
/// The footer placeholder types, in the order layouts carry them.
const FOOTERS: [&str; 3] = ["dt", "ftr", "sldNum"];
/// Placeholder indexes PowerPoint gives a layout's date, footer, and slide
/// number; inserted placeholders count on from the next one.
const FOOTER_INDEXES: [u32; 3] = [10, 11, 12];

/// `p:cSld/@name` of a part.
fn name_of(doc: &XmlDoc) -> String {
    doc.child(doc.root(), Ns::P, "cSld")
        .and_then(|c| doc.attr(c, "name"))
        .unwrap_or("")
        .to_owned()
}

/// `base`, or `1_base`, `2_base`... (PowerPoint's numbering of copies), the
/// first that `taken` does not hold.
fn unique_name(base: &str, taken: &[String]) -> String {
    if !taken.iter().any(|t| t == base) {
        return base.to_owned();
    }
    (1..)
        .map(|n| format!("{n}_{base}"))
        .find(|candidate| !taken.contains(candidate))
        .expect("unbounded search")
}

/// An id for a new layout: above every master and layout id (PowerPoint
/// numbers them upward), random above them in a collaborative deck.
fn new_page_id(pres: &mut Presentation, pages: &[MasterPage]) -> Result<u32> {
    let used: HashSet<u32> = pages.iter().map(|p| p.id).collect();
    let floor = pages
        .iter()
        .map(|p| p.id)
        .max()
        .unwrap_or(MASTER_ID_BASE - 1)
        .max(MASTER_ID_BASE - 1);
    let candidate = match pres.pkg.ids() {
        Some(random) if floor < u32::MAX - 1 => {
            Some(random.next_in(u64::from(floor) + 1..u64::from(u32::MAX) + 1) as u32)
        }
        _ => floor.checked_add(1),
    };
    candidate
        .filter(|id| !used.contains(id))
        .or_else(|| (MASTER_ID_BASE..=u32::MAX).find(|id| !used.contains(id)))
        .ok_or_else(|| Error::LimitExceeded("slide layout ids".into()))
}

fn find_page(pages: &[MasterPage], id: u32) -> Result<&MasterPage> {
    pages
        .iter()
        .find(|p| p.id == id)
        .ok_or_else(|| Error::NotFound(format!("slide master or layout {id}")))
}

fn layout_page(pages: &[MasterPage], id: u32) -> Result<&MasterPage> {
    let page = find_page(pages, id)?;
    if !page.is_layout {
        return Err(Error::InvalidEdit(format!(
            "{id} is a slide master; this applies to slide layouts"
        )));
    }
    Ok(page)
}

/// Markup of a title placeholder that takes everything from the master.
fn title_xml(id: u32) -> String {
    format!(
        "<p:sp><p:nvSpPr><p:cNvPr id=\"{id}\" name=\"Title {}\"/><p:cNvSpPr><a:spLocks noGrp=\"1\"/></p:cNvSpPr><p:nvPr><p:ph type=\"title\"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang=\"en-US\"/><a:t>{TITLE_PROMPT}</a:t></a:r><a:endParaRPr lang=\"en-US\"/></a:p></p:txBody></p:sp>",
        id.saturating_sub(1)
    )
}

/// The display name PowerPoint gives a footer placeholder.
fn footer_name(kind: &str) -> &'static str {
    match kind {
        "dt" => "Date Placeholder",
        "ftr" => "Footer Placeholder",
        _ => "Slide Number Placeholder",
    }
}

/// The placeholder `p:ph` element of a shape.
fn ph_element(doc: &XmlDoc, shape: NodeId) -> Option<NodeId> {
    let nv = doc
        .children(shape)
        .find(|&c| doc.local(c).starts_with("nv"))?;
    doc.child(nv, Ns::P, "nvPr")
        .and_then(|nv| doc.child(nv, Ns::P, "ph"))
}

/// Top-level placeholders of a page, in z-order.
fn placeholders(doc: &XmlDoc) -> Vec<(NodeId, Placeholder)> {
    sp_tree(doc)
        .map(|tree| {
            tree_children(doc, tree)
                .into_iter()
                .filter_map(|n| placeholder_of(doc, n).map(|p| (n, p)))
                .collect()
        })
        .unwrap_or_default()
}

/// Markup of a footer placeholder (`dt`, `ftr`, or `sldNum`) for a layout of
/// `master`: a copy of the one another of its layouts has, else one that
/// takes its position and style from the master's, with the master's
/// fields. `None` when the master has no such placeholder.
fn footer_xml(
    pres: &mut Presentation,
    master: &MasterPage,
    pages: &[MasterPage],
    kind: &str,
    id: u32,
) -> Result<Option<String>> {
    let name = format!("{} {}", footer_name(kind), id.saturating_sub(1));
    for page in pages
        .iter()
        .filter(|p| p.is_layout && p.master == master.id)
    {
        let doc = pres.xml(&page.part)?;
        if let Some((node, _)) = placeholders(&doc).into_iter().find(|(_, p)| p.kind == kind) {
            let mut copy = doc.fragment(node);
            if let Some(nv) = c_nv_pr(&copy, copy.root()) {
                copy.set_attr(nv, "id", &id.to_string());
                copy.set_attr(nv, "name", &name);
                copy.remove_children_named(nv, Ns::A, "extLst");
            }
            return Ok(Some(String::from_utf8_lossy(&copy.to_bytes()).into_owned()));
        }
    }
    let doc = pres.xml(&master.part)?;
    let Some((node, _)) = placeholders(&doc).into_iter().find(|(_, p)| p.kind == kind) else {
        return Ok(None);
    };
    let sz = ph_element(&doc, node)
        .and_then(|ph| doc.attr(ph, "sz"))
        .map(|sz| format!(" sz=\"{}\"", esc(sz)))
        .unwrap_or_default();
    let idx = FOOTER_INDEXES[FOOTERS.iter().position(|k| *k == kind).unwrap_or(0)];
    let paragraphs: String = doc
        .children(node)
        .find(|&c| doc.local(c) == "txBody")
        .map(|body| {
            doc.children_named(body, Ns::A, "p")
                .map(|p| String::from_utf8_lossy(&doc.fragment(p).to_bytes()).into_owned())
                .collect()
        })
        .unwrap_or_default();
    let paragraphs = if paragraphs.is_empty() {
        "<a:p><a:endParaRPr lang=\"en-US\"/></a:p>".to_owned()
    } else {
        paragraphs
    };
    Ok(Some(format!(
        "<p:sp><p:nvSpPr><p:cNvPr id=\"{id}\" name=\"{}\"/><p:cNvSpPr><a:spLocks noGrp=\"1\"/></p:cNvSpPr><p:nvPr><p:ph type=\"{kind}\"{sz} idx=\"{idx}\"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>{paragraphs}</p:txBody></p:sp>",
        esc(&name)
    )))
}

/// Markup of the layout PowerPoint's Insert Layout adds to `master`.
fn new_layout_xml(
    pres: &mut Presentation,
    master: &MasterPage,
    pages: &[MasterPage],
    name: &str,
) -> Result<String> {
    let mut shapes = title_xml(2);
    let mut id = 3;
    for kind in FOOTERS {
        if let Some(xml) = footer_xml(pres, master, pages, kind, id)? {
            shapes.push_str(&xml);
            id += 1;
        }
    }
    Ok(format!(
        "{STANDARD_DECLARATION}<p:sldLayout {PML_NAMESPACES} preserve=\"1\" userDrawn=\"1\"><p:cSld name=\"{}\"><p:spTree>{TREE_HEADER}{shapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>",
        esc(name)
    ))
}

/// Removes the co-authoring creation ids a copied layout carries.
fn drop_layout_creation_ids(doc: &mut XmlDoc) {
    drop_creation_id(doc);
    let Some(ext_lst) = doc.path(doc.root(), Ns::P, &["cSld", "extLst"]) else {
        return;
    };
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
    if doc.first_child(ext_lst).is_none() {
        doc.detach(ext_lst);
    }
}

/// Adds a layout (see `EditOp::AddLayout`); returns its id.
pub(super) fn add_layout(
    pres: &mut Presentation,
    master: Option<u32>,
    after: Option<u32>,
    duplicate: Option<u32>,
    name: Option<&str>,
) -> Result<u32> {
    store_ids(pres)?;
    let pages = pres.master_pages()?;
    let source = duplicate.map(|id| layout_page(&pages, id)).transpose()?;
    let anchor = after.map(|id| find_page(&pages, id)).transpose()?;
    let master_id = master
        .or(source.map(|s| s.master))
        .or(anchor.map(|a| a.master))
        .or(pages.first().map(|p| p.master))
        .ok_or_else(|| Error::InvalidEdit("the presentation has no slide master".into()))?;
    let master_page = find_page(&pages, master_id)?.clone();
    if master_page.is_layout {
        return Err(Error::InvalidEdit(format!(
            "{master_id} is a slide layout, not a slide master"
        )));
    }
    if let Some(a) = anchor
        && a.master != master_id
    {
        return Err(Error::InvalidEdit(format!(
            "layout {} belongs to another slide master",
            a.id
        )));
    }
    let taken: Vec<String> = pages
        .iter()
        .filter(|p| p.is_layout && p.master == master_id)
        .map(|p| pres.xml(&p.part).map(|d| name_of(&d)))
        .collect::<Result<_>>()?;
    let given = name.map(str::trim).filter(|n| !n.is_empty());
    let part = match source {
        Some(src) => {
            let mut renamed = HashMap::new();
            let part = copy_part_tree(pres, &src.part, &mut renamed)?;
            let original = name_of(&*pres.xml(&src.part)?);
            let name = given.map_or_else(|| unique_name(&original, &taken), str::to_owned);
            let doc = pres.xml_mut(&part)?;
            drop_layout_creation_ids(doc);
            if let Some(c_sld) = doc.child(doc.root(), Ns::P, "cSld") {
                doc.set_attr(c_sld, "name", &name);
            }
            part
        }
        None => {
            let name = given.map_or_else(|| unique_name(NEW_LAYOUT_NAME, &taken), str::to_owned);
            let xml = new_layout_xml(pres, &master_page, &pages, &name)?;
            let part = pres
                .pkg
                .unique_part_name("/ppt/slideLayouts/slideLayout", ".xml");
            pres.pkg
                .write(&part, xml.into_bytes(), Some(LAYOUT_CONTENT_TYPE));
            // Footers copied from other layouts repeat the namespace declarations.
            let doc = pres.xml_mut(&part)?;
            if let Some(tree) = sp_tree(doc) {
                for shape in tree_children(doc, tree) {
                    doc.drop_redundant_ns_decls(shape);
                }
            }
            let mut rels = Relationships::empty(&part);
            rels.add_internal(rel_type::SLIDE_MASTER, &master_page.part);
            pres.put_rels(rels);
            part
        }
    };
    let id = new_page_id(pres, &pages)?;
    let rid = pres
        .rels_mut(&master_page.part)?
        .add_internal(rel_type::SLIDE_LAYOUT, &part);
    // After the anchor, else after the copied layout, else at the end.
    let previous = match (anchor, source) {
        (Some(a), _) => Some(a.id),
        (None, Some(s)) => Some(s.id),
        (None, None) => None,
    };
    let doc = pres.xml_mut(&master_page.part)?;
    let root = doc.root();
    let list = doc.ensure_child(root, Ns::P, "sldLayoutIdLst", MASTER_ORDER);
    let el = doc.create_element(Ns::P, "sldLayoutId");
    doc.set_attr(el, "id", &id.to_string());
    doc.set_attr_ns(el, Ns::R, "id", &rid);
    let entries: Vec<NodeId> = doc.children_named(list, Ns::P, "sldLayoutId").collect();
    let after_entry = entries
        .iter()
        .copied()
        .find(|&e| previous.is_some_and(|p| entry_id(doc, e) == Some(p)));
    match (previous, after_entry) {
        // The master's own id: first among its layouts.
        (Some(p), None) if p == master_id => match entries.first() {
            Some(&first) => doc.insert_before(first, el),
            None => doc.append_child(list, el),
        },
        (_, Some(e)) => doc.insert_after(e, el),
        _ => match doc
            .children(list)
            .last()
            .filter(|&c| doc.local(c) == "extLst")
        {
            Some(ext) => doc.insert_before(ext, el),
            None => doc.append_child(list, el),
        },
    }
    Ok(id)
}

/// Renames a layout, or a master and its theme (see `EditOp::RenameLayout`).
pub(super) fn rename(pres: &mut Presentation, id: u32, name: &str) -> Result<()> {
    let name = name.trim();
    if name.is_empty() {
        return Err(Error::InvalidEdit("the name is empty".into()));
    }
    let page = pres.master_page(id)?;
    let named = |doc: &mut XmlDoc, always: bool| {
        if let Some(c_sld) = doc.child(doc.root(), Ns::P, "cSld")
            && (always
                || doc
                    .attr(c_sld, "name")
                    .is_some_and(|n| !n.trim().is_empty()))
        {
            doc.set_attr(c_sld, "name", name);
        }
    };
    if page.is_layout {
        named(pres.xml_mut(&page.part)?, true);
        return Ok(());
    }
    // PowerPoint shows a master by its theme's name; an own name is kept in step.
    named(pres.xml_mut(&page.part)?, false);
    let rels = pres.part_rels(&page.part)?;
    if let Some(theme) = rels.first_of_type(rel_type::THEME).map(|r| rels.resolve(r)) {
        let doc = pres.xml_mut(&theme)?;
        let root = doc.root();
        doc.set_attr(root, "name", name);
        pres.forget_theme(&theme);
    } else {
        named(pres.xml_mut(&page.part)?, true);
    }
    Ok(())
}

/// Slide ids using each layout part.
fn users(pres: &mut Presentation) -> Vec<(String, u32)> {
    pres.slides
        .clone()
        .into_iter()
        .filter_map(|s| layout_of(pres, &s.part).map(|l| (l, s.id)))
        .collect()
}

/// "slide 2" or "slides 2, 5, and 7" (1-based positions).
fn slide_list(pres: &Presentation, ids: &[u32]) -> String {
    let numbers: Vec<String> = ids
        .iter()
        .filter_map(|id| pres.slides.iter().position(|s| s.id == *id))
        .map(|i| (i + 1).to_string())
        .collect();
    match numbers.as_slice() {
        [one] => format!("slide {one}"),
        [rest @ .., last] => format!("slides {} and {last}", rest.join(", ")),
        [] => "no slides".to_owned(),
    }
}

/// Removes the list entry with `id` from `list` of the part's root; returns its `r:id`.
fn remove_entry(doc: &mut XmlDoc, list: &str, item: &str, id: u32) -> Option<String> {
    let list = doc.child(doc.root(), Ns::P, list)?;
    let entry = doc
        .children_named(list, Ns::P, item)
        .find(|&e| entry_id(doc, e) == Some(id))?;
    let rid = doc.attr_ns(entry, Ns::R, "id").map(str::to_owned);
    doc.detach(entry);
    rid
}

/// Deletes an unused layout or master (see `EditOp::DeleteLayout`). The
/// parts left unreachable are removed after the batch.
pub(super) fn delete(pres: &mut Presentation, id: u32) -> Result<()> {
    store_ids(pres)?;
    let pages = pres.master_pages()?;
    let page = find_page(&pages, id)?.clone();
    let users = users(pres);
    let doomed: Vec<&MasterPage> = pages
        .iter()
        .filter(|p| p.id == id || !page.is_layout && p.master == id && p.is_layout)
        .collect();
    let used: Vec<u32> = users
        .iter()
        .filter(|(layout, _)| doomed.iter().any(|p| p.part == *layout))
        .map(|(_, slide)| *slide)
        .collect();
    let name = {
        let doc = pres.xml(&page.part)?;
        name_of(&doc)
    };
    if !used.is_empty() {
        let what = if page.is_layout {
            format!("layout `{name}`")
        } else {
            "this slide master's layouts".to_owned()
        };
        return Err(Error::InvalidEdit(format!(
            "{what} cannot be deleted: {} {} it; give {} another layout first (setSlideLayout)",
            slide_list(pres, &used),
            if used.len() == 1 { "uses" } else { "use" },
            if used.len() == 1 { "it" } else { "them" },
        )));
    }
    if page.is_layout {
        let siblings = pages
            .iter()
            .filter(|p| p.is_layout && p.master == page.master)
            .count();
        if siblings <= 1 {
            return Err(Error::InvalidEdit(
                "a slide master keeps at least one layout".into(),
            ));
        }
        let doc = pres.xml_mut(&page.master_part)?;
        if let Some(rid) = remove_entry(doc, "sldLayoutIdLst", "sldLayoutId", id) {
            pres.rels_mut(&page.master_part)?.remove(&rid);
        }
        return Ok(());
    }
    if pages.iter().filter(|p| !p.is_layout).count() <= 1 {
        return Err(Error::InvalidEdit(
            "the presentation keeps at least one slide master".into(),
        ));
    }
    let main = pres.main_part.clone();
    let doc = pres.xml_mut(&main)?;
    if let Some(rid) = remove_entry(doc, "sldMasterIdLst", "sldMasterId", id) {
        pres.rels_mut(&main)?.remove(&rid);
    }
    Ok(())
}

/// The next placeholder index of a layout: past its own and the footers'.
fn next_index(doc: &XmlDoc) -> u32 {
    placeholders(doc)
        .iter()
        .map(|(_, p)| p.idx)
        .chain(FOOTER_INDEXES)
        .max()
        .unwrap_or(0)
        .saturating_add(1)
}

/// Adds a placeholder to a layout (see `EditOp::InsertPlaceholder`); returns its id.
pub(super) fn insert_placeholder(
    pres: &mut Presentation,
    layout: u32,
    kind: PlaceholderKind,
    rect: [f32; 4],
    vertical: bool,
) -> Result<u32> {
    let pages = pres.master_pages()?;
    let part = layout_page(&pages, layout)
        .map_err(|_| {
            Error::InvalidEdit(format!(
                "{layout} is not a slide layout; placeholders are inserted on layouts"
            ))
        })?
        .part
        .clone();
    if rect.iter().any(|v| !v.is_finite()) || rect[2] <= 0.0 || rect[3] <= 0.0 {
        return Err(Error::InvalidEdit(
            "a placeholder needs a finite position and a positive size".into(),
        ));
    }
    if vertical && kind.label().is_some() {
        return Err(Error::InvalidEdit(
            "only content and text placeholders can be vertical".into(),
        ));
    }
    let random = pres.pkg.ids().cloned();
    let doc = pres.xml_mut(&part)?;
    let id = fresh_shape_id(doc, random.as_deref());
    let number = if random.is_some() {
        placeholders(doc).len() as u32 + 1
    } else {
        id - 1
    };
    let idx = next_index(doc);
    let type_attr = kind
        .ph_type()
        .map(|t| format!(" type=\"{t}\""))
        .unwrap_or_default();
    let orient = if vertical { " orient=\"vert\"" } else { "" };
    let [x, y, w, h] = rect.map(|v| pt_to_emu(f64::from(v)));
    let (body_pr, lst_style, paragraphs) = match kind.label() {
        None => (
            if vertical {
                "<a:bodyPr vert=\"eaVert\"/>"
            } else {
                "<a:bodyPr/>"
            },
            "<a:lstStyle/>".to_owned(),
            TEXT_PROMPTS
                .iter()
                .enumerate()
                .map(|(level, text)| {
                    format!(
                        "<a:p><a:pPr lvl=\"{level}\"/><a:r><a:rPr lang=\"en-US\"/><a:t>{text}</a:t></a:r></a:p>"
                    )
                })
                .collect::<String>(),
        ),
        // Media placeholders show their kind, centered and unbulleted.
        Some(label) => (
            "<a:bodyPr anchor=\"ctr\"/>",
            "<a:lstStyle><a:lvl1pPr marL=\"0\" indent=\"0\" algn=\"ctr\"><a:buNone/></a:lvl1pPr></a:lstStyle>".to_owned(),
            format!(
                "<a:p><a:r><a:rPr lang=\"en-US\"/><a:t>{label}</a:t></a:r><a:endParaRPr lang=\"en-US\"/></a:p>"
            ),
        ),
    };
    let locks = if kind == PlaceholderKind::Picture {
        "<a:spLocks noGrp=\"1\" noChangeAspect=\"1\"/>"
    } else {
        "<a:spLocks noGrp=\"1\"/>"
    };
    let xml = format!(
        "<p:sp><p:nvSpPr><p:cNvPr id=\"{id}\" name=\"{} {number}\"/><p:cNvSpPr>{locks}</p:cNvSpPr><p:nvPr><p:ph{type_attr}{orient} sz=\"quarter\" idx=\"{idx}\"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x=\"{x}\" y=\"{y}\"/><a:ext cx=\"{w}\" cy=\"{h}\"/></a:xfrm></p:spPr><p:txBody>{body_pr}{lst_style}{paragraphs}</p:txBody></p:sp>",
        kind.shape_name()
    );
    let tree = sp_tree(doc).ok_or_else(|| Error::InvalidEdit("layout has no shape tree".into()))?;
    let el = import_fragment(doc, &xml)?;
    append_to_tree(doc, tree, el);
    Ok(id)
}

/// Gives a layout placeholder copied within the layout (Duplicate) an index
/// of its own, as PowerPoint does, so slides tell the two apart.
pub(super) fn renumber_copy(pres: &mut Presentation, part: &str, shape: u32) -> Result<()> {
    let doc = pres.xml(part)?;
    if !doc.is(doc.root(), Ns::P, "sldLayout") {
        return Ok(());
    }
    let Some(node) = super::xmlutil::find_shape(&doc, shape) else {
        return Ok(());
    };
    let Some(ph) = placeholder_of(&doc, node) else {
        return Ok(());
    };
    let shared = placeholders(&doc)
        .iter()
        .any(|(n, p)| *n != node && p.idx == ph.idx && p.kind == ph.kind);
    if !shared {
        return Ok(());
    }
    let idx = next_index(&doc);
    let doc = pres.xml_mut(part)?;
    if let Some(node) = super::xmlutil::find_shape(doc, shape)
        && let Some(el) = ph_element(doc, node)
    {
        doc.set_attr(el, "idx", &idx.to_string());
    }
    Ok(())
}

/// Sets a layout's Title, Footers, and Hide Background Graphics (see
/// `EditOp::SetLayoutOptions`).
pub(super) fn set_layout_options(
    pres: &mut Presentation,
    layout: u32,
    title: Option<bool>,
    footers: Option<bool>,
    hide_background_graphics: Option<bool>,
) -> Result<()> {
    let pages = pres.master_pages()?;
    let page = layout_page(&pages, layout)?.clone();
    let master = find_page(&pages, page.master)?.clone();
    if let Some(show) = title {
        let doc = pres.xml(&page.part)?;
        let titles: Vec<NodeId> = placeholders(&doc)
            .into_iter()
            .filter(|(_, p)| matches!(p.kind.as_str(), "title" | "ctrTitle"))
            .map(|(n, _)| n)
            .collect();
        if !show {
            let doc = pres.xml_mut(&page.part)?;
            for n in titles {
                doc.detach(n);
            }
        } else if titles.is_empty() {
            let random = pres.pkg.ids().cloned();
            let master_doc = pres.xml(&master.part)?;
            let has_master_title = placeholders(&master_doc)
                .iter()
                .any(|(_, p)| p.kind == "title");
            let (w, h) = pres.slide_size();
            let doc = pres.xml_mut(&page.part)?;
            let id = fresh_shape_id(doc, random.as_deref());
            let mut xml = title_xml(id);
            if !has_master_title {
                // Nothing to inherit a place from: the top of the slide.
                xml = xml.replace(
                    "<p:spPr/>",
                    &format!(
                        "<p:spPr><a:xfrm><a:off x=\"{}\" y=\"{}\"/><a:ext cx=\"{}\" cy=\"{}\"/></a:xfrm></p:spPr>",
                        w / 14,
                        h / 18,
                        w - w / 7,
                        h / 5
                    ),
                );
            }
            let tree = sp_tree(doc)
                .ok_or_else(|| Error::InvalidEdit("layout has no shape tree".into()))?;
            let el = import_fragment(doc, &xml)?;
            // The title goes to the back, where PowerPoint puts it.
            let first = doc
                .children(tree)
                .find(|&c| !matches!(doc.local(c), "nvGrpSpPr" | "grpSpPr"));
            match first {
                Some(f) if doc.local(f) != "extLst" => doc.insert_before(f, el),
                _ => append_to_tree(doc, tree, el),
            }
        }
    }
    if let Some(show) = footers {
        let doc = pres.xml(&page.part)?;
        let present: Vec<(NodeId, String)> = placeholders(&doc)
            .into_iter()
            .filter(|(_, p)| FOOTERS.contains(&p.kind.as_str()))
            .map(|(n, p)| (n, p.kind))
            .collect();
        if !show {
            let doc = pres.xml_mut(&page.part)?;
            for (n, _) in present {
                doc.detach(n);
            }
        } else {
            let random = pres.pkg.ids().cloned();
            let mut added = 0;
            for kind in FOOTERS {
                if present.iter().any(|(_, k)| k == kind) {
                    continue;
                }
                let id = fresh_shape_id(&*pres.xml(&page.part)?, random.as_deref());
                let Some(xml) = footer_xml(pres, &master, &pages, kind, id)? else {
                    continue;
                };
                let doc = pres.xml_mut(&page.part)?;
                let tree = sp_tree(doc)
                    .ok_or_else(|| Error::InvalidEdit("layout has no shape tree".into()))?;
                let el = import_fragment(doc, &xml)?;
                append_to_tree(doc, tree, el);
                doc.drop_redundant_ns_decls(el);
                added += 1;
            }
            if added == 0 && present.is_empty() {
                return Err(Error::InvalidEdit(
                    "the slide master has no date, footer, or slide number placeholders".into(),
                ));
            }
        }
    }
    if let Some(hide) = hide_background_graphics {
        let doc = pres.xml_mut(&page.part)?;
        let root = doc.root();
        if hide {
            doc.set_attr(root, "showMasterSp", "0");
        } else {
            doc.remove_attr(root, "showMasterSp");
        }
    }
    Ok(())
}

/// Child order of a list style (`a:lstStyle`, `p:titleStyle`...).
const LIST_STYLE_ORDER: &[&str] = &[
    "defPPr", "lvl1pPr", "lvl2pPr", "lvl3pPr", "lvl4pPr", "lvl5pPr", "lvl6pPr", "lvl7pPr",
    "lvl8pPr", "lvl9pPr", "extLst",
];
/// Child order of `p:txStyles`.
const TX_STYLES_ORDER: &[&str] = &["titleStyle", "bodyStyle", "otherStyle", "extLst"];
/// Child order of `a:txBody`.
const TX_BODY_ORDER: &[&str] = &["bodyPr", "lstStyle", "p"];

/// The placeholder `shape` of a master or layout part with its text body,
/// when formatting it should carry over to the slides based on it.
fn styled_placeholder(doc: &XmlDoc, shape: u32) -> Option<(NodeId, Placeholder)> {
    let root = doc.root();
    if !doc.is(root, Ns::P, "sldMaster") && !doc.is(root, Ns::P, "sldLayout") {
        return None;
    }
    let node = super::xmlutil::find_shape(doc, shape)?;
    let ph = placeholder_of(doc, node)?;
    let body = doc.children(node).find(|&c| doc.local(c) == "txBody")?;
    Some((body, ph))
}

/// The outline level of a paragraph (`a:pPr/@lvl`, 0-8).
fn level_of(doc: &XmlDoc, p: NodeId) -> usize {
    doc.child(p, Ns::A, "pPr")
        .and_then(|pr| doc.attr_i64(pr, "lvl"))
        .unwrap_or(0)
        .clamp(0, 8) as usize
}

/// The list style level slides inherit a placeholder's paragraphs of
/// `level` from: on a master, its title or body text style (as PowerPoint
/// keeps them) or the placeholder's own list style; on a layout, the
/// placeholder's list style.
fn style_level(doc: &mut XmlDoc, body: NodeId, ph: &Placeholder, level: usize) -> NodeId {
    let root = doc.root();
    let master_style = match ph.style_family() {
        "title" => Some("titleStyle"),
        "body" => Some("bodyStyle"),
        _ => None,
    }
    .filter(|_| doc.is(root, Ns::P, "sldMaster"));
    let list = match master_style {
        Some(style) => {
            let styles = doc.ensure_child(root, Ns::P, "txStyles", MASTER_ORDER);
            doc.ensure_child(styles, Ns::P, style, TX_STYLES_ORDER)
        }
        None => doc.ensure_child(body, Ns::A, "lstStyle", TX_BODY_ORDER),
    };
    doc.ensure_child(list, Ns::A, LIST_STYLE_ORDER[level + 1], LIST_STYLE_ORDER)
}

/// Levels of the paragraphs `formatText` covers whole between `start` and `end`.
fn covered_levels(
    doc: &XmlDoc,
    body: NodeId,
    start: Option<TextPos>,
    end: Option<TextPos>,
) -> Vec<usize> {
    let ps = super::text::paragraphs(doc, body);
    let mut levels = Vec::new();
    for (i, &p) in ps.iter().enumerate() {
        let len = super::text::para_len(doc, p);
        let from = match start {
            Some(s) if s.paragraph > i => continue,
            Some(s) if s.paragraph == i => s.offset.min(len),
            _ => 0,
        };
        let to = match end {
            Some(e) if e.paragraph < i => continue,
            Some(e) if e.paragraph == i => e.offset.min(len),
            _ => len,
        };
        if from == 0 && to == len && !levels.contains(&level_of(doc, p)) {
            levels.push(level_of(doc, p));
        }
    }
    levels
}

/// Carries character formatting given to whole paragraphs of a master's or
/// layout's placeholder into the text style its slides inherit, as
/// PowerPoint's Slide Master view does (the formatted text keeps it too).
pub(super) fn inherit_text_format(
    pres: &mut Presentation,
    part: &str,
    shape: u32,
    start: Option<TextPos>,
    end: Option<TextPos>,
    patch: &RunPatch,
) -> Result<()> {
    let Some((body, ph)) = styled_placeholder(&*pres.xml(part)?, shape) else {
        return Ok(());
    };
    let patch = RunPatch {
        link: None,
        link_tip: None,
        ..patch.clone()
    };
    let doc = pres.xml_mut(part)?;
    for level in covered_levels(doc, body, start, end) {
        let lvl = style_level(doc, body, &ph, level);
        let def = doc.ensure_child(lvl, Ns::A, "defRPr", P_PR_ORDER);
        patch_rpr(doc, def, &patch, None)?;
    }
    Ok(())
}

/// Carries paragraph formatting of a master's or layout's placeholder into
/// the text style its slides inherit (see [`inherit_text_format`]).
pub(super) fn inherit_paragraph_format(
    pres: &mut Presentation,
    part: &str,
    shape: u32,
    from: Option<usize>,
    to: Option<usize>,
    patch: &ParaPatch,
) -> Result<()> {
    let Some((body, ph)) = styled_placeholder(&*pres.xml(part)?, shape) else {
        return Ok(());
    };
    let patch = ParaPatch {
        level: None,
        ..patch.clone()
    };
    let doc = pres.xml_mut(part)?;
    let ps = super::text::paragraphs(doc, body);
    let last = ps.len().saturating_sub(1);
    let mut levels = Vec::new();
    for &p in ps
        .iter()
        .take(to.unwrap_or(last).min(last) + 1)
        .skip(from.unwrap_or(0))
    {
        let level = level_of(doc, p);
        if !levels.contains(&level) {
            levels.push(level);
        }
    }
    for level in levels {
        let lvl = style_level(doc, body, &ph, level);
        patch_level(doc, lvl, &patch)?;
    }
    Ok(())
}

/// Applies a paragraph patch to a list style level (`a:lvlNpPr`, which has
/// the schema of `a:pPr`) the way paragraph formatting applies it to a
/// paragraph: through a scratch paragraph carrying the level's properties.
fn patch_level(doc: &mut XmlDoc, lvl: NodeId, patch: &ParaPatch) -> Result<()> {
    let mut scratch = XmlDoc::new_root(Ns::A, "txBody");
    let body = scratch.root();
    let p = scratch.create_element(Ns::A, "p");
    scratch.append_child(body, p);
    let ppr = scratch.import(doc, lvl);
    scratch.rename(ppr, "pPr");
    scratch.append_child(p, ppr);
    format_paragraphs(&mut scratch, body, None, None, patch)?;
    let name = doc.local(lvl).to_owned();
    let patched = doc.import(&scratch, ppr);
    doc.rename(patched, &name);
    doc.insert_before(lvl, patched);
    doc.detach(lvl);
    Ok(())
}

/// Problems with master and layout ids that make PowerPoint repair a file:
/// ids below 2147483648, and ids used twice.
pub(crate) fn id_problems(pres: &mut Presentation) -> Result<Vec<String>> {
    let mut problems = Vec::new();
    let mut seen = HashSet::new();
    let main = pres.main_part.clone();
    let mut lists = vec![(main, "sldMasterIdLst", "sldMasterId")];
    for page in pres.master_pages()?.into_iter().filter(|p| !p.is_layout) {
        lists.push((page.part, "sldLayoutIdLst", "sldLayoutId"));
    }
    for (part, list, item) in lists {
        let doc = pres.xml(&part)?;
        let Some(list) = doc.child(doc.root(), Ns::P, list) else {
            continue;
        };
        // The ids are optional; a listed one must be valid and unique.
        for id in doc
            .children_named(list, Ns::P, item)
            .filter_map(|e| doc.attr(e, "id"))
        {
            match id.parse::<u32>() {
                Ok(n) if n >= MASTER_ID_BASE => {
                    if !seen.insert(n) {
                        problems.push(format!("master or layout id {n} is used twice"));
                    }
                }
                _ => problems.push(format!("{part}: id {id} is not at least 2147483648")),
            }
        }
    }
    Ok(problems)
}

/// Writes the ids of masters and layouts the file lists without a valid one
/// (see [`MasterPage::stored`]) before the lists change, so every page
/// keeps the id it had.
fn store_ids(pres: &mut Presentation) -> Result<()> {
    let pages = pres.master_pages()?;
    if pages.iter().all(|p| p.stored) {
        return Ok(());
    }
    let main = pres.main_part.clone();
    let mut lists = vec![(main, "sldMasterIdLst", "sldMasterId", false)];
    for page in pages.iter().filter(|p| !p.is_layout) {
        lists.push((page.part.clone(), "sldLayoutIdLst", "sldLayoutId", true));
    }
    for (part, list, item, layouts) in lists {
        let rels = pres.part_rels(&part)?;
        let doc = pres.xml(&part)?;
        let Some(list_node) = doc.child(doc.root(), Ns::P, list) else {
            continue;
        };
        let mut writes = Vec::new();
        for (at, entry) in doc.children_named(list_node, Ns::P, item).enumerate() {
            let target = doc
                .attr_ns(entry, Ns::R, "id")
                .and_then(|rid| rels.target_part(rid))
                .and_then(|t| pres.pkg.canonical_name(&t).map(str::to_owned));
            let page = pages.iter().find(|p| {
                Some(&p.part) == target.as_ref()
                    && p.is_layout == layouts
                    && (!layouts || p.master_part == part)
            });
            if let Some(page) = page.filter(|p| !p.stored) {
                writes.push((at, page.id));
            }
        }
        if writes.is_empty() {
            continue;
        }
        let doc = pres.xml_mut(&part)?;
        let Some(list_node) = doc.child(doc.root(), Ns::P, list) else {
            continue;
        };
        let entries: Vec<NodeId> = doc.children_named(list_node, Ns::P, item).collect();
        for (at, id) in writes {
            doc.set_attr(entries[at], "id", &id.to_string());
        }
    }
    Ok(())
}

#[cfg(test)]
mod test;
