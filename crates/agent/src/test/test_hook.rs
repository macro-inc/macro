use crate::hook::*;
use crate::stream::{StreamPart, ToolResponse};
use ai_toolset::SearchableTool;
use rig_agent::agent::{InvalidToolCallAction, ToolCallAction};
use rig_agent::tool::ToolOutput;
use schemars::Schema;
use std::pin::Pin;
use std::sync::Arc;
use std::sync::Mutex;
use tokio_util::sync::CancellationToken;

fn searchable(name: &str) -> SearchableTool {
    SearchableTool {
        name: name.to_string(),
        description: "desc".to_string(),
        schema: Schema::default(),
    }
}

/// A register fn that records the names it was handed.
fn recording_register() -> (RegisterFn, Arc<Mutex<Vec<String>>>) {
    let recorded = Arc::new(Mutex::new(Vec::<String>::new()));
    let sink = recorded.clone();
    let register: RegisterFn = Arc::new(move |tools: Vec<SearchableTool>| {
        let sink = sink.clone();
        Box::pin(async move {
            sink.lock()
                .unwrap()
                .extend(tools.into_iter().map(|t| t.name));
        }) as Pin<Box<dyn Future<Output = ()> + Send>>
    });
    (register, recorded)
}

/// Bridge inputs with no routing and `register` as the registrar; the caller
/// supplies the loaded-tool buffer.
fn inputs(loaded_buffer: Arc<Mutex<Vec<SearchableTool>>>, register: RegisterFn) -> BridgeInputs {
    BridgeInputs {
        routing: Arc::new(|_| None),
        loaded_buffer,
        register_loaded: register,
        tool_loads: ToolLoads::default(),
        stream_tool_calls: false,
        result_limit: None,
    }
}

#[tokio::test]
async fn on_tool_result_drains_buffer_and_registers_loaded_tools() {
    let buffer = Arc::new(Mutex::new(vec![
        searchable("mcp__slack__send"),
        searchable("mcp__linear__create_issue"),
    ]));
    let (register, registered) = recording_register();
    let token = CancellationToken::new();
    let (bridge, _rx) =
        StreamBridge::channel(inputs(buffer.clone(), register), Arc::new(vec![]), token);

    bridge
        .handle_tool_result(
            "SearchTools",
            None,
            "call-1",
            "{}",
            &ToolOutput::json(serde_json::json!({"loaded": []})),
            true,
        )
        .await;

    // Buffer drained and both pending tools handed to the registrar.
    assert!(buffer.lock().unwrap().is_empty());
    let mut got = registered.lock().unwrap().clone();
    got.sort();
    assert_eq!(
        got,
        vec![
            "mcp__linear__create_issue".to_string(),
            "mcp__slack__send".to_string()
        ]
    );
}

#[tokio::test]
async fn on_tool_result_registers_nothing_when_buffer_empty() {
    let buffer = Arc::new(Mutex::new(Vec::new()));
    let (register, registered) = recording_register();
    let token = CancellationToken::new();
    let (bridge, _rx) = StreamBridge::channel(inputs(buffer, register), Arc::new(vec![]), token);

    bridge
        .handle_tool_result(
            "WebSearch",
            None,
            "call-2",
            "{}",
            &ToolOutput::json(serde_json::json!({})),
            true,
        )
        .await;

    assert!(registered.lock().unwrap().is_empty());
}

/// A bare bridge with no routing, no loaded-tool buffer, and an empty
/// searchable catalog, for exercising [`StreamBridge::handle_tool_call`] in
/// isolation.
fn bare_bridge() -> (
    StreamBridge,
    tokio::sync::mpsc::UnboundedReceiver<Result<StreamPart, crate::AgentError>>,
) {
    let (register, _registered) = recording_register();
    StreamBridge::channel(
        inputs(Arc::new(Mutex::new(Vec::new())), register),
        Arc::new(vec![]),
        CancellationToken::new(),
    )
}

#[tokio::test]
async fn on_tool_call_parses_object_args() {
    let (bridge, mut rx) = bare_bridge();

    let action = bridge.handle_tool_call("Search", None, "call-1", "{\"query\":\"cats\"}");

    assert!(matches!(action, ToolCallAction::Run));
    let Ok(StreamPart::ToolCall(tool_call)) = rx.try_recv().unwrap() else {
        panic!("expected a tool call");
    };
    assert_eq!(tool_call.json, serde_json::json!({"query": "cats"}));
}

