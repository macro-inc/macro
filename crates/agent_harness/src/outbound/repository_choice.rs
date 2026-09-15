//! Shared Haiku decision over repository candidates supplied by each runtime.
use crate::domain::ports::RepositoryDecision;
use agent::structured_output::{DynamicSchema, dynamic_structured_completion};
use agent::{Message, PredefinedModel};
use agent_session::domain::model::AgentSession;
use macro_user_id::user_id::MacroUserIdStr;
use serde::Deserialize;
use serde_json::json;
use std::sync::Arc;

static SYSTEM_PROMPT: &str = include_str!("repository_choice_prompt.txt");

/// The model's answer.
#[derive(Debug, Deserialize)]
struct ChoiceOutput {
    repository: Option<String>,
    #[serde(rename = "reason")]
    _reason: String,
}

/// The same metered fast-model decision used for Cursor and Codex first prompts.
pub struct HaikuRepositoryDecision {
    recorder: Arc<dyn ai_usage::UsageRecorder>,
}
impl HaikuRepositoryDecision {
    /// Bind model usage to the service's shared recorder.
    pub fn new(recorder: Arc<dyn ai_usage::UsageRecorder>) -> Self {
        Self { recorder }
    }
}
#[async_trait::async_trait]
impl RepositoryDecision for HaikuRepositoryDecision {
    async fn choose(
        &self,
        owner: &MacroUserIdStr<'static>,
        prompt: &str,
        candidates: &[String],
        recent: &[AgentSession],
    ) -> Result<Option<String>, rootcause::Report> {
        if candidates.is_empty() {
            return Ok(None);
        }
        let value = dynamic_structured_completion(
            PredefinedModel::Fast,
            SYSTEM_PROMPT,
            vec![Message::user(user_message(prompt, candidates, recent))],
            choice_schema(candidates),
            self.recorder.as_ref(),
            ai_usage::UsageContext::new(ai_usage::AiFeature::AgentRepositoryChoice, owner.clone()),
        )
        .await
        .map_err(|error| rootcause::report!("repository choice completion failed: {error}"))?;
        let output: ChoiceOutput = serde_json::from_value(value)
            .map_err(|error| rootcause::report!("repository choice is not the schema: {error}"))?;
        if let Some(chosen) = &output.repository
            && !candidates.contains(chosen)
        {
            return Err(rootcause::report!(
                "repository choice was not one of the supplied candidates"
            ));
        }
        Ok(output.repository)
    }
}
/// The three sections the model reads: what it may choose from, what the user
/// has been doing, and what they just asked for.
pub(crate) fn user_message(prompt: &str, candidates: &[String], recent: &[AgentSession]) -> String {
    use std::fmt::Write as _;

    let mut message = String::from("<candidate_repositories>\n");
    for candidate in candidates {
        let _ = writeln!(message, "{candidate}");
    }
    message.push_str("</candidate_repositories>\n\n<recent_sessions>\n");
    if recent.is_empty() {
        message.push_str("none\n");
    }
    for session in recent {
        let _ = writeln!(
            message,
            "{} · {} · {}",
            session.name,
            session.repo_url.as_deref().unwrap_or("no repository"),
            session.created_at.to_rfc3339(),
        );
    }
    message.push_str("</recent_sessions>\n\n<prompt>\n");
    message.push_str(prompt);
    message.push_str("\n</prompt>");
    message
}

/// The output schema, with the candidate urls as the only allowed answers.
///
/// Constraining the enum rather than only validating afterwards: a model that
/// cannot express an invented repository mostly does not try to.
pub(crate) fn choice_schema(candidates: &[String]) -> DynamicSchema {
    let mut allowed: Vec<serde_json::Value> = candidates
        .iter()
        .map(|candidate| json!(candidate))
        .collect();
    allowed.push(serde_json::Value::Null);
    DynamicSchema {
        name: "RepositoryChoice".to_owned(),
        description: Some(
            "The repository a coding-agent session's first prompt belongs to, if any.".to_owned(),
        ),
        schema: json!({
            "type": "object",
            "additionalProperties": false,
            "required": ["repository", "reason"],
            "properties": {
                "repository": {
                    "type": ["string", "null"],
                    "enum": allowed,
                    "description": "One of the candidate repository urls, or null when none clearly fits."
                },
                "reason": {
                    "type": "string",
                    "description": "A concise reason for the choice."
                }
            }
        }),
    }
}
