use crate::model::types::Model;
use rig_core::{client::CompletionClient, http_client::HttpClientExt, providers::gemini};
use std::sync::Arc;

/// A Gemini model bound to the native GenerateContent client that serves it.
///
/// Gemini 3 requires `thought_signature` on function-call parts of the current
/// turn. The OpenAI-compatible Chat Completions adapter drops that field, so
/// Google ids route here rather than through
/// [`super::openai::OpenAiChatCompletionsModel`].
pub struct GeminiModel<'a, H = rig_core::http_client::ReqwestClient> {
    model: Model<'a>,
    client: Arc<gemini::Client<H>>,
}

impl<'a, H: HttpClientExt + Clone + 'static> GeminiModel<'a, H> {
    /// Bind `model` to the client that serves it.
    pub fn new(model: Model<'a>, client: Arc<gemini::Client<H>>) -> Self {
        Self { model, client }
    }

    /// The routed id this model was bound to.
    pub fn model(&self) -> &Model<'a> {
        &self.model
    }

    /// The rig completion model for this id. The id is passed verbatim to the
    /// Gemini API.
    pub fn completion(&self) -> gemini::completion::CompletionModel<H> {
        self.client.completion_model(self.model.name().to_string())
    }

    /// Ask Gemini to include thought summaries so reasoning deltas reach the
    /// stream. Thinking itself is on by default for Gemini 3; this only asks
    /// for the summarized thoughts, not a thinking-level override.
    ///
    /// Keys are the camelCase names rig deserializes into
    /// `AdditionalParameters`. A snake_case `generation_config` is not that
    /// field: it is left on the body as an unknown key, and rig then skips
    /// `maxOutputTokens` because it only copies `max_tokens` when
    /// `generationConfig` parsed. The request goes out with thinking on, no
    /// output cap, and no streamed thoughts, so the turn sits silent until
    /// the idle timeout.
    pub fn thinking_params(&self) -> Option<serde_json::Value> {
        Some(serde_json::json!({
            "generationConfig": {
                "thinkingConfig": {
                    "includeThoughts": true
                }
            }
        }))
    }
}

#[cfg(test)]
mod test;
