//! The Anthropic cache prefix (`tools` → `system` → `messages`) across a run
//! and across sessions, as the final HTTP bodies show it.
//!
//! A scripted transport stands in for the providers: it records each request
//! body and answers with canned SSE. Sessions route through a real
//! [`ModelRouter`], so the provider arms, the request planner and the wire
//! layout build every byte the API would see.

use super::util;
use crate::SystemPrompt;
use crate::model::anthropic_prompt_layout::AnthropicPromptLayout;
use crate::model::router::ModelRouter;
use crate::stream::ToolResponse;
use ai_toolset::{
    AsyncTool, AsyncToolCollection, RequestContext, RequestSchema, SearchableTool, ServiceContext,
    ToolAnnotated, ToolAnnotations, ToolResult, ToolSet as AiToolSet, ToolSetError,
};
use async_trait::async_trait;
use bytes::Bytes;
use rig_core::http_client::HttpClientExt;
use rig_core::http_client::{self, LazyBody, MultipartForm, Request, Response, StreamingResponse};
use rig_core::providers::{anthropic, openai};
use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::VecDeque;
use std::pin::Pin;
use std::sync::{Arc, Mutex};

/// Records request bodies and answers each with the next scripted SSE body,
/// or fails the request once the script runs out.
#[derive(Clone, Debug, Default)]
struct ScriptedProvider {
    bodies: Arc<Mutex<Vec<Value>>>,
    responses: Arc<Mutex<VecDeque<String>>>,
}

impl ScriptedProvider {
    fn new(responses: impl IntoIterator<Item = String>) -> Self {
        Self {
            bodies: Arc::default(),
            responses: Arc::new(Mutex::new(responses.into_iter().collect())),
        }
    }

    fn bodies(&self) -> Vec<Value> {
        self.bodies.lock().unwrap().clone()
    }
}

impl HttpClientExt for ScriptedProvider {
    fn send<T, U>(
        &self,
        _: Request<T>,
    ) -> impl Future<Output = http_client::Result<Response<LazyBody<U>>>> + Send + 'static
    where
        T: Into<Bytes> + Send,
        U: From<Bytes> + Send + 'static,
    {
        std::future::ready(Err(http_client::Error::StreamEnded))
    }

    fn send_multipart<U>(
        &self,
        _: Request<MultipartForm>,
    ) -> impl Future<Output = http_client::Result<Response<LazyBody<U>>>> + Send + 'static
    where
        U: From<Bytes> + Send + 'static,
    {
        std::future::ready(Err(http_client::Error::StreamEnded))
    }

    async fn send_streaming<T>(&self, request: Request<T>) -> http_client::Result<StreamingResponse>
    where
        T: Into<Bytes> + Send,
    {
        let body = serde_json::from_slice(&request.into_body().into()).unwrap();
        self.bodies.lock().unwrap().push(body);
        let Some(sse) = self.responses.lock().unwrap().pop_front() else {
            return Err(http_client::Error::StreamEnded);
        };
        let stream = futures::stream::iter([Ok(Bytes::from(sse))]);
        Ok(Response::builder()
            .header("content-type", "text/event-stream")
            .body(Box::pin(stream) as http_client::sse::BoxedStream)
            .unwrap())
    }
}

fn sse(events: &[Value]) -> String {
    events
        .iter()
        .map(|event| {
            format!(
                "event: {}\ndata: {event}\n\n",
                event["type"].as_str().unwrap()
            )
        })
        .collect()
}

fn tool_use_response(id: &str, name: &str, input: Value) -> String {
    sse(&[
        json!({"type": "message_start", "message": {"id": "msg_1", "type": "message", "role": "assistant", "model": "claude-opus-4-8", "content": [], "stop_reason": null, "usage": {"input_tokens": 1, "output_tokens": 0}}}),
        json!({"type": "content_block_start", "index": 0, "content_block": {"type": "tool_use", "id": id, "name": name, "input": {}}}),
        json!({"type": "content_block_delta", "index": 0, "delta": {"type": "input_json_delta", "partial_json": input.to_string()}}),
        json!({"type": "content_block_stop", "index": 0}),
        json!({"type": "message_delta", "delta": {"stop_reason": "tool_use"}, "usage": {"output_tokens": 1}}),
        json!({"type": "message_stop"}),
    ])
}