/// Anthropic's Messages API rejects a `tool_use.input` that is not a JSON
/// object. A zero-argument tool call can arrive with an empty or otherwise
/// non-object `args` string; the hook must always hand back an object so a
/// bad value never gets persisted into chat history and replayed later.
#[tokio::test]
async fn on_tool_call_coerces_non_object_args_to_empty_object() {
    for args in ["", "null", "\"oops\"", "[1,2,3]", "not json at all"] {
        let (bridge, mut rx) = bare_bridge();

        let action = bridge.handle_tool_call("ListSkills", None, "call-1", args);

        assert!(matches!(action, ToolCallAction::Run));
        let Ok(StreamPart::ToolCall(tool_call)) = rx.try_recv().unwrap() else {
            panic!("expected a tool call for args {args:?}");
        };
        assert_eq!(
            tool_call.json,
            serde_json::json!({}),
            "args {args:?} must coerce to an empty object, not {:?}",
            tool_call.json
        );
    }
}

#[tokio::test]
async fn invalid_call_to_searchable_tool_loads_it_and_retries() {
    let (register, registered) = recording_register();
    let catalog = Arc::new(vec![searchable("mcp__linear__create_issue")]);
    let bridge_inputs = inputs(Arc::new(Mutex::new(Vec::new())), register);
    let tool_loads = bridge_inputs.tool_loads.clone();
    let (bridge, _rx) = StreamBridge::channel(bridge_inputs, catalog, CancellationToken::new());

    let action = bridge
        .handle_invalid_tool_call("mcp__linear__create_issue", Some("toolu_1"))
        .await;

    // The unloaded-but-searchable tool was registered and the turn retries,
    // the retry's result being the one that loaded it.
    assert_eq!(&*registered.lock().unwrap(), &["mcp__linear__create_issue"]);
    let call = rig_core::message::ToolCall::new(
        "toolu_1".to_owned(),
        rig_core::message::ToolFunction::new(
            "mcp__linear__create_issue".to_owned(),
            serde_json::json!({}),
        ),
    );
    assert_eq!(tool_loads.loaded_by(&call), ["mcp__linear__create_issue"]);
    let Some(InvalidToolCallAction::Retry { feedback }) = action else {
        panic!("expected retry, got {action:?}");
    };
    assert!(feedback.contains("mcp__linear__create_issue"));
}

#[tokio::test]
async fn invalid_call_to_unknown_tool_retries_with_feedback_without_loading() {
    let (register, registered) = recording_register();
    let catalog = Arc::new(vec![searchable("mcp__linear__create_issue")]);
    let (bridge, _rx) = StreamBridge::channel(
        inputs(Arc::new(Mutex::new(Vec::new())), register),
        catalog,
        CancellationToken::new(),
    );

    let action = bridge
        .handle_invalid_tool_call("mcp__nope__hallucinated", Some("toolu_1"))
        .await;

    // Nothing exists to load; the model gets corrective feedback instead of
    // the stream failing.
    assert!(registered.lock().unwrap().is_empty());
    let Some(InvalidToolCallAction::Retry { feedback }) = action else {
        panic!("expected retry, got {action:?}");
    };
    assert!(feedback.contains("mcp__nope__hallucinated"));
}

/// A bare bridge that streams tool calls.
fn streaming_bridge() -> (
    StreamBridge,
    tokio::sync::mpsc::UnboundedReceiver<Result<StreamPart, crate::AgentError>>,
) {
    let (register, _registered) = recording_register();
    StreamBridge::channel(
        BridgeInputs {
            stream_tool_calls: true,
            ..inputs(Arc::new(Mutex::new(Vec::new())), register)
        },
        Arc::new(vec![]),
        CancellationToken::new(),
    )
}

fn drain(
    rx: &mut tokio::sync::mpsc::UnboundedReceiver<Result<StreamPart, crate::AgentError>>,
) -> Vec<StreamPart> {
    std::iter::from_fn(|| rx.try_recv().ok())
        .map(|part| part.expect("no error parts"))
        .collect()
}

/// Two calls written at once - parallel tool calls stream interleaved - each
/// keep the id they opened under through their finished call and result,
/// even when the provider names the finished call by a `call_id` of its own.
#[tokio::test]
async fn interleaved_streamed_calls_keep_their_announced_ids() {
    let (bridge, mut rx) = streaming_bridge();

    bridge.handle_tool_call_delta("", "internal-a", Some("Search"), "");
    bridge.handle_tool_call_delta("", "internal-b", Some("Read"), "");
    bridge.handle_tool_call_delta("", "internal-b", None, "{\"id\":");
    bridge.handle_tool_call_delta("", "internal-a", None, "{\"query\":\"cats\"}");
    bridge.handle_tool_call_delta("", "internal-b", None, "\"doc\"}");
    bridge.handle_tool_call("Read", Some("call_b"), "internal-b", "{\"id\":\"doc\"}");
    bridge.handle_tool_call(
        "Search",
        Some("call_a"),
        "internal-a",
        "{\"query\":\"cats\"}",
    );
    bridge
        .handle_tool_result(
            "Read",
            Some("call_b"),
            "internal-b",
            "{}",
            &ToolOutput::json(serde_json::json!({"text": "hi"})),
            true,
        )
        .await;

    let parts = drain(&mut rx);
    let summary: Vec<String> = parts
        .iter()
        .map(|part| match part {
            StreamPart::ToolCallStarted(start) => format!("start {} {}", start.id, start.name),
            StreamPart::ToolCallArgs { id, delta } => format!("args {id} {delta}"),
            StreamPart::ToolCall(call) => format!("call {} {}", call.id, call.json),
            StreamPart::ToolResponse(ToolResponse::Json { id, .. }) => format!("result {id}"),
            other => format!("{other:?}"),
        })
        .collect();
    assert_eq!(
        summary,
        vec![
            "start internal-a Search",
            "start internal-b Read",
            "args internal-b {\"id\":",
            "args internal-a {\"query\":\"cats\"}",
            "args internal-b \"doc\"}",
            "call internal-b {\"id\":\"doc\"}",
            "call internal-a {\"query\":\"cats\"}",
            "result internal-b",
        ]
    );
}

