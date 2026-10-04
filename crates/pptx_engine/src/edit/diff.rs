//! What an edit changed: the slides (and slide masters and layouts) whose
//! rendering differs between two states of a presentation, and the caches
//! an undo can carry over.

use super::{EditResult, guides, sections};
use crate::model::masters::{MasterPage, list_pages};
use crate::model::presentation::{PartRef, Presentation};
use crate::model::shape::shows_master_shapes;
use crate::opc::{Relationships, TargetMode, rel_type, rels_part_name};
use crate::xml::{Ns, XmlDoc};
use std::sync::Arc;

/// Parsed XML of a part in state `p` (cached, else parsed from its bytes).
fn doc_of(p: &Presentation, part: &str) -> Option<Arc<XmlDoc>> {
    p.xml.get(part).cloned().or_else(|| {
        let bytes = p.pkg.read(part).ok()?;
        XmlDoc::parse(&bytes, part).ok().map(Arc::new)
    })
}

/// Relationships of a part in state `p` (cached, else parsed).
fn rels_of(p: &Presentation, part: &str) -> Option<Arc<Relationships>> {
    p.rels
        .get(part)
        .cloned()
        .or_else(|| p.pkg.rels(part).ok().map(Arc::new))
}

/// A part of state `p` by (possibly non-canonical) name.
fn part_of(p: &Presentation, name: &str) -> Option<PartRef> {
    let name = p.pkg.canonical_name(name)?.to_owned();
    Some(PartRef {
        doc: doc_of(p, &name)?,
        rels: rels_of(p, &name)?,
        name,
    })
}

/// The target of a part's first relationship of `kind`.
fn related(p: &Presentation, part: &str, kind: &str) -> Option<String> {
    let rels = rels_of(p, part)?;
    let target = rels.first_of_type(kind).map(|r| rels.resolve(r))?;
    p.pkg.canonical_name(&target).map(str::to_owned)
}

/// How Slide Master view lists a master or layout: its name, and whether
/// it hides the master's background graphics.
type Listing = (String, bool);

/// The masters and layouts of state `p`, as Slide Master view lists them.
fn master_list(p: &Presentation) -> Vec<(MasterPage, Listing)> {
    let Some(main) = part_of(p, &p.main_part) else {
        return Vec::new();
    };
    list_pages(&main, &mut |name| part_of(p, name))
        .into_iter()
        .map(|page| {
            let doc = doc_of(p, &page.part);
            let own = doc
                .as_ref()
                .and_then(|d| {
                    d.child(d.root(), Ns::P, "cSld")
                        .and_then(|c| d.attr(c, "name"))
                })
                .unwrap_or("")
                .to_owned();
            let theme = || {
                let theme = related(p, &page.part, rel_type::THEME)?;
                let doc = doc_of(p, &theme)?;
                doc.attr(doc.root(), "name").map(str::to_owned)
            };
            let name = if page.is_layout || !own.trim().is_empty() {
                own
            } else {
                theme().unwrap_or_default()
            };
            let hides = doc.is_some_and(|d| !shows_master_shapes(&d));
            (page, (name, hides))
        })
        .collect()
}

