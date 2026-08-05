//! Built-in "system" skills available to every user.
//!
//! System skills are defined entirely in code as composable static strings
//! (see the [`prompt`] crate) — they are not documents. They surface through
//! the same AI tools as user-authored skills (`ListSkills`, `SearchSkills`,
//! `ReadContent`) and in the skills menu, but cannot be opened or edited as
//! markdown documents.
//!
//! Each skill lives in its own module exporting a `SKILL` static, mirroring
//! how the [`prompt`] crate exports a `PROMPT` per section. Register new
//! skills in [`SYSTEM_SKILLS`], and mirror their id and name in the web
//! app's `system-skills.ts` constants (like system properties do).
#![deny(missing_docs)]

use prompt::Section;
use uuid::Uuid;

pub mod demo;
pub mod skill_authoring;

#[cfg(test)]
mod test;

/// A built-in skill, defined as static strings rather than a document.
pub struct SystemSkill {
    /// Stable slug, unique across system skills. The skill's id derives from
    /// it — renaming a slug changes the id, so treat slugs as permanent.
    pub slug: &'static str,
    /// Display name, matched by skill search.
    pub name: &'static str,
    /// The skill's markdown instructions as a composable prompt section.
    pub content: Section,
}

impl SystemSkill {
    /// The skill's stable id: the UUIDv5 of its URI in the standard URL
    /// namespace. Derived rather than stored so it cannot drift from the
    /// slug, and never collides with a real (v4) document id.
    pub fn id(&self) -> Uuid {
        Uuid::new_v5(
            &Uuid::NAMESPACE_URL,
            format!("https://macro.com/system-skills/{}", self.slug).as_bytes(),
        )
    }

    /// Render the skill's markdown instructions.
    pub fn render_content(&self) -> String {
        self.content.to_string()
    }
}

/// Every system skill, in display order.
pub static SYSTEM_SKILLS: &[&SystemSkill] = &[&skill_authoring::SKILL, &demo::SKILL];

/// Look up a system skill by its well-known id.
pub fn system_skill(id: Uuid) -> Option<&'static SystemSkill> {
    SYSTEM_SKILLS.iter().find(|skill| skill.id() == id).copied()
}

/// Whether `id` is a system skill id (and thus not a document id).
pub fn is_system_skill(id: Uuid) -> bool {
    system_skill(id).is_some()
}
