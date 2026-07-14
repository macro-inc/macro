use std::sync::Arc;

use crate::model::types::Model;
use rig_core::{client::CompletionClient, providers::openai};

/// A model served over the OpenAI-compatible **Chat Completions** API.
///
/// OpenAI-compatible providers differ only by the
/// [`CompletionsClient`](openai::CompletionsClient)'s base URL and key, never
/// by Rust type, so routing can hold any number of them without new variants.
/// Which provider serves an id is decided by routing (the `provider/…`
/// segment), so there is no id classification here.
pub struct OpenAiChatCompletionsModel<'a> {
    model: Model<'a>,
    client: Arc<openai::CompletionsClient>,
}

impl<'a> OpenAiChatCompletionsModel<'a> {
    /// Bind `model` to the client that serves it.
    pub fn new(model: Model<'a>, client: Arc<openai::CompletionsClient>) -> Self {
        Self { model, client }
    }

    /// The rig completion model for this id.
    ///
    /// Unlike the Responses API, the Chat Completions API does not coerce tools
    /// into a strict subset, so tools are already sent verbatim.
    pub fn completion(&self) -> openai::completion::CompletionModel {
        self.client.completion_model(self.model.name().to_string())
    }

    /// Best-effort reasoning config, flattened into the request by rig, or
    /// `None` if the model doesn't support it.
    ///
    /// The Chat Completions API takes a flat `reasoning_effort` field, accepted
    /// only by reasoning models (the GPT-5 family and the `o`-series); anything
    /// else returns `None`, since sending it elsewhere 400s. `mini` / `nano`
    /// variants get a lower effort. `temperature` is never set (reasoning models
    /// reject it).
    pub fn thinking_params(&self) -> Option<serde_json::Value> {
        let model = self.model.name().to_lowercase();

        let is_reasoning = model.contains("gpt-5")
            || model.starts_with("o1")
            || model.starts_with("o3")
            || model.starts_with("o4");
        if !is_reasoning {
            return None;
        }

        let effort = if model.contains("mini") || model.contains("nano") {
            "low"
        } else {
            "high"
        };

        Some(serde_json::json!({ "reasoning_effort": effort }))
    }
}

/// A model served over OpenAI's **Responses** API.
///
/// This is intentionally separate from OpenAI-compatible Chat Completions:
/// OpenAI GPT reasoning models expect Responses-shaped request fields, while
/// many compatible OSS endpoints only promise `/v1/chat/completions`.
pub struct OpenAiResponsesModel<'a> {
    model: Model<'a>,
    client: Arc<openai::Client>,
}

impl<'a> OpenAiResponsesModel<'a> {
    /// Bind `model` to the Responses API client that serves it.
    pub fn new(model: Model<'a>, client: Arc<openai::Client>) -> Self {
        Self { model, client }
    }

    /// The rig Responses API completion model for this id.
    ///
    /// Rig maps the generic `max_tokens` agent setting to the Responses API's
    /// `max_output_tokens`, avoiding the Chat Completions `max_tokens` 400s on
    /// GPT reasoning models. Tools are sent verbatim (`with_non_strict_tools`)
    /// rather than coerced into OpenAI's strict subset.
    pub fn completion(&self) -> openai::responses_api::ResponsesCompletionModel {
        self.client
            .completion_model(self.model.name().to_string())
            .with_non_strict_tools()
    }

    /// Best-effort reasoning config for OpenAI Responses models, or `None` if
    /// the model doesn't support it.
    pub fn thinking_params(&self) -> Option<serde_json::Value> {
        let model = self.model.name().to_lowercase();

        let is_reasoning = model.contains("gpt-5")
            || model.starts_with("o1")
            || model.starts_with("o3")
            || model.starts_with("o4");
        if !is_reasoning {
            return None;
        }

        let effort = if model.contains("mini") || model.contains("nano") {
            "low"
        } else {
            "high"
        };

        Some(serde_json::json!({
            "reasoning": {
                "effort": effort,
                "summary": "auto"
            }
        }))
    }
}