fn text_response(text: &str) -> String {
    sse(&[
        json!({"type": "message_start", "message": {"id": "msg_2", "type": "message", "role": "assistant", "model": "claude-opus-4-8", "content": [], "stop_reason": null, "usage": {"input_tokens": 1, "output_tokens": 0}}}),
        json!({"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}}),
        json!({"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": text}}),
        json!({"type": "content_block_stop", "index": 0}),
        json!({"type": "message_delta", "delta": {"stop_reason": "end_turn"}, "usage": {"output_tokens": 1}}),
        json!({"type": "message_stop"}),
    ])
}

/// Stand-in for `ai_tools::LoadTools`: hands the named catalog tools to the
/// session's loader.
#[derive(Deserialize, JsonSchema)]
#[schemars(title = "LoadTools", description = "Load deferred tools by name.")]
struct LoadToolsStandIn {
    names: Vec<String>,
}

impl ToolAnnotated for LoadToolsStandIn {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("Load tools");
}

#[async_trait]
impl AsyncTool<()> for LoadToolsStandIn {
    type Output = Value;

    async fn call(
        &self,
        _service_context: ServiceContext<()>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let matched: Vec<SearchableTool> = request_context
            .searchable_tools
            .iter()
            .filter(|tool| self.names.contains(&tool.name))
            .cloned()
            .collect();
        if let Some(loader) = request_context.tool_loader.as_ref() {
            loader.load(matched);
        }
        Ok(json!({ "loaded": self.names }))
    }
}

/// `LoadTools` upfront, `EditPresentation` in the catalog.
struct DeferringToolSet {
    eager: AsyncToolCollection<()>,
}

impl AiToolSet<()> for DeferringToolSet {
    fn dispatch_tool_call<'a>(
        &'a self,
        context: (),
        request_context: RequestContext,
        tool_name: &'a str,
        json: &'a Value,
    ) -> Pin<Box<dyn Future<Output = Result<ToolResult<Value>, ToolSetError>> + 'a + Send>> {
        if tool_name == "EditPresentation" {
            return Box::pin(async { Ok(Ok(json!({ "edited": true }))) });
        }
        self.eager
            .dispatch_tool_call(context, request_context, tool_name, json)
    }

    fn request_schemas(&self) -> Option<Vec<RequestSchema>> {
        self.eager.request_schemas()
    }

    fn searchable_catalog(&self) -> Vec<SearchableTool> {
        vec![SearchableTool {
            name: "EditPresentation".to_owned(),
            description: "Edit a presentation.".to_owned(),
            schema: serde_json::from_value(json!({
                "type": "object",
                "properties": {"id": {"type": "string"}}
            }))
            .unwrap(),
        }]
    }
}

fn router(transport: &ScriptedProvider) -> ModelRouter<ScriptedProvider> {
    let anthropic = anthropic::Client::builder()
        .api_key("test-anthropic-key")
        .http_client(AnthropicPromptLayout::new(transport.clone()))
        .build()
        .unwrap();
    let openai = openai::Client::builder()
        .api_key("test-openai-key")
        .http_client(transport.clone())
        .build()
        .unwrap();
    ModelRouter::new(anthropic, openai)
}

/// Run one session of `model` over `transport`: what it sent, and what it
/// streamed back.
async fn run_session(
    transport: &ScriptedProvider,
    model: &str,
    system_prompt: impl Into<SystemPrompt>,
    prompt: &str,
) -> (Vec<Value>, util::Collected) {
    let toolset: Arc<dyn AiToolSet<()> + Send + Sync> = Arc::new(DeferringToolSet {
        eager: AsyncToolCollection::<()>::new().add_tool::<LoadToolsStandIn, ()>(),
    });
    let before = transport.bodies().len();
    let mut session = util::test_loop()
        .with_model(model)
        .test_routed_session(
            &router(transport),
            toolset,
            Arc::new(()),
            system_prompt,
            util::usage_ctx(),
        )
        .await;
    let collected = util::drive(&mut session, prompt).await;
    (transport.bodies()[before..].to_vec(), collected)
}

