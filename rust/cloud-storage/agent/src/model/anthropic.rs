use crate::model::types::Model;
use rig_core::{client::CompletionClient, providers::anthropic};
use std::sync::Arc;

/// A Claude model bound to the native Anthropic client that serves it.
///
/// Carries the parsed [`Model`] id and a shared client. Which provider an id
/// belongs to is decided by routing (the `anthropic/…` segment), so there is no
/// id classification here.
pub struct AnthropicModel<'a> {
    model: Model<'a>,
    client: Arc<anthropic::Client>,
}

impl<'a> AnthropicModel<'a> {
    /// Bind `model` to the client that serves it.
    pub fn new(model: Model<'a>, client: Arc<anthropic::Client>) -> Self {
        Self { model, client }
    }

    /// The rig completion model for this id. The id is passed verbatim to the
    /// Anthropic API.
    pub fn completion(&self) -> anthropic::completion::CompletionModel {
        self.client.completion_model(self.model.name().to_string())
    }

    /// Best-effort extended-thinking config for the configured model, flattened
    /// into the request body by rig, or `None` if the model doesn't support it.
    ///
    /// - Opus / Fable / Mythos / Sonnet: `adaptive` (the model chooses when to
    ///   think; avoids the `budget_tokens < max_tokens` constraint).
    /// - Haiku: no adaptive support, so `enabled` + `budget_tokens`.
    ///
    /// `temperature` is never set: it is rejected on Opus 4.7+ and constrained
    /// to 1 with extended thinking elsewhere, so we let the API default apply.
    pub fn thinking_params(&self) -> Option<serde_json::Value> {
        let model = self.model.name().to_lowercase();

        if model.contains("opus")
            || model.contains("fable")
            || model.contains("mythos")
            || model.contains("sonnet")
        {
            Some(serde_json::json!({
                "thinking": { "type": "adaptive", "display": "summarized" }
            }))
        } else if model.contains("haiku") {
            Some(serde_json::json!({
                "thinking": { "type": "enabled", "budget_tokens": 10_000 }
            }))
        } else {
            None
        }
    }
}
