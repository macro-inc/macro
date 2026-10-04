//! What an edit changed: the slides whose rendering differs between two
//! states of a presentation, and the caches an undo can carry over.

use super::{EditResult, sections};
use crate::model::presentation::Presentation;
use crate::opc::{TargetMode, rel_type, rels_part_name};

/// Which slides differ between two states of the same presentation.
pub(crate) fn diff(before: &Presentation, after: &Presentation) -> EditResult {
    let ids = |p: &Presentation| p.slides.iter().map(|s| s.id).collect::<Vec<_>>();
    let same = |name: &str| before.pkg.part_identity(name) == after.pkg.part_identity(name);
    // The slide size and numbering show on every slide.
    let deck_changed =
        before.size != after.size || before.first_slide_number != after.first_slide_number;
    let sections_changed =
        !same(&after.main_part) && sections::snapshot(before) != sections::snapshot(after);
    let structure_changed = ids(before) != ids(after) || deck_changed || sections_changed;
    let notes_part = |p: &Presentation, slide: &str| {
        p.rels
            .get(slide)
            .and_then(|r| r.first_of_type(rel_type::NOTES_SLIDE).map(|n| r.resolve(n)))
    };
    // Charts live in parts of their own; editing one changes the slide's rendering.
    let charts_unchanged = |slide: &str| {
        let rels = match after.rels.get(slide) {
            Some(r) => std::sync::Arc::clone(r),
            None => match after.pkg.rels(slide) {
                Ok(r) => std::sync::Arc::new(r),
                Err(_) => return true,
            },
        };
        rels.iter()
            .filter(|r| r.rel_type == rel_type::CHART && r.mode == TargetMode::Internal)
            .all(|r| same(&rels.resolve(r)))
    };
    // Themes, masters, and layouts are drawn under every slide that uses
    // them; a change to any of them redraws every slide.
    let shared_changed = deck_changed
        || after.pkg.part_names().any(|name| {
            (name.starts_with("/ppt/theme/")
                || name.starts_with("/ppt/slideMasters/")
                || name.starts_with("/ppt/slideLayouts/"))
                && !same(name)
        });
    let changed_slides = after
        .slides
        .iter()
        .filter(|s| {
            if shared_changed {
                return true;
            }
            let unchanged = before
                .slides
                .iter()
                .any(|o| o.id == s.id && o.part == s.part)
                && same(&s.part)
                && same(&rels_part_name(&s.part))
                && notes_part(after, &s.part).is_none_or(|n| same(&n))
                && charts_unchanged(&s.part);
            !unchanged
        })
        .map(|s| s.id)
        .collect();
    EditResult {
        created: Vec::new(),
        changed_slides,
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
