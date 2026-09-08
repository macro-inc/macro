//! GenAI telemetry: what the agent loop adds to rig's `invoke_agent`, `chat`
//! and `execute_tool` spans so an observability backend can evaluate a run
//! (tool selection against the offered tools, goal completion across a
//! conversation).
use super::util;
use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolResult,
};
use async_trait::async_trait;
use genai_telemetry::attr;
use opentelemetry::trace::TracerProvider as _;
use opentelemetry::{Array, Value};
use opentelemetry_sdk::trace::{InMemorySpanExporter, SdkTracerProvider, SpanData};
use rig_core::test_utils::{MockCompletionModel, MockStreamEvent};
use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::json;
use std::sync::Arc;
use tracing_subscriber::layer::SubscriberExt as _;

/// A tool that echoes its input.
#[derive(Deserialize, JsonSchema)]
#[schemars(title = "echo_tool", description = "Echoes its input back.")]
struct EchoTool {
    value: String,
}

impl ToolAnnotated for EchoTool {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("Echo");
}

#[async_trait]
impl AsyncTool<()> for EchoTool {
    type Output = serde_json::Value;

    async fn call(
        &self,
        _service_context: ServiceContext<()>,
        _request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        Ok(json!({ "echo": self.value }))
    }
}

/// An OpenTelemetry pipeline that keeps finished spans in memory, installed as
/// the thread's default subscriber for the returned guard's lifetime. The
/// tests run on tokio's current-thread runtime, so the driver task the agent
/// loop spawns sees the same subscriber.
fn otel_test_pipeline() -> (
    InMemorySpanExporter,
    SdkTracerProvider,
    tracing::subscriber::DefaultGuard,
) {
    let exporter = InMemorySpanExporter::default();
    let provider = SdkTracerProvider::builder()
        .with_simple_exporter(exporter.clone())
        .build();
    let layer = tracing_opentelemetry::layer().with_tracer(provider.tracer("test"));
    let guard = tracing::subscriber::set_default(tracing_subscriber::registry().with(layer));
    // Other tests in this binary run the same code paths with no subscriber
    // installed, which can cache "never interested" for a span callsite on
    // another thread; recompute so this subscriber sees every span.
    tracing::callsite::rebuild_interest_cache();
    (exporter, provider, guard)
}

fn finished(exporter: &InMemorySpanExporter, provider: &SdkTracerProvider) -> Vec<SpanData> {
    provider.force_flush().expect("flush");
    exporter.get_finished_spans().expect("finished spans")
}

fn attribute<'a>(span: &'a SpanData, key: &str) -> Option<&'a Value> {
    span.attributes
        .iter()
        .find(|kv| kv.key.as_str() == key)
        .map(|kv| &kv.value)
}

fn string_attribute(span: &SpanData, key: &str) -> Option<String> {
    match attribute(span, key)? {
        Value::String(s) => Some(s.as_str().to_string()),
        _ => None,
    }
}

fn int_attribute(span: &SpanData, key: &str) -> Option<i64> {
    match attribute(span, key)? {
        Value::I64(i) => Some(*i),
        _ => None,
    }
}

fn string_array_attribute(span: &SpanData, key: &str) -> Option<Vec<String>> {
    match attribute(span, key)? {
        Value::Array(Array::String(values)) => {
            Some(values.iter().map(|v| v.as_str().to_string()).collect())
        }
        _ => None,
    }
}

fn json_attribute(span: &SpanData, key: &str) -> Vec<serde_json::Value> {
    let raw = string_attribute(span, key).unwrap_or_else(|| panic!("{key} on {}", span.name));
    serde_json::from_str(&raw).unwrap_or_else(|e| panic!("{key} is not a JSON array: {e}: {raw}"))
}

/// Spans with the given `gen_ai.operation.name`, in the order they finished.
fn spans_with_operation<'a>(spans: &'a [SpanData], operation: &str) -> Vec<&'a SpanData> {
    spans
        .iter()
        .filter(|span| string_attribute(span, attr::OPERATION_NAME).as_deref() == Some(operation))
        .collect()
}

fn names(spans: &[SpanData]) -> Vec<&str> {
    spans.iter().map(|span| span.name.as_ref()).collect()
}

