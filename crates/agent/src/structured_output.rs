//! Structured output via prompted JSON generation and offline schema validation.
use anyhow::Context;
use rig_core::message::Message;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::model::router::{ModelRouter, RoutedModel};

#[cfg(test)]
mod test;

const MAX_SCHEMA_BYTES: usize = 64 * 1024;

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

/// Preflight a dynamic schema without network or filesystem reference retrieval.
/// Local `$defs`/`$ref` references are supported. Call before beginning paid work
/// when an API needs to reject an invalid schema as a client error.
pub fn validate_schema(schema: &DynamicSchema) -> anyhow::Result<jsonschema::Validator> {
    anyhow::ensure!(
        serde_json::to_vec(&schema.schema)?.len() <= MAX_SCHEMA_BYTES,
        "output schema must fit in 64 KiB"
    );
    jsonschema::options()
        .offline()
        .should_validate_formats(true)
        .build(&schema.schema)
        .map_err(|_| {
            anyhow::anyhow!(
                "output schema is invalid or requires an unavailable external reference"
            )
        })
}

/// How much a model may think before it gives a structured answer.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum CompletionThinking {
    /// The model's own default.
    #[default]
    Default,
    /// Briefly, for a faster answer: Gemini 3 models think at their low
    /// level, which can take a structured answer from minutes to seconds.
    /// Other providers keep their defaults.
    Low,
}

impl CompletionThinking {
    /// The provider parameters that ask `model` to think this way, if any.
    fn params(self, model: &str) -> Option<serde_json::Value> {
        match self {
            Self::Default => None,
            Self::Low => self.params_for(&ModelRouter::shared().ok()?.route_or_default(model)),
        }
    }

    pub(crate) fn params_for<H>(self, routed: &RoutedModel<'_, H>) -> Option<serde_json::Value> {
        match (self, routed) {
            (Self::Low, RoutedModel::Gemini(_)) => Some(serde_json::json!({
                "generationConfig": { "thinkingConfig": { "thinkingLevel": "low" } }
            })),
            (Self::Default, _)
            | (
                Self::Low,
                RoutedModel::Anthropic(_)
                | RoutedModel::OpenAiChatCompletions(_)
                | RoutedModel::OpenAiResponses(_),
            ) => None,
        }
    }
}

/// Run a completion with conversation history and return a JSON value
/// conforming to `schema`.
#[tracing::instrument(skip(model, system_prompt, messages, schema, recorder, ctx), err)]
pub async fn dynamic_structured_completion<M: ToString>(
    model: M,
    system_prompt: &str,
    messages: Vec<Message>,
    schema: DynamicSchema,
    recorder: &dyn ai_usage::UsageRecorder,
    ctx: ai_usage::UsageContext,
) -> anyhow::Result<serde_json::Value> {
    dynamic_structured_completion_thinking(
        model,
        system_prompt,
        messages,
        schema,
        CompletionThinking::Default,
        recorder,
        ctx,
    )
    .await
}

/// [`dynamic_structured_completion`], letting the model think as `thinking` says.
#[tracing::instrument(
    skip(model, system_prompt, messages, schema, recorder, ctx),
    fields(gen_ai.request.thinking = ?thinking),
    err
)]
pub async fn dynamic_structured_completion_thinking<M: ToString>(
    model: M,
    system_prompt: &str,
    messages: Vec<Message>,
    schema: DynamicSchema,
    thinking: CompletionThinking,
    recorder: &dyn ai_usage::UsageRecorder,
    ctx: ai_usage::UsageContext,
) -> anyhow::Result<serde_json::Value> {
    let model = model.to_string();
    let validator = validate_schema(&schema)?;
    let structured_prompt = format!(
        "{system_prompt}\n\n\
         You MUST respond with ONLY a valid JSON value matching this schema.\n\
         Schema name: {name}\n\
         {desc}\
         Schema:\n```json\n{schema_json}\n```\n\
         Respond with ONLY the raw JSON value. No markdown fences, no explanation.",
        name = schema.name,
        desc = schema
            .description
            .as_deref()
            .map(|d| format!("{d}\n"))
            .unwrap_or_default(),
        schema_json = serde_json::to_string_pretty(&schema.schema)?,
    );

    let params = thinking.params(&model);
    let response = crate::completion::complete_with_history_and_params(
        model,
        &structured_prompt,
        messages,
        params,
        recorder,
        ctx,
    )
    .await?;

    parse_and_validate(&response, &validator)
}

fn parse_and_validate(
    response: &str,
    validator: &jsonschema::Validator,
) -> anyhow::Result<serde_json::Value> {
    let trimmed = response.trim();
    let json_str = if let Some(rest) = trimmed.strip_prefix("```") {
        let inner = rest.strip_prefix("json").unwrap_or(rest);
        inner.strip_suffix("```").unwrap_or(inner).trim()
    } else {
        trimmed
    };

    let value =
        serde_json::from_str(json_str).context("Failed to parse structured output as JSON")?;
    validator.validate(&value).map_err(|error| {
        anyhow::anyhow!(
            "structured output does not match the output schema at {}",
            error.instance_path()
        )
    })?;
    Ok(value)
}
