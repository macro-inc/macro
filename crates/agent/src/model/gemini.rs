use crate::model::types::Model;
use rig_core::{client::CompletionClient, providers::gemini};
use std::sync::Arc;

/// A Gemini model bound to the native GenerateContent client that serves it.
///
/// Gemini 3 requires `thought_signature` on function-call parts of the current
/// turn. The OpenAI-compatible Chat Completions adapter drops that field, so
/// Google ids route here rather than through
/// [`super::openai::OpenAiChatCompletionsModel`].
pub struct GeminiModel<'a> {
    model: Model<'a>,
    client: Arc<gemini::Client>,
}

impl<'a> GeminiModel<'a> {
    /// Bind `model` to the client that serves it.
    pub fn new(model: Model<'a>, client: Arc<gemini::Client>) -> Self {
        Self { model, client }
    }

    /// The routed id this model was bound to.
    pub fn model(&self) -> &Model<'a> {
        &self.model
    }

    /// The rig completion model for this id. The id is passed verbatim to the
    /// Gemini API.
    pub fn completion(&self) -> gemini::completion::CompletionModel {
        self.client.completion_model(self.model.name().to_string())
    }

    /// Ask Gemini to include thought summaries so reasoning deltas reach the
    /// stream. Thinking itself is on by default for Gemini 3; this only asks
    /// for the summarized thoughts, not a thinking-level override.
    pub fn thinking_params(&self) -> Option<serde_json::Value> {
        Some(serde_json::json!({
            "generation_config": {
                "thinking_config": {
                    "include_thoughts": true
                }
            }
        }))
    }
}

#[cfg(test)]
mod test;
