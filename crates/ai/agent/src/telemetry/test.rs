//! Unit tests for the rig → semconv message encoding.
use super::*;
use rig_core::completion::ToolDefinition;
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

#[test]
fn every_model_call_records_its_size_by_part_even_with_telemetry_off() {
    use opentelemetry::trace::TracerProvider as _;
    use opentelemetry_sdk::trace::{InMemorySpanExporter, SdkTracerProvider};
    use tracing_subscriber::layer::SubscriberExt as _;

    use crate::system_prompt::PromptSection;

    let exporter = InMemorySpanExporter::default();
    let provider = SdkTracerProvider::builder()
        .with_simple_exporter(exporter.clone())
        .build();
    let layer = tracing_opentelemetry::layer().with_tracer(provider.tracer("test"));
    let _guard = tracing::subscriber::set_default(tracing_subscriber::registry().with(layer));
    tracing::callsite::rebuild_interest_cache();

    // The in-memory runtime's configuration: GenAI content and usage off.
    let telemetry = GenAiContext::new(
        None,
        "agent_session".to_owned(),
        ContentPolicy::enabled(),
        false,
    );
    let mut system_prompt = SystemPrompt::default();
    system_prompt.push_shared(PromptSection::Preamble, "You are Macro.\n");
    system_prompt.push(PromptSection::Memory, "prefers Rust");
    telemetry.set_prompt(
        &system_prompt,
        &[SearchableTool {
            name: "linear_search".to_owned(),
            description: "Search Linear".to_owned(),
            schema: serde_json::from_value(json!({"type": "object"})).unwrap(),
        }],
    );
    let request = CompletionRequest {
        model: None,
        preamble: Some(system_prompt.to_string()),
        chat_history: OneOrMany::many([
            Message::System {
                content: "per-session part".to_owned(),
            },
            Message::user("hello"),
            Message::Assistant {
                id: None,
                content: OneOrMany::one(AssistantContent::ToolCall(ToolCall {
                    id: "call-1".to_owned(),
                    call_id: None,
                    function: ToolFunction {
                        name: "linear_search".to_owned(),
                        arguments: json!({}),
                    },
                    signature: None,
                    additional_params: None,
                })),
            },
            Message::User {
                content: OneOrMany::one(UserContent::ToolResult(ToolResult {
                    id: "call-1".to_owned(),
                    call_id: None,
                    content: OneOrMany::one(ToolResultContent::Text(Text {
                        text: "x".repeat(1000),
                        additional_params: None,
                    })),
                })),
            },
        ])
        .unwrap(),
        documents: Vec::new(),
        tools: vec![
            ToolDefinition {
                name: "ContentSearch".to_owned(),
                description: "Search content".to_owned(),
                parameters: json!({"type": "object"}),
            },
            ToolDefinition {
                name: "linear_search".to_owned(),
                description: "Search Linear".to_owned(),
                parameters: json!({"type": "object"}),
            },
        ],
        temperature: None,
        max_tokens: None,
        tool_choice: None,
        additional_params: None,
        output_schema: None,
        record_telemetry_content: false,
    };

    tracing::info_span!("chat_streaming").in_scope(|| telemetry.record_request(&request));
    telemetry.finish_run();
    provider.force_flush().unwrap();

    let spans = exporter.get_finished_spans().unwrap();
    let attributes: std::collections::HashMap<String, String> = spans[0]
        .attributes
        .iter()
        .map(|kv| (kv.key.to_string(), kv.value.to_string()))
        .collect();
    let field = |key: &str| attributes.get(key).map(String::as_str);
    assert_eq!(field("macro.genai.prompt.preamble.bytes"), Some("15"));
    assert_eq!(field("macro.genai.prompt.memory.bytes"), Some("12"));
    assert_eq!(
        field("macro.genai.prompt.memory.hash"),
        Some("27cbbf6fb8677c79")
    );
    assert_eq!(field("macro.genai.prompt.tools.eager.count"), Some("1"));
    assert_eq!(field("macro.genai.prompt.tools.loaded.count"), Some("1"));
    assert_eq!(field("macro.genai.prompt.messages"), Some("3"));
    assert_eq!(field("macro.genai.prompt.tool_results.count"), Some("1"));
    assert_eq!(field("macro.genai.prompt.tool_results.bytes"), Some("1073"));
    assert_eq!(field("macro.genai.prompt.history.bytes"), Some("153"));
    // No content: the prompt and messages stay off the span.
    assert_eq!(field(attr::SYSTEM_INSTRUCTIONS), None);
    assert_eq!(field(attr::INPUT_MESSAGES), None);
}
