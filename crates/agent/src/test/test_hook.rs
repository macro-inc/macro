use crate::hook::*;
use crate::stream::StreamPart;
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

#[tokio::test]
async fn on_tool_result_drains_buffer_and_registers_loaded_tools() {
    let buffer = Arc::new(Mutex::new(vec![
        searchable("mcp__slack__send"),
        searchable("mcp__linear__create_issue"),
    ]));
    let (register, registered) = recording_register();
    let routing: ToolRouter = Arc::new(|_| None);
    let token = CancellationToken::new();
    let (bridge, _rx) =
        StreamBridge::channel(routing, buffer.clone(), register, Arc::new(vec![]), token);

    bridge
        .handle_tool_result(
            "SearchTools",
            None,
            "call-1",
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
    let routing: ToolRouter = Arc::new(|_| None);
    let token = CancellationToken::new();
    let (bridge, _rx) = StreamBridge::channel(routing, buffer, register, Arc::new(vec![]), token);

    bridge
        .handle_tool_result(
            "WebSearch",
            None,
            "call-2",
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
        Arc::new(|_| None),
        Arc::new(Mutex::new(Vec::new())),
        register,
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
    let routing: ToolRouter = Arc::new(|_| None);
    let catalog = Arc::new(vec![searchable("mcp__linear__create_issue")]);
    let (bridge, _rx) = StreamBridge::channel(
        routing,
        Arc::new(Mutex::new(Vec::new())),
        register,
        catalog,
        CancellationToken::new(),
    );

    let action = bridge
        .handle_invalid_tool_call("mcp__linear__create_issue")
        .await;

    // The unloaded-but-searchable tool was registered and the turn retries.
    assert_eq!(&*registered.lock().unwrap(), &["mcp__linear__create_issue"]);
    let Some(InvalidToolCallAction::Retry { feedback }) = action else {
        panic!("expected retry, got {action:?}");
    };
    assert!(feedback.contains("mcp__linear__create_issue"));
}

#[tokio::test]
async fn invalid_call_to_unknown_tool_retries_with_feedback_without_loading() {
    let (register, registered) = recording_register();
    let routing: ToolRouter = Arc::new(|_| None);
    let catalog = Arc::new(vec![searchable("mcp__linear__create_issue")]);
    let (bridge, _rx) = StreamBridge::channel(
        routing,
        Arc::new(Mutex::new(Vec::new())),
        register,
        catalog,
        CancellationToken::new(),
    );

    let action = bridge
        .handle_invalid_tool_call("mcp__nope__hallucinated")
        .await;

    // Nothing exists to load; the model gets corrective feedback instead of
    // the stream failing.
    assert!(registered.lock().unwrap().is_empty());
    let Some(InvalidToolCallAction::Retry { feedback }) = action else {
        panic!("expected retry, got {action:?}");
    };
    assert!(feedback.contains("mcp__nope__hallucinated"));
}
