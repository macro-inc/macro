//! Agent loop behavior tests.
//!
//! These drive the public session surface used by DCS — [`AgentLoop`] →
//! [`super::Session::cancellable`] → [`super::Session::send_message`] — with a
//! fake completion model injected via [`AgentLoop::test_session`], so the real
//! per-session wiring (tool adapters, cancellation token) is exercised.

use crate::AgentLoop;
use crate::stream::{StreamPart, ToolResponse};
use ai_toolset::{
    AsyncTool, AsyncToolCollection, RequestContext, ServiceContext, ToolResult,
    ToolSet as AiToolSet,
};
use ai_usage::{AiFeature, UsageContext, UsageEvent, UsageRecorder};
use futures::StreamExt;
use macro_user_id::user_id::MacroUserIdStr;
use rig_core::message::Message;
use rig_core::test_utils::{MockCompletionModel, MockStreamEvent};
use schemars::JsonSchema;
use serde::Deserialize;
use std::sync::Arc;
use tokio::sync::Notify;

/// Records nothing — token usage isn't under test here.
struct NoOpRecorder;
impl UsageRecorder for NoOpRecorder {
    fn record(&self, _event: UsageEvent) {}
}

fn test_loop() -> AgentLoop {
    AgentLoop::new(Arc::new(NoOpRecorder))
        .with_max_turns(8)
        .with_max_tokens(1024)
}

fn test_user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("test@macro.com").expect("valid user id")
}

/// Shared service state handed to the tool. `started` lets the tool announce
/// that it has begun executing so the test can cancel only *after* the
/// `on_tool_call` guard has passed — otherwise the agent loop would terminate
/// before the tool ever runs and no tool response would be produced.
#[derive(Clone)]
struct TestCtx {
    started: Arc<Notify>,
}

/// A tool that would run forever, but cooperatively returns a normal response
/// when the request is cancelled. It reads the cancellation token off the
/// [`RequestContext`] it is handed — exactly how a real long-running tool
/// consumes `request_context.cancel`.
#[derive(Deserialize, JsonSchema)]
#[schemars(
    title = "infinite_tool",
    description = "Runs until the request is cancelled."
)]
struct InfiniteTool {}

#[async_trait::async_trait]
impl AsyncTool<TestCtx> for InfiniteTool {
    type Output = serde_json::Value;

    async fn call(
        &self,
        service_context: ServiceContext<TestCtx>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        service_context.started.notify_one();
        tokio::select! {
            _ = request_context.cancel.cancelled() => {
                Ok(serde_json::json!({ "status": "cancelled" }))
            }
            // The "infinite" work that never finishes on its own.
            _ = std::future::pending::<()>() => {
                unreachable!("pending future never resolves")
            }
        }
    }
}

/// A fake AI stream that calls an infinite tool exercises cooperative
/// cancellation: cancelling the session while the tool is running makes the
/// tool return (via `request_context.cancel`), and that return surfaces as a
/// tool response in the message stream.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cancelling_running_tool_yields_a_tool_response() {
    // Turn 1: the model calls the infinite tool. Turn 2 (reached once the
    // tool returns) just finalizes so the agentic loop terminates.
    let model = MockCompletionModel::from_stream_turns([
        vec![
            MockStreamEvent::tool_call("call-1", "infinite_tool", serde_json::json!({})),
            MockStreamEvent::final_response_with_default_usage(),
        ],
        vec![MockStreamEvent::final_response_with_default_usage()],
    ]);

    let started = Arc::new(Notify::new());
    let context = Arc::new(TestCtx {
        started: started.clone(),
    });
    let toolset: Arc<dyn AiToolSet<TestCtx> + Send + Sync> =
        Arc::new(AsyncToolCollection::<TestCtx>::new().add_tool::<InfiniteTool, TestCtx>());

    let usage_ctx = UsageContext::new(AiFeature::Chat, test_user());
    let session = test_loop()
        .test_session(toolset, context, "test preamble", usage_ctx, model)
        .await;
    let (mut session, cancel) = session.cancellable();

    // Cancel once the tool is actually executing.
    tokio::spawn(async move {
        started.notified().await;
        cancel.cancel();
    });

    let mut stream = session
        .send_message(vec![Message::user("run the infinite tool")])
        .await
        .expect("send_message should start the stream");

    let mut parts = Vec::new();
    while let Some(item) = stream.next().await {
        if let Ok(part) = item {
            parts.push(part);
        }
    }

    // The tool call appears in the stream...
    let tool_call_id = parts
        .iter()
        .find_map(|part| match part {
            StreamPart::ToolCall(call) if call.name == "infinite_tool" => Some(call.id.clone()),
            _ => None,
        })
        .expect("expected a tool call for infinite_tool");

    // ...and it has a response, produced by the tool returning cooperatively
    // when `request_context.cancel` fired.
    let response = parts
        .iter()
        .find_map(|part| match part {
            StreamPart::ToolResponse(ToolResponse::Json { id, json, .. })
                if *id == tool_call_id =>
            {
                Some(json.clone())
            }
            _ => None,
        })
        .expect("expected a tool response for the infinite tool call");

    assert_eq!(response, serde_json::json!({ "status": "cancelled" }));
}
