//! A loop that streams tool calls reports each call as the model writes it.
//!
//! The model can spend seconds writing a call's arguments - a document body,
//! an email draft - before the call exists as far as rig's `on_tool_call` is
//! concerned. A host that renders tool activity live wants the call on screen
//! from the moment the model names it.

use super::util;
use crate::stream::{StreamPart, ToolResponse};
use ai_toolset::{
    AsyncTool, AsyncToolCollection, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations,
    ToolResult,
};
use async_trait::async_trait;
use rig_core::test_utils::{MockCompletionModel, MockStreamEvent};
use schemars::JsonSchema;
use serde::Deserialize;
use std::sync::Arc;

#[derive(Deserialize, JsonSchema)]
#[schemars(title = "echo_tool", description = "Echoes its input back.")]
struct EchoTool {
    value: String,
}

impl ToolAnnotated for EchoTool {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("Echo");
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

/// One call written in fragments, then a closing text turn.
fn streamed_echo() -> MockCompletionModel {
    MockCompletionModel::from_stream_turns([
        vec![
            MockStreamEvent::tool_call_name_delta("fc-1", "internal-1", "echo_tool"),
            MockStreamEvent::tool_call_arguments_delta("fc-1", "internal-1", "{\"value\":"),
            MockStreamEvent::tool_call_arguments_delta("fc-1", "internal-1", "\"hi\"}"),
            MockStreamEvent::tool_call("fc-1", "echo_tool", serde_json::json!({ "value": "hi" }))
                .with_call_id("call-1"),
            MockStreamEvent::final_response_with_default_usage(),
        ],
        vec![
            MockStreamEvent::text("done"),
            MockStreamEvent::final_response_with_default_usage(),
        ],
    ])
}

/// The call opens when it is named, its fragments follow in order, and the
/// finished call and its result carry the id it opened under - not the
/// provider's `call_id`, which was not known when it opened.
#[tokio::test]
async fn a_streamed_call_opens_early_and_finishes_under_the_same_id() {
    let mut session = util::test_loop()
        .with_streamed_tool_calls()
        .test_session(
            util::single_tool_set::<EchoTool, ()>(),
            Arc::new(()),
            "test preamble",
            util::usage_ctx(),
            streamed_echo(),
        )
        .await;

    let collected = util::drive(&mut session, "echo hi").await;
    assert!(collected.error.is_none(), "{:?}", collected.error);

    let started: Vec<(&str, &str)> = collected
        .parts
        .iter()
        .filter_map(|part| match part {
            StreamPart::ToolCallStarted(start) => Some((start.id.as_str(), start.name.as_str())),
            _ => None,
        })
        .collect();
    assert_eq!(started, vec![("internal-1", "echo_tool")]);

    let fragments: Vec<(&str, &str)> = collected
        .parts
        .iter()
        .filter_map(|part| match part {
            StreamPart::ToolCallArgs { id, delta } => Some((id.as_str(), delta.as_str())),
            _ => None,
        })
        .collect();
    assert_eq!(
        fragments,
        vec![("internal-1", "{\"value\":"), ("internal-1", "\"hi\"}")]
    );

    let calls = collected.tool_calls();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].id, "internal-1");
    assert_eq!(calls[0].json, serde_json::json!({ "value": "hi" }));
    assert!(matches!(
        collected.tool_response("internal-1"),
        Some(ToolResponse::Json { json, .. }) if json == &serde_json::json!({ "echo": "hi" })
    ));

    let position = |wanted: fn(&StreamPart) -> bool| {
        collected
            .parts
            .iter()
            .position(wanted)
            .expect("the part was emitted")
    };
    let opened = position(|part| matches!(part, StreamPart::ToolCallStarted(_)));
    let first_fragment = position(|part| matches!(part, StreamPart::ToolCallArgs { .. }));
    let finished = position(|part| matches!(part, StreamPart::ToolCall(_)));
    assert!(opened < first_fragment && first_fragment < finished);
    assert_eq!(collected.content(), "done");
}

/// A loop that did not ask for streamed calls sees only finished ones, under
/// the provider's id, exactly as before.
#[tokio::test]
async fn a_loop_without_streaming_reports_only_finished_calls() {
    let mut session = util::session(
        util::tool_set(AsyncToolCollection::<()>::new().add_tool::<EchoTool, ()>()),
        Arc::new(()),
        streamed_echo(),
    )
    .await;

    let collected = util::drive(&mut session, "echo hi").await;

    assert!(!collected.parts.iter().any(|part| matches!(
        part,
        StreamPart::ToolCallStarted(_) | StreamPart::ToolCallArgs { .. }
    )));
    let calls = collected.tool_calls();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].id, "call-1");
    assert!(collected.tool_response("call-1").is_some());
}
