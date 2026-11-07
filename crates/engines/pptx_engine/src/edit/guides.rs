//! Drawing guides (PowerPoint's View ▸ Guides): the lines shown over every
//! slide for lining shapes up.
//!
//! PowerPoint 2013 and later store the deck's guides as `p15:sldGuideLst`
//! in an extension of the presentation part
//! (`p:extLst/p:ext[@uri="{EFAFB233-…}"]`); masters and layouts carry their
//! own lists in their extension lists. Each `p15:guide` has an `id`, an
//! `orient` (`horz`, or the default `vert`), a `pos` in master units (1/576
//! inch, 8 per point) from the slide's top or left edge, and a `p15:clr`.
//! Older files keep the slide guides only in `viewProps.xml`
//! (`p:cSldViewPr/p:guideLst/p:guide`), which are read when the extension
//! is missing; writes mirror the list there, as PowerPoint does.

use super::ops::{GuideOrient, GuideSpec};
use super::slides::PRESENTATION_ORDER;
use super::xmlutil::color_element;
use crate::error::{Error, Result};
use crate::model::presentation::Presentation;
use crate::xml::{NodeId, Ns, XmlDoc};
use serde::Serialize;
use std::collections::HashSet;

/// The presentation extension holding the slide guides.
const SLIDE_GUIDES_URI: &str = "{EFAFB233-063F-42B5-8137-9DF3F51BA10A}";
/// The slide master extension holding its guides.
const MASTER_GUIDES_URI: &str = "{27BBF7A9-308A-43DC-89C8-2F10F3537804}";
/// The slide layout extension holding its guides.
const LAYOUT_GUIDES_URI: &str = "{DCECCB84-F9BA-43D5-87BE-67443E8EF086}";
/// The presentation extension holding sections, which PowerPoint writes first.
const SECTION_LIST_URI: &str = "{521415D9-36F7-43E2-AB2F-B90AF26B5E84}";
/// Master units (`pos`) per point.
const UNITS_PER_POINT: f32 = 8.0;
/// The color PowerPoint gives guides drawn on slides.
pub const DEFAULT_GUIDE_COLOR: &str = "A4A3A4";
/// Child order of `p15:guide`.
const GUIDE_ORDER: &[&str] = &["clr", "extLst"];
/// Child order of `p:cSldViewPr`.
const SLIDE_VIEW_ORDER: &[&str] = &["cViewPr", "guideLst"];
/// How far (points) a guide may sit outside the slide and still be taken.
const EDGE_TOLERANCE: f32 = 0.5;

/// A drawing guide.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GuideOutline {
    /// Identifier, unique within its list (what `setGuides` keeps by).
    pub id: u32,
    /// `horizontal` (a line across the slide) or `vertical`.
    pub orient: GuideOrient,
    /// Points from the slide's top edge (horizontal) or left edge (vertical).
    pub position: f32,
    /// Color as `RRGGBB` or a theme color name, when the file gives one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
}

/// The `p15:sldGuideLst` in the extension `uri` of a part's root.
fn guide_list(doc: &XmlDoc, uri: &str) -> Option<(NodeId, NodeId)> {
    let ext_lst = doc.child(doc.root(), Ns::P, "extLst")?;
    doc.children_named(ext_lst, Ns::P, "ext")
        .filter(|&e| doc.attr(e, "uri") == Some(uri))
        .find_map(|e| doc.child(e, Ns::P15, "sldGuideLst").map(|l| (e, l)))
}

/// A color element's value as `setGuides` takes it.
fn color_value(doc: &XmlDoc, clr: NodeId) -> Option<String> {
    let c = doc.children(clr).next()?;
    match doc.local(c) {
        "srgbClr" => doc.attr(c, "val").map(str::to_ascii_uppercase),
        "schemeClr" | "prstClr" => doc.attr(c, "val").map(str::to_owned),
        "sysClr" => doc.attr(c, "lastClr").map(str::to_ascii_uppercase),
        _ => None,
    }
}

fn orient_of(doc: &XmlDoc, guide: NodeId) -> GuideOrient {
    match doc.attr(guide, "orient") {
        Some("horz") => GuideOrient::Horizontal,
        _ => GuideOrient::Vertical,
    }
}

fn position_of(doc: &XmlDoc, guide: NodeId) -> f32 {
    doc.attr_f64(guide, "pos")
        .map_or(0.0, |v| v as f32 / UNITS_PER_POINT)
}

/// The guides of a `p15:sldGuideLst`.
fn read_list(doc: &XmlDoc, list: NodeId) -> Vec<GuideOutline> {
    doc.children_named(list, Ns::P15, "guide")
        .enumerate()
        .map(|(i, g)| GuideOutline {
            id: doc
                .attr_i64(g, "id")
                .and_then(|v| u32::try_from(v).ok())
                .unwrap_or(i as u32 + 1),
            orient: orient_of(doc, g),
            position: position_of(doc, g),
            color: doc
                .child(g, Ns::P15, "clr")
                .and_then(|c| color_value(doc, c)),
        })
        .collect()
}