/// Which slides (and masters and layouts) differ between two states of the
/// same presentation.
pub(crate) fn diff(before: &Presentation, after: &Presentation) -> EditResult {
    let ids = |p: &Presentation| p.slides.iter().map(|s| s.id).collect::<Vec<_>>();
    let same = |name: &str| before.pkg.part_identity(name) == after.pkg.part_identity(name);
    let same_with_rels = |name: &str| same(name) && same(&rels_part_name(name));
    // The slide size and numbering show on every slide.
    let deck_changed =
        before.size != after.size || before.first_slide_number != after.first_slide_number;
    let sections_changed =
        !same(&after.main_part) && sections::snapshot(before) != sections::snapshot(after);
    // Guides live in the presentation part (or, in older files, the view
    // properties) and show on every slide.
    let guides_changed = (!same(&after.main_part)
        || after
            .pkg
            .part_names()
            .any(|n| n.ends_with("/viewProps.xml") && !same(n)))
        && guides::snapshot(before) != guides::snapshot(after);
    // Themes, masters, and layouts are drawn under the slides that use them.
    let shared = |name: &str| {
        name.starts_with("/ppt/theme/")
            || name.starts_with("/ppt/slideMasters/")
            || name.starts_with("/ppt/slideLayouts/")
    };
    let shared_changed = after
        .pkg
        .part_names()
        .chain(before.pkg.part_names())
        .any(|name| shared(name) && !same(name));
    // Slide Master view lists masters and layouts by name and options.
    let (masters_before, masters_after) = if shared_changed || !same(&after.main_part) {
        (master_list(before), master_list(after))
    } else {
        (Vec::new(), Vec::new())
    };
    let masters_changed = masters_before
        .iter()
        .map(|(p, n)| (p.id, &p.part, n))
        .ne(masters_after.iter().map(|(p, n)| (p.id, &p.part, n)));
    let structure_changed = ids(before) != ids(after)
        || deck_changed
        || sections_changed
        || guides_changed
        || masters_changed;
    let notes_part = |p: &Presentation, slide: &str| {
        p.rels
            .get(slide)
            .and_then(|r| r.first_of_type(rel_type::NOTES_SLIDE).map(|n| r.resolve(n)))
    };
    // Charts and comments live in parts of their own; editing one changes the slide.
    let charts_unchanged = |slide: &str| {
        let Some(rels) = rels_of(after, slide) else {
            return true;
        };
        rels.iter()
            .filter(|r| {
                (r.rel_type == rel_type::CHART || r.rel_type.ends_with("/comments"))
                    && r.mode == TargetMode::Internal
            })
            .all(|r| same(&rels.resolve(r)))
    };
    // A master, with its theme, as drawn under its layouts and slides.
    let master_unchanged = |master: &str| {
        same_with_rels(master)
            && related(after, master, rel_type::THEME).is_none_or(|theme| same(&theme))
    };
    // What a slide inherits: its layout, the layout's master, and its theme.
    let inherited_unchanged = |slide: &str| {
        if !shared_changed {
            return true;
        }
        let Some(layout) = related(after, slide, rel_type::SLIDE_LAYOUT) else {
            return false;
        };
        same_with_rels(&layout)
            && related(after, &layout, rel_type::SLIDE_MASTER).is_some_and(|m| master_unchanged(&m))
    };
    let slides = after.slides.iter().filter(|s| {
        let unchanged = !deck_changed
            && before
                .slides
                .iter()
                .any(|o| o.id == s.id && o.part == s.part)
            && same_with_rels(&s.part)
            && notes_part(after, &s.part).is_none_or(|n| same(&n))
            && charts_unchanged(&s.part)
            && inherited_unchanged(&s.part);
        !unchanged
    });
    let pages = masters_after.iter().filter(|(page, _)| {
        let unchanged = !deck_changed
            && masters_before
                .iter()
                .any(|(o, _)| o.id == page.id && o.part == page.part)
            && master_unchanged(&page.master_part)
            && same_with_rels(&page.part)
            && charts_unchanged(&page.part);
        !unchanged
    });
    EditResult {
        created: Vec::new(),
        changed_slides: slides.map(|s| s.id).collect(),
        changed_layouts: pages.map(|(page, _)| page.id).collect(),
        structure_changed,
        replaced: 0,
    }
}

/// Moves parsed-part and decoded-image caches from `from` into `to` for every
/// part whose bytes are identical in both states.
pub(super) fn carry_caches(from: &Presentation, to: &mut Presentation) {
    let same = |name: &str| from.pkg.part_identity(name) == to.pkg.part_identity(name);
    for (name, doc) in &from.xml {
        if !to.xml.contains_key(name) && same(name) {
            to.xml.insert(name.clone(), doc.clone());
        }
    }
    for (name, rels) in &from.rels {
        if !to.rels.contains_key(name) && same(&rels_part_name(name)) {
            to.rels.insert(name.clone(), rels.clone());
        }
    }
    for (name, img) in &from.images {
        if !to.images.contains_key(name) && same(name) {
            to.images.insert(name.clone(), img.clone());
        }
    }
    for (name, mf) in &from.metafiles {
        if !to.metafiles.contains_key(name) && same(name) {
            to.metafiles.insert(name.clone(), mf.clone());
        }
    }
}
