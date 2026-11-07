use std::sync::Arc;

use crate::model::ReasoningEffort;
use crate::model::types::Model;
use rig_core::completion::{
    CompletionError, CompletionModel, CompletionRequest, CompletionResponse,
};
use rig_core::streaming::StreamingCompletionResponse;
use rig_core::{client::CompletionClient, http_client::HttpClientExt, providers::openai};

/// Fireworks' Chat Completions `model` field is the account-scoped path, not
/// the short catalog slug. Routing ids stay `fireworks/<slug>` so the picker,
/// usage, and pricing can use the bare name.
fn completion_model_id(model: &Model<'_>) -> String {
    if model.provider() == "fireworks" && !model.name().starts_with("accounts/") {
        format!("accounts/fireworks/models/{}", model.name())
    } else {
        model.name().to_string()
    }
}

/// A model served over the OpenAI-compatible **Chat Completions** API.
///
/// OpenAI-compatible providers differ only by the
/// [`CompletionsClient`](openai::CompletionsClient)'s base URL and key, never
/// by Rust type, so routing can hold any number of them without new variants.
/// Which provider serves an id is decided by routing (the `provider/…`
/// segment). Fireworks is the one exception on the wire: its API wants the
/// account-scoped path, which [`completion_model_id`] derives from the
/// catalog slug.
pub struct OpenAiChatCompletionsModel<'a, H = rig_core::http_client::ReqwestClient> {
    model: Model<'a>,
    client: Arc<openai::CompletionsClient<H>>,
}

impl<'a, H: HttpClientExt + Clone + Default + std::fmt::Debug + 'static>
    OpenAiChatCompletionsModel<'a, H>
{
    /// Bind `model` to the client that serves it.
    pub fn new(model: Model<'a>, client: Arc<openai::CompletionsClient<H>>) -> Self {
        Self { model, client }
    }

    /// The routed id this model was bound to.
    pub fn model(&self) -> &Model<'a> {
        &self.model
    }

    /// The rig completion model for this id.
    ///
    /// Unlike the Responses API, the Chat Completions API does not coerce tools
    /// into a strict subset, so tools are already sent verbatim.
    pub fn completion(&self) -> CompatibleCompletionModel<H> {
        CompatibleCompletionModel(
            self.client
                .completion_model(completion_model_id(&self.model)),
        )
    }

    /// Best-effort reasoning config, flattened into the request by rig, or
    /// `None` if the model doesn't support it.
    ///
    /// The Chat Completions API takes a flat `reasoning_effort` field, accepted
    /// only by reasoning models (the GPT-5 and GPT-6 families and the
    /// `o`-series); anything
    /// else returns `None`, since sending it elsewhere 400s. `mini` / `nano`
    /// variants get a lower effort. `temperature` is never set (reasoning models
    /// reject it).
    pub fn thinking_params(
        &self,
        reasoning_effort: Option<ReasoningEffort>,
    ) -> Option<serde_json::Value> {
        let model = self.model.name().to_lowercase();

        let is_reasoning = model.contains("gpt-5")
            || model.contains("gpt-6")
            || model.starts_with("o1")
            || model.starts_with("o3")
            || model.starts_with("o4");
        if !is_reasoning {
            return None;
        }

        let effort = reasoning_effort
            .and_then(|effort| effort.explicit_for(&self.model.to_string()))
            .map_or_else(
                || {
                    if model.contains("mini") || model.contains("nano") {
                        "low"
                    } else {
                        "high"
                    }
                },
                ReasoningEffort::as_str,
            );

        Some(serde_json::json!({ "reasoning_effort": effort }))
    }
}

/// Compatible endpoints cannot carry images in tool messages. Preserve the
/// result metadata and explain the unsupported transport instead of failing
/// the next turn or sending encoded pixels as text, including on history replay.
#[derive(Clone)]
pub struct CompatibleCompletionModel<H>(openai::completion::CompletionModel<H>);

