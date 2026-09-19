//! User tools through the whole loop: the tool answers pending, the session's
//! finisher (when it has one) settles the call before the model reads it, and
//! the model's next request carries what the user decided.

use super::util;
use crate::hook::{FinishedUserTool, PendingUserTool, UserToolFinisher};
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
use std::pin::Pin;
use std::sync::{Arc, Mutex};

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
async fn without_a_finisher_the_model_reads_the_pending_answer() {
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

#[tokio::test]
async fn with_a_finisher_the_model_reads_what_the_user_decided() {
    let model = call_then_done();
    let seen: Arc<Mutex<Vec<PendingUserTool>>> = Arc::new(Mutex::new(Vec::new()));
    let finisher: UserToolFinisher = {
        let seen = Arc::clone(&seen);
        Arc::new(move |call: PendingUserTool| {
            let seen = Arc::clone(&seen);
            Box::pin(async move {
                seen.lock().unwrap().push(call);
                Some(FinishedUserTool::Result(
                    serde_json::json!({"UserAction": {"delivered": "hello, edited"}}),
                ))
            }) as Pin<Box<dyn Future<Output = Option<FinishedUserTool>> + Send>>
        })
    };
    let toolset = util::tool_set(AsyncToolCollection::<()>::new().add_user_tool::<SendNote, ()>());
    let mut session = util::test_loop()
        .with_user_tool_finisher(finisher)
        .test_session(
            toolset,
            Arc::new(()),
            "test preamble",
            util::usage_ctx(),
            model.clone(),
        )
        .await;

    let result = util::drive(&mut session, "send hello").await;

    let call = result.tool_calls()[0].clone();
    assert_eq!(
        &*seen.lock().unwrap(),
        &[PendingUserTool {
            tool_name: "SendNote".to_owned(),
            tool_call_id: call.id.clone(),
            args: serde_json::json!({ "text": "hello" }),
        }],
        "the finisher saw the call as the model made it, under the id the stream gave it"
    );
    let response = result
        .tool_response(&call.id)
        .expect("the call was answered");
    assert!(
        matches!(
            response,
            ToolResponse::Json { json, .. }
                if json == &serde_json::json!({"UserAction": {"delivered": "hello, edited"}})
        ),
        "the stream records the finished result, got {response:?}"
    );
    let shown = tool_result_shown(&model.requests());
    assert!(
        shown.contains("hello, edited"),
        "the model read the finished result: {shown}"
    );
    assert!(
        !shown.contains("PendingUserExecution"),
        "the pending answer never reached the model: {shown}"
    );
    assert_eq!(result.content(), "done");
}
