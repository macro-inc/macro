//! Slide masters and their layouts in the deck outline (PowerPoint's Slide
//! Master view): ids, names, which slides use each layout, and placeholders.

use crate::error::Result;
use crate::model::masters::MasterPage;
use crate::model::presentation::{PartRef, Presentation, SlideContext};
use crate::model::shape::{placeholder_of, shows_master_shapes, sp_tree, tree_children};
use crate::opc::rel_type;
use crate::xml::Ns;
use serde::Serialize;

/// A slide master and its layouts.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MasterOutline {
    /// Master id (at least 2147483648). Edit operations take it as their
    /// `slide` to edit the master's shapes, text, and background; reading
    /// it as a slide index outlines or renders the master.
    pub id: u32,
    /// Display name: the master's own name, else its theme's ("Office Theme").
    pub name: String,
    /// Placeholder types on the master, in z-order (`title`, `body`, `dt`,
    /// `ftr`, `sldNum`).
    pub placeholders: Vec<String>,
    /// Its layouts, in order.
    pub layouts: Vec<MasterLayoutOutline>,
}

/// A slide layout of a master.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MasterLayoutOutline {
    /// Layout id (at least 2147483648), addressed like a master's id.
    pub id: u32,
    /// Name (`addSlide` and `setSlideLayout` take it).
    pub name: String,
    /// Layout type (`title`, `obj`, `twoObj`, `titleOnly`, `blank`, `cust`...).
    pub kind: String,
    /// Ids of the slides that use it, in deck order (a used layout cannot be
    /// deleted).
    pub slide_ids: Vec<u32>,
    /// Placeholder types, in z-order (`title`, `body`, `obj` for content,
    /// `pic`, `chart`, `tbl`, `dgm`, `media`, `dt`, `ftr`, `sldNum`...).
    pub placeholders: Vec<String>,
    /// Whether the master's background graphics are hidden on it
    /// (`showMasterSp="0"`).
    pub hide_background_graphics: bool,
}

/// `p:cSld/@name` of a slide-like part (empty when absent).
pub(crate) fn page_name(part: &PartRef) -> String {
    let doc = &part.doc;
    doc.child(doc.root(), Ns::P, "cSld")
        .and_then(|c| doc.attr(c, "name"))
        .unwrap_or("")
        .to_owned()
}

/// A master's display name: its own name, else its theme's.
pub(crate) fn master_name(pres: &mut Presentation, master: &PartRef) -> String {
    let own = page_name(master);
    if !own.trim().is_empty() {
        return own;
    }
    let theme = master
        .rels
        .first_of_type(rel_type::THEME)
        .map(|r| master.rels.resolve(r));
    theme
        .and_then(|t| pres.xml(&t).ok())
        .and_then(|doc| doc.attr(doc.root(), "name").map(str::to_owned))
        .unwrap_or_default()
}

/// Placeholder types of a page's shape tree, in z-order.
fn placeholder_kinds(part: &PartRef) -> Vec<String> {
    let doc = &part.doc;
    sp_tree(doc)
        .map(|tree| {
            tree_children(doc, tree)
                .into_iter()
                .filter_map(|n| placeholder_of(doc, n).map(|p| p.kind))
                .collect()
        })
        .unwrap_or_default()
}

/// The id of the layout in part `layout` (`None` when no master lists it).
pub(super) fn layout_id(pres: &mut Presentation, layout: &str) -> Result<Option<u32>> {
    Ok(pres
        .master_pages()?
        .into_iter()
        .find(|p| p.is_layout && p.part == layout)
        .map(|p| p.id))
}

/// A master page's position in Slide Master view order, its name, and (for
/// a layout) its id, for its outline.
pub(super) fn page_position(
    pres: &mut Presentation,
    ctx: &SlideContext,
    id: u32,
) -> Result<(usize, String, Option<u32>)> {
    let pages = pres.master_pages()?;
    let index = pages.iter().position(|p| p.id == id).unwrap_or(0);
    let layout = pages.get(index).is_some_and(|p| p.is_layout);
    let name = if layout {
        page_name(&ctx.slide)
    } else {
        master_name(pres, &ctx.slide)
    };
    Ok((index, name, layout.then_some(id)))
}

/// Every master with its layouts.
pub(super) fn outline(pres: &mut Presentation) -> Result<Vec<MasterOutline>> {
    let pages = pres.master_pages()?;
    // Which layout each slide uses.
    let mut uses: Vec<(String, u32)> = Vec::new();
    for s in pres.slides.clone() {
        if let Some(layout) = crate::edit::slides::layout_of(pres, &s.part) {
            uses.push((layout, s.id));
        }
    }
    let mut out: Vec<MasterOutline> = Vec::new();
    for page in pages {
        let Ok(part) = pres.part(&page.part) else {
            continue;
        };
        if !page.is_layout {
            out.push(MasterOutline {
                id: page.id,
                name: master_name(pres, &part),
                placeholders: placeholder_kinds(&part),
                layouts: Vec::new(),
            });
            continue;
        }
        let Some(master) = out.last_mut().filter(|m| m.id == page.master) else {
            continue;
        };
        master.layouts.push(layout_outline(&page, &part, &uses));
    }
    Ok(out)
}

fn layout_outline(
    page: &MasterPage,
    part: &PartRef,
    uses: &[(String, u32)],
) -> MasterLayoutOutline {
    let doc = &part.doc;
    MasterLayoutOutline {
        id: page.id,
        name: page_name(part),
        kind: doc.attr(doc.root(), "type").unwrap_or("cust").to_owned(),
        slide_ids: uses
            .iter()
            .filter(|(layout, _)| *layout == page.part)
            .map(|(_, id)| *id)
            .collect(),
        placeholders: placeholder_kinds(part),
        hide_background_graphics: !shows_master_shapes(doc),
    }
}
