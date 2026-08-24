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

fn system_skill_summaries() -> impl Iterator<Item = SkillSummary> {
    system_skills::SYSTEM_SKILLS
        .iter()
        .map(|skill| SkillSummary {
            document_id: skill.id(),
            name: skill.name.to_string(),
            updated_at: None,
        })
}

fn tokenize(text: &str) -> Vec<String> {
    text.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|token| !token.is_empty())
        .map(str::to_string)
        .collect()
}

/// Matches a system skill name against a query with the same semantics the
/// search service applies to skill documents: the query tokens must appear as
/// an adjacent run of name tokens. [`SkillMatchType::Partial`] additionally
/// lets the final query token match a name-token prefix.
fn system_skill_name_matches(name: &str, query: &str, match_type: SkillMatchType) -> bool {
    let name_tokens = tokenize(name);
    let query_tokens = tokenize(query);
    if query_tokens.is_empty() || query_tokens.len() > name_tokens.len() {
        return false;
    }

    (0..=name_tokens.len() - query_tokens.len()).any(|start| {
        query_tokens
            .iter()
            .enumerate()
            .all(|(offset, query_token)| {
                let name_token = &name_tokens[start + offset];
                let is_last = offset == query_tokens.len() - 1;
                match match_type {
                    SkillMatchType::Exact => name_token == query_token,
                    SkillMatchType::Partial if is_last => name_token.starts_with(query_token),
                    SkillMatchType::Partial => name_token == query_token,
                }
            })
    })
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

        // System skills are static, so they are matched here rather than by
        // the search backend.
        skills.extend(
            system_skill_summaries()
                .filter(|skill| system_skill_name_matches(&skill.name, query, match_type)),
        );

        sort_most_recently_updated_first(&mut skills);

        Ok(skills)
    }

    #[tracing::instrument(skip(self), err)]
    async fn list_skills(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> Result<Vec<SkillSummary>, SkillError> {
        let mut skills = self.lister.list_skills(user_id, LIST_LIMIT).await?;

        // System skills are visible to everyone; having no update timestamp,
        // they sort after every user skill.
        skills.extend(system_skill_summaries());

        sort_most_recently_updated_first(&mut skills);

        Ok(skills)
    }
}
