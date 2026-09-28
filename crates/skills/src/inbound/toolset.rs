//! Toolset inbound adapter for skills.
//!
//! Exposes skill discovery and reading to every agent harness through
//! `SearchSkills`, `ListSkills`, and `ReadSkill`.

mod list_skills;
mod read_skill;
mod search_skills;

use std::sync::Arc;

use ai_toolset::AsyncToolCollection;

use crate::domain::ports::SkillService;

pub use list_skills::{ListSkills, ListSkillsResponse};
pub use read_skill::{ReadSkill, ReadSkillResponse};
pub use search_skills::{SearchSkills, SearchSkillsResponse, SkillSearchResult};

/// Service context for skill AI tools.
pub struct SkillToolContext<Svc: SkillService> {
    /// The skill domain service used to search skills.
    pub service: Arc<Svc>,
}

impl<Svc: SkillService> Clone for SkillToolContext<Svc> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
        }
    }
}

impl<Svc: SkillService> SkillToolContext<Svc> {
    /// Create a new skill tool context.
    pub fn new(service: Svc) -> Self {
        Self {
            service: Arc::new(service),
        }
    }
}

/// Create the skill toolset.
pub fn skill_toolset<Svc: SkillService>() -> AsyncToolCollection<SkillToolContext<Svc>> {
    AsyncToolCollection::new()
        .add_tool::<SearchSkills, SkillToolContext<Svc>>()
        .add_tool::<ListSkills, SkillToolContext<Svc>>()
        .add_tool::<ReadSkill, SkillToolContext<Svc>>()
}
