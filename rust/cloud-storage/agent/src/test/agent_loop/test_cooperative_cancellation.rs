//! Cooperative cancellation.
//!
//! A long-running tool reads the cancellation token off its [`RequestContext`]
//! and returns a normal value when the request is cancelled. Cancelling such a
//! tool mid-flight must surface its cooperative result as a tool response and
//! let the loop finish *cleanly* — no terminal error. This is distinct from the
//! abrupt path in `test_cancellation_resolution`, where the loop itself tears
//! down with a cancellation error.

use super::util;
use crate::stream::ToolResponse;
use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolResult};
use async_trait::async_trait;
use rig_core::test_utils::{MockCompletionModel, MockStreamEvent};
use schemars::JsonSchema;
use serde::Deserialize;
use std::sync::Arc;
use tokio::sync::Notify;

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

#[async_trait]
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

/// Cancelling the session while an infinite tool is running makes the tool
/// return (via `request_context.cancel`), and that return surfaces as a tool
/// response in the message stream.
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
    let toolset = util::single_tool_set::<InfiniteTool, TestCtx>();

    let session = util::session(toolset, context, model).await;
    let (mut session, cancel) = session.cancellable();

    // Cancel once the tool is actually executing.
    tokio::spawn(async move {
        started.notified().await;
        cancel.cancel();
    });

    let result = util::drive(&mut session, "run the infinite tool").await;

    // The tool call appears in the stream...
    let tool_call_id = result
        .tool_calls()
        .into_iter()
        .find(|call| call.name == "infinite_tool")
        .map(|call| call.id.clone())
        .expect("expected a tool call for infinite_tool");

    // ...and it has a response, produced by the tool returning cooperatively
    // when `request_context.cancel` fired.
    let response = result
        .tool_response(&tool_call_id)
        .expect("expected a tool response for the infinite tool call");

    assert!(
        matches!(
            response,
            ToolResponse::Json { json, .. } if *json == serde_json::json!({ "status": "cancelled" })
        ),
        "cooperative cancellation should surface the tool's own result, got {response:?}"
    );

    // A tool that cancels cooperatively is a *normal* return: the loop runs the
    // next turn and finishes without a terminal error.
    assert!(
        result.error.is_none(),
        "cooperative cancellation must not tear the stream down with an error, got {:?}",
        result.error
    );
}
