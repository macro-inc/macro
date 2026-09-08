//! The projector over recorded sessions: which spans come out, with which
//! attributes, from the frames a live actor would feed it.

use super::*;
use crate::domain::model::Message;
use crate::domain::ports::SessionToolDefinition;
use crate::domain::session::CloseReason;
use agent_fold::testing::{fixtures, parse_log};
use opentelemetry::trace::{SpanId, Status, TraceContextExt as _, TracerProvider as _};
use opentelemetry::{Array, Value as OtelValue};
use opentelemetry_sdk::trace::{InMemorySpanExporter, SdkTracerProvider, SpanData};
use serde_json::json;
use tracing_opentelemetry::OpenTelemetrySpanExt as _;
use tracing_subscriber::layer::SubscriberExt as _;

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

fn attribute<'a>(span: &'a SpanData, key: &str) -> Option<&'a OtelValue> {
    span.attributes
        .iter()
        .find(|kv| kv.key.as_str() == key)
        .map(|kv| &kv.value)
}

fn string_attribute(span: &SpanData, key: &str) -> Option<String> {
    match attribute(span, key)? {
        OtelValue::String(s) => Some(s.to_string()),
        other => panic!("{key} is not a string: {other:?}"),
    }
}

fn int_attribute(span: &SpanData, key: &str) -> Option<i64> {
    match attribute(span, key)? {
        OtelValue::I64(i) => Some(*i),
        other => panic!("{key} is not an integer: {other:?}"),
    }
}

fn string_array_attribute(span: &SpanData, key: &str) -> Option<Vec<String>> {
    match attribute(span, key)? {
        OtelValue::Array(Array::String(values)) => {
            Some(values.iter().map(ToString::to_string).collect())
        }
        other => panic!("{key} is not a string array: {other:?}"),
    }
}

fn json_attribute(span: &SpanData, key: &str) -> Option<Value> {
    string_attribute(span, key).map(|json| serde_json::from_str(&json).expect("valid JSON"))
}

fn spans_named<'a>(spans: &'a [SpanData], name: &str) -> Vec<&'a SpanData> {
    spans.iter().filter(|span| span.name == name).collect()
}

fn projector(policy: ContentPolicy) -> GenAiProjector {
    GenAiProjector::new(
        AgentSessionId::TEST_A,
        policy,
        SharedToolDefinitions::default(),
    )
}

/// Feed a recorded log through the projector the way the actor does: frames
/// to the runtime through `on_outbound`, frames from it through `on_inbound`.
fn replay(projector: &mut GenAiProjector, jsonl: &str) {
    for entry in parse_log(jsonl) {
        match &entry.content {
            Message::ToRuntime(message) => projector.on_outbound(message, None),
            Message::ToServer(message) => projector.on_inbound(message),
        }
    }
}