/// A finished call with a different correlation id can still match its
/// announcement by the provider id, without guessing from its tool name.
#[tokio::test]
async fn a_finished_call_without_its_delta_id_claims_the_open_announcement() {
    let (bridge, mut rx) = streaming_bridge();

    bridge.handle_tool_call_delta("provider-id", "delta-id", Some("Search"), "{}");
    bridge.handle_tool_call("Search", Some("provider-id"), "final-id", "{}");
    bridge
        .handle_tool_result(
            "Search",
            Some("provider-id"),
            "final-id",
            "{}",
            &ToolOutput::json(serde_json::json!({})),
            true,
        )
        .await;

    let ids: Vec<String> = drain(&mut rx)
        .into_iter()
        .filter_map(|part| match part {
            StreamPart::ToolCall(call) => Some(call.id),
            StreamPart::ToolResponse(ToolResponse::Json { id, .. }) => Some(id),
            _ => None,
        })
        .collect();
    assert_eq!(ids, vec!["provider-id", "provider-id"]);
}

/// Without streaming the deltas emit no progress parts and ids are the provider's.
#[tokio::test]
async fn a_bridge_without_streaming_ignores_deltas() {
    let (bridge, mut rx) = bare_bridge();

    bridge.handle_tool_call_delta("", "internal-a", Some("Search"), "{}");
    bridge.handle_tool_call("Search", Some("call_a"), "internal-a", "{}");

    let parts = drain(&mut rx);
    assert_eq!(parts.len(), 1);
    assert!(matches!(&parts[0], StreamPart::ToolCall(call) if call.id == "call_a"));
}

#[tokio::test]
async fn parallel_calls_of_the_same_tool_keep_provider_ids_when_finishing_out_of_order() {
    let (bridge, mut rx) = streaming_bridge();
    bridge.handle_tool_call_delta("provider-a", "internal-a", Some("Search"), "{}");
    bridge.handle_tool_call_delta("provider-b", "internal-b", Some("Search"), "{}");
    bridge.handle_tool_call("Search", Some("provider-b"), "final-b", "{}");
    bridge.handle_tool_call("Search", Some("provider-a"), "final-a", "{}");
    for (provider, internal) in [("provider-b", "final-b"), ("provider-a", "final-a")] {
        bridge
            .handle_tool_result(
                "Search",
                Some(provider),
                internal,
                "{}",
                &ToolOutput::json(serde_json::json!({})),
                true,
            )
            .await;
    }
    let ids: Vec<String> = drain(&mut rx)
        .into_iter()
        .filter_map(|part| match part {
            StreamPart::ToolCall(call) => Some(call.id),
            StreamPart::ToolResponse(ToolResponse::Json { id, .. }) => Some(id),
            _ => None,
        })
        .collect();
    assert_eq!(
        ids,
        ["provider-b", "provider-a", "provider-b", "provider-a"]
    );
}

#[tokio::test]
async fn a_bridge_without_streaming_still_preserves_anthropic_provider_ids() {
    let (bridge, mut rx) = bare_bridge();
    bridge.handle_tool_call_delta("toolu_call", "internal", Some("Search"), "{}");
    bridge.handle_tool_call("Search", None, "internal", "{}");
    bridge
        .handle_tool_result(
            "Search",
            None,
            "internal",
            "{}",
            &ToolOutput::json(serde_json::json!({})),
            true,
        )
        .await;
    let parts = drain(&mut rx);
    assert!(matches!(&parts[0], StreamPart::ToolCall(call) if call.id == "toolu_call"));
    assert!(
        matches!(&parts[1], StreamPart::ToolResponse(ToolResponse::Json { id, .. }) if id == "toolu_call")
    );
    assert_eq!(parts.len(), 2);
}
