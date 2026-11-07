//! Search scoping uses current grants, including shared channel sessions.

use agent_session::domain::search::AgentSessionSearchMetadata;
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use rootcause::Report;
use uuid::Uuid;

#[cfg(test)]
mod test;

/// Source of current metadata restricted to the caller's authoritative grants.
pub(crate) trait AgentSessionSearchSource {
    fn accessible(
        &self,
        user: &MacroUserId<Lowercase<'_>>,
        requested: &[Uuid],
    ) -> impl Future<Output = Result<Vec<AgentSessionSearchMetadata>, Report>> + Send;
}

/// Resolves an allowlist before search and revalidates it during enrichment.
pub(crate) struct AgentSessionSearchService<S>(pub S);

impl<S: AgentSessionSearchSource> AgentSessionSearchService<S> {
    pub async fn scope(
        &self,
        user: &MacroUserId<Lowercase<'_>>,
        requested: &[Uuid],
        owners: &[String],
        enabled: bool,
        tags_active: bool,
    ) -> Result<Vec<AgentSessionSearchMetadata>, Report> {
        // Tags aren't projected for sessions yet. Do not return unfiltered sessions.
        if !enabled || tags_active || requested.iter().any(Uuid::is_nil) {
            return Ok(Vec::new());
        }
        Ok(self
            .0
            .accessible(user, requested)
            .await?
            .into_iter()
            .filter(|session| {
                (requested.is_empty() || requested.contains(&session.id))
                    && (owners.is_empty()
                        || owners
                            .iter()
                            .any(|owner| owner == session.owner_id.as_ref()))
            })
            .collect())
    }
}
