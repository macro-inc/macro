use super::Model;
use crate::error::AgentError;
use regex::Regex;
use rig_core::{client::CompletionClient, providers::anthropic};
use std::sync::{Arc, LazyLock};

/// Matches the Anthropic model namespace.
///
/// The frontend is authoritative over model selection, so we only need to
/// decide which *provider* an id belongs to — not validate the exact id (the
/// string is passed through to the API verbatim). Every Claude id is
/// `claude-<family>-<version>` (`claude-opus-4-8`, `claude-sonnet-4-6`,
/// `claude-haiku-4-5`, `claude-fable-5`, …), so a single prefix covers the
/// whole provider.
static ANTHROPIC_MODEL_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^claude-").expect("Anthropic model regex is valid"));

/// Whether `model` names a known Anthropic model.
pub(crate) fn is_anthropic_model(model: &str) -> bool {
    ANTHROPIC_MODEL_RE.is_match(model)
}

/// An api id validated as belonging to the Anthropic namespace.
///
/// The only constructor is [`TryFrom<String>`], which checks the id against
/// [`is_anthropic_model`]. An `AnthropicModelId` therefore always names an
/// Anthropic model, so routing one is infallible.
#[derive(Debug, Clone)]
pub struct AnthropicModelId(String);

impl AnthropicModelId {
    /// The underlying api id, passed verbatim to the Anthropic API.
    pub(crate) fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for AnthropicModelId {
    type Error = AgentError;

    fn try_from(model: String) -> Result<Self, Self::Error> {
        if is_anthropic_model(&model) {
            Ok(Self(model))
        } else {
            Err(AgentError::UnknownModel(model))
        }
    }
}

pub struct AnthropicModel {
    client: Arc<anthropic::Client>,
    model: AnthropicModelId,
}

impl AnthropicModel {
    /// Build a model bound to `model` served by `client`.
    ///
    /// Validation happens when the [`AnthropicModelId`] is constructed; the id
    /// is passed through verbatim to the Anthropic API.
    pub(super) fn new(client: Arc<anthropic::Client>, model: AnthropicModelId) -> Self {
        Self { client, model }
    }
}

impl Model for AnthropicModel {
    type Completion = anthropic::completion::CompletionModel;

    fn completion(&self) -> Self::Completion {
        self.client
            .completion_model(self.model.as_str().to_string())
    }

    /// Best-effort extended-thinking config for the configured model.
    ///
    /// Returned JSON is flattened into the request body by rig, so the
    /// top-level keys here (`thinking`) become top-level request fields.
    ///
    /// The shape is chosen per model family so it never produces a config
    /// that 400s for that model:
    /// - Opus / Fable / Mythos: adaptive thinking only (`enabled` +
    ///   `budget_tokens` is rejected on Opus 4.7+). `display` is valid here.
    /// - Sonnet (4.6): adaptive is supported and avoids the
    ///   `budget_tokens < max_tokens` constraint.
    /// - Haiku (4.5): no adaptive support; use `enabled` + `budget_tokens`.
    ///   `display` is omitted — it postdates Haiku 4.5's thinking surface and
    ///   would risk a 400.
    ///
    /// Crucially we never set `temperature`: it is removed on Opus 4.7+ (400)
    /// and constrained to 1 with extended thinking elsewhere, so we leave it
    /// unset and let the API default apply.
    ///
    /// Any model we don't recognize as thinking-capable returns `None`.
    fn thinking_params(&self) -> Option<serde_json::Value> {
        let model = self.model.as_str().to_lowercase();

        // Opus / Fable / Mythos and Sonnet all take the same adaptive config
        // (Sonnet supports adaptive and so avoids the `budget_tokens < max_tokens`
        // constraint); only Haiku needs the explicit `enabled` + `budget_tokens`.
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
