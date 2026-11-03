//! Built-in "system" skills available to every user.
//!
//! System skills are defined entirely in code as composable static strings
//! (see the [`prompt`] crate) — they are not documents. They surface through
//! the same AI tools as user-authored skills (`ListSkills`, `SearchSkills`,
//! `ReadSkill`) but cannot be opened or edited as markdown documents.
//! [`Visibility::Listed`] skills also appear in the skills menu;
//! [`Visibility::AgentOnly`] skills carry an area's guidance for agents and
//! stay out of users' skill lists.
//!
//! Each skill lives in its own module exporting a `SKILL` static, mirroring
//! how the [`prompt`] crate exports a `PROMPT` per section. Register new
//! skills in [`SYSTEM_SKILLS`]; the web app fetches them from the
//! `GET /system_skills` endpoint.
#![deny(missing_docs)]

use prompt::Section;
use uuid::Uuid;

pub mod catch_me_up;
pub mod configure_agent;
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
    /// When to use the skill, starting "Use when". Agents route requests to
    /// skills on this sentence alone, so it says what the skill is not for
    /// too when a neighbouring skill could be confused with it.
    pub description: &'static str,
    /// Who sees the skill listed.
    pub visibility: Visibility,
    /// The deferred tools whose use the skill's instructions cover.
    pub tools: &'static [&'static str],
    /// The SDK entities whose use in code the skill's instructions cover.
    pub sdk_entities: &'static [&'static str],
    /// The skill's markdown instructions as a composable prompt section.
    pub content: Section,
}

/// Where a system skill is listed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Visibility {
    /// Offered to users in the skills menu, and to agents.
    Listed,
    /// Offered to agents only: an area's guidance, loaded when a request
    /// needs it rather than picked by a user.
    AgentOnly,
}

/// The longest a skill description may be, in characters.
pub const MAX_DESCRIPTION_CHARS: usize = 300;

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
pub static SYSTEM_SKILLS: &[&SystemSkill] = &[
    &catch_me_up::SKILL,
    &what_i_did_yesterday::SKILL,
    &configure_agent::SKILL,
];

/// Look up a system skill by its well-known id.
pub fn system_skill(id: Uuid) -> Option<&'static SystemSkill> {
    SYSTEM_SKILLS.iter().find(|skill| skill.id() == id).copied()
}

/// Whether `id` is a system skill id (and thus not a document id).
pub fn is_system_skill(id: Uuid) -> bool {
    system_skill(id).is_some()
}

/// The system skills users see in the skills menu.
pub fn listed() -> impl Iterator<Item = &'static SystemSkill> {
    SYSTEM_SKILLS
        .iter()
        .copied()
        .filter(|skill| skill.visibility == Visibility::Listed)
}

/// Every system skill's name, id and description, for an agent to read the
/// ones a request needs with `ReadSkill`.
pub fn catalog() -> String {
    let mut catalog = String::from(
        "# Built-in skills\nRead a skill with ReadSkill, by its id, before a request it describes.\n",
    );
    for skill in SYSTEM_SKILLS {
        catalog.push_str(&format!(
            "- {} ({}): {}\n",
            skill.name,
            skill.id(),
            skill.description
        ));
    }
    catalog
}

/// Every agent-only skill's instructions, for prompts that carry an area's
/// guidance whole instead of loading it when a request needs it.
pub fn inline() -> String {
    SYSTEM_SKILLS
        .iter()
        .filter(|skill| skill.visibility == Visibility::AgentOnly)
        .map(|skill| skill.render_content())
        .collect()
}