#[test]
fn a_turn_becomes_an_agent_span_with_a_tool_span_per_call() {
    let (exporter, provider, _guard) = otel_test_pipeline();
    let mut projector = projector(ContentPolicy::enabled());
    replay(&mut projector, fixtures::TURN);
    let spans = finished(&exporter, &provider);

    let agent = spans_named(&spans, "invoke_agent");
    assert_eq!(agent.len(), 1, "one prompt, one agent span: {spans:#?}");
    let agent = agent[0];
    assert_eq!(
        string_attribute(agent, attr::OPERATION_NAME).as_deref(),
        Some("invoke_agent")
    );
    assert_eq!(
        string_attribute(agent, attr::CONVERSATION_ID).as_deref(),
        Some(AgentSessionId::TEST_A.to_string().as_str())
    );
    // The fixture's `initialize` names no agent; the harness is recognized
    // from the `_meta.claudeCode` namespace on its tool frames.
    assert_eq!(
        string_attribute(agent, attr::AGENT_NAME).as_deref(),
        Some("claude_code")
    );
    assert_eq!(
        string_array_attribute(agent, attr::RESPONSE_FINISH_REASONS),
        Some(vec!["stop".to_owned()])
    );
    assert_eq!(int_attribute(agent, attr::USAGE_INPUT_TOKENS), Some(10));
    assert_eq!(int_attribute(agent, attr::USAGE_OUTPUT_TOKENS), Some(8));
    assert_eq!(
        int_attribute(agent, attr::MACRO_CONTEXT_USED_TOKENS),
        Some(10)
    );
    assert_eq!(
        int_attribute(agent, attr::MACRO_CONTEXT_SIZE_TOKENS),
        Some(1_000_000)
    );

    let input = json_attribute(agent, attr::INPUT_MESSAGES).expect("input recorded");
    assert_eq!(
        input,
        json!([{ "role": "user", "parts": [{ "type": "text", "content": "list the examples and write a file" }] }])
    );
    let output = json_attribute(agent, attr::OUTPUT_MESSAGES).expect("output recorded");
    assert_eq!(output[0]["role"], "assistant");
    assert_eq!(output[0]["finish_reason"], "stop");
    let parts = output[0]["parts"].as_array().expect("parts");
    assert_eq!(
        parts[0],
        json!({ "type": "text", "content": "Sure, one moment." })
    );
    assert_eq!(parts[1]["type"], "tool_call");
    assert_eq!(parts[1]["id"], "tc-run");
    assert_eq!(parts[1]["name"], "Bash");
    assert_eq!(parts[1]["arguments"], json!({ "command": "ls examples" }));
    assert_eq!(parts[2]["type"], "tool_call");
    assert_eq!(parts[2]["name"], "Write");
    assert_eq!(parts[3], json!({ "type": "text", "content": "Done." }));

    let tools = spans_named(&spans, "execute_tool Bash");
    assert_eq!(tools.len(), 1, "one Bash call: {spans:#?}");
    let bash = tools[0];
    assert_eq!(
        bash.parent_span_id,
        agent.span_context.span_id(),
        "tool spans hang off the turn"
    );
    assert_eq!(
        string_attribute(bash, attr::TOOL_NAME).as_deref(),
        Some("Bash")
    );
    assert_eq!(
        string_attribute(bash, attr::TOOL_CALL_ID).as_deref(),
        Some("tc-run")
    );
    assert_eq!(
        string_attribute(bash, attr::MACRO_TOOL_KIND).as_deref(),
        Some("execute")
    );
    assert_eq!(
        json_attribute(bash, attr::TOOL_CALL_ARGUMENTS),
        Some(json!({ "command": "ls examples" }))
    );
    // No `rawOutput`; the terminal output in `_meta` is the result.
    let result = string_attribute(bash, attr::TOOL_CALL_RESULT).expect("result recorded");
    assert!(
        result.contains("events.rs"),
        "terminal output recorded: {result}"
    );
    assert_eq!(bash.status, Status::Unset);

    let write = spans_named(&spans, "execute_tool Write");
    assert_eq!(write.len(), 1);
    assert_eq!(write[0].parent_span_id, agent.span_context.span_id());
    // The tool spans close before the turn does.
    assert!(bash.end_time <= agent.end_time);
}

#[test]
fn the_harness_announced_by_initialize_names_the_agent() {
    let (exporter, provider, _guard) = otel_test_pipeline();
    let mut projector = projector(ContentPolicy::enabled());
    replay(
        &mut projector,
        include_str!("../../../../../agent_fold/fixtures/real/real_single_turn.jsonl"),
    );
    let spans = finished(&exporter, &provider);

    let agent = spans_named(&spans, "invoke_agent");
    assert_eq!(agent.len(), 1);
    assert_eq!(
        string_attribute(agent[0], attr::AGENT_NAME).as_deref(),
        Some("claude_code")
    );
    assert_eq!(int_attribute(agent[0], attr::USAGE_INPUT_TOKENS), Some(2));
    assert_eq!(int_attribute(agent[0], attr::USAGE_OUTPUT_TOKENS), Some(29));
    let output = json_attribute(agent[0], attr::OUTPUT_MESSAGES).expect("output");
    assert_eq!(
        output[0]["parts"][0]["content"],
        "Hey! What are we working on today?"
    );
}

