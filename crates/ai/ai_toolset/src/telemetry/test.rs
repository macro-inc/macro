use super::*;
use crate::{
    AsyncTool, AsyncToolCollection, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations,
    ToolCallError, ToolSet as _,
};
use async_trait::async_trait;
use macro_user_id::user_id::MacroUserIdStr;
use opentelemetry::Value;
use opentelemetry::trace::{Status, TracerProvider as _};
use opentelemetry_sdk::trace::{InMemorySpanExporter, SdkTracerProvider, SpanData};
use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::json;
use tracing::Instrument as _;
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

/// A tool that always fails.
#[derive(Deserialize, JsonSchema)]
#[schemars(title = "boom_tool", description = "Always fails.")]
struct BoomTool {}

impl ToolAnnotated for BoomTool {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("Boom");
}

#[async_trait]
impl AsyncTool<()> for BoomTool {
    type Output = serde_json::Value;

    async fn call(
        &self,
        _service_context: ServiceContext<()>,
        _request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        Err(ToolCallError {
            description: "boom failed".to_string(),
            internal_error: anyhow::anyhow!("boom"),
        })
    }
}

fn toolset() -> AsyncToolCollection<()> {
    AsyncToolCollection::<()>::new()
        .add_tool::<EchoTool, ()>()
        .add_tool::<BoomTool, ()>()
}

/// `echo_tool` registered as a user-executed (deferred) tool instead.
fn user_toolset() -> AsyncToolCollection<()> {
    AsyncToolCollection::<()>::new().add_user_tool::<EchoTool, ()>()
}

fn request_context() -> RequestContext {
    RequestContext::new(MacroUserIdStr::try_from_email("test@macro.com").expect("valid user id"))
}

/// An OpenTelemetry pipeline that keeps finished spans in memory, installed as
/// the thread's default subscriber for the returned guard's lifetime.
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

fn string_attribute(span: &SpanData, key: &str) -> Option<String> {
    span.attributes
        .iter()
        .find(|kv| kv.key.as_str() == key)
        .and_then(|kv| match &kv.value {
            Value::String(s) => Some(s.as_str().to_string()),
            _ => None,
        })
}

fn tool_spans(spans: &[SpanData]) -> Vec<&SpanData> {
    spans
        .iter()
        .filter(|span| span.name.starts_with("execute_tool"))
        .collect()
}

