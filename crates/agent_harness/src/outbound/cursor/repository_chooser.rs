//! Fast-model implementation of the repository-choice capability.

use std::sync::Arc;

use agent::structured_output::{DynamicSchema, dynamic_structured_completion};
use agent::{Message, PredefinedModel};
use agent_session::domain::model::AgentSession;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use serde::Deserialize;
use serde_json::json;

use crate::domain::repository_choice::{RECENT_SESSIONS, RepositoryChoiceModel};

#[cfg(test)]
mod test;

static SYSTEM_PROMPT: &str = include_str!("repository_chooser/system_prompt.md");

/// Reads the prompt with the fast model after the domain service admits the work.
pub struct HaikuRepositoryChooser {
    recorder: Arc<dyn ai_usage::UsageRecorder>,
}

/// The model's answer.
#[derive(Debug, Deserialize)]
struct ChoiceOutput {
    repository: String,
    #[serde(rename = "reason")]
    _reason: String,
}

impl HaikuRepositoryChooser {
    /// Build a model capability with usage recording.
    pub fn new(recorder: Arc<dyn ai_usage::UsageRecorder>) -> Self {
        Self { recorder }
    }
}

impl RepositoryChoiceModel for HaikuRepositoryChooser {
    #[tracing::instrument(
        name = "agent.repository_choice.decide",
        skip_all,
        err,
        fields(
            agent.repository_choice.candidate_count = candidates.len(),
            agent.repository_choice.recent_session_count = recent.len(),
        )
    )]
    async fn decide(
        &self,
        owner: &MacroUserIdStr<'_>,
        prompt: &str,
        candidates: &[String],
        recent: &[AgentSession],
        fallback: &str,
    ) -> Result<String, rootcause::Report> {
        let value = dynamic_structured_completion(
            PredefinedModel::Fast,
            SYSTEM_PROMPT,
            vec![Message::user(user_message(
                prompt, candidates, recent, fallback,
            ))],
            choice_schema(candidates),
            self.recorder.as_ref(),
            ai_usage::UsageContext::new(
                ai_usage::AiFeature::AgentRepositoryChoice,
                owner.clone().into_owned(),
            ),
        )
        .await
        .map_err(|error| rootcause::report!("repository choice completion failed: {error}"))?;

        let output: ChoiceOutput = serde_json::from_value(value)
            .map_err(|error| rootcause::report!("repository choice is not the schema: {error}"))?;
        Ok(output.repository)
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

/// Constrain the model to authorized candidates rather than only validating afterwards.
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