#[test]
fn usage_is_recorded_per_turn_from_the_running_totals() {
    let (exporter, provider, _guard) = otel_test_pipeline();
    let mut projector = projector(ContentPolicy::enabled());
    replay(
        &mut projector,
        include_str!("../../../../../agent_fold/fixtures/real/real_multi_turn.jsonl"),
    );
    let spans = finished(&exporter, &provider);

    let agents = spans_named(&spans, "invoke_agent");
    assert!(agents.len() > 1, "a multi-turn recording: {}", agents.len());
    let first = agents
        .iter()
        .min_by_key(|span| span.start_time)
        .expect("a first turn");
    assert_eq!(int_attribute(first, attr::USAGE_OUTPUT_TOKENS), Some(2161));
    // Every later turn reports its increase, never the total so far.
    let total: i64 = agents
        .iter()
        .filter_map(|span| int_attribute(span, attr::USAGE_OUTPUT_TOKENS))
        .sum();
    assert_eq!(total, 48946, "the turns' shares add up to the final total");
}

#[test]
fn a_failed_mcp_call_marks_its_span_and_unwraps_the_envelope() {
    let (exporter, provider, _guard) = otel_test_pipeline();
    let mut projector = projector(ContentPolicy::enabled());
    replay(&mut projector, fixtures::MACRO_MCP);
    let spans = finished(&exporter, &provider);

    let tools: Vec<_> = spans
        .iter()
        .filter(|span| span.name.starts_with("execute_tool "))
        .collect();
    assert!(!tools.is_empty(), "tool spans: {spans:#?}");
    for tool in &tools {
        assert_eq!(
            string_attribute(tool, attr::MACRO_MCP_SERVER).as_deref(),
            Some("macro"),
            "Macro's tools are reached over its MCP server: {tool:#?}"
        );
        // The MCP `CallToolResult` envelope is not what the tool returned:
        // a text result is recorded as its bare text, a structured one as
        // its own JSON, never `{"content": [...], "isError": ...}`.
        if let Some(result) = string_attribute(tool, attr::TOOL_CALL_RESULT) {
            assert!(
                !result.contains("\"isError\""),
                "envelope unwrapped: {result}"
            );
        }
    }
    let failed: Vec<_> = tools
        .iter()
        .filter(|span| matches!(span.status, Status::Error { .. }))
        .collect();
    assert_eq!(failed.len(), 1, "one failed call: {tools:#?}");
    assert_eq!(
        string_attribute(failed[0], attr::ERROR_TYPE).as_deref(),
        Some("tool_error")
    );
}

#[test]
fn a_stopped_connection_ends_the_turn_and_its_tools_in_error() {
    let (exporter, provider, _guard) = otel_test_pipeline();
    let mut projector = projector(ContentPolicy::enabled());
    // Everything up to, not including, the prompt's answer.
    let frames: Vec<&str> = fixtures::TURN.lines().collect();
    let truncated = frames[..frames.len() - 3].join("\n");
    replay(&mut projector, &truncated);
    projector.on_stopped(&StopReason::Closed(CloseReason::TransportClosed));
    let spans = finished(&exporter, &provider);

    let agent = spans_named(&spans, "invoke_agent");
    assert_eq!(agent.len(), 1);
    assert!(matches!(agent[0].status, Status::Error { .. }));
    assert_eq!(
        string_attribute(agent[0], attr::ERROR_TYPE).as_deref(),
        Some("session_stopped")
    );
    assert_eq!(
        string_array_attribute(agent[0], attr::RESPONSE_FINISH_REASONS),
        Some(vec!["error".to_owned()])
    );
    // The Write call had not finished when the connection dropped.
    let write = spans_named(&spans, "execute_tool Write");
    assert_eq!(write.len(), 1);
    assert!(matches!(write[0].status, Status::Error { .. }));
    assert_eq!(
        string_attribute(write[0], attr::ERROR_TYPE).as_deref(),
        Some("abandoned")
    );
}

#[test]
fn a_refused_prompt_ends_the_turn_in_error() {
    let (exporter, provider, _guard) = otel_test_pipeline();
    let mut projector = projector(ContentPolicy::enabled());
    let prompt = RawJsonRpcMessage::request(
        "session/prompt".to_owned(),
        json!({ "sessionId": "s1", "prompt": [{ "type": "text", "text": "hi" }] }),
        RequestId::Str("p1".to_owned()),
    )
    .expect("a request");
    projector.on_outbound(&ToRuntimeMessage::Acp(AcpMessage(prompt)), None);
    projector.on_inbound(&ToServerMessage::Acp(AcpMessage(
        RawJsonRpcMessage::response(
            RequestId::Str("p1".to_owned()),
            Err(agent_client_protocol::Error::internal_error()),
        ),
    )));
    let spans = finished(&exporter, &provider);

    let agent = spans_named(&spans, "invoke_agent");
    assert_eq!(agent.len(), 1);
    assert_eq!(
        string_attribute(agent[0], attr::ERROR_TYPE).as_deref(),
        Some("prompt_refused")
    );
    assert_eq!(
        string_array_attribute(agent[0], attr::RESPONSE_FINISH_REASONS),
        Some(vec!["error".to_owned()])
    );
}