#[tokio::test]
async fn try_tool_call_opens_an_execute_tool_span_with_arguments_and_result() {
    let (exporter, provider, _guard) = otel_test_pipeline();
    let toolset = toolset();

    let result = toolset
        .try_tool_call((), request_context(), "echo_tool", &json!({ "value": "a" }))
        .await
        .expect("dispatch")
        .expect("tool success");
    assert_eq!(result, json!({ "echo": "a" }));

    let spans = finished(&exporter, &provider);
    let tool_spans = tool_spans(&spans);
    assert_eq!(tool_spans.len(), 1, "exactly one tool span, got {spans:#?}");
    let span = tool_spans[0];
    assert_eq!(span.name, "execute_tool echo_tool");
    assert_eq!(
        string_attribute(span, attr::OPERATION_NAME).as_deref(),
        Some("execute_tool")
    );
    assert_eq!(
        string_attribute(span, attr::TOOL_TYPE).as_deref(),
        Some("function")
    );
    assert_eq!(
        string_attribute(span, attr::TOOL_NAME).as_deref(),
        Some("echo_tool")
    );
    assert_eq!(
        string_attribute(span, attr::TOOL_CALL_ARGUMENTS).as_deref(),
        Some(r#"{"value":"a"}"#)
    );
    assert_eq!(
        string_attribute(span, attr::TOOL_CALL_RESULT).as_deref(),
        Some(r#"{"echo":"a"}"#)
    );
    assert_eq!(span.status, Status::Unset);
}

#[tokio::test]
async fn try_tool_call_enriches_an_open_execute_tool_span_instead_of_nesting() {
    let (exporter, provider, _guard) = otel_test_pipeline();
    let toolset = toolset();

    // The agent runtime opens `execute_tool` around the dispatch; the toolset
    // must add to it, not open a second tool span underneath.
    let runtime_span = tracing::info_span!("execute_tool");
    toolset
        .try_tool_call((), request_context(), "echo_tool", &json!({ "value": "b" }))
        .instrument(runtime_span)
        .await
        .expect("dispatch")
        .expect("tool success");

    let spans = finished(&exporter, &provider);
    let tool_spans = tool_spans(&spans);
    assert_eq!(tool_spans.len(), 1, "no nested tool span, got {spans:#?}");
    let span = tool_spans[0];
    assert_eq!(
        span.name, "execute_tool",
        "the runtime's span is kept as-is"
    );
    assert_eq!(
        string_attribute(span, attr::TOOL_CALL_ARGUMENTS).as_deref(),
        Some(r#"{"value":"b"}"#)
    );
    assert_eq!(
        string_attribute(span, attr::TOOL_CALL_RESULT).as_deref(),
        Some(r#"{"echo":"b"}"#)
    );
}

#[tokio::test]
async fn a_failing_tool_marks_the_span_failed_with_its_description_as_output() {
    let (exporter, provider, _guard) = otel_test_pipeline();
    let toolset = toolset();

    let result = toolset
        .try_tool_call((), request_context(), "boom_tool", &json!({}))
        .await
        .expect("dispatch");
    assert!(result.is_err());

    let spans = finished(&exporter, &provider);
    let span = tool_spans(&spans)[0];
    assert!(
        matches!(&span.status, Status::Error { description } if description == "boom failed"),
        "{:?}",
        span.status
    );
    assert_eq!(
        string_attribute(span, attr::ERROR_TYPE).as_deref(),
        Some("tool_error")
    );
    assert_eq!(
        string_attribute(span, attr::TOOL_CALL_RESULT).as_deref(),
        Some("boom failed")
    );
}

#[tokio::test]
async fn dispatch_errors_are_classified() {
    let (exporter, provider, _guard) = otel_test_pipeline();
    let toolset = toolset();

    assert!(matches!(
        toolset
            .try_tool_call((), request_context(), "missing_tool", &json!({}))
            .await,
        Err(ToolSetError::NotFound(_))
    ));
    assert!(matches!(
        toolset
            .try_tool_call((), request_context(), "echo_tool", &json!({ "wrong": 1 }))
            .await,
        Err(ToolSetError::Deserialization(_))
    ));

    let spans = finished(&exporter, &provider);
    let tool_spans = tool_spans(&spans);
    assert_eq!(tool_spans.len(), 2);
    assert_eq!(tool_spans[0].name, "execute_tool missing_tool");
    assert_eq!(
        string_attribute(tool_spans[0], attr::ERROR_TYPE).as_deref(),
        Some("tool_not_found")
    );
    assert_eq!(
        string_attribute(tool_spans[1], attr::ERROR_TYPE).as_deref(),
        Some("invalid_arguments")
    );
    assert!(
        tool_spans
            .iter()
            .all(|span| matches!(span.status, Status::Error { .. }))
    );
}

#[tokio::test]
async fn user_tool_calls_are_traced_too() {
    let (exporter, provider, _guard) = otel_test_pipeline();
    let toolset = user_toolset();

    toolset
        .try_user_tool_call((), request_context(), "echo_tool", &json!({ "value": "c" }))
        .await
        .expect("dispatch")
        .expect("tool success");

    let spans = finished(&exporter, &provider);
    let span = tool_spans(&spans)[0];
    assert_eq!(span.name, "execute_tool echo_tool");
    assert_eq!(
        string_attribute(span, attr::TOOL_CALL_ARGUMENTS).as_deref(),
        Some(r#"{"value":"c"}"#)
    );
    // The tool's own output, not the `UserToolResponse` API wrapper.
    assert_eq!(
        string_attribute(span, attr::TOOL_CALL_RESULT).as_deref(),
        Some(r#"{"echo":"c"}"#)
    );
}

#[tokio::test]
async fn content_capture_off_records_structure_only() {
    let (exporter, provider, _guard) = otel_test_pipeline();

    let guard = ToolCallSpan::begin_with_policy(
        "echo_tool",
        &json!({ "value": "secret" }),
        ContentPolicy::disabled(),
    );
    let result: Result<ToolResult<serde_json::Value>, ToolSetError> = Ok(Err(ToolCallError {
        description: "private failure".to_string(),
        internal_error: anyhow::anyhow!("boom"),
    }));
    guard.finish(&result);
    drop(guard);

    let spans = finished(&exporter, &provider);
    let span = tool_spans(&spans)[0];
    assert_eq!(
        string_attribute(span, attr::TOOL_NAME).as_deref(),
        Some("echo_tool")
    );
    assert_eq!(string_attribute(span, attr::TOOL_CALL_ARGUMENTS), None);
    assert_eq!(string_attribute(span, attr::TOOL_CALL_RESULT), None);
    // The failure itself is not content, but its description is.
    match &span.status {
        Status::Error { description } => {
            assert!(!description.contains("private failure"), "{description}");
        }
        other => panic!("expected an error status, got {other:?}"),
    }
}

#[tokio::test]
async fn oversized_content_is_bounded_and_flagged() {
    let (exporter, provider, _guard) = otel_test_pipeline();
    let toolset = toolset();

    let big = "x".repeat(20_000);
    toolset
        .try_tool_call((), request_context(), "echo_tool", &json!({ "value": big }))
        .await
        .expect("dispatch")
        .expect("tool success");

    let spans = finished(&exporter, &provider);
    let span = tool_spans(&spans)[0];
    let arguments = string_attribute(span, attr::TOOL_CALL_ARGUMENTS).expect("arguments");
    assert!(
        arguments.len() < 10_000,
        "arguments should be cut, got {} bytes",
        arguments.len()
    );
    assert!(arguments.contains("[truncated"), "{arguments}");
    assert_eq!(
        span.attributes
            .iter()
            .find(|kv| kv.key.as_str() == attr::MACRO_CONTENT_TRUNCATED)
            .map(|kv| kv.value.clone()),
        Some(Value::Bool(true))
    );
}

/// A request that opted out - another layer reports its tool calls - runs
/// its tools without `execute_tool` telemetry of their own.
#[tokio::test]
async fn a_request_that_opted_out_records_no_tool_span() {
    let (exporter, provider, _guard) = otel_test_pipeline();
    let toolset = toolset();

    toolset
        .try_tool_call(
            (),
            request_context().with_genai_telemetry(false),
            "echo_tool",
            &json!({ "value": "quiet" }),
        )
        .await
        .expect("dispatch")
        .expect("tool success");

    let spans = finished(&exporter, &provider);
    assert!(tool_spans(&spans).is_empty(), "{spans:#?}");
}
