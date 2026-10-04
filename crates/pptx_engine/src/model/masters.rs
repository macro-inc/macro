//! Slide masters and their layouts as pages of their own, the way
//! PowerPoint's Slide Master view shows them: each master, then its layouts.
//!
//! Masters and layouts have stable ids (`p:sldMasterId/@id` in the
//! presentation, `p:sldLayoutId/@id` in each master). ECMA-376 keeps them at
//! or above [`MASTER_ID_BASE`] and slide ids below it, so one id addresses a
//! slide, a master, or a layout: edit operations take a master's or layout's
//! id wherever they take a slide id for its shapes, text, and background, and
//! the reads that take a slide's position (outlines, rendering, text layout,
//! copying shapes) take a master's or layout's id in its place.

use super::presentation::{PartRef, Presentation, SlideContext};
use crate::error::{Error, Result};
use crate::xml::{NodeId, Ns, XmlDoc};

/// The smallest id a slide master or layout has; slide ids are smaller.
pub const MASTER_ID_BASE: u32 = 0x8000_0000;

/// A slide master or one of its layouts.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MasterPage {
    /// Its id (`p:sldMasterId/@id` or `p:sldLayoutId/@id`).
    pub id: u32,
    /// Its part.
    pub part: String,
    /// The id of its master (its own id for a master).
    pub master: u32,
    /// The part of its master.
    pub master_part: String,
    /// Whether it is a layout (else a master).
    pub is_layout: bool,
}

/// What a page index addresses.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Page {
    /// The slide, master, or layout id.
    pub id: u32,
    /// Its part.
    pub part: String,
    /// The slide's 0-based position (`None` for a master or layout).
    pub slide: Option<usize>,
    /// The number slide-number fields show.
    pub number: usize,
}

/// The `id` attribute of a list entry, when it is a valid 32-bit id.
pub(crate) fn entry_id(doc: &XmlDoc, entry: NodeId) -> Option<u32> {
    doc.attr_i64(entry, "id")
        .and_then(|id| u32::try_from(id).ok())
}

impl SlideContext {
    /// Whether the context draws a master or layout itself (Slide Master
    /// view) rather than a slide.
    pub fn is_master_page(&self) -> bool {
        let doc = &self.slide.doc;
        let root = doc.root();
        doc.is(root, Ns::P, "sldMaster") || doc.is(root, Ns::P, "sldLayout")
    }
}

/// Every slide master and its layouts in Slide Master view order, reading
/// the masters with `load` (a part by name, `None` when it is missing).
pub(crate) fn list_pages(
    main: &PartRef,
    load: &mut dyn FnMut(&str) -> Option<PartRef>,
) -> Vec<MasterPage> {
    let doc = &main.doc;
    let masters: Vec<(u32, String)> = doc
        .child(doc.root(), Ns::P, "sldMasterIdLst")
        .map(|list| {
            doc.children_named(list, Ns::P, "sldMasterId")
                .filter_map(|m| {
                    let id = entry_id(doc, m)?;
                    let part = main.target(doc.attr_ns(m, Ns::R, "id")?)?;
                    Some((id, part))
                })
                .collect()
        })
        .unwrap_or_default();
    let mut out = Vec::new();
    for (id, part) in masters {
        let Some(master) = load(&part) else {
            continue;
        };
        out.push(MasterPage {
            id,
            part: master.name.clone(),
            master: id,
            master_part: master.name.clone(),
            is_layout: false,
        });
        let doc = &master.doc;
        let Some(list) = doc.child(doc.root(), Ns::P, "sldLayoutIdLst") else {
            continue;
        };
        for l in doc.children_named(list, Ns::P, "sldLayoutId") {
            let (Some(layout_id), Some(target)) = (
                entry_id(doc, l),
                doc.attr_ns(l, Ns::R, "id")
                    .and_then(|rid| master.target(rid)),
            ) else {
                continue;
            };
            let Some(layout) = load(&target) else {
                continue;
            };
            out.push(MasterPage {
                id: layout_id,
                part: layout.name,
                master: id,
                master_part: master.name.clone(),
                is_layout: true,
            });
        }
    }
    out
}

impl Presentation {
    /// Every slide master and its layouts, in Slide Master view order: each
    /// master, then its layouts in their list order.
    pub fn master_pages(&mut self) -> Result<Vec<MasterPage>> {
        let main = self.part(&self.main_part.clone())?;
        Ok(list_pages(&main, &mut |name| {
            let name = self.pkg.canonical_name(name)?.to_owned();
            self.part(&name).ok()
        }))
    }

    /// The master or layout with id `id`.
    pub(crate) fn master_page(&mut self, id: u32) -> Result<MasterPage> {
        self.master_pages()?
            .into_iter()
            .find(|p| p.id == id)
            .ok_or_else(|| Error::NotFound(format!("slide master or layout {id}")))
    }

    /// The part of the slide, slide master, or layout with id `id` (slides
    /// first, should a malformed deck reuse an id).
    pub(crate) fn page_part(&mut self, id: u32) -> Result<String> {
        if let Ok(part) = self.slide_part(id) {
            return Ok(part);
        }
        self.master_page(id)
            .map(|p| p.part)
            .map_err(|_| Error::NotFound(format!("slide {id}")))
    }

    /// What `index` addresses: the slide at that 0-based position, or (from
    /// [`MASTER_ID_BASE`] up) the slide master or layout with that id.
    pub(crate) fn page(&mut self, index: usize) -> Result<Page> {
        if let Some(entry) = self.slides.get(index) {
            return Ok(Page {
                id: entry.id,
                part: entry.part.clone(),
                slide: Some(index),
                number: self.slide_number(index),
            });
        }
        let id = u32::try_from(index)
            .ok()
            .filter(|&id| id >= MASTER_ID_BASE)
            .ok_or_else(|| Error::NotFound(format!("slide {index}")))?;
        let page = self.master_page(id)?;
        Ok(Page {
            id,
            part: page.part,
            slide: None,
            number: self.first_slide_number as usize,
        })
    }

    /// The inheritance context of what `index` addresses: a slide's 0-based
    /// position, or the id of a slide master or layout (see the module docs).
    pub fn page_context(&mut self, index: usize) -> Result<SlideContext> {
        let page = self.page(index)?;
        let part = self.part(&page.part)?;
        self.context_for(part, page.number)
    }
}

#[cfg(test)]
mod test;
