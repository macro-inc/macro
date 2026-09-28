//! Deciding which repository a Cursor session's first prompt belongs to.
//!
//! A hosted session has no checkout to read a remote from: it is opened from a
//! chat message, and the only evidence for where its work belongs is the prompt
//! itself, the repositories its owner can reach through Macro's GitHub App, and
//! what that person has been working on lately. So a fast model reads the three
//! together and picks one candidate.
//!
//! Every hosted coding session needs a repository. Ambiguous prompts fall back
//! to the owner's most recent accessible repository, or the first candidate
//! when there is no accessible repository in their history.
//!
//! The choice is written back to the session row before the agent is minted:
//! the egress proxy pins the sandbox's git traffic to that column, so a
//! repository the row does not name is a repository the session cannot reach.

use std::num::NonZeroUsize;
use std::sync::Arc;

use agent::structured_output::{DynamicSchema, dynamic_structured_completion};
use agent::{Message, PredefinedModel};
use agent_session::domain::model::{AgentSession, AgentSessionId};
use agent_session::domain::ports::AgentSessionRepo;
use cursor_cloud_agents::domain::model::RepoUrl;
use cursor_cloud_agents::domain::ports::{RepositoryChooser, SessionIntent};
use macro_user_id::user_id::MacroUserIdStr;
use serde::Deserialize;
use serde_json::json;

use crate::domain::ports::ReachableRepositories;
use crate::domain::repository_selection::{fallback_repository, intent, recent_repository};

#[cfg(test)]
mod test;

/// How many of the owner's recent sessions the prompt describes.
///
/// Enough to show what someone is in the middle of, few enough that a single
/// stale session cannot outvote the prompt itself.
const RECENT_SESSIONS: usize = 5;

static SYSTEM_PROMPT: &str = include_str!("repository_chooser/system_prompt.md");

/// A [`RepositoryChooser`] that reads the prompt with the fast model.
pub struct HaikuRepositoryChooser<Repositories, Sessions> {
    repositories: Arc<Repositories>,
    sessions: Sessions,
    recorder: Arc<dyn ai_usage::UsageRecorder>,
    owner: MacroUserIdStr<'static>,
    session_id: AgentSessionId,
    model: PredefinedModel,
}

/// The model's answer.
#[derive(Debug, Deserialize)]
struct ChoiceOutput {
    repository: String,
    #[serde(rename = "reason")]
    _reason: String,
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
            recorder,
            owner,
            session_id,
            model: PredefinedModel::Fast,
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
        // The model chooses between urls: they are what the session row is
        // pinned to, and a candidate's default branch is no help in deciding
        // which repository a prompt belongs to.
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
            // Look past recent chat-only sessions for the last accessible repo.
            limit = limit.checked_mul(2).ok_or_else(|| {
                rootcause::report!("too many sessions to find a recent repository")
            })?;
        }
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
        let fallback = fallback_repository(candidates, recent)?;
        let value = dynamic_structured_completion(
            self.model,
            SYSTEM_PROMPT,
            vec![Message::user(user_message(
                prompt, candidates, recent, fallback,
            ))],
            choice_schema(candidates),
            self.recorder.as_ref(),
            ai_usage::UsageContext::new(
                ai_usage::AiFeature::AgentRepositoryChoice,
                self.owner.clone(),
            ),
        )
        .await
        .map_err(|error| rootcause::report!("repository choice completion failed: {error}"))?;

        let output: ChoiceOutput = serde_json::from_value(value)
            .map_err(|error| rootcause::report!("repository choice is not the schema: {error}"))?;
        intent(candidates, &output.repository)
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
        // A caller-selected repository was authorized by the opening service.
        // Keep that choice on retries and resumes instead of asking a model to replace it.
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
                let recent = self.recent_sessions(&candidates).await?;
                tracing::Span::current()
                    .record("agent.repository_choice.recent_session_count", recent.len());
                self.decide(prompt, &candidates, &recent).await?
            };

            // Before the agent is minted, because the row is what the egress proxy
            // pins git traffic to.
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

/// The candidates, recent context, deterministic fallback, and current prompt.
fn user_message(
    prompt: &str,
    candidates: &[String],
    recent: &[AgentSession],
    fallback: &str,
) -> String {
    use std::fmt::Write as _;

    let mut message = String::from("<candidate_repositories>\n");
    for candidate in candidates {
        let _ = writeln!(message, "{candidate}");
    }
    message.push_str("</candidate_repositories>\n\n<recent_sessions>\n");
    if recent.is_empty() {
        message.push_str("none\n");
    }
    for session in recent.iter().take(RECENT_SESSIONS) {
        let _ = writeln!(
            message,
            "{} · {} · {}",
            session.name,
            session.repo_url.as_deref().unwrap_or("no repository"),
            session.created_at.to_rfc3339(),
        );
    }
    message.push_str("</recent_sessions>\n\n<fallback_repository>\n");
    message.push_str(fallback);
    message.push_str("\n</fallback_repository>\n\n<prompt>\n");
    message.push_str(prompt);
    message.push_str("\n</prompt>");
    message
}

/// The output schema, with the candidate urls as the only allowed answers.
///
/// Constraining the enum rather than only validating afterwards: a model that
/// cannot express an invented repository mostly does not try to.
fn choice_schema(candidates: &[String]) -> DynamicSchema {
    let allowed: Vec<serde_json::Value> = candidates
        .iter()
        .map(|candidate| json!(candidate))
        .collect();
    DynamicSchema {
        name: "RepositoryChoice".to_owned(),
        description: Some(
            "The repository a coding-agent session's first prompt belongs to.".to_owned(),
        ),
        schema: json!({
            "type": "object",
            "additionalProperties": false,
            "required": ["repository", "reason"],
            "properties": {
                "repository": {
                    "type": "string",
                    "enum": allowed,
                    "description": "One of the candidate repository urls. Use the fallback repository when none clearly fits."
                },
                "reason": {
                    "type": "string",
                    "description": "A concise reason for the choice."
                }
            }
        }),
    }
}
