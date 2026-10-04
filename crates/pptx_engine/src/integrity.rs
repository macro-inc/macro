//! Package integrity checks used after edits: every relationship target and
//! `r:` reference resolves, every part has a content type, slide ids are
//! unique, and slides keep the schema order of their top-level elements.
//! Files that fail these checks make PowerPoint offer a "repair".

use crate::error::Result;
use crate::model::presentation::Presentation;
use crate::opc::{CONTENT_TYPES_PART, TargetMode, content_type};
use crate::xml::{Ns, XmlDoc};
use std::collections::HashSet;

impl Presentation {
    /// Describes every integrity problem found (empty when the package is sound).
    pub fn integrity_problems(&mut self) -> Result<Vec<String>> {
        let mut problems = Vec::new();
        let names: Vec<String> = self.pkg.part_names().map(str::to_owned).collect();
        for name in &names {
            if name.ends_with(".rels") || name.eq_ignore_ascii_case(CONTENT_TYPES_PART) {
                continue;
            }
            if self.pkg.content_type(name).is_none() {
                problems.push(format!("{name}: no content type"));
            }
            let rels = self.part_rels(name)?;
            for r in rels.iter().filter(|r| r.mode == TargetMode::Internal) {
                let target = rels.resolve(r);
                if !self.pkg.has_part(&target) {
                    problems.push(format!(
                        "{name}: relationship {} points at missing {target}",
                        r.id
                    ));
                }
            }
            let is_xml = self
                .pkg
                .content_type(name)
                .is_some_and(|ct| ct.ends_with("+xml") || ct.ends_with("/xml"));
            if !is_xml || rels.iter().next().is_none() && !name.starts_with("/ppt/slides/") {
                continue;
            }
            let Ok(doc) = self.xml(name) else {
                problems.push(format!("{name}: not well-formed XML"));
                continue;
            };
            if self.pkg.content_type(name) == Some(content_type::SLIDE)
                && let Some(problem) = slide_order_problem(&doc)
            {
                problems.push(format!("{name}: {problem}"));
            }
            for n in doc.descendants(doc.root()) {
                for a in doc.attrs(n) {
                    if a.ns() == Ns::R && !a.value().is_empty() && rels.get(a.value()).is_none() {
                        problems.push(format!(
                            "{name}: r:{}=\"{}\" has no relationship",
                            a.local(),
                            a.value()
                        ));
                    }
                }
            }
        }
        let mut seen = HashSet::new();
        for s in &self.slides {
            if !seen.insert(s.id) {
                problems.push(format!("slide id {} is used twice", s.id));
            }
        }
        Ok(problems)
    }
}

/// Child order of `p:sld` (`mc:AlternateContent` stands for what it wraps).
const SLIDE_ORDER: &[&str] = &["cSld", "clrMapOvr", "transition", "timing", "extLst"];

/// Describes a slide whose top-level elements break the schema order.
fn slide_order_problem(doc: &XmlDoc) -> Option<String> {
    let mut last = 0;
    for c in doc.children(doc.root()) {
        let local = if doc.is(c, Ns::MC, "AlternateContent") {
            doc.first_child(c)
                .and_then(|branch| doc.first_child(branch))
                .map_or("", |n| doc.local(n))
        } else {
            doc.local(c)
        };
        let Some(rank) = SLIDE_ORDER.iter().position(|o| *o == local) else {
            return Some(format!("unexpected <{local}> in the slide"));
        };
        if rank < last {
            return Some(format!("<{local}> is out of schema order"));
        }
        last = rank;
    }
    None
}
