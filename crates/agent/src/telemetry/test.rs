//! Unit tests for the rig → semconv message encoding.
use super::*;
use rig_core::message::{Text, ToolCall, ToolFunction, ToolResult};
use serde_json::json;

#[test]
fn user_text_becomes_a_user_message_with_a_text_part() {
    let encoded = message_json(&Message::user("hello"));
    assert_eq!(
        encoded,
        vec![json!({"role": "user", "parts": [{"type": "text", "content": "hello"}]})]
    );
}

#[test]
fn tool_results_become_a_tool_message() {
    let message = Message::User {
        content: OneOrMany::many([
            UserContent::ToolResult(ToolResult {
                id: "call-1".to_string(),
                call_id: None,
                content: OneOrMany::one(ToolResultContent::Json {
                    value: json!({ "echo": "a" }),
                }),
            }),
            UserContent::Text(Text {
                text: "and more".to_string(),
                additional_params: None,
            }),
        ])
        .expect("two items"),
    };
    let encoded = message_json(&message);
    assert_eq!(
        encoded,
        vec![
            json!({"role": "tool", "parts": [{"type": "tool_call_response", "id": "call-1", "response": {"echo": "a"}}]}),
            json!({"role": "user", "parts": [{"type": "text", "content": "and more"}]}),
        ]
    );
}

#[test]
fn assistant_tool_calls_and_text_are_parts_and_decide_the_finish_reason() {
    let content = OneOrMany::many([
        AssistantContent::Text(Text {
            text: "let me check".to_string(),
            additional_params: None,
        }),
        AssistantContent::ToolCall(ToolCall {
            id: "call-1".to_string(),
            call_id: None,
            function: ToolFunction {
                name: "echo_tool".to_string(),
                arguments: json!({ "value": "a" }),
            },
            signature: None,
            additional_params: None,
        }),
    ])
    .expect("two items");
    assert_eq!(
        assistant_parts(&content),
        vec![
            json!({"type": "text", "content": "let me check"}),
            json!({"type": "tool_call", "id": "call-1", "name": "echo_tool", "arguments": {"value": "a"}}),
        ]
    );
    assert_eq!(finish_reason(&content), attr::finish_reason::TOOL_CALL);
    assert_eq!(
        finish_reason(&OneOrMany::one(AssistantContent::text("done"))),
        attr::finish_reason::STOP
    );
}

#[test]
fn a_lone_text_tool_result_is_a_plain_string_and_several_items_an_array() {
    assert_eq!(
        tool_result_json(&OneOrMany::one(ToolResultContent::Text(Text {
            text: "ok".to_string(),
            additional_params: None,
        }))),
        json!("ok")
    );
    assert_eq!(
        tool_result_json(
            &OneOrMany::many([
                ToolResultContent::Text(Text {
                    text: "ok".to_string(),
                    additional_params: None,
                }),
                ToolResultContent::Json { value: json!(1) },
            ])
            .expect("two items")
        ),
        json!(["ok", 1])
    );
}

#[test]
fn finishing_a_run_releases_the_parked_chat_span() {
    use opentelemetry::trace::TracerProvider as _;
    use opentelemetry_sdk::trace::{InMemorySpanExporter, SdkTracerProvider};
    use tracing_subscriber::layer::SubscriberExt as _;

    let exporter = InMemorySpanExporter::default();
    let provider = SdkTracerProvider::builder()
        .with_simple_exporter(exporter.clone())
        .build();
    let layer = tracing_opentelemetry::layer().with_tracer(provider.tracer("test"));
    let _guard = tracing::subscriber::set_default(tracing_subscriber::registry().with(layer));
    tracing::callsite::rebuild_interest_cache();

    let telemetry = GenAiContext::new(None, "chat".to_owned(), ContentPolicy::enabled(), true);
    // A model call whose turn never finished: its span sits parked.
    *telemetry.0.chat_span.lock().unwrap() = Some(tracing::info_span!("chat"));
    provider.force_flush().unwrap();
    assert!(exporter.get_finished_spans().unwrap().is_empty());

    telemetry.finish_run();
    provider.force_flush().unwrap();
    assert_eq!(exporter.get_finished_spans().unwrap().len(), 1);
    assert!(telemetry.0.chat_span.lock().unwrap().is_none());
    // Idempotent.
    telemetry.finish_run();
}
