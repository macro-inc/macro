//! Tool calls should be yielded eagerly to the stream consumer
//! This means that we should get the call before the response
//! We should not get the call when the response finishes
//!
//! This is important for long running tools like rewrite and
//! subagent
//!

use super::util;
use crate::stream::{StreamPart, ToolResponse};
use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolResult};
use async_trait::async_trait;
use rig_core::message::Message;
use rig_core::test_utils::{MockCompletionModel, MockStreamEvent};
use schemars::JsonSchema;
use serde::Deserialize;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{Mutex, oneshot};

/// How long to wait for a part that *should* already be on its way before
/// concluding none is coming. Long enough to be reliable on a loaded CI box,
/// short enough that a genuinely-missing part fails the test quickly.
const GRACE: Duration = Duration::from_millis(500);

/// A tool that never returns.
#[derive(Deserialize, JsonSchema)]
#[schemars(title = "never_tool", description = "Never returns.")]
struct NeverTool {}

#[async_trait]
impl AsyncTool<()> for NeverTool {
    type Output = serde_json::Value;

    async fn call(
        &self,
        _service_context: ServiceContext<()>,
        _request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        std::future::pending::<()>().await;
        unreachable!("pending future never resolves")
    }
}

/// This tests against an "infinite" tool (tool that never returns)
/// It shows that the consumer gets a tool call and never a response
#[tokio::test]
async fn infinite_tool_yields_call_but_never_a_response() {
    let model = MockCompletionModel::from_stream_turns([vec![
        MockStreamEvent::tool_call("call-1", "never_tool", serde_json::json!({})),
        MockStreamEvent::final_response_with_default_usage(),
    ]]);

    let toolset = util::single_tool_set::<NeverTool, ()>();
    let mut session = util::session(toolset, Arc::new(()), model).await;
    let mut stream = session
        .send_message(vec![Message::user("run the infinite tool")])
        .await
        .expect("send_message should start the stream");

    let mut saw_call = false;
    let mut saw_response = false;
    // The tool never returns, so the stream never ends — `next_within` stops us
    // once the in-flight tool leaves the consumer with nothing more to read.
    while let Some(part) = util::next_within(&mut stream, GRACE).await {
        match part {
            StreamPart::ToolCall(call) if call.name == "never_tool" => saw_call = true,
            StreamPart::ToolResponse(_) => saw_response = true,
            _ => {}
        }
    }

    assert!(
        saw_call,
        "the consumer must receive the tool call eagerly — while the tool is still running"
    );
    assert!(
        !saw_response,
        "a tool that never returns must never produce a response"
    );
}

/// Shared state gating [`GatedTool`]: the test holds the sender and releases the
/// tool by sending on it. `Option` because the receiver is consumed on first
/// (and only) call.
#[derive(Clone)]
struct Gate {
    release: Arc<Mutex<Option<oneshot::Receiver<()>>>>,
}

/// A tool that blocks until the test releases it via the oneshot channel.
#[derive(Deserialize, JsonSchema)]
#[schemars(title = "gated_tool", description = "Returns only once released.")]
struct GatedTool {}

#[async_trait]
impl AsyncTool<Gate> for GatedTool {
    type Output = serde_json::Value;

    async fn call(
        &self,
        service_context: ServiceContext<Gate>,
        _request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let rx = service_context
            .release
            .lock()
            .await
            .take()
            .expect("gated tool is called at most once");
        let _ = rx.await;
        Ok(serde_json::json!({ "status": "released" }))
    }
}

/// This tests against a tool that will not return until it is told to
/// via oneshot. It shows that we get the call 1st then the response after
/// oneshotting it.
#[tokio::test]
async fn gated_tool_yields_call_first_then_response_once_released() {
    let model = MockCompletionModel::from_stream_turns([
        vec![
            MockStreamEvent::tool_call("call-1", "gated_tool", serde_json::json!({})),
            MockStreamEvent::final_response_with_default_usage(),
        ],
        vec![MockStreamEvent::final_response_with_default_usage()],
    ]);

    let (release_tx, release_rx) = oneshot::channel();
    let context = Arc::new(Gate {
        release: Arc::new(Mutex::new(Some(release_rx))),
    });
    let toolset = util::single_tool_set::<GatedTool, Gate>();
    let mut session = util::session(toolset, context, model).await;
    let mut stream = session
        .send_message(vec![Message::user("run the gated tool")])
        .await
        .expect("send_message should start the stream");

    // The call must arrive while the tool is still gated — before we release it.
    let mut call_id = None;
    while let Some(part) = util::next_within(&mut stream, GRACE).await {
        match part {
            StreamPart::ToolCall(call) if call.name == "gated_tool" => {
                call_id = Some(call.id.clone());
                break;
            }
            StreamPart::ToolResponse(_) => {
                panic!("response must not arrive before the tool is released")
            }
            _ => {}
        }
    }
    let call_id = call_id.expect("tool call should be yielded before the tool returns");

    // Release the tool; only now should its response land.
    release_tx.send(()).expect("receiver still alive");

    let mut response = None;
    while let Some(part) = util::next_within(&mut stream, GRACE).await {
        if let StreamPart::ToolResponse(ToolResponse::Json { id, json, .. }) = &part {
            if *id == call_id {
                response = Some(json.clone());
                break;
            }
        }
    }
    assert_eq!(
        response.expect("the response should arrive after releasing the tool"),
        serde_json::json!({ "status": "released" })
    );
}

/// A tool that returns immediately.
#[derive(Deserialize, JsonSchema)]
#[schemars(title = "echo_tool", description = "Returns immediately.")]
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

/// This test shows that we get the call and response in quick succession
/// for a near-instant tool (like most of our tools)
#[tokio::test]
async fn instant_tool_yields_call_then_response_in_order() {
    let model = MockCompletionModel::from_stream_turns([
        vec![
            MockStreamEvent::tool_call("call-1", "echo_tool", serde_json::json!({ "value": "hi" })),
            MockStreamEvent::final_response_with_default_usage(),
        ],
        vec![MockStreamEvent::final_response_with_default_usage()],
    ]);

    let toolset = util::single_tool_set::<EchoTool, ()>();
    let mut session = util::session(toolset, Arc::new(()), model).await;
    let result = util::drive(&mut session, "run the echo tool").await;

    let call_pos = result
        .parts
        .iter()
        .position(|part| matches!(part, StreamPart::ToolCall(call) if call.name == "echo_tool"))
        .expect("expected a tool call for echo_tool");
    let response_pos = result
        .parts
        .iter()
        .position(|part| matches!(part, StreamPart::ToolResponse(_)))
        .expect("expected a tool response");
    assert!(
        call_pos < response_pos,
        "the call must be yielded before its response"
    );

    let call = result
        .tool_calls()
        .into_iter()
        .find(|call| call.name == "echo_tool")
        .expect("expected a tool call for echo_tool");
    let response = result
        .tool_response(&call.id)
        .expect("expected a response for the echo tool call");
    assert!(
        matches!(
            response,
            ToolResponse::Json { json, .. } if *json == serde_json::json!({ "echo": "hi" })
        ),
        "the tool's own output should surface as the response, got {response:?}"
    );
}
