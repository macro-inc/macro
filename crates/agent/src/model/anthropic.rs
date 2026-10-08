use crate::hook::ToolLoads;
use crate::model::ReasoningEffort;
use crate::model::anthropic_prompt_layout::{PROMPT_LAYOUT_KEY, PromptLayout, ToolReferences};
use crate::model::types::Model;
use ai_toolset::SearchableTool;
use rig_core::completion::{
    CompletionError, CompletionModel, CompletionRequest, CompletionResponse,
};
use rig_core::message::{AssistantContent, Message, ToolResultContent, UserContent};
use rig_core::streaming::StreamingCompletionResponse;
use rig_core::{client::CompletionClient, http_client::HttpClientExt, providers::anthropic};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

/// Models that load a `defer_loading` tool from a `tool_reference` in a tool
/// result, read the whole cache prefix back after it, and call the tool with
/// its schema. Each was probed against the API on 2026-10-06; none needs a
/// beta header. The Fable models are documented to support it but were not
/// reachable for this organization, so they keep the client-side path.
const TOOL_REFERENCE_MODELS: &[&str] = &[
    "claude-haiku-4-5",
    "claude-opus-4-7",
    "claude-opus-4-8",
    "claude-opus-5",
    "claude-opus-5-5",
    "claude-sonnet-4-6",
    "claude-sonnet-5",
    "claude-sonnet-5-5",
];

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

    /// Whether this model loads deferred tools through `tool_reference`.
    pub(crate) fn loads_tools_by_reference(&self) -> bool {
        TOOL_REFERENCE_MODELS.contains(&self.model.name())
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

/// How a session lays out its Anthropic requests for the prompt cache.
#[derive(Clone, Default)]
pub(crate) struct SessionLayout {
    /// The first two system messages are the system prompt's shared part and
    /// its per-session rest, each cached on its own.
    pub(crate) shared_system: bool,
    /// Catalog tools declared upfront and loaded by reference.
    pub(crate) deferred: Option<DeferredTools>,
}

/// A session's catalog tools, declared with `defer_loading` on every request
/// so loading one never changes `tools`, the front of the cache prefix.
#[derive(Clone)]
pub(crate) struct DeferredTools {
    names: HashSet<String>,
    /// Wire definitions in catalog order.
    definitions: Arc<Vec<serde_json::Value>>,
    loads: ToolLoads,
}

impl DeferredTools {
    pub(crate) fn new(catalog: &[SearchableTool], loads: ToolLoads) -> Self {
        let definitions = catalog
            .iter()
            .map(|tool| {
                let definition = crate::tool_adapter::provider_definition(
                    tool.name.clone(),
                    tool.description.clone(),
                    &tool.schema,
                );
                serde_json::json!({
                    "name": definition.name,
                    "description": definition.description,
                    "input_schema": definition.parameters,
                    "defer_loading": true,
                })
            })
            .collect();
        Self {
            names: catalog.iter().map(|tool| tool.name.clone()).collect(),
            definitions: Arc::new(definitions),
            loads,
        }
    }

    /// Where each catalog tool's schema is loaded from: the result of the call
    /// that loaded it this session, or, for a tool an earlier turn called, the
    /// text result just before its first call. A tool is referenced once, and
    /// the same history always places it in the same result, so the requests
    /// of a run and of the turns after it share their prefix.
    fn references(&self, history: &[Message]) -> Vec<ToolReferences> {
        let loaded_this_session: HashSet<String> = self.loads.loaded().into_iter().collect();
        let mut loaded_by_result: HashMap<String, Vec<String>> = HashMap::new();
        let mut referenced = HashSet::new();
        let mut references: Vec<ToolReferences> = Vec::new();
        let mut place = |tool_use_id: &str, name: &String| {
            if !self.names.contains(name) || !referenced.insert(name.clone()) {
                return;
            }
            match references
                .iter_mut()
                .find(|references| references.tool_use_id == tool_use_id)
            {
                Some(references) => references.tool_names.push(name.clone()),
                None => references.push(ToolReferences {
                    tool_use_id: tool_use_id.to_owned(),
                    tool_names: vec![name.clone()],
                }),
            }
        };
        let mut latest_text_result: Option<String> = None;
        for message in history {
            match message {
                Message::User { content } => {
                    let results: Vec<_> = content
                        .iter()
                        .filter_map(|content| match content {
                            UserContent::ToolResult(result) => Some(result),
                            _ => None,
                        })
                        .filter(|result| {
                            result
                                .content
                                .iter()
                                .all(|content| !matches!(content, ToolResultContent::Image(_)))
                        })
                        .collect();
                    for result in &results {
                        for name in loaded_by_result.get(&result.id).into_iter().flatten() {
                            place(&result.id, name);
                        }
                    }
                    if let Some(first) = results.first() {
                        latest_text_result = Some(first.id.clone());
                    }
                }
                Message::Assistant { content, .. } => {
                    for content in content.iter() {
                        let AssistantContent::ToolCall(call) = content else {
                            continue;
                        };
                        loaded_by_result.insert(call.id.clone(), self.loads.loaded_by(call));
                        if !loaded_this_session.contains(&call.function.name)
                            && let Some(tool_use_id) = &latest_text_result
                        {
                            place(tool_use_id, &call.function.name);
                        }
                    }
                }
                Message::System { .. } => {}
            }
        }
        references
    }
}

/// An Anthropic completion model whose requests carry a [`SessionLayout`]:
/// catalog tools move into `defer_loading` declarations and the rest of the
/// layout is declared for
/// [`AnthropicPromptLayout`](crate::model::anthropic_prompt_layout::AnthropicPromptLayout)
/// to apply on the wire.
#[derive(Clone)]
pub(crate) struct LaidOutModel<M> {
    inner: M,
    layout: SessionLayout,
}

impl<M> LaidOutModel<M> {
    pub(crate) fn new(inner: M, layout: SessionLayout) -> Self {
        Self { inner, layout }
    }

    fn lay_out(
        &self,
        mut request: CompletionRequest,
    ) -> Result<CompletionRequest, CompletionError> {
        let history: Vec<Message> = request.chat_history.iter().cloned().collect();
        let mut layout = PromptLayout::default();
        if self.layout.shared_system {
            if !matches!(
                history.as_slice(),
                [Message::System { .. }, Message::System { .. }, ..]
            ) {
                return Err(CompletionError::RequestError(
                    "the request must open with the shared and per-session system messages".into(),
                ));
            }
            layout.cache_shared_system = true;
        }
        let mut params = match request.additional_params.take() {
            None => serde_json::Map::new(),
            Some(serde_json::Value::Object(params)) => params,
            Some(_) => {
                return Err(CompletionError::RequestError(
                    "additional_params must be an object".into(),
                ));
            }
        };
        if let Some(deferred) = &self.layout.deferred {
            if params.contains_key("tools") {
                return Err(CompletionError::RequestError(
                    "additional_params already declares tools".into(),
                ));
            }
            request
                .tools
                .retain(|tool| !deferred.names.contains(&tool.name));
            params.insert(
                "tools".to_owned(),
                serde_json::Value::Array(deferred.definitions.to_vec()),
            );
            layout.tool_references = deferred.references(&history);
        }
        if layout != PromptLayout::default() {
            params.insert(
                PROMPT_LAYOUT_KEY.to_owned(),
                serde_json::to_value(&layout)
                    .map_err(|error| CompletionError::RequestError(error.into()))?,
            );
        }
        request.additional_params =
            (!params.is_empty()).then_some(serde_json::Value::Object(params));
        Ok(request)
    }
}

impl<M: CompletionModel> CompletionModel for LaidOutModel<M> {
    type Response = M::Response;
    type StreamingResponse = M::StreamingResponse;
    type Client = M::Client;

    fn make(client: &Self::Client, model: impl Into<String>) -> Self {
        Self::new(M::make(client, model), SessionLayout::default())
    }

    async fn completion(
        &self,
        request: CompletionRequest,
    ) -> Result<CompletionResponse<Self::Response>, CompletionError> {
        self.inner.completion(self.lay_out(request)?).await
    }

    async fn stream(
        &self,
        request: CompletionRequest,
    ) -> Result<StreamingCompletionResponse<Self::StreamingResponse>, CompletionError> {
        self.inner.stream(self.lay_out(request)?).await
    }

    fn composes_native_output_with_tools(&self) -> bool {
        self.inner.composes_native_output_with_tools()
    }
}

#[cfg(test)]
mod test;
