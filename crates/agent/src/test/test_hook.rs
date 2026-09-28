use crate::hook::*;
use crate::stream::{StreamPart, ToolResponse};
use ai_toolset::SearchableTool;
use rig_agent::agent::{InvalidToolCallAction, ToolCallAction, ToolResultAction};
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
/// supplies the loaded-tool buffer and, optionally, a user-tool finisher.
fn inputs(
    loaded_buffer: Arc<Mutex<Vec<SearchableTool>>>,
    register: RegisterFn,
    user_tool_finisher: Option<UserToolFinisher>,
) -> BridgeInputs {
    BridgeInputs {
        routing: Arc::new(|_| None),
        loaded_buffer,
        register_loaded: register,
        user_tool_finisher,
    }
}

/// A finisher that records what it was handed and answers with `answer`.
fn recording_finisher(
    answer: Option<FinishedUserTool>,
) -> (UserToolFinisher, Arc<Mutex<Vec<PendingUserTool>>>) {
    let recorded = Arc::new(Mutex::new(Vec::new()));
    let sink = recorded.clone();
    let finisher: UserToolFinisher = Arc::new(move |call: PendingUserTool| {
        let sink = sink.clone();
        let answer = answer.clone();
        Box::pin(async move {
            sink.lock().unwrap().push(call);
            answer
        }) as Pin<Box<dyn Future<Output = Option<FinishedUserTool>> + Send>>
    });
    (finisher, recorded)
}

#[tokio::test]
async fn on_tool_result_drains_buffer_and_registers_loaded_tools() {
    let buffer = Arc::new(Mutex::new(vec![
        searchable("mcp__slack__send"),
        searchable("mcp__linear__create_issue"),
    ]));
    let (register, registered) = recording_register();
    let token = CancellationToken::new();
    let (bridge, _rx) = StreamBridge::channel(
        inputs(buffer.clone(), register, None),
        Arc::new(vec![]),
        token,
    );

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
    let (bridge, _rx) =
        StreamBridge::channel(inputs(buffer, register, None), Arc::new(vec![]), token);

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
        inputs(Arc::new(Mutex::new(Vec::new())), register, None),
        Arc::new(vec![]),
        CancellationToken::new(),
    )
}

