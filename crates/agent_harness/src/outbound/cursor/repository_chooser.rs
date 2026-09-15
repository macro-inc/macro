//! Deciding which repository a Cursor session's first prompt belongs to.
//!
//! A hosted session has no checkout to read a remote from: it is opened from a
//! chat message, and the only evidence for where its work belongs is the prompt
//! itself, the repositories its owner can reach through Macro's GitHub App, and
//! what that person has been working on lately. So a fast model reads the three
//! together and picks one candidate, or none.
//!
//! Picking none is a real answer, not a failure. A question, an investigation,
//! or a prompt that fits three repositories equally well is better served by a
//! session with no repository - which still runs - than by one minted against a
//! guess, because Cursor fixes an agent's repository at creation and would open
//! its pull request in the wrong place.
//!
//! The choice is written back to the session row before the agent is minted:
//! the egress proxy pins the sandbox's git traffic to that column, so a
//! repository the row does not name is a repository the session cannot reach.

use std::num::NonZeroUsize;
use std::sync::Arc;

use agent_session::domain::model::{AgentSession, AgentSessionId};
use agent_session::domain::ports::AgentSessionRepo;
use cursor_cloud_agents::domain::model::RepoUrl;
use cursor_cloud_agents::domain::ports::{RepositoryChooser, SessionIntent};
use macro_user_id::user_id::MacroUserIdStr;

use crate::domain::ports::{ReachableRepositories, RepositoryDecision};
use crate::outbound::repository_choice::HaikuRepositoryDecision;
#[cfg(test)]
use crate::outbound::repository_choice::{choice_schema, user_message};

#[cfg(test)]
mod test;

/// How many of the owner's recent sessions the prompt describes.
///
/// Enough to show what someone is in the middle of, few enough that a single
/// stale session cannot outvote the prompt itself.
const RECENT_SESSIONS: usize = 5;

/// A [`RepositoryChooser`] that reads the prompt with the fast model.
pub struct HaikuRepositoryChooser<Repositories, Sessions> {
    repositories: Arc<Repositories>,
    sessions: Sessions,
    decision: HaikuRepositoryDecision,
    owner: MacroUserIdStr<'static>,
    session_id: AgentSessionId,
}

impl<Repositories, Sessions> HaikuRepositoryChooser<Repositories, Sessions>
where
    Repositories: ReachableRepositories,
    Sessions: AgentSessionRepo,
{
    /// Build a chooser for one session, on behalf of its owner.
    pub fn new(
        repositories: Arc<Repositories>,
        sessions: Sessions,
        recorder: Arc<dyn ai_usage::UsageRecorder>,
        owner: MacroUserIdStr<'static>,
        session_id: AgentSessionId,
    ) -> Self {
        Self {
            repositories,
            sessions,
            decision: HaikuRepositoryDecision::new(recorder),
            owner,
            session_id,
        }
    }

    /// Repositories this owner can reach through Macro's GitHub App.
    #[tracing::instrument(
        name = "agent.repository_choice.reachable_repositories",
        skip_all,
        err,
        fields(agent.session.id = %self.session_id)
    )]
    async fn reachable_repositories(&self) -> Result<Vec<String>, rootcause::Report> {
        self.repositories
            .for_user(&self.owner)
            .await
            .map_err(|error| rootcause::report!("could not list reachable repositories: {error}"))
    }

    /// The five prior sessions, excluding the placeholder being initialized.
    #[tracing::instrument(
        name = "agent.repository_choice.recent_sessions",
        skip_all,
        err,
        fields(agent.session.id = %self.session_id)
    )]
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

    /// Ask the model, and hold it to the candidate list.
    #[tracing::instrument(
        name = "agent.repository_choice.decide",
        skip_all,
        err,
        fields(
            agent.session.id = %self.session_id,
            agent.repository_choice.candidate_count = candidates.len(),
            agent.repository_choice.recent_session_count = recent.len(),
        )
    )]
    async fn decide(
        &self,
        prompt: &str,
        candidates: &[String],
        recent: &[AgentSession],
    ) -> Result<SessionIntent, rootcause::Report> {
        let selected = self
            .decision
            .choose(&self.owner, prompt, candidates, recent)
            .await?;
        intent(candidates, selected.as_deref())
    }
}

impl<Repositories, Sessions> RepositoryChooser for HaikuRepositoryChooser<Repositories, Sessions>
where
    Repositories: ReachableRepositories,
    Sessions: AgentSessionRepo,
{
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
    async fn choose(
        &self,
        prompt: &str,
        _cwd: &std::path::Path,
    ) -> Result<SessionIntent, rootcause::Report> {
        let mut had_candidates = false;
        let result = async {
            let candidates = self.reachable_repositories().await?;
            had_candidates = !candidates.is_empty();
            tracing::Span::current().record(
                "agent.repository_choice.candidate_count",
                candidates.len(),
            );

            let chosen = if candidates.is_empty() {
                // Nothing to choose between, and nothing a model could add. The
                // session still runs; it just works on no repository.
                tracing::info!(
                    "no github app installation is reachable for this user; the session works on no repository"
                );
                SessionIntent::default()
            } else {
                let recent = self.recent_sessions().await?;
                tracing::Span::current().record(
                    "agent.repository_choice.recent_session_count",
                    recent.len(),
                );
                self.decide(prompt, &candidates, &recent).await?
            };

            // Before the agent is minted, because the row is what the egress proxy
            // pins git traffic to - and `None` is written too, so a session that
            // chose nothing cannot reach whatever the row was stamped with at open.
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
}

/// Turn an answer into an intent, refusing anything that is not a candidate.
///
/// The schema already says which urls are allowed, so a miss here is a model
/// that ignored it - which is exactly the case where trusting the answer would
/// point the session at a repository nobody offered it.
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
