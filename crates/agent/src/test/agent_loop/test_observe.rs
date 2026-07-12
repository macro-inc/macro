//! Asserts the [`AgentObserver`] port sees the full session lifecycle: session
//! start, per-message span, tool spans, LLM usage, message finish, and session
//! end — and that a loop without an observer emits nothing (the default).
use super::util;
use crate::observe::{AgentObserver, SessionMeta};
use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolResult};
use async_trait::async_trait;
use rig_core::test_utils::{MockCompletionModel, MockStreamEvent};
use schemars::JsonSchema;
use serde::Deserialize;
use std::sync::{Arc, Mutex};
use tokio::sync::Notify;

/// A tool that echoes its input.
#[derive(Deserialize, JsonSchema)]
#[schemars(title = "echo_tool", description = "Echoes its input back.")]
struct EchoTool {
    value: String,
}

#[async_trait]
impl AsyncTool<()> for EchoTool {
    type Output = serde_json::Value;

    async fn call(
        &self,
        _service_context: ServiceContext<()>,
        _request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        Ok(serde_json::json!({ "echo": self.value }))
    }
}

/// Records every observer callback as a compact tag string, in order.
#[derive(Default)]
struct Recording(Mutex<Vec<String>>);

impl Recording {
    fn events(&self) -> Vec<String> {
        self.0.lock().expect("recording poisoned").clone()
    }
    fn push(&self, tag: String) {
        self.0.lock().expect("recording poisoned").push(tag);
    }
}

impl AgentObserver for Recording {
    fn session_started(&self, session_id: &str, meta: &SessionMeta<'_>) {
        assert!(!session_id.is_empty());
        self.push(format!("session_started feature={}", meta.feature));
    }
    fn message_started(&self, _session_id: &str, span_id: &str) {
        self.push(format!("message_started {span_id}"));
    }
    fn tool_started(&self, _session_id: &str, _parent_span_id: &str, call_id: &str, name: &str) {
        self.push(format!("tool_started {name} {call_id}"));
    }
    fn tool_finished(
        &self,
        _session_id: &str,
        _parent_span_id: &str,
        call_id: &str,
        name: &str,
        ok: bool,
    ) {
        self.push(format!("tool_finished {name} {call_id} ok={ok}"));
    }
    fn llm_usage(
        &self,
        _session_id: &str,
        _parent_span_id: &str,
        span_id: &str,
        model: &str,
        input_tokens: u64,
        output_tokens: u64,
    ) {
        assert!(!span_id.is_empty());
        assert!(!model.is_empty());
        self.push(format!("llm_usage in={input_tokens} out={output_tokens}"));
    }
    fn message_finished(&self, _session_id: &str, span_id: &str, ok: bool) {
        self.push(format!("message_finished {span_id} ok={ok}"));
    }
    fn session_ended(&self, _session_id: &str) {
        self.push("session_ended".to_string());
    }
}

fn tool_then_done() -> MockCompletionModel {
    MockCompletionModel::from_stream_turns([
        vec![
            MockStreamEvent::tool_call("call-1", "echo_tool", serde_json::json!({"value": "hi"})),
            MockStreamEvent::final_response_with_default_usage(),
        ],
        vec![
            MockStreamEvent::text("done"),
            MockStreamEvent::final_response_with_default_usage(),
        ],
    ])
}

/// The observer sees the whole lifecycle in order, and `session_ended` fires
/// once the session (and its stream) are dropped.
#[tokio::test]
async fn observer_sees_session_message_tool_and_usage_lifecycle() {
    let recording = Arc::new(Recording::default());
    let mut session = util::test_loop()
        .with_observer(recording.clone())
        .test_session(
            util::single_tool_set::<EchoTool, ()>(),
            Arc::new(()),
            "test preamble",
            util::usage_ctx(),
            tool_then_done(),
        )
        .await;

    let collected = util::drive(&mut session, "call the tool").await;
    assert!(collected.error.is_none());
    drop(session);
    // The driver task may hold the last observer handle briefly; yield to it.
    tokio::task::yield_now().await;

    // Normalize the recorded events (strip the per-run session uuid and call
    // id) and assert the EXACT lifecycle sequence.
    let events = recording.events();
    let normalized: Vec<String> = events
        .iter()
        .map(
            |e| match e.split_whitespace().collect::<Vec<_>>().as_slice() {
                ["message_started", span] => format!("message_started {}", tail(span, 2)),
                ["message_finished", span, ok] => {
                    format!("message_finished {} {ok}", tail(span, 2))
                }
                ["tool_started", name, _call_id] => format!("tool_started {name}"),
                ["tool_finished", name, _call_id, ok] => format!("tool_finished {name} {ok}"),
                ["llm_usage", ..] => "llm_usage".to_string(),
                _ => e.clone(),
            },
        )
        .collect();
    assert_eq!(
        normalized,
        [
            "session_started feature=chat",
            "message_started msg:0",
            "tool_started echo_tool",
            "tool_finished echo_tool ok=true",
            "llm_usage",
            "message_finished msg:0 ok=true",
            "session_ended",
        ],
        "raw events: {events:?}"
    );

    // Start and finish carry the same tool call id.
    let call_id = |e: &str| e.split_whitespace().nth(2).map(str::to_owned);
    assert_eq!(
        events
            .iter()
            .find_map(|e| e.starts_with("tool_started").then(|| call_id(e)).flatten()),
        events
            .iter()
            .find_map(|e| e.starts_with("tool_finished").then(|| call_id(e)).flatten()),
        "{events:?}"
    );
}