/// A bare bridge whose user tools `finisher` finishes.
fn finishing_bridge(
    finisher: UserToolFinisher,
) -> (
    StreamBridge,
    tokio::sync::mpsc::UnboundedReceiver<Result<StreamPart, crate::AgentError>>,
) {
    let (register, _registered) = recording_register();
    StreamBridge::channel(
        inputs(Arc::new(Mutex::new(Vec::new())), register, Some(finisher)),
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
    let (bridge, _rx) = StreamBridge::channel(
        inputs(Arc::new(Mutex::new(Vec::new())), register, None),
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
    let catalog = Arc::new(vec![searchable("mcp__linear__create_issue")]);
    let (bridge, _rx) = StreamBridge::channel(
        inputs(Arc::new(Mutex::new(Vec::new())), register, None),
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

// --- user tools ---

const PENDING: &str = "\"PendingUserExecution\"";

/// The finisher gets the call as the model made it, and what it returns is
/// what the model reads and what the stream records - the pending answer
/// never leaves the bridge.
#[tokio::test]
async fn a_pending_user_tool_is_finished_before_the_model_reads_it() {
    let created = serde_json::json!({"UserAction": {"eventId": "evt-1", "title": "Sync"}});
    let (finisher, seen) = recording_finisher(Some(FinishedUserTool::Result(created.clone())));
    let (bridge, mut rx) = finishing_bridge(finisher);

    let action = bridge
        .handle_tool_result(
            "CreateCalendarEvent",
            Some("toolu_1"),
            "internal-1",
            "{\"title\":\"Sync\"}",
            &ToolOutput::json(serde_json::Value::String("PendingUserExecution".into())),
            true,
        )
        .await;

    assert_eq!(
        &*seen.lock().unwrap(),
        &[PendingUserTool {
            tool_name: "CreateCalendarEvent".to_owned(),
            tool_call_id: "toolu_1".to_owned(),
            args: serde_json::json!({"title": "Sync"}),
        }]
    );
    let ToolResultAction::Rewrite(shown) = action else {
        panic!("the model's view is rewritten, got {action:?}");
    };
    assert_eq!(shown.as_json(), Some(&created));
    let Ok(StreamPart::ToolResponse(ToolResponse::Json { id, json, name })) =
        rx.try_recv().unwrap()
    else {
        panic!("the stream records the finished result");
    };
    assert_eq!(
        (id.as_str(), name.as_str()),
        ("toolu_1", "CreateCalendarEvent")
    );
    assert_eq!(json, created);
}

#[tokio::test]
async fn a_user_tool_the_finisher_fails_reads_as_a_tool_error() {
    let (finisher, _seen) = recording_finisher(Some(FinishedUserTool::Error(
        "the user is already being asked something".to_owned(),
    )));
    let (bridge, mut rx) = finishing_bridge(finisher);

    let action = bridge
        .handle_tool_result(
            "SendEmail",
            Some("toolu_2"),
            "internal-2",
            "{}",
            &ToolOutput::text(PENDING),
            true,
        )
        .await;

    let ToolResultAction::Rewrite(shown) = action else {
        panic!("the model's view is rewritten, got {action:?}");
    };
    assert_eq!(
        shown.as_text(),
        Some("the user is already being asked something")
    );
    let Ok(StreamPart::ToolResponse(ToolResponse::Err { description, .. })) =
        rx.try_recv().unwrap()
    else {
        panic!("the stream records the failure");
    };
    assert_eq!(description, "the user is already being asked something");
}

/// A finisher that declines to act, and a bridge with no finisher at all,
/// both leave the pending answer for the host to finish later - chat's flow.
#[tokio::test]
async fn an_unfinished_user_tool_keeps_its_pending_answer() {
    let (finisher, seen) = recording_finisher(None);
    for (bridge, mut rx) in [finishing_bridge(finisher), bare_bridge()] {
        let action = bridge
            .handle_tool_result(
                "SendEmail",
                None,
                "internal-3",
                "{}",
                &ToolOutput::text(PENDING),
                true,
            )
            .await;
        assert!(matches!(action, ToolResultAction::Keep), "got {action:?}");
        let Ok(StreamPart::ToolResponse(ToolResponse::Json { json, .. })) = rx.try_recv().unwrap()
        else {
            panic!("the stream records the pending answer");
        };
        assert_eq!(json, serde_json::json!("PendingUserExecution"));
    }
    assert_eq!(
        seen.lock().unwrap().len(),
        1,
        "the declining finisher was asked once"
    );
}

/// Only the pending answer is a user tool's: every other result, and every
/// failure, passes the finisher by.
#[tokio::test]
async fn results_other_than_pending_never_reach_the_finisher() {
    let (finisher, seen) =
        recording_finisher(Some(FinishedUserTool::Result(serde_json::json!("never"))));
    let (bridge, mut rx) = finishing_bridge(finisher);

    bridge
        .handle_tool_result(
            "ListCalendars",
            None,
            "internal-4",
            "{}",
            &ToolOutput::json(serde_json::json!({"calendars": []})),
            true,
        )
        .await;
    bridge
        .handle_tool_result(
            "CreateCalendarEvent",
            None,
            "internal-5",
            "{}",
            &ToolOutput::text(PENDING),
            false,
        )
        .await;

    assert!(seen.lock().unwrap().is_empty());
    assert!(matches!(
        rx.try_recv().unwrap(),
        Ok(StreamPart::ToolResponse(ToolResponse::Json { .. }))
    ));
    assert!(matches!(
        rx.try_recv().unwrap(),
        Ok(StreamPart::ToolResponse(ToolResponse::Err { .. }))
    ));
}