#[test]
fn content_is_not_recorded_when_capture_is_off() {
    let (exporter, provider, _guard) = otel_test_pipeline();
    let mut projector = projector(ContentPolicy::disabled());
    replay(&mut projector, fixtures::TURN);
    let spans = finished(&exporter, &provider);

    let agent = spans_named(&spans, "invoke_agent")[0];
    assert!(attribute(agent, attr::INPUT_MESSAGES).is_none());
    assert!(attribute(agent, attr::OUTPUT_MESSAGES).is_none());
    // Structure stays.
    assert_eq!(
        string_array_attribute(agent, attr::RESPONSE_FINISH_REASONS),
        Some(vec!["stop".to_owned()])
    );
    assert_eq!(int_attribute(agent, attr::USAGE_OUTPUT_TOKENS), Some(8));

    let bash = spans_named(&spans, "execute_tool Bash")[0];
    assert!(attribute(bash, attr::TOOL_CALL_ARGUMENTS).is_none());
    assert!(attribute(bash, attr::TOOL_CALL_RESULT).is_none());
    assert_eq!(
        string_attribute(bash, attr::TOOL_NAME).as_deref(),
        Some("Bash")
    );
}

#[test]
fn published_tool_definitions_reach_the_turn_and_describe_its_calls() {
    let (exporter, provider, _guard) = otel_test_pipeline();
    let definitions = SharedToolDefinitions::default();
    let mut projector = GenAiProjector::new(
        AgentSessionId::TEST_A,
        ContentPolicy::enabled(),
        definitions.clone(),
    );
    definitions.publish(vec![
        SessionToolDefinition {
            name: "mcp__macro__ReadContent".to_owned(),
            description: "Read a document.".to_owned(),
            parameters: json!({ "type": "object", "properties": { "id": { "type": "string" } } }),
        },
        SessionToolDefinition {
            name: "mcp__linear__create_issue".to_owned(),
            description: "Create a Linear issue.".to_owned(),
            parameters: json!({ "type": "object" }),
        },
    ]);
    replay(&mut projector, fixtures::MACRO_MCP);
    let spans = finished(&exporter, &provider);

    let agent = spans_named(&spans, "invoke_agent");
    assert!(!agent.is_empty());
    let listed = json_attribute(agent[0], attr::TOOL_DEFINITIONS).expect("definitions recorded");
    assert_eq!(listed[0]["name"], "mcp__macro__ReadContent");
    assert_eq!(listed[0]["description"], "Read a document.");
    assert_eq!(listed[1]["name"], "mcp__linear__create_issue");

    let read = spans
        .iter()
        .find(|span| string_attribute(span, attr::TOOL_NAME).as_deref() == Some("ReadContent"))
        .expect("a ReadContent call in the fixture");
    assert_eq!(
        string_attribute(read, attr::TOOL_DESCRIPTION).as_deref(),
        Some("Read a document.")
    );
}

#[test]
fn definitions_published_after_the_prompt_are_recorded_when_the_turn_closes() {
    let (exporter, provider, _guard) = otel_test_pipeline();
    let definitions = SharedToolDefinitions::default();
    let mut projector = GenAiProjector::new(
        AgentSessionId::TEST_A,
        ContentPolicy::enabled(),
        definitions.clone(),
    );
    let frames: Vec<&str> = fixtures::TURN.lines().collect();
    // Up to and including the prompt.
    replay(&mut projector, &frames[..4].join("\n"));
    definitions.publish(vec![SessionToolDefinition {
        name: "mcp__linear__create_issue".to_owned(),
        description: "Create a Linear issue.".to_owned(),
        parameters: json!({ "type": "object" }),
    }]);
    replay(&mut projector, &frames[4..].join("\n"));
    let spans = finished(&exporter, &provider);

    let agent = spans_named(&spans, "invoke_agent")[0];
    let listed = json_attribute(agent, attr::TOOL_DEFINITIONS).expect("definitions recorded");
    assert_eq!(listed.as_array().map(Vec::len), Some(1));
}