/// The legacy slide guides of `viewProps.xml`.
fn read_view_guides(doc: &XmlDoc) -> Vec<GuideOutline> {
    doc.path(
        doc.root(),
        Ns::P,
        &["slideViewPr", "cSldViewPr", "guideLst"],
    )
    .map(|list| {
        doc.children_named(list, Ns::P, "guide")
            .enumerate()
            .map(|(i, g)| GuideOutline {
                id: i as u32 + 1,
                orient: orient_of(doc, g),
                position: position_of(doc, g),
                color: None,
            })
            .collect()
    })
    .unwrap_or_default()
}

/// The deck's slide guides given its presentation part and, for files
/// without the extension, its view properties.
pub(crate) fn read(main: &XmlDoc, view: Option<&XmlDoc>) -> Vec<GuideOutline> {
    match guide_list(main, SLIDE_GUIDES_URI) {
        Some((_, list)) => read_list(main, list),
        None => view.map(read_view_guides).unwrap_or_default(),
    }
}

/// The guides a slide master or layout part defines.
pub(crate) fn read_part(doc: &XmlDoc) -> Vec<GuideOutline> {
    [MASTER_GUIDES_URI, LAYOUT_GUIDES_URI]
        .iter()
        .find_map(|uri| guide_list(doc, uri))
        .map(|(_, list)| read_list(doc, list))
        .unwrap_or_default()
}

/// The `viewProps.xml` part of a deck, if it has one.
fn view_part(pres: &mut Presentation) -> Option<String> {
    let main = pres.main_part.clone();
    let rels = pres.part_rels(&main).ok()?;
    rels.iter()
        .find(|r| r.rel_type.ends_with("/viewProps"))
        .map(|r| rels.resolve(r))
        .filter(|name| pres.pkg.part_names().any(|n| n == name.as_str()))
}

/// The deck's slide guides.
pub(crate) fn deck_guides(pres: &mut Presentation) -> Result<Vec<GuideOutline>> {
    let main = pres.xml(&pres.main_part.clone())?;
    let view = match guide_list(&main, SLIDE_GUIDES_URI) {
        Some(_) => None,
        None => view_part(pres).and_then(|name| pres.xml(&name).ok()),
    };
    Ok(read(&main, view.as_deref()))
}

/// The slide guides of a presentation state without touching its caches
/// (for comparing two states).
pub(crate) fn snapshot(pres: &Presentation) -> Vec<GuideOutline> {
    let parse = |name: &str| -> Option<std::sync::Arc<XmlDoc>> {
        match pres.xml.get(name) {
            Some(doc) => Some(doc.clone()),
            None => {
                let bytes = pres.pkg.read(name).ok()?;
                XmlDoc::parse(&bytes, name).ok().map(std::sync::Arc::new)
            }
        }
    };
    let Some(main) = parse(&pres.main_part) else {
        return Vec::new();
    };
    if guide_list(&main, SLIDE_GUIDES_URI).is_some() {
        return read(&main, None);
    }
    let view = pres
        .pkg
        .part_names()
        .find(|n| n.ends_with("/viewProps.xml"))
        .and_then(parse);
    read(&main, view.as_deref())
}

/// The guide list of the presentation part, created with its extension.
fn ensure_list(doc: &mut XmlDoc) -> NodeId {
    if let Some((_, list)) = guide_list(doc, SLIDE_GUIDES_URI) {
        return list;
    }
    let root = doc.root();
    let ext_lst = doc.ensure_child(root, Ns::P, "extLst", PRESENTATION_ORDER);
    let ext = doc.create_element(Ns::P, "ext");
    doc.set_attr(ext, "uri", SLIDE_GUIDES_URI);
    // After the section list, which PowerPoint writes first.
    let sections = doc
        .children_named(ext_lst, Ns::P, "ext")
        .find(|&e| doc.attr(e, "uri") == Some(SECTION_LIST_URI));
    match (sections, doc.first_child(ext_lst)) {
        (Some(s), _) => doc.insert_after(s, ext),
        (None, Some(first)) => doc.insert_before(first, ext),
        (None, None) => doc.append_child(ext_lst, ext),
    }
    let list = doc.create_element(Ns::P15, "sldGuideLst");
    doc.append_child(ext, list);
    list
}

