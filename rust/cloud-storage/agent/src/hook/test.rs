use super::*;
use rig_core::providers::anthropic::completion::CompletionModel as AnthropicModel;
use schemars::Schema;
use std::sync::Mutex;

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
    let (bridge, _rx) = StreamBridge::channel(routing, buffer.clone(), register);

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
    let (bridge, _rx) = StreamBridge::channel(routing, buffer, register);

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
