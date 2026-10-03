//! Package integrity checks used after edits: every relationship target and
//! `r:` reference resolves, every part has a content type, and slide ids are
//! unique. Files that fail these checks make PowerPoint offer a "repair".

use crate::error::Result;
use crate::model::presentation::Presentation;
use crate::opc::{CONTENT_TYPES_PART, TargetMode};
use crate::xml::Ns;
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
                    problems.push(format!("{name}: relationship {} points at missing {target}", r.id));
                }
            }
            let is_xml = self.pkg.content_type(name).is_some_and(|ct| ct.ends_with("+xml") || ct.ends_with("/xml"));
            if !is_xml || rels.iter().next().is_none() && !name.starts_with("/ppt/slides/") {
                continue;
            }
            let Ok(doc) = self.xml(name) else {
                problems.push(format!("{name}: not well-formed XML"));
                continue;
            };
            for n in doc.descendants(doc.root()) {
                for a in doc.attrs(n) {
                    if a.ns() == Ns::R && !a.value().is_empty() && rels.get(a.value()).is_none() {
                        problems.push(format!("{name}: r:{}=\"{}\" has no relationship", a.local(), a.value()));
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
