//! The one-shot paths trace their single model call like the agent loop does.
use super::*;
use genai_telemetry::attr;
use opentelemetry::trace::{Status, TracerProvider as _};
use opentelemetry_sdk::trace::{InMemorySpanExporter, SdkTracerProvider, SpanData};
use rig_core::test_utils::{MockCompletionModel, MockTurn};
use tracing_subscriber::layer::SubscriberExt as _;

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
    tracing::callsite::rebuild_interest_cache();
    (exporter, provider, guard)
}

fn finished(exporter: &InMemorySpanExporter, provider: &SdkTracerProvider) -> Vec<SpanData> {
    provider.force_flush().expect("flush");
    exporter.get_finished_spans().expect("spans")
}

fn string_attribute(span: &SpanData, key: &str) -> Option<String> {
    span.attributes
        .iter()
        .find(|kv| kv.key.as_str() == key)
        .map(|kv| kv.value.to_string())
}

fn chat_spans(spans: &[SpanData]) -> Vec<&SpanData> {
    spans
        .iter()
        .filter(|span| {
            string_attribute(span, attr::OPERATION_NAME).as_deref() == Some(attr::operation::CHAT)
        })
        .collect()
}

#[tokio::test]
async fn a_one_shot_completion_traces_its_model_call() {
    let (exporter, provider, _guard) = otel_test_pipeline();
    let telemetry = GenAiContext::new(None, "summarize".to_owned(), ContentPolicy::enabled(), true);
    let model = TracedModel::new(
        MockCompletionModel::new([MockTurn::text("a summary")]),
        telemetry.clone(),
    );

    let response = prompt_once(model, "be brief", "summarize this", telemetry)
        .await
        .expect("the completion succeeds");
    assert_eq!(response.output, "a summary");

    let spans = finished(&exporter, &provider);
    let chats = chat_spans(&spans);
    assert_eq!(chats.len(), 1, "{spans:#?}");
    let chat = chats[0];
    assert_eq!(chat.status, Status::Unset);
    assert!(string_attribute(chat, attr::INPUT_MESSAGES).is_some());
    assert!(
        string_attribute(chat, attr::OUTPUT_MESSAGES)
            .is_some_and(|output| output.contains("a summary"))
    );
}

/// A provider that refuses the call leaves no turn for the hook to record, so
/// the traced model itself marks the call as failed.
#[tokio::test]
async fn a_failed_one_shot_completion_marks_its_chat_span() {
    let (exporter, provider, _guard) = otel_test_pipeline();
    let telemetry = GenAiContext::new(None, "summarize".to_owned(), ContentPolicy::enabled(), true);
    let model = TracedModel::new(
        MockCompletionModel::new([MockTurn::error("upstream is down")]),
        telemetry.clone(),
    );

    let error = prompt_once(model, "be brief", "summarize this", telemetry)
        .await
        .expect_err("the completion fails");
    assert!(error.to_string().contains("upstream is down"), "{error}");

    let spans = finished(&exporter, &provider);
    let chats = chat_spans(&spans);
    assert_eq!(chats.len(), 1, "{spans:#?}");
    let chat = chats[0];
    match &chat.status {
        Status::Error { description } => {
            assert!(description.contains("upstream is down"), "{description}");
        }
        other => panic!("expected an error status, got {other:?}"),
    }
    assert_eq!(
        string_attribute(chat, attr::ERROR_TYPE).as_deref(),
        Some("provider_error")
    );
    assert!(
        string_attribute(chat, attr::RESPONSE_FINISH_REASONS)
            .is_some_and(|reasons| reasons.contains("error"))
    );
    assert!(string_attribute(chat, attr::INPUT_MESSAGES).is_some());
    assert_eq!(string_attribute(chat, attr::OUTPUT_MESSAGES), None);
}