/// Removes the guide list's extension (and an extension list left empty).
fn drop_list(doc: &mut XmlDoc) {
    let Some((ext, _)) = guide_list(doc, SLIDE_GUIDES_URI) else {
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

/// `pos` for a position in points.
fn pos_value(points: f32) -> String {
    ((points * UNITS_PER_POINT).round() as i64).to_string()
}

/// Writes a guide's orientation and position.
fn set_place(doc: &mut XmlDoc, guide: NodeId, spec: &GuideSpec) {
    match spec.orient {
        GuideOrient::Horizontal => doc.set_attr(guide, "orient", "horz"),
        GuideOrient::Vertical => doc.remove_attr(guide, "orient"),
    }
    doc.set_attr(guide, "pos", &pos_value(spec.position));
}

/// Gives a guide the color `color` (`p15:clr`).
fn set_color(doc: &mut XmlDoc, guide: NodeId, color: &str) -> Result<()> {
    let value = color_element(doc, color, None)?;
    let clr = doc.ensure_child(guide, Ns::P15, "clr", GUIDE_ORDER);
    for c in doc.child_nodes(clr).to_vec() {
        doc.detach(c);
    }
    doc.append_child(clr, value);
    Ok(())
}

fn check(specs: &[GuideSpec], size: (f32, f32)) -> Result<()> {
    let mut ids = HashSet::new();
    for s in specs {
        let (extent, side) = match s.orient {
            GuideOrient::Horizontal => (size.1, "height"),
            GuideOrient::Vertical => (size.0, "width"),
        };
        if !s.position.is_finite()
            || s.position < -EDGE_TOLERANCE
            || s.position > extent + EDGE_TOLERANCE
        {
            return Err(Error::InvalidEdit(format!(
                "guide position {} is off the slide (0 to the slide's {side}, {extent} pt)",
                s.position
            )));
        }
        if let Some(id) = s.id
            && !ids.insert(id)
        {
            return Err(Error::InvalidEdit(format!("guide id {id} is listed twice")));
        }
    }
    Ok(())
}

/// Replaces the deck's slide guides.
pub(super) fn set_guides(pres: &mut Presentation, specs: &[GuideSpec]) -> Result<()> {
    let size = (
        crate::units::emu_to_pt(pres.size.0 as f64),
        crate::units::emu_to_pt(pres.size.1 as f64),
    );
    check(specs, size)?;
    let clamp = |s: &GuideSpec| {
        let extent = match s.orient {
            GuideOrient::Horizontal => size.1,
            GuideOrient::Vertical => size.0,
        };
        GuideSpec {
            position: s.position.clamp(0.0, extent),
            ..s.clone()
        }
    };
    let specs: Vec<GuideSpec> = specs.iter().map(clamp).collect();
    let main = pres.main_part.clone();
    let doc = pres.xml_mut(&main)?;
    if specs.is_empty() {
        drop_list(doc);
    } else {
        write_list(doc, &specs)?;
    }
    mirror_view(pres, &specs)
}

/// Rewrites the presentation's guide list to `specs`, keeping the elements
/// of guides they name by id.
fn write_list(doc: &mut XmlDoc, specs: &[GuideSpec]) -> Result<()> {
    let list = ensure_list(doc);
    let existing: Vec<(u32, NodeId)> = doc
        .children_named(list, Ns::P15, "guide")
        .filter_map(|g| {
            doc.attr_i64(g, "id")
                .and_then(|v| u32::try_from(v).ok())
                .map(|id| (id, g))
        })
        .collect();
    let kept: HashSet<u32> = specs
        .iter()
        .filter_map(|s| s.id)
        .filter(|id| existing.iter().any(|(e, _)| e == id))
        .collect();
    let mut next = kept.iter().copied().max().unwrap_or(0);
    for c in doc.child_nodes(list).to_vec() {
        doc.detach(c);
    }
    for spec in specs {
        let reused = spec
            .id
            .filter(|id| kept.contains(id))
            .and_then(|id| existing.iter().find(|(e, _)| *e == id).map(|(_, g)| *g));
        let guide = match reused {
            Some(g) => g,
            None => {
                let g = doc.create_element(Ns::P15, "guide");
                next += 1;
                doc.set_attr(g, "id", &next.to_string());
                g
            }
        };
        set_place(doc, guide, spec);
        doc.set_attr(guide, "userDrawn", "1");
        match spec.color.as_deref() {
            Some(color) => set_color(doc, guide, color)?,
            None if doc.child(guide, Ns::P15, "clr").is_none() => {
                set_color(doc, guide, DEFAULT_GUIDE_COLOR)?;
            }
            None => {}
        }
        doc.append_child(list, guide);
    }
    Ok(())
}

/// Mirrors the guides into `viewProps.xml`'s slide view, when it has one.
fn mirror_view(pres: &mut Presentation, specs: &[GuideSpec]) -> Result<()> {
    let Some(name) = view_part(pres) else {
        return Ok(());
    };
    let (slide_view, empty) = {
        let view = pres.xml(&name)?;
        let Some(slide_view) = view.path(view.root(), Ns::P, &["slideViewPr", "cSldViewPr"]) else {
            return Ok(());
        };
        let empty = view
            .child(slide_view, Ns::P, "guideLst")
            .is_none_or(|l| view.children(l).next().is_none());
        (slide_view, empty)
    };
    if specs.is_empty() && empty {
        return Ok(());
    }
    let doc = pres.xml_mut(&name)?;
    let list = doc.ensure_child(slide_view, Ns::P, "guideLst", SLIDE_VIEW_ORDER);
    for c in doc.child_nodes(list).to_vec() {
        doc.detach(c);
    }
    for spec in specs {
        let g = doc.create_element(Ns::P, "guide");
        set_place(doc, g, spec);
        doc.append_child(list, g);
    }
    Ok(())
}

#[cfg(test)]
mod test;
