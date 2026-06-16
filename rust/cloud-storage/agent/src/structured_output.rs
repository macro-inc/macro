/// Structured output via prompted JSON generation.
use anyhow::Context;
use rig_core::message::Message;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// Schema definition for dynamic structured completions.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct DynamicSchema {
    /// The JSON schema to validate against.
    pub schema: serde_json::Value,
    /// Name of the schema.
    pub name: String,
    /// Optional description of what the schema represents.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

/// Run a completion with conversation history and return a JSON value
/// conforming to `schema`.
#[tracing::instrument(skip(model, system_prompt, messages, schema), err)]
pub async fn dynamic_structured_completion<M: ToString>(
    model: M,
    system_prompt: &str,
    messages: Vec<Message>,
    schema: DynamicSchema,
) -> anyhow::Result<serde_json::Value> {
    let structured_prompt = format!(
        "{system_prompt}\n\n\
         You MUST respond with ONLY a valid JSON object matching this schema.\n\
         Schema name: {name}\n\
         {desc}\
         Schema:\n```json\n{schema_json}\n```\n\
         Respond with ONLY the raw JSON object. No markdown fences, no explanation.",
        name = schema.name,
        desc = schema
            .description
            .as_deref()
            .map(|d| format!("{d}\n"))
            .unwrap_or_default(),
        schema_json = serde_json::to_string_pretty(&schema.schema)?,
    );

    let response =
        crate::completion::complete_with_history(model, &structured_prompt, messages).await?;

    let trimmed = response.trim();
    let json_str = if let Some(rest) = trimmed.strip_prefix("```") {
        let inner = rest.strip_prefix("json").unwrap_or(rest);
        inner.strip_suffix("```").unwrap_or(inner).trim()
    } else {
        trimmed
    };

    serde_json::from_str(json_str).context("Failed to parse structured output as JSON")
}
