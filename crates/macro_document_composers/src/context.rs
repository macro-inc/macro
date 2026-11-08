//! Native server request types reuse the shared trigger domain directly.
use macro_document_model::{DocumentContext, Result};
use serde::{Deserialize, Serialize};
/// Person the agent acts for or hears from.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentContextPerson {
    /// Stable identity, verbatim.
    pub id: String,
    /// Display name.
    pub name: String,
}
/// Source-formatted time facts supplied by the caller.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentContextCurrentTime {
    /// ISO timestamp as supplied on the wire.
    pub iso: String,
    /// Human-readable local timestamp.
    pub local: String,
    /// Timezone name, when supplied.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[serde(deserialize_with = "crate::wire::non_null_option")]
    pub time_zone: Option<String>,
}
/// Typed server prompt; legacy conversation fields are excluded by wire parsing.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentContextPrompt {
    /// Authored Markdown to sanitize and retain.
    pub prompt_markdown: String,
    /// Private instructions.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub instructions: Option<String>,
    /// Owner of the session.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub owner: Option<AgentContextPerson>,
    /// Sender when distinct from the owner.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sender: Option<AgentContextPerson>,
    /// Explicit caller time facts.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current_time: Option<AgentContextCurrentTime>,
    /// Domain context for why the agent was called.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trigger: Option<trigger_context::TriggerContext>,
}
/// Sanitize authored Markdown, then prepend the private typed trigger context.
pub fn compose_agent_context_prompt(
    input: &AgentContextPrompt,
    context: &DocumentContext,
) -> Result<String> {
    let value = serde_json::to_value(input)?;
    validate_context(&value)?;
    crate::context_wire::compose_agent_context_prompt(&value, context)
}

pub(crate) fn validate_context(value: &serde_json::Value) -> Result<()> {
    match value {
        serde_json::Value::Object(object) => {
            for (key, value) in object {
                if key == "payload" {
                    continue;
                }
                if matches!(
                    key.as_str(),
                    "id" | "entity_type"
                        | "entity_id"
                        | "event"
                        | "action"
                        | "repository"
                        | "sender"
                        | "cron"
                        | "timezone"
                        | "iso"
                        | "local"
                        | "timeZone"
                        | "sheet_id"
                        | "range"
                        | "mark_id"
                        | "anchor_id"
                        | "posted_at"
                        | "root_id"
                        | "message_id"
                        | "thread_id"
                        | "prompt_message_id"
                        | "received_at"
                        | "channel_id"
                        | "started_at"
                        | "ended_at"
                        | "at"
                        | "scheduled_for"
                        | "requested_at"
                        | "assigned_at"
                        | "discussion_id"
                        | "dispatched_at"
                        | "routine_id"
                ) && value.as_str() == Some("")
                {
                    return Err(macro_document_model::Error::InvalidArgument(
                        format!("empty context field {key}").into(),
                    ));
                }
                if matches!(
                    key.as_str(),
                    "events" | "entity_ids" | "actions" | "repositories" | "payload_match"
                ) && value
                    .as_array()
                    .is_some_and(|values| values.iter().any(|value| value.as_str() == Some("")))
                {
                    return Err(macro_document_model::Error::InvalidArgument(
                        format!("empty context list item {key}").into(),
                    ));
                }
                validate_context(value)?;
            }
        }
        serde_json::Value::Array(values) => {
            for value in values {
                validate_context(value)?;
            }
        }
        _ => {}
    }
    Ok(())
}
