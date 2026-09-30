//! Repository-choice orchestration. Only ambiguous selection spends Macro AI quota.

use std::{future::Future, num::NonZeroUsize, sync::Arc};

use agent_session::domain::{
    model::{AgentSession, AgentSessionId},
    ports::AgentSessionRepo,
};
use ai_billing::{AiAdmissionService, AiFeature};
use cursor_cloud_agents::domain::{
    model::RepoUrl,
    ports::{RepositoryChooser, SessionIntent},
};
use macro_user_id::user_id::MacroUserIdStr;

use super::{
    ports::ReachableRepositories,
    repository_selection::{fallback_repository, intent, recent_repository},
};

#[cfg(test)]
mod test;

/// Recent sessions initially considered as evidence for a repository choice.
pub const RECENT_SESSIONS: usize = 5;

/// Model capability; admission and persistence belong to the calling domain service.
pub trait RepositoryChoiceModel: Send + Sync + 'static {
    /// Choose one of the authorized candidates, recording usage for the trusted owner.
    fn decide(
        &self,
        owner: &MacroUserIdStr<'_>,
        prompt: &str,
        candidates: &[String],
        recent: &[AgentSession],
        fallback: &str,
    ) -> impl Future<Output = Result<String, rootcause::Report>> + Send;
}

/// Chooses and persists a repository before a hosted agent is minted.
pub struct RepositoryChoiceService<Repositories, Sessions, Model> {
    repositories: Arc<Repositories>,
    sessions: Sessions,
    model: Model,
    admission: Arc<dyn AiAdmissionService>,
    owner: MacroUserIdStr<'static>,
    session_id: AgentSessionId,
}

impl<Repositories, Sessions, Model> RepositoryChoiceService<Repositories, Sessions, Model>
where
    Repositories: ReachableRepositories,
    Sessions: AgentSessionRepo,
    Model: RepositoryChoiceModel,
{
    /// Build a chooser for one session and its verified owner.
    pub fn new(
        repositories: Arc<Repositories>,
        sessions: Sessions,
        model: Model,
        admission: Arc<dyn AiAdmissionService>,
        owner: MacroUserIdStr<'static>,
        session_id: AgentSessionId,
    ) -> Self {
        Self {
            repositories,
            sessions,
            model,
            admission,
            owner,
            session_id,
        }
    }

    #[tracing::instrument(
        name = "agent.repository_choice.reachable_repositories",
        skip_all,
        err,
        fields(agent.session.id = %self.session_id)
    )]
    async fn reachable_repositories(&self) -> Result<Vec<String>, rootcause::Report> {
        Ok(self
            .repositories
            .for_user(&self.owner)
            .await
            .map_err(|error| rootcause::report!("could not list reachable repositories: {error}"))?
            .into_iter()
            .map(|repository| repository.url)
            .collect())
    }

    /// Recent sessions through the newest accessible repository, excluding this session.
    #[tracing::instrument(
        name = "agent.repository_choice.recent_sessions",
        skip_all,
        err,
        fields(agent.session.id = %self.session_id)
    )]
    async fn recent_sessions(
        &self,
        candidates: &[String],
    ) -> Result<Vec<AgentSession>, rootcause::Report> {
        let mut limit = RECENT_SESSIONS + 1;
        loop {
            let recent = self
                .sessions
                .recent_for_owner(
                    &self.owner,
                    NonZeroUsize::new(limit).expect("a nonzero count"),
                )
                .await
                .map_err(|error| {
                    rootcause::report!("could not read the owner's recent sessions: {error}")
                })?;
            let exhausted = recent.len() < limit;
            let recent: Vec<_> = recent
                .into_iter()
                .filter(|session| session.id != self.session_id)
                .collect();
            if exhausted || recent_repository(candidates, &recent).is_some() {
                return Ok(recent);
            }
            limit = limit.checked_mul(2).ok_or_else(|| {
                rootcause::report!("too many sessions to find a recent repository")
            })?;
        }
    }
}

impl<Repositories, Sessions, Model> RepositoryChooser
    for RepositoryChoiceService<Repositories, Sessions, Model>
where
    Repositories: ReachableRepositories,
    Sessions: AgentSessionRepo,
    Model: RepositoryChoiceModel,
{
    #[tracing::instrument(name = "agent.repository_choice", skip_all, err,
        fields(
            agent.session.id = %self.session_id,
            agent.repository_choice.candidate_count = tracing::field::Empty,
            agent.repository_choice.recent_session_count = tracing::field::Empty,
            agent.repository_choice.outcome = tracing::field::Empty,
        ))]
    async fn choose(
        &self,
        prompt: &str,
        _cwd: &std::path::Path,
    ) -> Result<SessionIntent, rootcause::Report> {
        // Caller-selected repositories were authorized by the opening service.
        let session =
            self.sessions.get(self.session_id).await.map_err(|error| {
                rootcause::report!("could not read selected repository: {error}")
            })?;
        if session.repo_branch.is_some()
            && let Some(url) = session.repo_url.as_deref()
        {
            let repository = RepoUrl::parse(url)
                .ok_or_else(|| rootcause::report!("invalid selected repository"))?;
            return Ok(SessionIntent {
                repository: Some(repository),
                open_pull_request: true,
            });
        }
        let mut had_candidates = false;
        let result = async {
            let candidates = self.reachable_repositories().await?;
            had_candidates = !candidates.is_empty();
            tracing::Span::current()
                .record("agent.repository_choice.candidate_count", candidates.len());
            let fallback = fallback_repository(&candidates, &[])?;
            let chosen = if candidates.len() == 1 {
                intent(&candidates, fallback)?
            } else {
                self.admission
                    .admit(&self.owner, AiFeature::AgentRepositoryChoice)
                    .await
                    .map_err(|error| rootcause::report!(error))?;
                let recent = self.recent_sessions(&candidates).await?;
                tracing::Span::current()
                    .record("agent.repository_choice.recent_session_count", recent.len());
                let fallback = fallback_repository(&candidates, &recent)?;
                let choice = self
                    .model
                    .decide(&self.owner, prompt, &candidates, &recent, fallback)
                    .await?;
                intent(&candidates, &choice)?
            };

            // The egress proxy pins git traffic to this row, before agent creation.
            self.sessions
                .set_repo_url(
                    self.session_id,
                    chosen.repository.as_ref().map(ToString::to_string),
                )
                .await
                .map_err(|error| {
                    rootcause::report!("could not record the session's repository: {error}")
                })?;
            Ok(chosen)
        }
        .await;
        tracing::Span::current().record(
            "agent.repository_choice.outcome",
            match &result {
                Ok(_) => "selected",
                Err(_) if !had_candidates => "no_candidates",
                Err(_) => "failed",
            },
        );
        result
    }
}
