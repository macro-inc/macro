use crate::model::types::Model;
use rig_core::completion::{
    CompletionError, CompletionModel, CompletionRequest, CompletionResponse,
};
use rig_core::streaming::StreamingCompletionResponse;
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
    pub fn completion(&self) -> GeminiCompletionModel<H> {
        GeminiCompletionModel(self.client.completion_model(self.model.name().to_string()))
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

/// Sends tool schemas through Gemini's native JSON Schema field. Rig's legacy
/// `parameters` conversion recursively inlines references, which overflows the
/// process stack for recursive schemas such as database view filters. It also
/// loses nested nullable unions, producing an invalid empty Gemini `type`.
#[derive(Clone)]
pub struct GeminiCompletionModel<H>(gemini::completion::CompletionModel<H>);

impl<H: HttpClientExt + Clone + 'static> CompletionModel for GeminiCompletionModel<H> {
    type Response = <gemini::completion::CompletionModel<H> as CompletionModel>::Response;
    type StreamingResponse =
        <gemini::completion::CompletionModel<H> as CompletionModel>::StreamingResponse;
    type Client = gemini::Client<H>;

    fn make(client: &Self::Client, model: impl Into<String>) -> Self {
        Self(gemini::completion::CompletionModel::make(client, model))
    }

    async fn completion(
        &self,
        request: CompletionRequest,
    ) -> Result<CompletionResponse<Self::Response>, CompletionError> {
        self.0.completion(native_tool_schemas(request)?).await
    }

    async fn stream(
        &self,
        request: CompletionRequest,
    ) -> Result<StreamingCompletionResponse<Self::StreamingResponse>, CompletionError> {
        self.0.stream(native_tool_schemas(request)?).await
    }
}

fn native_tool_schemas(
    mut request: CompletionRequest,
) -> Result<CompletionRequest, CompletionError> {
    if request.tools.is_empty() {
        return Ok(request);
    }
    let declarations: Vec<_> = request
        .tools
        .drain(..)
        .map(|tool| {
            let mut declaration = serde_json::json!({
                "name": tool.name,
                "description": tool.description,
            });
            if !tool.parameters.is_null() {
                declaration["parametersJsonSchema"] = tool.parameters;
            }
            declaration
        })
        .collect();
    let params = request
        .additional_params
        .get_or_insert_with(|| serde_json::json!({}));
    let object = params.as_object_mut().ok_or_else(|| {
        CompletionError::RequestError("Gemini additional parameters must be an object".into())
    })?;
    let tools = object
        .entry("tools")
        .or_insert_with(|| serde_json::json!([]));
    let tools = tools.as_array_mut().ok_or_else(|| {
        CompletionError::RequestError("Gemini additional tools must be an array".into())
    })?;
    tools.insert(
        0,
        serde_json::json!({ "functionDeclarations": declarations }),
    );
    Ok(request)
}

#[cfg(test)]
mod test;
