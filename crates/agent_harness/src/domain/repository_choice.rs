//! Owner-bound repository selection before a hosted agent is minted.

use std::future::Future;
use std::num::NonZeroUsize;
use std::sync::Arc;

use agent_session::domain::model::{AgentSession, AgentSessionId};
use agent_session::domain::ports::AgentSessionRepo;
use ai_billing::domain::AiAdmissionService;
use ai_usage::AiFeature;
use cursor_cloud_agents::domain::model::RepoUrl;
use cursor_cloud_agents::domain::ports::SessionIntent;
use macro_user_id::user_id::MacroUserIdStr;

use super::ports::ReachableRepositories;

#[cfg(test)]
mod test;

const RECENT_SESSIONS: usize = 5;

/// Model-backed interpretation of a prompt, restricted to the supplied candidates.
pub trait RepositoryChoiceModel: Send + Sync {
    /// Return a candidate URL or no repository. Usage belongs to `owner`.
    fn decide(
        &self,
        owner: &MacroUserIdStr<'_>,
        prompt: &str,
        candidates: &[String],
        recent: &[AgentSession],
    ) -> impl Future<Output = Result<Option<String>, rootcause::Report>> + Send;
}

/// Keeps deterministic choices available without billing a helper completion.
pub struct RepositoryChoice<Repositories, Sessions, Model> {
    repositories: Arc<Repositories>,
    sessions: Sessions,
    model: Model,
    admission: Arc<dyn AiAdmissionService>,
    owner: MacroUserIdStr<'static>,
    session_id: AgentSessionId,
}

impl<Repositories, Sessions, Model> RepositoryChoice<Repositories, Sessions, Model>
where
    Repositories: ReachableRepositories,
    Sessions: AgentSessionRepo,
    Model: RepositoryChoiceModel,
{
    /// Build for a persisted session's trusted owner, after opening authorization.
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

    /// Keep explicit choices; otherwise choose and persist before remote work starts.
    #[tracing::instrument(
        name = "agent.repository_choice",
        skip_all,
        err,
        fields(
            agent.session.id = %self.session_id,
            agent.repository_choice.candidate_count = tracing::field::Empty,
            agent.repository_choice.recent_session_count = tracing::field::Empty,
            agent.repository_choice.outcome = tracing::field::Empty,
        )
    )]
    pub async fn choose(&self, prompt: &str) -> Result<SessionIntent, rootcause::Report> {
        // The opening service already authorized this caller-selected repository.
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
            let candidates: Vec<_> = self
                .repositories
                .for_user(&self.owner)
                .await
                .map_err(|error| {
                    rootcause::report!("could not list reachable repositories: {error}")
                })?
                .into_iter()
                .map(|repository| repository.url)
                .collect();
            had_candidates = !candidates.is_empty();
            tracing::Span::current().record(
                "agent.repository_choice.candidate_count",
                candidates.len(),
            );
            let chosen = if candidates.is_empty() {
                tracing::info!("no github app installation is reachable for this user; the session works on no repository");
                SessionIntent::default()
            } else {
                self.admission
                    .admit(&self.owner, AiFeature::AgentRepositoryChoice)
                    .await
                    .map_err(|error| rootcause::Report::new(error).into_dynamic())?;
                let recent = self.recent_sessions().await?;
                tracing::Span::current().record(
                    "agent.repository_choice.recent_session_count",
                    recent.len(),
                );
                let answer = self.model
                    .decide(&self.owner, prompt, &candidates, &recent)
                    .await?;
                intent(&candidates, answer.as_deref())?
            };
            // The egress proxy pins git traffic to this row. Write None too, so a
            // stamped default cannot survive a successful no-repository choice.
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
                Ok(chosen) if chosen.repository.is_some() => "selected",
                Ok(_) if !had_candidates => "no_candidates",
                Ok(_) => "none",
                Err(_) => "failed",
            },
        );
        result
    }

    /// Five prior sessions, excluding the placeholder being initialized.
    async fn recent_sessions(&self) -> Result<Vec<AgentSession>, rootcause::Report> {
        let recent = self
            .sessions
            .recent_for_owner(
                &self.owner,
                NonZeroUsize::new(RECENT_SESSIONS + 1).expect("a nonzero count"),
            )
            .await
            .map_err(|error| {
                rootcause::report!("could not read the owner's recent sessions: {error}")
            })?;
        Ok(recent
            .into_iter()
            .filter(|session| session.id != self.session_id)
            .take(RECENT_SESSIONS)
            .collect())
    }
}

/// Schema constraints are not authorization: also validate the model's answer.
fn intent(
    candidates: &[String],
    repository: Option<&str>,
) -> Result<SessionIntent, rootcause::Report> {
    let Some(chosen) = repository else {
        return Ok(SessionIntent::default());
    };
    if !candidates.iter().any(|candidate| candidate == chosen) {
        return Err(rootcause::report!(
            "chose {chosen}, which is not one of this user's repositories"
        ));
    }
    let repository = RepoUrl::parse(chosen)
        .ok_or_else(|| rootcause::report!("chose {chosen}, which is not a repository url"))?;
    Ok(SessionIntent {
        repository: Some(repository),
        open_pull_request: true,
    })
}