fn compatible_media(mut request: CompletionRequest) -> CompletionRequest {
    use rig_core::message::{Message, ToolResultContent, UserContent};
    for message in request.chat_history.iter_mut() {
        if let Message::User { content } = message {
            for part in content.iter_mut() {
                if let UserContent::ToolResult(result) = part {
                    for output in result.content.iter_mut() {
                        if matches!(output, ToolResultContent::Image(_)) {
                            *output = ToolResultContent::text(
                                "This model's Chat Completions transport cannot inspect tool images. The image was omitted, not converted to text. Use a native image-capable model such as Anthropic or OpenAI Responses to inspect it; do not claim visual verification.",
                            );
                        }
                    }
                }
            }
        }
    }
    request
}

impl<H: HttpClientExt + Clone + Default + std::fmt::Debug + 'static> CompletionModel
    for CompatibleCompletionModel<H>
{
    type Response = <openai::completion::CompletionModel<H> as CompletionModel>::Response;
    type StreamingResponse =
        <openai::completion::CompletionModel<H> as CompletionModel>::StreamingResponse;
    type Client = openai::CompletionsClient<H>;
    fn make(client: &Self::Client, model: impl Into<String>) -> Self {
        Self(openai::completion::CompletionModel::make(client, model))
    }
    async fn completion(
        &self,
        request: CompletionRequest,
    ) -> Result<CompletionResponse<Self::Response>, CompletionError> {
        self.0.completion(compatible_media(request)).await
    }
    async fn stream(
        &self,
        request: CompletionRequest,
    ) -> Result<StreamingCompletionResponse<Self::StreamingResponse>, CompletionError> {
        self.0.stream(compatible_media(request)).await
    }
    fn composes_native_output_with_tools(&self) -> bool {
        self.0.composes_native_output_with_tools()
    }
}

/// A model served over OpenAI's **Responses** API.
///
/// This is intentionally separate from OpenAI-compatible Chat Completions:
/// OpenAI GPT reasoning models expect Responses-shaped request fields, while
/// many compatible OSS endpoints only promise `/v1/chat/completions`.
pub struct OpenAiResponsesModel<'a, H = rig_core::http_client::ReqwestClient> {
    model: Model<'a>,
    client: Arc<openai::Client<H>>,
}

impl<'a, H: HttpClientExt + Clone + Default + std::fmt::Debug + 'static>
    OpenAiResponsesModel<'a, H>
{
    /// Bind `model` to the Responses API client that serves it.
    pub fn new(model: Model<'a>, client: Arc<openai::Client<H>>) -> Self {
        Self { model, client }
    }

    /// The routed id this model was bound to.
    pub fn model(&self) -> &Model<'a> {
        &self.model
    }

    /// The rig Responses API completion model for this id.
    ///
    /// Rig maps the generic `max_tokens` agent setting to the Responses API's
    /// `max_output_tokens`, avoiding the Chat Completions `max_tokens` 400s on
    /// GPT reasoning models. Tools are sent verbatim (non-strict is rig's
    /// default since 0.41) rather than coerced into OpenAI's strict subset.
    pub fn completion(&self) -> openai::responses_api::ResponsesCompletionModel<H> {
        self.client.completion_model(self.model.name().to_string())
    }

    /// Best-effort reasoning config for OpenAI Responses models, or `None` if
    /// the model doesn't support it.
    pub fn thinking_params(
        &self,
        reasoning_effort: Option<ReasoningEffort>,
    ) -> Option<serde_json::Value> {
        let model = self.model.name().to_lowercase();

        let is_reasoning = model.contains("gpt-5")
            || model.contains("gpt-6")
            || model.starts_with("o1")
            || model.starts_with("o3")
            || model.starts_with("o4");
        if !is_reasoning {
            return None;
        }

        let effort = reasoning_effort
            .and_then(|effort| effort.explicit_for(&self.model.to_string()))
            .map_or_else(
                || {
                    if model.contains("mini") || model.contains("nano") {
                        "low"
                    } else {
                        "high"
                    }
                },
                ReasoningEffort::as_str,
            );

        Some(serde_json::json!({
            "reasoning": {
                "effort": effort,
                "summary": "auto"
            }
        }))
    }
}

#[cfg(test)]
mod test;
