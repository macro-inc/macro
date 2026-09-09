//! Chat user tools still return pending for the existing composer flow.

use super::util;
use crate::stream::ToolResponse;
use ai_toolset::{
    AsyncTool, AsyncToolCollection, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations,
    ToolResult,
};
use async_trait::async_trait;
use rig_core::completion::CompletionRequest;
use rig_core::message::{Message, UserContent};
use rig_core::test_utils::{MockCompletionModel, MockStreamEvent};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

#[derive(Deserialize, JsonSchema)]
#[schemars(
    title = "SendNote",
    description = "Sends a note the user must confirm."
)]
struct SendNote {
    text: String,
}

#[derive(Serialize, JsonSchema)]
struct Sent {
    delivered: String,
}

impl ToolAnnotated for SendNote {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("Send note");
}

#[async_trait]
impl AsyncTool<()> for SendNote {
    type Output = Sent;

    async fn call(
        &self,
        _service_context: ServiceContext<()>,
        _request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        Ok(Sent {
            delivered: self.text.clone(),
        })
    }
}

/// The model calls the user tool once, then reads its result and says "done".
fn call_then_done() -> MockCompletionModel {
    MockCompletionModel::from_stream_turns([
        vec![
            MockStreamEvent::tool_call(
                "call-1",
                "SendNote",
                serde_json::json!({ "text": "hello" }),
            ),
            MockStreamEvent::final_response_with_default_usage(),
        ],
        vec![
            MockStreamEvent::text("done"),
            MockStreamEvent::final_response_with_default_usage(),
        ],
    ])
}

/// The tool result text the model was shown in its second request.
fn tool_result_shown(requests: &[CompletionRequest]) -> String {
    let second = requests
        .get(1)
        .expect("the model was asked again after the tool");
    second
        .chat_history
        .iter()
        .filter_map(|message| match message {
            Message::User { content } => Some(content.iter()),
            _ => None,
        })
        .flatten()
        .filter_map(|content| match content {
            UserContent::ToolResult(result) => Some(format!("{result:?}")),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[tokio::test]
async fn chat_reads_the_deferred_user_tool_answer() {
    let model = call_then_done();
    let toolset = util::tool_set(AsyncToolCollection::<()>::new().add_user_tool::<SendNote, ()>());
    let mut session = util::session(toolset, Arc::new(()), model.clone()).await;

    let result = util::drive(&mut session, "send hello").await;

    let call = result.tool_calls()[0].clone();
    let response = result
        .tool_response(&call.id)
        .expect("the call was answered");
    assert!(
        matches!(response, ToolResponse::Json { json, .. } if json == "PendingUserExecution"),
        "chat's flow: the pending answer is recorded as-is, got {response:?}"
    );
    assert!(tool_result_shown(&model.requests()).contains("PendingUserExecution"));
    assert_eq!(result.content(), "done");
}
