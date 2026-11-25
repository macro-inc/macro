//! The one-shot paths trace their single model call like the agent loop does.
use super::*;
use genai_telemetry::{ContentPolicy, attr};
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

/// The one-shot paths take the current content policy (`telemetry_for`), so
/// a structured call made inside `withhold_content` keeps its span's
/// structure and none of what it was told or answered.
#[tokio::test]
async fn a_structured_one_shot_inside_withhold_content_records_no_content() {
    let (exporter, provider, _guard) = otel_test_pipeline();
    let response = genai_telemetry::withhold_content(async {
        let telemetry = GenAiContext::new(None, "find".to_owned(), ContentPolicy::current(), true);
        let model = TracedModel::new(
            MockCompletionModel::new([MockTurn::text(r#"{"private":"answer"}"#)]),
            telemetry.clone(),
        );
        prompt_with_history(
            model,
            "private instructions",
            vec![Message::user("a private prompt")],
            telemetry,
            Some(serde_json::json!({"response_format": {"type": "json_object"}})),
        )
        .await
    })
    .await
    .expect("the completion succeeds");
    assert_eq!(response.output, r#"{"private":"answer"}"#);

    let spans = finished(&exporter, &provider);
    let chats = chat_spans(&spans);
    assert_eq!(chats.len(), 1, "{spans:#?}");
    assert_eq!(string_attribute(chats[0], attr::INPUT_MESSAGES), None);
    assert_eq!(string_attribute(chats[0], attr::OUTPUT_MESSAGES), None);
    for span in &spans {
        for kv in &span.attributes {
            let value = kv.value.to_string();
            assert!(!value.contains("private"), "{} carries {value}", kv.key);
        }
    }
}

/// A context built outside `withhold_content` with capture on records no
/// content for a call made inside the scope, answered or failed: its
/// recorders read the scope when they record.
#[tokio::test]
async fn a_context_built_before_withhold_content_records_no_content_inside_it() {
    let (exporter, provider, _guard) = otel_test_pipeline();
    for turn in [
        MockTurn::text(r#"{"private":"answer"}"#),
        MockTurn::error("upstream refused the private prompt"),
    ] {
        let telemetry = GenAiContext::new(None, "find".to_owned(), ContentPolicy::enabled(), true);
        let model = TracedModel::new(MockCompletionModel::new([turn]), telemetry.clone());
        let _ = genai_telemetry::withhold_content(prompt_with_history(
            model,
            "private instructions",
            vec![Message::user("a private prompt")],
            telemetry,
            None,
        ))
        .await;
    }

    let spans = finished(&exporter, &provider);
    assert_eq!(chat_spans(&spans).len(), 2, "{spans:#?}");
    for span in &spans {
        for kv in &span.attributes {
            let value = kv.value.to_string();
            assert!(!value.contains("private"), "{} carries {value}", kv.key);
        }
        if let Status::Error { description } = &span.status {
            assert!(!description.contains("private"), "{description}");
        }
    }
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

/// A failed call inside `withhold_content` keeps none of the provider's text:
/// not on its span, and not in the error its caller records.
#[tokio::test]
async fn a_failed_one_shot_inside_withhold_content_records_no_content() {
    let (exporter, provider, _guard) = otel_test_pipeline();
    let error = genai_telemetry::withhold_content(async {
        let telemetry = GenAiContext::new(None, "find".to_owned(), ContentPolicy::current(), true);
        let model = TracedModel::new(
            MockCompletionModel::new([MockTurn::error("cannot read the private answer")]),
            telemetry.clone(),
        );
        prompt_with_history(
            model,
            "private instructions",
            vec![Message::user("a private prompt")],
            telemetry,
            None,
        )
        .await
    })
    .await
    .expect_err("the completion fails");
    assert_eq!(
        format!("{error:#}"),
        "the model call failed with a provider error; its text is withheld with the call's content"
    );
    // Not "private" alone: with a backtrace, the error names `anyhow::__private`.
    for planted in ["private answer", "private instructions", "private prompt"] {
        assert!(!format!("{error:?}").contains(planted), "{error:?}");
    }

    let spans = finished(&exporter, &provider);
    let chats = chat_spans(&spans);
    assert_eq!(chats.len(), 1, "{spans:#?}");
    assert_eq!(
        string_attribute(chats[0], attr::ERROR_TYPE).as_deref(),
        Some("provider_error")
    );
    for span in &spans {
        let status = format!("{:?}", span.status);
        assert!(!status.contains("private"), "{} ends {status}", span.name);
        for kv in &span.attributes {
            let value = kv.value.to_string();
            assert!(!value.contains("private"), "{} carries {value}", kv.key);
        }
        for event in span.events.iter() {
            let text = format!("{} {:?}", event.name, event.attributes);
            assert!(!text.contains("private"), "{} records {text}", span.name);
        }
    }

    // Outside the scope the caller still gets the provider's text.
    let telemetry = GenAiContext::new(None, "find".to_owned(), ContentPolicy::current(), true);
    let model = TracedModel::new(
        MockCompletionModel::new([MockTurn::error("upstream is down")]),
        telemetry.clone(),
    );
    let error = prompt_with_history(
        model,
        "be brief",
        vec![Message::user("hi")],
        telemetry,
        None,
    )
    .await
    .expect_err("the completion fails");
    assert!(error.to_string().contains("upstream is down"), "{error}");
}

/// A minimal valid 1x1 PNG.
#[rustfmt::skip]
const ONE_BY_ONE_PNG: &[u8] = &[
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xDE, 0x00, 0x00, 0x00,
    0x0C, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63, 0xF8, 0xCF, 0xC0, 0x00,
    0x00, 0x03, 0x01, 0x01, 0x00, 0xC9, 0xFE, 0x92, 0xEF, 0x00, 0x00, 0x00,
    0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
];

#[test]
fn image_user_message_sends_the_instruction_and_a_webp() {
    use rig_core::message::{DocumentSourceKind, ImageMediaType, UserContent};

    let message =
        image_user_message("Describe this image.", ONE_BY_ONE_PNG.to_vec()).expect("a valid png");
    let Message::User { content } = message else {
        panic!("expected a user message");
    };
    let blocks: Vec<_> = content.into_iter().collect();
    assert_eq!(blocks.len(), 2);

    let UserContent::Text(text) = &blocks[0] else {
        panic!("expected the instruction first");
    };
    assert_eq!(text.text, "Describe this image.");

    let UserContent::Image(image) = &blocks[1] else {
        panic!("expected the image second");
    };
    assert_eq!(image.media_type, Some(ImageMediaType::WEBP));
    assert!(matches!(image.data, DocumentSourceKind::Base64(_)));
}

#[test]
fn image_user_message_rejects_bytes_that_are_not_an_image() {
    image_user_message("Describe this image.", b"not an image".to_vec())
        .expect_err("non-image bytes");
}

#[tokio::test]
async fn one_shot_history_preserves_provider_parameters_and_traces_the_response() {
    let (exporter, provider, _guard) = otel_test_pipeline();
    let telemetry = GenAiContext::new(None, "extract".to_owned(), ContentPolicy::enabled(), true);
    let mock = MockCompletionModel::new([MockTurn::text(r#"{"body":"hello"}"#)]);
    let model = TracedModel::new(mock.clone(), telemetry.clone());
    let params = serde_json::json!({
        "reasoning_effort": "none",
        "response_format": {"type": "json_schema", "json_schema": {
            "name": "Draft", "schema": {"type": "object"}
        }}
    });
    let response = prompt_with_history(
        model,
        "extract JSON",
        vec![Message::user("hello")],
        telemetry,
        Some(params.clone()),
    )
    .await
    .expect("completion succeeds");
    assert_eq!(response.output, r#"{"body":"hello"}"#);
    assert_eq!(mock.requests()[0].additional_params, Some(params));
    assert_eq!(mock.requests()[0].max_tokens, Some(ONE_SHOT_MAX_TOKENS));
    assert_eq!(chat_spans(&finished(&exporter, &provider)).len(), 1);
}

#[tokio::test]
async fn activated_one_shots_fail_before_routing_without_financial_capability() {
    use ai_usage::financial::{FinancialCapability, FinancialMode};
    use ai_usage::{AiFeature, NoOpUsageRecorder};

    let usage = UsageContext::system(AiFeature::DynamicCompletionsApi);
    let metering = MeteringContext::new(
        FinancialMode::Activated,
        FinancialCapability::Unavailable,
        usage.clone(),
        vec![],
    );
    metering
        .scope(async {
            let error = complete(
                "unknown/model",
                "system",
                "hello",
                &NoOpUsageRecorder,
                usage.clone(),
            )
            .await
            .unwrap_err();
            assert_eq!(error.to_string(), "financial capability unavailable");
            let error = complete_with_history(
                "unknown/model",
                "system",
                vec![Message::user("hello")],
                &NoOpUsageRecorder,
                usage.clone(),
            )
            .await
            .unwrap_err();
            assert_eq!(error.to_string(), "financial capability unavailable");
            let error = complete_with_history_and_params(
                "unknown/model",
                "system",
                vec![Message::user("hello")],
                Some(serde_json::json!({"reasoning_effort": "none"})),
                &NoOpUsageRecorder,
                usage,
            )
            .await
            .unwrap_err();
            assert_eq!(error.to_string(), "financial capability unavailable");
        })
        .await;
}
