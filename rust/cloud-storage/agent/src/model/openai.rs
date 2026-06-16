use super::Model;
use crate::error::AgentError;
use regex::Regex;
use rig_core::{client::CompletionClient, providers::openai};
use std::sync::{Arc, LazyLock};

/// Matches the OpenAI model namespace.
///
/// The frontend is authoritative over model selection, so we only need to
/// decide which *provider* an id belongs to — not validate the exact id (the
/// string is passed through to the API verbatim). Every OpenAI id falls under
/// one of these prefixes:
///
/// - `gpt-…`      — `gpt-5*`, `gpt-4o`, `gpt-4.1`, `gpt-3.5-turbo`, …
/// - `o[1-9]…`    — `o1`, `o3-mini`, `o4-mini`, `o3-pro`, …
/// - `chatgpt-…`  — `chatgpt-4o-latest`
/// - `chat-latest`
///
/// Anthropic ids (`claude-*`) never match.
static OPENAI_MODEL_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^(?:gpt-|o[1-9]|chatgpt-|chat-latest)").expect("OpenAI model regex is valid")
});

/// Whether `model` names a known OpenAI model.
pub(crate) fn is_openai_model(model: &str) -> bool {
    OPENAI_MODEL_RE.is_match(model)
}

/// An api id validated as belonging to the OpenAI namespace.
///
/// The only constructor is [`TryFrom<String>`], which checks the id against
/// [`is_openai_model`]. An `OpenAiModelId` therefore always names an OpenAI
/// model, so routing one is infallible.
#[derive(Debug, Clone)]
pub struct OpenAiModelId(String);

impl OpenAiModelId {
    /// The underlying api id, passed verbatim to the OpenAI API.
    pub(crate) fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for OpenAiModelId {
    type Error = AgentError;

    fn try_from(model: String) -> Result<Self, Self::Error> {
        if is_openai_model(&model) {
            Ok(Self(model))
        } else {
            Err(AgentError::UnknownModel(model))
        }
    }
}

pub struct OpenAiModel {
    client: Arc<openai::Client>,
    model: OpenAiModelId,
}

impl OpenAiModel {
    /// Build a model bound to `model` served by `client`.
    ///
    /// Validation happens when the [`OpenAiModelId`] is constructed; the id is
    /// passed through verbatim to the OpenAI API.
    pub(super) fn new(client: Arc<openai::Client>, model: OpenAiModelId) -> Self {
        Self { client, model }
    }
}

impl Model for OpenAiModel {
    type Completion = openai::responses_api::ResponsesCompletionModel;

    /// Tools are sent verbatim (`with_non_strict_tools`) rather than coerced
    /// into OpenAI's strict subset, which would silently force every optional
    /// tool parameter to `required`.
    fn completion(&self) -> Self::Completion {
        self.client
            .completion_model(self.model.as_str().to_string())
            .with_non_strict_tools()
    }

    /// Best-effort reasoning config for the configured model.
    ///
    /// Returned JSON is flattened into the Responses API request by rig and
    /// parsed into its `reasoning` parameter (`effort` + `summary`).
    ///
    /// Reasoning is only valid on reasoning models — the GPT-5 family — so
    /// anything else returns `None` (sending `reasoning` to a non-reasoning
    /// model 400s). Within the family, the smaller `mini` / `nano` variants
    /// get a lower effort than the full models.
    ///
    /// We never set `temperature`: reasoning models reject it, so we leave it
    /// unset and let the API default apply.
    fn thinking_params(&self) -> Option<serde_json::Value> {
        let model = self.model.as_str().to_lowercase();

        if !model.contains("gpt-5") {
            return None;
        }

        let effort = if model.contains("mini") || model.contains("nano") {
            "low"
        } else {
            "high"
        };

        Some(serde_json::json!({
            "reasoning": { "effort": effort, "summary": "auto" }
        }))
    }
}