/// Every exported span with its attribute keys, for assertion messages.
fn describe(spans: &[SpanData]) -> String {
    spans
        .iter()
        .map(|span| {
            let keys: Vec<&str> = span.attributes.iter().map(|kv| kv.key.as_str()).collect();
            format!("{} {:?}", span.name, keys)
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// One run: the model calls `echo_tool`, then answers "done".
#[tokio::test]
async fn a_run_records_the_attributes_evaluations_read() {
    let (exporter, provider, _guard) = otel_test_pipeline();
    let model = MockCompletionModel::from_stream_turns([
        vec![
            MockStreamEvent::tool_call("call-1", "echo_tool", json!({ "value": "a" })),
            MockStreamEvent::final_response_with_default_usage(),
        ],
        vec![
            MockStreamEvent::text("done"),
            MockStreamEvent::final_response_with_default_usage(),
        ],
    ]);
    let toolset = util::single_tool_set::<EchoTool, ()>();
    let mut session = util::test_loop()
        .with_conversation_id("chat-123")
        .test_session(
            toolset,
            Arc::new(()),
            "test preamble",
            util::usage_ctx(),
            model,
        )
        .await;

    let result = util::drive(&mut session, "call echo").await;
    assert_eq!(result.content(), "done");
    drop(session);

    let spans = finished(&exporter, &provider);

    // The agent span: ours, adopted by rig, carrying the session and the run's
    // input, output and usage.
    let agents = spans_with_operation(&spans, attr::operation::INVOKE_AGENT);
    assert_eq!(agents.len(), 1, "one agent span, got {:?}", names(&spans));
    let agent = agents[0];
    assert_eq!(agent.name, "invoke_agent");
    assert_eq!(
        string_attribute(agent, attr::CONVERSATION_ID).as_deref(),
        Some("chat-123")
    );
    assert_eq!(
        string_attribute(agent, attr::AGENT_NAME).as_deref(),
        Some("chat"),
        "the agent is named after the usage context's feature"
    );
    assert_eq!(
        string_attribute(agent, attr::PROVIDER_NAME).as_deref(),
        Some("test")
    );
    assert_eq!(
        string_attribute(agent, attr::REQUEST_MODEL).as_deref(),
        Some("fake-model")
    );
    assert!(int_attribute(agent, attr::USAGE_INPUT_TOKENS).is_some());
    assert!(int_attribute(agent, attr::USAGE_OUTPUT_TOKENS).is_some());
    let input = json_attribute(agent, attr::INPUT_MESSAGES);
    assert_eq!(input[0]["role"], "user");
    assert_eq!(input[0]["parts"][0]["content"], "call echo");
    let output = json_attribute(agent, attr::OUTPUT_MESSAGES);
    assert_eq!(output[0]["parts"][0]["content"], "done");
    assert_eq!(output[0]["finish_reason"], "stop");

    // One chat span per model call, each with the tool set it was offered, the
    // history it saw, the session, and what it produced.
    let chats = spans_with_operation(&spans, attr::operation::CHAT);
    assert_eq!(
        chats.len(),
        2,
        "two model calls, got:\n{}",
        describe(&spans)
    );
    let (first, second) = (chats[0], chats[1]);
    for chat in &chats {
        assert_eq!(
            string_attribute(chat, attr::CONVERSATION_ID).as_deref(),
            Some("chat-123")
        );
        assert!(int_attribute(chat, attr::REQUEST_MAX_TOKENS).is_some());
        let definitions = json_attribute(chat, attr::TOOL_DEFINITIONS);
        assert!(
            definitions
                .iter()
                .any(|d| d["type"] == "function" && d["name"] == "echo_tool"),
            "{definitions:?}"
        );
        let system = json_attribute(chat, attr::SYSTEM_INSTRUCTIONS);
        assert!(
            system[0]["content"]
                .as_str()
                .is_some_and(|s| s.contains("test preamble")),
            "{system:?}"
        );
    }

    let input = json_attribute(first, attr::INPUT_MESSAGES);
    assert!(
        input.iter().all(|m| m["role"] != "system"),
        "system instructions stay out of the history: {input:?}"
    );
    assert_eq!(input.last().unwrap()["parts"][0]["content"], "call echo");
    assert_eq!(
        string_array_attribute(first, attr::RESPONSE_FINISH_REASONS),
        Some(vec!["tool_call".to_string()])
    );
    let output = json_attribute(first, attr::OUTPUT_MESSAGES);
    assert_eq!(output[0]["role"], "assistant");
    assert_eq!(output[0]["finish_reason"], "tool_call");
    assert_eq!(output[0]["parts"][0]["type"], "tool_call");
    assert_eq!(output[0]["parts"][0]["name"], "echo_tool");
    assert_eq!(output[0]["parts"][0]["arguments"], json!({ "value": "a" }));

    let input = json_attribute(second, attr::INPUT_MESSAGES);
    let tool_message = input
        .iter()
        .find(|m| m["role"] == "tool")
        .expect("the second call sees the tool result as a tool message");
    assert_eq!(tool_message["parts"][0]["type"], "tool_call_response");
    assert_eq!(tool_message["parts"][0]["response"], json!({ "echo": "a" }));
    assert_eq!(
        string_array_attribute(second, attr::RESPONSE_FINISH_REASONS),
        Some(vec!["stop".to_string()])
    );
    let output = json_attribute(second, attr::OUTPUT_MESSAGES);
    assert_eq!(output[0]["parts"][0]["content"], "done");

    // The tool span: rig's, with the model's call id, plus our arguments and
    // result — and only one of them per call.
    let tools = spans_with_operation(&spans, attr::operation::EXECUTE_TOOL);
    assert_eq!(
        tools.len(),
        1,
        "one tool span per call, got {:?}",
        names(&spans)
    );
    let tool = tools[0];
    assert_eq!(
        string_attribute(tool, attr::TOOL_NAME).as_deref(),
        Some("echo_tool")
    );
    assert_eq!(
        string_attribute(tool, attr::TOOL_CALL_ID).as_deref(),
        Some("call-1")
    );
    assert_eq!(
        string_attribute(tool, attr::TOOL_CALL_ARGUMENTS).as_deref(),
        Some(r#"{"value":"a"}"#)
    );
    assert_eq!(
        string_attribute(tool, attr::TOOL_CALL_RESULT).as_deref(),
        Some(r#"{"echo":"a"}"#)
    );

    // Everything is one trace under the agent span: the model calls hang off
    // it directly, and the tool call off the run too (rig opens it from the
    // driver, which runs inside the agent span).
    let trace_id = agent.span_context.trace_id();
    assert!(
        spans
            .iter()
            .all(|span| span.span_context.trace_id() == trace_id),
        "{:?}",
        names(&spans)
    );
    let agent_id = agent.span_context.span_id();
    for chat in &chats {
        assert_eq!(chat.parent_span_id, agent_id, "{}", describe(&spans));
    }
    assert_eq!(tool.parent_span_id, agent_id, "{}", describe(&spans));
}

/// Without a conversation id nothing is invented, and the run still traces.
#[tokio::test]
async fn a_run_without_a_conversation_id_has_no_session_attribute() {
    let (exporter, provider, _guard) = otel_test_pipeline();
    let model = MockCompletionModel::from_stream_turns([vec![
        MockStreamEvent::text("hi"),
        MockStreamEvent::final_response_with_default_usage(),
    ]]);
    let toolset = util::single_tool_set::<EchoTool, ()>();
    let mut session = util::session(toolset, Arc::new(()), model).await;

    let result = util::drive(&mut session, "hello").await;
    assert_eq!(result.content(), "hi");
    drop(session);

    let spans = finished(&exporter, &provider);
    let agent = spans_with_operation(&spans, attr::operation::INVOKE_AGENT)[0];
    assert_eq!(string_attribute(agent, attr::CONVERSATION_ID), None);
    let chat = spans_with_operation(&spans, attr::operation::CHAT)[0];
    assert_eq!(string_attribute(chat, attr::CONVERSATION_ID), None);
    assert_eq!(
        string_array_attribute(chat, attr::RESPONSE_FINISH_REASONS),
        Some(vec!["stop".to_string()])
    );
}

/// A run the provider fails is a failed run on the agent span, not a quiet
/// success.
#[tokio::test]
async fn a_provider_error_marks_the_agent_span_failed() {
    let (exporter, provider, _guard) = otel_test_pipeline();
    let model = MockCompletionModel::from_stream_turns([vec![
        MockStreamEvent::text("partial"),
        MockStreamEvent::error("upstream exploded"),
    ]]);
    let toolset = util::single_tool_set::<EchoTool, ()>();
    let mut session = util::session(toolset, Arc::new(()), model).await;

    let stream = session
        .send_message(vec![rig_core::message::Message::user("hello")])
        .await
        .expect("the stream starts");
    let collected = util::collect(stream).await;
    assert!(
        collected.error.is_some(),
        "the failure reaches the consumer"
    );
    drop(session);

    let spans = finished(&exporter, &provider);
    let agent = spans_with_operation(&spans, attr::operation::INVOKE_AGENT)[0];
    assert!(
        matches!(agent.status, opentelemetry::trace::Status::Error { .. }),
        "{agent:#?}"
    );
    assert_eq!(
        string_attribute(agent, attr::ERROR_TYPE).as_deref(),
        Some("streaming_error")
    );
    assert_eq!(
        string_array_attribute(agent, attr::RESPONSE_FINISH_REASONS),
        Some(vec!["error".to_string()])
    );
}

/// A tool that never returns, so a run can be abandoned mid-flight.
#[derive(Deserialize, JsonSchema)]
#[schemars(title = "hang_tool", description = "Never finishes.")]
struct HangTool {}

impl ToolAnnotated for HangTool {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("Hang");
}

#[async_trait]
impl AsyncTool<()> for HangTool {
    type Output = serde_json::Value;

    async fn call(
        &self,
        _service_context: ServiceContext<()>,
        _request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        std::future::pending().await
    }
}

/// A consumer that walks away from the stream cancels the run, and the agent
/// span says so rather than closing as if the agent had answered.
#[tokio::test]
async fn dropping_the_stream_marks_the_agent_span_cancelled() {
    let (exporter, provider, _guard) = otel_test_pipeline();
    let model = MockCompletionModel::from_stream_turns([vec![
        MockStreamEvent::tool_call("call-1", "hang_tool", json!({})),
        MockStreamEvent::final_response_with_default_usage(),
    ]]);
    let toolset = util::single_tool_set::<HangTool, ()>();
    let mut session = util::session(toolset, Arc::new(()), model).await;

    let mut stream = session
        .send_message(vec![rig_core::message::Message::user("hang")])
        .await
        .expect("the stream starts");
    // The tool call is announced the moment the model emits it, while the
    // tool itself hangs; walking away here abandons the run mid-tool.
    let first = util::next_within(&mut stream, std::time::Duration::from_secs(5)).await;
    assert!(first.is_some(), "the pending tool call is streamed");
    drop(stream);
    drop(session);
    // The aborted driver's destructors run on the runtime's next turns.
    for _ in 0..20 {
        tokio::task::yield_now().await;
    }

    let spans = finished(&exporter, &provider);
    let agent = spans_with_operation(&spans, attr::operation::INVOKE_AGENT)[0];
    assert_eq!(
        string_attribute(agent, attr::ERROR_TYPE).as_deref(),
        Some("cancelled"),
        "{}",
        describe(&spans)
    );
    assert_eq!(
        string_array_attribute(agent, attr::RESPONSE_FINISH_REASONS),
        Some(vec!["cancelled".to_string()])
    );
}

/// A tool that cancels the request it runs in, then returns: the runtime
/// notices the cancellation before its next model call and ends the run with
/// a cancellation error.
#[derive(Deserialize, JsonSchema)]
#[schemars(title = "cancel_tool", description = "Cancels the request.")]
struct CancelTool {}

impl ToolAnnotated for CancelTool {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("Cancel");
}

#[async_trait]
impl AsyncTool<()> for CancelTool {
    type Output = serde_json::Value;

    async fn call(
        &self,
        _service_context: ServiceContext<()>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        request_context.cancel.cancel();
        Ok(json!({ "status": "cancelling" }))
    }
}

/// A user stopping the run is a cancelled run, not a failed one, even though
/// the runtime reports it as an error item on the stream.
#[tokio::test]
async fn a_cancelled_run_is_recorded_as_cancelled_not_failed() {
    let (exporter, provider, _guard) = otel_test_pipeline();
    let model = MockCompletionModel::from_stream_turns([
        vec![
            MockStreamEvent::tool_call("call-1", "cancel_tool", json!({})),
            MockStreamEvent::final_response_with_default_usage(),
        ],
        vec![
            MockStreamEvent::text("never reached"),
            MockStreamEvent::final_response_with_default_usage(),
        ],
    ]);
    let toolset = util::single_tool_set::<CancelTool, ()>();
    let mut session = util::session(toolset, Arc::new(()), model).await;

    let stream = session
        .send_message(vec![rig_core::message::Message::user("stop soon")])
        .await
        .expect("the stream starts");
    let collected = util::collect(stream).await;
    assert!(
        collected
            .error
            .as_ref()
            .is_some_and(|error| error.was_cancelled()),
        "the run ends with a cancellation: {:?}",
        collected.error
    );
    drop(session);

    let spans = finished(&exporter, &provider);
    let agent = spans_with_operation(&spans, attr::operation::INVOKE_AGENT)[0];
    assert_eq!(
        string_attribute(agent, attr::ERROR_TYPE).as_deref(),
        Some("cancelled"),
        "{}",
        describe(&spans)
    );
    assert_eq!(
        string_array_attribute(agent, attr::RESPONSE_FINISH_REASONS),
        Some(vec!["cancelled".to_string()])
    );
}
