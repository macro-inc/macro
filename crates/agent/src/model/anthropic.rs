use crate::model::ReasoningEffort;
use crate::model::types::Model;
use rig_core::{client::CompletionClient, http_client::HttpClientExt, providers::anthropic};
use std::sync::Arc;

/// A Claude model bound to the native Anthropic client that serves it.
///
/// Carries the parsed [`Model`] id and a shared client. Which provider an id
/// belongs to is decided by routing (the `anthropic/…` segment), so there is no
/// id classification here.
pub struct AnthropicModel<'a, H = rig_core::http_client::ReqwestClient> {
    model: Model<'a>,
    client: Arc<anthropic::Client<H>>,
}

impl<'a, H: HttpClientExt + Clone + Default + 'static> AnthropicModel<'a, H> {
    /// Bind `model` to the client that serves it.
    pub fn new(model: Model<'a>, client: Arc<anthropic::Client<H>>) -> Self {
        Self { model, client }
    }

    /// The routed id this model was bound to.
    pub fn model(&self) -> &Model<'a> {
        &self.model
    }

    /// The rig completion model for this id. The id is passed verbatim to the
    /// Anthropic API.
    ///
    /// Caching uses three 5-minute breakpoints. The last tool and the system
    /// prompt are fixed per agent, so sessions share them. The top-level
    /// automatic marker follows the conversation tail from one turn to the next.
    pub fn completion(&self) -> anthropic::completion::CompletionModel<H> {
        self.client
            .completion_model(self.model.name().to_string())
            .with_prompt_caching()
            .with_automatic_caching()
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
    pub fn thinking_params(
        &self,
        reasoning_effort: Option<ReasoningEffort>,
    ) -> Option<serde_json::Value> {
        let model = self.model.name().to_lowercase();

        let mut params = if model.contains("opus")
            || model.contains("fable")
            || model.contains("mythos")
            || model.contains("sonnet")
        {
            serde_json::json!({
                "thinking": { "type": "adaptive", "display": "summarized" }
            })
        } else if model.contains("haiku") {
            serde_json::json!({
                "thinking": { "type": "enabled", "budget_tokens": 10_000 }
            })
        } else {
            serde_json::json!({})
        };

        if let Some(effort) =
            reasoning_effort.and_then(|effort| effort.explicit_for(&self.model.to_string()))
        {
            params["output_config"] = serde_json::json!({ "effort": effort.as_str() });
        }

        params
            .as_object()
            .is_some_and(|params| !params.is_empty())
            .then_some(params)
    }
}

#[cfg(test)]
mod test;
