//! Domain service implementation for skills.

#[cfg(test)]
mod test;

use macro_user_id::user_id::MacroUserIdStr;

use crate::domain::model::{SkillError, SkillMatchType, SkillSummary};
use crate::domain::ports::{SkillLister, SkillSearcher, SkillService};

/// Maximum number of skills returned from a single listing.
const LIST_LIMIT: u16 = 100;

/// Skill domain service backed by a [`SkillSearcher`] and a [`SkillLister`].
#[derive(Debug, Clone)]
pub struct SkillServiceImpl<S, L> {
    searcher: S,
    lister: L,
}

impl<S, L> SkillServiceImpl<S, L> {
    /// Create a new skill service from a searcher and a lister.
    pub fn new(searcher: S, lister: L) -> Self {
        Self { searcher, lister }
    }
}

fn sort_most_recently_updated_first(skills: &mut [SkillSummary]) {
    skills.sort_by(|a, b| {
        b.updated_at
            .cmp(&a.updated_at)
            .then_with(|| a.document_id.cmp(&b.document_id))
    });
}

impl<S: SkillSearcher, L: SkillLister> SkillService for SkillServiceImpl<S, L> {
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

        sort_most_recently_updated_first(&mut skills);

        Ok(skills)
    }

    #[tracing::instrument(skip(self), err)]
    async fn list_skills(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> Result<Vec<SkillSummary>, SkillError> {
        let mut skills = self.lister.list_skills(user_id, LIST_LIMIT).await?;

        sort_most_recently_updated_first(&mut skills);

        Ok(skills)
    }
}