/// Whether `EditPresentation` ran and answered.
fn edited(collected: &util::Collected) -> bool {
    collected.tool_responses().into_iter().any(|response| {
        matches!(
            response,
            ToolResponse::Json { name, json, .. }
                if name == "EditPresentation" && *json == json!({"edited": true})
        )
    })
}

const MODEL_LINE: &str = "\n\nYou are the anthropic/claude-opus-4-8 model. If this model id is \
                          unfamiliar, that is because it was released after your training data \
                          cutoff — trust this id over your training data when identifying yourself.";

fn split_prompt(task: &str) -> SystemPrompt {
    SystemPrompt::split(
        "# Identity\nYou are Macro.\n",
        format!("\n<session_instructions>\n{task}\n</session_instructions>"),
    )
}

#[tokio::test]
async fn loading_a_tool_keeps_every_request_prefix() {
    let transport = ScriptedProvider::new([
        tool_use_response(
            "toolu_load",
            "LoadTools",
            json!({"names": ["EditPresentation"]}),
        ),
        tool_use_response("toolu_edit", "EditPresentation", json!({"id": "deck"})),
        text_response("done"),
    ]);
    let (bodies, collected) = run_session(
        &transport,
        "anthropic/claude-opus-4-8",
        split_prompt("task A"),
        "edit my deck",
    )
    .await;
    assert!(collected.error.is_none(), "{:?}", collected.error);
    assert!(edited(&collected), "{:?}", collected.tool_responses());
    assert_eq!(bodies.len(), 3);

    // The catalog is declared deferred from the first request, so loading
    // never changes `tools`.
    let tools = json!([
        {
            "name": "LoadTools",
            "description": "Load deferred tools by name.",
            "input_schema": {
                "title": "LoadTools",
                "required": ["names"],
                "type": "object",
                "properties": {"names": {"type": "array", "items": {"type": "string"}}},
            },
            "cache_control": {"type": "ephemeral"},
        },
        {
            "name": "EditPresentation",
            "description": "Edit a presentation.",
            "input_schema": {"type": "object", "properties": {"id": {"type": "string"}}},
            "defer_loading": true,
        },
    ]);
    let system = json!([
        {"type": "text", "text": "# Identity\nYou are Macro.\n", "cache_control": {"type": "ephemeral"}},
        {
            "type": "text",
            "text": format!("\n<session_instructions>\ntask A\n</session_instructions>{MODEL_LINE}"),
            "cache_control": {"type": "ephemeral"},
        },
    ]);
    for body in &bodies {
        assert_eq!(body["tools"], tools);
        assert_eq!(body["system"], system);
        assert_eq!(body["cache_control"], json!({"type": "ephemeral"}));
    }
    // Each request's conversation is the start of the next one's.
    for pair in bodies.windows(2) {
        let earlier = pair[0]["messages"].as_array().unwrap();
        let later = pair[1]["messages"].as_array().unwrap();
        assert_eq!(&later[..earlier.len()], earlier.as_slice());
    }
    assert_eq!(
        bodies[1]["messages"][2],
        json!({"role": "user", "content": [
            {"type": "tool_result", "tool_use_id": "toolu_load", "content": [
                {"type": "tool_reference", "tool_name": "EditPresentation"},
            ]},
            {"type": "text", "text": "<tool_result_text tool_use_id=\"toolu_load\">{\"loaded\":[\"EditPresentation\"]}</tool_result_text>"},
        ]})
    );
}