/// The last `n` colon-separated segments of an id (drops the session uuid).
fn tail(id: &str, n: usize) -> String {
    let parts: Vec<&str> = id.split(':').collect();
    parts[parts.len().saturating_sub(n)..].join(":")
}

/// With observation explicitly disabled the session runs exactly as before —
/// independent of whatever `ORRERY_URL` happens to be in the test environment.
#[tokio::test]
async fn without_observer_changes_nothing() {
    let mut session = util::test_loop()
        .without_observer()
        .test_session(
            util::single_tool_set::<EchoTool, ()>(),
            Arc::new(()),
            "test preamble",
            util::usage_ctx(),
            tool_then_done(),
        )
        .await;
    let collected = util::drive(&mut session, "call the tool").await;
    assert!(collected.error.is_none());
    assert_eq!(collected.content(), "done");
}

/// A tool that blocks until the test drops the stream. `started` lets the test
/// wait until the tool is genuinely mid-flight before cancelling.
#[derive(Deserialize, JsonSchema)]
#[schemars(title = "stall_tool", description = "Blocks until cancelled.")]
struct StallTool {}

#[async_trait]
impl AsyncTool<Arc<Notify>> for StallTool {
    type Output = serde_json::Value;

    async fn call(
        &self,
        service_context: ServiceContext<Arc<Notify>>,
        _request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        service_context.notify_one();
        std::future::pending::<()>().await;
        unreachable!("pending future never resolves")
    }
}

/// Dropping the stream mid-tool (abrupt cancellation) must still close the
/// message span — `message_finished ok=false` — and end the session exactly
/// once. This is the `Drop` fallback on `MessageObserve`.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn dropped_stream_still_finishes_the_message_span() {
    let model = MockCompletionModel::from_stream_turns([vec![
        MockStreamEvent::tool_call("call-1", "stall_tool", serde_json::json!({})),
        MockStreamEvent::final_response_with_default_usage(),
    ]]);
    let recording = Arc::new(Recording::default());
    let started = Arc::new(Notify::new());
    let mut session = util::test_loop()
        .with_observer(recording.clone())
        .test_session(
            util::single_tool_set::<StallTool, Arc<Notify>>(),
            Arc::new(started.clone()),
            "test preamble",
            util::usage_ctx(),
            model,
        )
        .await;

    let mut stream = session
        .send_message(vec![crate::Message::user("stall")])
        .await
        .expect("stream starts");
    // Drain until the tool is running, then drop the stream (client abort).
    while util::next_within(&mut stream, std::time::Duration::from_secs(5))
        .await
        .is_some()
    {
        if recording
            .events()
            .iter()
            .any(|e| e.starts_with("tool_started"))
        {
            break;
        }
    }
    started.notified().await;
    drop(stream);
    drop(session);
    tokio::task::yield_now().await;
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;

    let events = recording.events();
    let finishes: Vec<&String> = events
        .iter()
        .filter(|e| e.starts_with("message_finished"))
        .collect();
    assert_eq!(
        finishes.len(),
        1,
        "exactly one message_finished: {events:?}"
    );
    assert!(
        finishes[0].ends_with("ok=false"),
        "aborted message closes as not-ok: {events:?}"
    );
    assert_eq!(
        events.iter().filter(|e| *e == "session_ended").count(),
        1,
        "{events:?}"
    );
    assert_eq!(
        events.last().map(String::as_str),
        Some("session_ended"),
        "{events:?}"
    );
}
