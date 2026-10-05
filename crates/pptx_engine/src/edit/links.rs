//! Hyperlinks: the link strings `formatText` and `setShapeLink` take and
//! outlines report, and the `a:hlinkClick` elements they become.
//!
//! A link string is an address (`https://…`, `mailto:…`, a file), `#slide=<id>`
//! for another slide by stable id, or `#<jump>` for a slide show jump
//! (`#nextslide`, `#previousslide`, `#firstslide`, `#lastslide`,
//! `#lastslideviewed`, `#endshow`).

use super::xmlutil::R_PR_ORDER;
use crate::error::{Error, Result};
use crate::model::presentation::{Presentation, SlideEntry};
use crate::model::text::{Link, LinkTarget};
use crate::opc::{TargetMode, rel_type};
use crate::xml::{NodeId, Ns, XmlDoc};

/// The slide show jumps a link can make.
pub const JUMPS: &[&str] = &[
    "firstslide",
    "lastslide",
    "nextslide",
    "previousslide",
    "lastslideviewed",
    "endshow",
];

/// A link ready to write: its relationship (empty for jumps) and action.
#[derive(Clone, Debug, PartialEq)]
pub struct LinkRef {
    rid: String,
    action: Option<String>,
    tooltip: Option<String>,
}

/// The link string of a model link, as outlines report it (`None` for a
/// jump to a slide no longer in the deck).
pub fn link_string(slides: &[SlideEntry], link: &Link) -> Option<String> {
    match &link.target {
        LinkTarget::Url(url) => Some(url.clone()),
        LinkTarget::Slide(part) => slides
            .iter()
            .find(|s| s.part == *part)
            .map(|s| format!("#slide={}", s.id)),
        LinkTarget::Jump(jump) => Some(format!("#{jump}")),
    }
}

/// Adds the relationship `link` needs to `part` (`None` for `""`, which
/// removes a link).
pub(crate) fn link_ref(
    pres: &mut Presentation,
    part: &str,
    link: &str,
    tooltip: Option<&str>,
) -> Result<Option<LinkRef>> {
    let link = link.trim();
    if link.is_empty() {
        return Ok(None);
    }
    let tooltip = tooltip
        .map(str::trim)
        .filter(|t| !t.is_empty())
        .map(str::to_owned);
    let (rid, action) = if let Some(id) = link.strip_prefix("#slide=") {
        let id: u32 = id
            .parse()
            .map_err(|_| Error::InvalidEdit(format!("bad slide link {link:?}")))?;
        let target = pres.slide_part(id)?;
        let rid = pres.rels_mut(part)?.add_internal(rel_type::SLIDE, &target);
        (rid, Some("ppaction://hlinksldjump".to_owned()))
    } else if let Some(jump) = link.strip_prefix('#') {
        if !JUMPS.contains(&jump) {
            return Err(Error::InvalidEdit(format!(
                "unknown link {link:?}: use an address, #slide=<id>, or one of #{}",
                JUMPS.join(", #")
            )));
        }
        (
            String::new(),
            Some(format!("ppaction://hlinkshowjump?jump={jump}")),
        )
    } else {
        let rid = pres
            .rels_mut(part)?
            .add(rel_type::HYPERLINK, link, TargetMode::External);
        (rid, None)
    };
    Ok(Some(LinkRef {
        rid,
        action,
        tooltip,
    }))
}

/// Replaces `parent`'s click link (`a:hlinkClick`) with `link`, or removes it.
fn set_hlink(doc: &mut XmlDoc, parent: NodeId, link: Option<&LinkRef>, order: &[&str]) {
    doc.remove_children_named(parent, Ns::A, "hlinkClick");
    let Some(link) = link else {
        return;
    };
    let el = doc.create_element(Ns::A, "hlinkClick");
    doc.set_attr_ns(el, Ns::R, "id", &link.rid);
    if let Some(action) = &link.action {
        doc.set_attr(el, "action", action);
    }
    if let Some(tip) = &link.tooltip {
        doc.set_attr(el, "tooltip", tip);
    }
    doc.insert_in_order(parent, el, order);
}

/// Sets a run's (`a:rPr`) link.
pub fn set_run_link(doc: &mut XmlDoc, rpr: NodeId, link: Option<&LinkRef>) {
    set_hlink(doc, rpr, link, R_PR_ORDER);
}

/// Sets the link of shape `shape` (on its `p:cNvPr`).
pub fn set_shape_link(doc: &mut XmlDoc, shape: u32, link: Option<&LinkRef>) -> Result<()> {
    let node = super::shapes::find(doc, shape)?;
    let nv = crate::model::shape::c_nv_pr(doc, node)
        .ok_or_else(|| Error::InvalidEdit(format!("shape {shape} has no properties")))?;
    set_hlink(doc, nv, link, &["hlinkClick", "hlinkHover", "extLst"]);
    Ok(())
}

#[cfg(test)]
mod test;