#[test]
fn macro_tools_are_listed_by_their_bare_names_for_the_in_process_agent() {
    let (exporter, provider, _guard) = otel_test_pipeline();
    let definitions = SharedToolDefinitions::default();
    let mut projector = GenAiProjector::new(
        AgentSessionId::TEST_A,
        ContentPolicy::enabled(),
        definitions.clone(),
    );
    definitions.publish(vec![
        SessionToolDefinition {
            name: "mcp__macro__ReadContent".to_owned(),
            description: "Read a document.".to_owned(),
            parameters: json!({ "type": "object" }),
        },
        SessionToolDefinition {
            name: "mcp__linear__create_issue".to_owned(),
            description: "Create a Linear issue.".to_owned(),
            parameters: json!({ "type": "object" }),
        },
    ]);
    replay(&mut projector, fixtures::SUBAGENT_MACRO_INMEM);
    let spans = finished(&exporter, &provider);

    let agent = spans_named(&spans, "invoke_agent");
    assert!(!agent.is_empty(), "{spans:#?}");
    assert_eq!(
        string_attribute(agent[0], attr::AGENT_NAME).as_deref(),
        Some("macro")
    );
    let listed = json_attribute(agent[0], attr::TOOL_DEFINITIONS).expect("definitions recorded");
    assert_eq!(listed[0]["name"], "ReadContent");
    assert_eq!(listed[1]["name"], "mcp__linear__create_issue");
}

#[test]
fn the_turn_hangs_off_the_command_that_carried_the_prompt() {
    let (exporter, provider, _guard) = otel_test_pipeline();
    let mut projector = projector(ContentPolicy::enabled());
    let command = tracing::info_span!("agent.session.command");
    let command_id = command.context().span().span_context().span_id();
    assert_ne!(command_id, SpanId::INVALID);
    let prompt = RawJsonRpcMessage::request(
        "session/prompt".to_owned(),
        json!({ "sessionId": "s1", "prompt": [{ "type": "text", "text": "hi" }] }),
        RequestId::Str("p1".to_owned()),
    )
    .expect("a request");
    projector.on_outbound(&ToRuntimeMessage::Acp(AcpMessage(prompt)), Some(&command));
    projector.on_inbound(&ToServerMessage::Acp(AcpMessage(
        RawJsonRpcMessage::response(
            RequestId::Str("p1".to_owned()),
            Ok(json!({ "stopReason": "cancelled" })),
        ),
    )));
    drop(command);
    let spans = finished(&exporter, &provider);

    let agent = spans_named(&spans, "invoke_agent");
    assert_eq!(agent.len(), 1);
    assert_eq!(agent[0].parent_span_id, command_id);
    assert_eq!(
        string_array_attribute(agent[0], attr::RESPONSE_FINISH_REASONS),
        Some(vec!["cancelled".to_owned()])
    );
    // No harness ever announced itself and no tool frame gave it away.
    assert_eq!(
        string_attribute(agent[0], attr::AGENT_NAME).as_deref(),
        Some("unknown")
    );
}

