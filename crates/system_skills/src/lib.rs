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
//! skills in [`SYSTEM_SKILLS`]; the web app fetches them from the
//! `GET /system_skills` endpoint.
#![deny(missing_docs)]

use prompt::Section;
use uuid::Uuid;

pub mod catch_me_up;
pub mod what_i_did_yesterday;

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

/// UUIDv5 namespace for system skill ids. An arbitrary constant generated
/// once; changing it changes every system skill id.
const SYSTEM_SKILL_NAMESPACE: Uuid = uuid::uuid!("7e447d71-00ba-4440-92f1-d478d0ce8fe5");

impl SystemSkill {
    /// The skill's stable id: the UUIDv5 of its slug in
    /// [`SYSTEM_SKILL_NAMESPACE`]. Derived rather than stored so it cannot
    /// drift from the slug, and never collides with a real (v4) document id.
    pub fn id(&self) -> Uuid {
        Uuid::new_v5(&SYSTEM_SKILL_NAMESPACE, self.slug.as_bytes())
    }

    /// Render the skill's markdown instructions.
    pub fn render_content(&self) -> String {
        self.content.to_string()
    }
}

/// Every system skill, in display order.
pub static SYSTEM_SKILLS: &[&SystemSkill] = &[&catch_me_up::SKILL, &what_i_did_yesterday::SKILL];

/// Look up a system skill by its well-known id.
pub fn system_skill(id: Uuid) -> Option<&'static SystemSkill> {
    SYSTEM_SKILLS.iter().find(|skill| skill.id() == id).copied()
}

/// Whether `id` is a system skill id (and thus not a document id).
pub fn is_system_skill(id: Uuid) -> bool {
    system_skill(id).is_some()
}
