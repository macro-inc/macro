//! Domain service implementation for skills.

#[cfg(test)]
mod test;

use macro_user_id::user_id::MacroUserIdStr;

use crate::domain::model::{SkillError, SkillMatchType, SkillSummary};
use crate::domain::ports::{SkillSearcher, SkillService};

/// Skill domain service backed by a [`SkillSearcher`].
#[derive(Debug, Clone)]
pub struct SkillServiceImpl<S> {
    searcher: S,
}

impl<S> SkillServiceImpl<S> {
    /// Create a new skill service from a searcher.
    pub fn new(searcher: S) -> Self {
        Self { searcher }
    }
}

impl<S: SkillSearcher> SkillService for SkillServiceImpl<S> {
    #[tracing::instrument(skip(self), err)]
    async fn search_skills(
        &self,
        user_id: &MacroUserIdStr<'_>,
        query: &str,
        match_type: SkillMatchType,
    ) -> Result<Vec<SkillSummary>, SkillError> {
        let query = query.trim();
        if query.is_empty() {
            return Err(SkillError::InvalidRequest(
                "query must not be empty".to_string(),
            ));
        }

        let mut skills = self
            .searcher
            .search_skills_by_name(user_id, query, match_type)
            .await?;

        skills.sort_by(|a, b| {
            b.updated_at
                .cmp(&a.updated_at)
                .then_with(|| a.document_id.cmp(&b.document_id))
        });

        Ok(skills)
    }
}