#[test]
fn the_model_comes_from_the_runtime_config_options() {
    let (exporter, provider, _guard) = otel_test_pipeline();
    let mut projector = projector(ContentPolicy::enabled());
    let open = RawJsonRpcMessage::request(
        "session/new".to_owned(),
        json!({ "cwd": "/w", "mcpServers": [] }),
        RequestId::Str("n1".to_owned()),
    )
    .expect("a request");
    projector.on_outbound(&ToRuntimeMessage::Acp(AcpMessage(open)), None);
    projector.on_inbound(&ToServerMessage::Acp(AcpMessage(
        RawJsonRpcMessage::response(
            RequestId::Str("n1".to_owned()),
            Ok(json!({
                "sessionId": "s1",
                "configOptions": [{
                    "id": "model",
                    "name": "Model",
                    "category": "model",
                    "type": "select",
                    "currentValue": "claude-opus-5",
                    "options": [{ "value": "claude-opus-5", "name": "Opus" }]
                }]
            })),
        ),
    )));
    let prompt = RawJsonRpcMessage::request(
        "session/prompt".to_owned(),
        json!({ "sessionId": "s1", "prompt": [{ "type": "text", "text": "hi" }] }),
        RequestId::Str("p1".to_owned()),
    )
    .expect("a request");
    projector.on_outbound(&ToRuntimeMessage::Acp(AcpMessage(prompt)), None);
    projector.on_inbound(&ToServerMessage::Acp(AcpMessage(
        RawJsonRpcMessage::response(
            RequestId::Str("p1".to_owned()),
            Ok(json!({ "stopReason": "max_tokens" })),
        ),
    )));
    let spans = finished(&exporter, &provider);

    let agent = spans_named(&spans, "invoke_agent")[0];
    assert_eq!(
        string_attribute(agent, attr::REQUEST_MODEL).as_deref(),
        Some("claude-opus-5")
    );
    assert_eq!(
        string_array_attribute(agent, attr::RESPONSE_FINISH_REASONS),
        Some(vec!["length".to_owned()])
    );
}

#[test]
fn oversized_tool_results_are_cut_and_marked() {
    let (exporter, provider, _guard) = otel_test_pipeline();
    let mut projector = projector(ContentPolicy {
        capture: true,
        limits: genai_telemetry::Limits {
            max_part_chars: 16,
            max_attribute_bytes: 64,
        },
    });
    let call = RawJsonRpcMessage::notification(
        "session/update".to_owned(),
        json!({
            "sessionId": "s1",
            "update": {
                "sessionUpdate": "tool_call",
                "toolCallId": "t1",
                "title": "Read",
                "kind": "read",
                "status": "completed",
                "rawInput": { "path": "/a" },
                "rawOutput": { "text": "x".repeat(500) }
            }
        }),
    )
    .expect("a notification");
    projector.on_inbound(&ToServerMessage::Acp(AcpMessage(call)));
    let spans = finished(&exporter, &provider);

    let read = spans_named(&spans, "execute_tool Read");
    assert_eq!(read.len(), 1, "a call outside any turn still gets a span");
    assert_eq!(read[0].parent_span_id, SpanId::INVALID);
    let result = string_attribute(read[0], attr::TOOL_CALL_RESULT).expect("result");
    assert!(result.len() <= 64, "cut to the budget: {}", result.len());
    assert_eq!(
        attribute(read[0], attr::MACRO_CONTENT_TRUNCATED),
        Some(&OtelValue::Bool(true))
    );
}

#[test]
fn a_tool_call_opened_outside_any_turn_survives_a_later_turn_ending() {
    let (exporter, provider, _guard) = otel_test_pipeline();
    let mut projector = projector(ContentPolicy::enabled());
    // A call streamed by a resumed session, before this connection prompts.
    let open = RawJsonRpcMessage::notification(
        "session/update".to_owned(),
        json!({
            "sessionId": "s1",
            "update": {
                "sessionUpdate": "tool_call",
                "toolCallId": "bg-1",
                "title": "Bash",
                "kind": "execute",
                "status": "in_progress",
                "rawInput": { "command": "sleep 60" }
            }
        }),
    )
    .expect("a notification");
    projector.on_inbound(&ToServerMessage::Acp(AcpMessage(open)));

    // A whole turn passes.
    let prompt = RawJsonRpcMessage::request(
        "session/prompt".to_owned(),
        json!({ "sessionId": "s1", "prompt": [{ "type": "text", "text": "hi" }] }),
        RequestId::Str("p1".to_owned()),
    )
    .expect("a request");
    projector.on_outbound(&ToRuntimeMessage::Acp(AcpMessage(prompt)), None);
    projector.on_inbound(&ToServerMessage::Acp(AcpMessage(
        RawJsonRpcMessage::response(
            RequestId::Str("p1".to_owned()),
            Ok(json!({ "stopReason": "end_turn" })),
        ),
    )));

    // Then the background call finishes, and its span records that.
    let done = RawJsonRpcMessage::notification(
        "session/update".to_owned(),
        json!({
            "sessionId": "s1",
            "update": {
                "sessionUpdate": "tool_call_update",
                "toolCallId": "bg-1",
                "status": "completed",
                "rawOutput": { "exit": 0 }
            }
        }),
    )
    .expect("a notification");
    projector.on_inbound(&ToServerMessage::Acp(AcpMessage(done)));
    let spans = finished(&exporter, &provider);

    let bash = spans_named(&spans, "execute_tool Bash");
    assert_eq!(bash.len(), 1, "{spans:#?}");
    assert_eq!(bash[0].status, Status::Unset, "not abandoned by the turn");
    assert_eq!(
        json_attribute(bash[0], attr::TOOL_CALL_RESULT),
        Some(json!({ "exit": 0 }))
    );
    assert!(bash[0].end_time >= spans_named(&spans, "invoke_agent")[0].end_time);
}