#[tokio::test]
async fn sessions_with_different_instructions_share_the_shared_system_block() {
    let transport = ScriptedProvider::new([text_response("one"), text_response("two")]);
    let (first, _) = run_session(
        &transport,
        "anthropic/claude-opus-4-8",
        split_prompt("task A"),
        "hi",
    )
    .await;
    let (second, _) = run_session(
        &transport,
        "anthropic/claude-opus-4-8",
        split_prompt("task B"),
        "hi",
    )
    .await;

    assert_eq!(first[0]["tools"], second[0]["tools"]);
    let shared = json!({
        "type": "text",
        "text": "# Identity\nYou are Macro.\n",
        "cache_control": {"type": "ephemeral"},
    });
    assert_eq!(first[0]["system"][0], shared);
    assert_eq!(second[0]["system"][0], shared);
    assert_ne!(first[0]["system"][1], second[0]["system"][1]);
}

#[tokio::test]
async fn a_deferred_tool_called_before_loading_is_loaded_from_its_retry() {
    let transport = ScriptedProvider::new([
        tool_use_response("toolu_early", "EditPresentation", json!({"id": "deck"})),
        tool_use_response("toolu_edit", "EditPresentation", json!({"id": "deck"})),
        text_response("done"),
    ]);
    let (bodies, collected) = run_session(
        &transport,
        "anthropic/claude-opus-4-8",
        split_prompt("task A"),
        "edit my deck",
    )
    .await;
    assert!(collected.error.is_none(), "{:?}", collected.error);
    assert!(edited(&collected), "{:?}", collected.tool_responses());

    assert_eq!(bodies[0]["tools"], bodies[1]["tools"]);
    let retry = &bodies[1]["messages"][2]["content"];
    assert_eq!(
        retry[0],
        json!({"type": "tool_result", "tool_use_id": "toolu_early", "content": [
            {"type": "tool_reference", "tool_name": "EditPresentation"},
        ]})
    );
    assert!(
        retry[1]["text"]
            .as_str()
            .unwrap()
            .starts_with("<tool_result_text tool_use_id=\"toolu_early\">"),
        "{retry}"
    );
}

#[tokio::test]
async fn a_model_without_tool_references_loads_by_registering() {
    let transport = ScriptedProvider::new([
        tool_use_response(
            "toolu_load",
            "LoadTools",
            json!({"names": ["EditPresentation"]}),
        ),
        text_response("done"),
    ]);
    let (bodies, collected) = run_session(
        &transport,
        "anthropic/claude-fable-5-1",
        split_prompt("task A"),
        "edit my deck",
    )
    .await;
    assert!(collected.error.is_none(), "{:?}", collected.error);

    let names = |body: &Value| -> Vec<String> {
        body["tools"]
            .as_array()
            .unwrap()
            .iter()
            .map(|tool| tool["name"].as_str().unwrap().to_owned())
            .collect()
    };
    assert_eq!(names(&bodies[0]), ["LoadTools"]);
    assert_eq!(names(&bodies[1]), ["LoadTools", "EditPresentation"]);
    let wire = serde_json::to_string(&bodies).unwrap();
    assert!(!wire.contains("defer_loading") && !wire.contains("tool_reference"));
    // The system prompt is still cached in two parts.
    assert_eq!(bodies[0]["system"].as_array().unwrap().len(), 2);
}

#[tokio::test]
async fn other_providers_receive_the_prompt_joined_as_before() {
    let split = ScriptedProvider::default();
    let (split_bodies, _) =
        run_session(&split, "openai/gpt-5.5", split_prompt("task A"), "hi").await;
    let joined = ScriptedProvider::default();
    let (joined_bodies, _) = run_session(
        &joined,
        "openai/gpt-5.5",
        "# Identity\nYou are Macro.\n\n<session_instructions>\ntask A\n</session_instructions>",
        "hi",
    )
    .await;

    assert!(!split_bodies.is_empty());
    assert_eq!(split_bodies, joined_bodies);
    let wire = serde_json::to_string(&split_bodies).unwrap();
    for anthropic_only in [
        "defer_loading",
        "tool_reference",
        "macro_prompt_layout",
        "cache_control",
    ] {
        assert!(!wire.contains(anthropic_only), "{anthropic_only} in {wire}");
    }
}
