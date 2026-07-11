use crate::hook::*;
use ai_toolset::SearchableTool;
use rig_core::agent::{HookAction, InvalidToolCallContext, InvalidToolCallHookAction, PromptHook};
use rig_core::providers::anthropic::completion::CompletionModel as AnthropicModel;
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

    let action = <StreamBridge as PromptHook<AnthropicModel>>::on_tool_result(
        &bridge,
        "SearchTools",
        None,
        "call-1",
        "{}",
        "{\"loaded\":[]}",
    )
    .await;

    assert!(matches!(action, HookAction::Continue));
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

    let _ = <StreamBridge as PromptHook<AnthropicModel>>::on_tool_result(
        &bridge,
        "WebSearch",
        None,
        "call-2",
        "{}",
        "{}",
    )
    .await;

    assert!(registered.lock().unwrap().is_empty());
}

/// An [`InvalidToolCallContext`] for a model-emitted call to `tool_name`.
fn invalid_call(tool_name: &str) -> InvalidToolCallContext {
    InvalidToolCallContext {
        tool_name: tool_name.to_string(),
        tool_call_id: Some("call-1".to_string()),
        internal_call_id: Some("internal-1".to_string()),
        args: Some("{}".to_string()),
        available_tools: vec!["SearchTools".to_string()],
        allowed_tools: vec!["SearchTools".to_string()],
        tool_choice: None,
        chat_history: vec![],
        is_streaming: true,
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

    let action = <StreamBridge as PromptHook<AnthropicModel>>::on_invalid_tool_call(
        &bridge,
        &invalid_call("mcp__linear__create_issue"),
    )
    .await;

    // The unloaded-but-searchable tool was registered and the turn retries.
    assert_eq!(&*registered.lock().unwrap(), &["mcp__linear__create_issue"]);
    let InvalidToolCallHookAction::Retry { feedback } = action else {
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

    let action = <StreamBridge as PromptHook<AnthropicModel>>::on_invalid_tool_call(
        &bridge,
        &invalid_call("mcp__nope__hallucinated"),
    )
    .await;

    // Nothing exists to load; the model gets corrective feedback instead of
    // the stream failing.
    assert!(registered.lock().unwrap().is_empty());
    let InvalidToolCallHookAction::Retry { feedback } = action else {
        panic!("expected retry, got {action:?}");
    };
    assert!(feedback.contains("mcp__nope__hallucinated"));
}