#[test]
fn attached_resources_are_named_not_copied() {
    let (exporter, provider, _guard) = otel_test_pipeline();
    let mut projector = projector(ContentPolicy::enabled());
    let prompt = RawJsonRpcMessage::request(
        "session/prompt".to_owned(),
        json!({
            "sessionId": "s1",
            "prompt": [
                { "type": "text", "text": "summarize this" },
                { "type": "resource", "resource": {
                    "uri": "https://user:secret@files.example.com/doc.md?sig=abc",
                    "mimeType": "text/markdown",
                    "text": "CONFIDENTIAL BODY"
                } },
                { "type": "resource_link", "name": "notes", "uri": "macro://doc/42#p3" }
            ]
        }),
        RequestId::Str("p1".to_owned()),
    )
    .expect("a request");
    projector.on_outbound(&ToRuntimeMessage::Acp(AcpMessage(prompt)), None);
    projector.on_inbound(&ToServerMessage::Acp(AcpMessage(
        RawJsonRpcMessage::response(
            RequestId::Str("p1".to_owned()),
            Ok(json!({ "stopReason": "end_turn" })),
        ),
    )));
    let spans = finished(&exporter, &provider);

    let agent = spans_named(&spans, "invoke_agent")[0];
    let input = string_attribute(agent, attr::INPUT_MESSAGES).expect("input recorded");
    assert!(input.contains("summarize this"));
    assert!(!input.contains("CONFIDENTIAL BODY"), "{input}");
    assert!(!input.contains("secret"), "{input}");
    assert!(!input.contains("sig=abc"), "{input}");
    let parsed: Value = serde_json::from_str(&input).expect("valid JSON");
    assert_eq!(parsed[0]["parts"][1]["type"], "uri");
    assert_eq!(
        parsed[0]["parts"][1]["uri"],
        "https://files.example.com/doc.md"
    );
    assert_eq!(parsed[0]["parts"][2]["uri"], "macro://doc/42");
}

#[test]
fn tool_error_text_follows_the_content_policy() {
    let failing_call = |id: &str| {
        RawJsonRpcMessage::notification(
            "session/update".to_owned(),
            json!({
                "sessionId": "s1",
                "update": {
                    "sessionUpdate": "tool_call",
                    "toolCallId": id,
                    "title": "Read",
                    "kind": "read",
                    "status": "failed",
                    "rawOutput": {
                        "content": [{ "type": "text", "text": "permission denied: /home/eric/.ssh/id_rsa" }],
                        "isError": true
                    }
                }
            }),
        )
        .expect("a notification")
    };

    let (exporter, provider, guard) = otel_test_pipeline();
    let mut quiet = projector(ContentPolicy::disabled());
    quiet.on_inbound(&ToServerMessage::Acp(AcpMessage(failing_call("t1"))));
    let spans = finished(&exporter, &provider);
    match &spans_named(&spans, "execute_tool Read")[0].status {
        Status::Error { description } => {
            assert!(!description.contains("id_rsa"), "{description}");
        }
        other => panic!("expected an error status, got {other:?}"),
    }
    drop(guard);

    let (exporter, provider, _guard) = otel_test_pipeline();
    let mut verbose = projector(ContentPolicy::enabled());
    verbose.on_inbound(&ToServerMessage::Acp(AcpMessage(failing_call("t2"))));
    let spans = finished(&exporter, &provider);
    match &spans_named(&spans, "execute_tool Read")[0].status {
        Status::Error { description } => {
            assert!(description.contains("permission denied"), "{description}");
        }
        other => panic!("expected an error status, got {other:?}"),
    }
}
