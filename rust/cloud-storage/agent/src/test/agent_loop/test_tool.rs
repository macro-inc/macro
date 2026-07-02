//! this tests how the agent loop handles tools
//! it aims to cover all cases of tool success and failure
use super::util;
use crate::stream::ToolResponse;
use ai_toolset::{
    AsyncTool, AsyncToolCollection, RequestContext, ServiceContext, ToolCallError, ToolResult,
};
use async_trait::async_trait;
use rig_core::test_utils::{MockCompletionModel, MockStreamEvent};
use schemars::JsonSchema;
use serde::Deserialize;
use std::sync::Arc;

/// A tool that echoes its input. Deserialization fails when `value` is absent.
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

/// A tool that always fails with a [`ToolCallError`].
#[derive(Deserialize, JsonSchema)]
#[schemars(title = "boom_tool", description = "Always fails.")]
struct BoomTool {}

#[async_trait]
impl AsyncTool<()> for BoomTool {
    type Output = serde_json::Value;

    async fn call(
        &self,
        _service_context: ServiceContext<()>,
        _request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        Err(ToolCallError {
            description: "boom failed".to_string(),
            internal_error: anyhow::anyhow!("boom"),
        })
    }
}

/// A two-turn script: `tool_turn` does the tool calls, then a final turn writes
/// "done" so we can observe that the loop kept going.
fn tool_then_done(tool_turn: impl IntoIterator<Item = MockStreamEvent>) -> MockCompletionModel {
    MockCompletionModel::from_stream_turns([
        tool_turn
            .into_iter()
            .chain([MockStreamEvent::final_response_with_default_usage()])
            .collect::<Vec<_>>(),
        vec![
            MockStreamEvent::text("done"),
            MockStreamEvent::final_response_with_default_usage(),
        ],
    ])
}

/// Tool call error
/// it should not stop the loop. It should output the call and response of the tool. These should be the strongly typed events
/// yielded to the consumer
#[tokio::test]
async fn tool_call_error_emits_call_and_error_response() {
    let model = tool_then_done([MockStreamEvent::tool_call(
        "call-1",
        "boom_tool",
        serde_json::json!({}),
    )]);
    let toolset = util::single_tool_set::<BoomTool, ()>();
    let mut session = util::session(toolset, Arc::new(()), model).await;

    let result = util::drive(&mut session, "call the failing tool").await;

    let call = result
        .tool_calls()
        .into_iter()
        .find(|call| call.name == "boom_tool")
        .expect("the failing tool's call should be emitted");
    let response = result
        .tool_response(&call.id)
        .expect("the failing tool's response should be emitted");
    assert!(
        matches!(response, ToolResponse::Err { description, .. } if description.contains("boom failed")),
        "a tool error should surface as a typed error response, got {response:?}"
    );
    assert!(
        result.error.is_none(),
        "a tool error must not stop the loop, got {:?}",
        result.error
    );
    assert_eq!(result.content(), "done", "the loop should continue");
}

/// Parallel tool call success
/// Multiple tool calls are executed in one turn. They all succeed. The call/response eventsa re all emitted
#[tokio::test]
async fn parallel_success_emits_all_calls_and_responses() {
    let model = tool_then_done([
        MockStreamEvent::tool_call("call-1", "echo_tool", serde_json::json!({ "value": "a" })),
        MockStreamEvent::tool_call("call-2", "echo_tool", serde_json::json!({ "value": "b" })),
    ]);
    let toolset = util::single_tool_set::<EchoTool, ()>();
    let mut session = util::session(toolset, Arc::new(()), model).await;

    let result = util::drive(&mut session, "call echo twice").await;

    assert_eq!(result.tool_calls().len(), 2, "both calls should be emitted");
    let echoed: Vec<serde_json::Value> = result
        .tool_responses()
        .into_iter()
        .filter_map(|response| match response {
            ToolResponse::Json { json, .. } => json.get("echo").cloned(),
            ToolResponse::Err { .. } => None,
        })
        .collect();
    assert_eq!(echoed, vec![serde_json::json!("a"), serde_json::json!("b")]);
    // Every call has a matching response.
    for call in result.tool_calls() {
        assert!(
            result.tool_response(&call.id).is_some(),
            "call {} should have a response",
            call.id
        );
    }
}

// TODO: add support for concurrent execution (unsupported by rig)
/// Long enough to let a slow tool finish so we observe full ordering, short
/// enough to keep the suite quick.
// const SLOW: u64 = 200;
// const MEDIUM: u64 = 100;
// const FAST: u64 = 10;
// /// a tool that sleeps `ms` before returning its `label`. used to observe
// /// execution concurrency by completion order.

// #[derive(Deserialize, JsonSchema)]
// #[schemars(title = "sleep_tool", description = "sleeps, then returns its label.")]
// struct SleepTool {
//     ms: u64,
//     label: String,
// }

// #[async_trait]
// impl AsyncTool<()> for SleepTool {
//     type Output = serde_json::Value;

//     async fn call(
//         &self,
//         _service_context: ServiceContext<()>,
//         _request_context: RequestContext,
//     ) -> ToolResult<Self::Output> {
//         tokio::time::sleep(Duration::from_millis(self.ms)).await;
//         Ok(serde_json::json!({ "label": self.label }))
//     }
// }

// /// The `label` of a JSON tool response, for ordering assertions.
// fn response_label(response: &ToolResponse) -> Option<&str> {
//     match response {
//         ToolResponse::Json { json, .. } => json.get("label").and_then(|l| l.as_str()),
//         ToolResponse::Err { .. } => None,
//     }
// }
// /// Parallel tool call parallel execution
// /// three tools are called in one turn. The tools have different timings. They are executed in paralle as
// /// seen by the output which shows the fast tools yield before the slow tools regardless of order in the
// /// response
// #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
// async fn parallel_tools_execute_concurrently() {
//     // Response order is slow, medium, fast — but if they run concurrently the
//     // responses should land fast, medium, slow (by completion time).
//     let model = tool_then_done([
//         MockStreamEvent::tool_call(
//             "call-1",
//             "sleep_tool",
//             serde_json::json!({ "ms": SLOW, "label": "slow" }),
//         ),
//         MockStreamEvent::tool_call(
//             "call-2",
//             "sleep_tool",
//             serde_json::json!({ "ms": MEDIUM, "label": "medium" }),
//         ),
//         MockStreamEvent::tool_call(
//             "call-3",
//             "sleep_tool",
//             serde_json::json!({ "ms": FAST, "label": "fast" }),
//         ),
//     ]);
//     let toolset = util::single_tool_set::<SleepTool, ()>();
//     let mut session = util::session(toolset, Arc::new(()), model).await;

//     let result = util::drive(&mut session, "call three timed tools").await;

//     let order: Vec<&str> = result
//         .tool_responses()
//         .into_iter()
//         .filter_map(response_label)
//         .collect();
//     assert_eq!(
//         order,
//         vec!["fast", "medium", "slow"],
//         "tools should run concurrently, so responses land in completion order"
//     );
// }

/// Parallel Tool call failure
/// If one call fails it emits the failure parts correctly and the other calls succeed
#[tokio::test]
async fn parallel_failure_isolated_from_successful_calls() {
    let model = tool_then_done([
        MockStreamEvent::tool_call("call-1", "boom_tool", serde_json::json!({})),
        MockStreamEvent::tool_call("call-2", "echo_tool", serde_json::json!({ "value": "ok" })),
    ]);
    let toolset = util::tool_set(
        AsyncToolCollection::<()>::new()
            .add_tool::<BoomTool, ()>()
            .add_tool::<EchoTool, ()>(),
    );
    let mut session = util::session(toolset, Arc::new(()), model).await;

    let result = util::drive(&mut session, "call a failing and a succeeding tool").await;

    let boom = result
        .tool_calls()
        .into_iter()
        .find(|call| call.name == "boom_tool")
        .and_then(|call| result.tool_response(&call.id))
        .expect("the failing call should have a response");
    assert!(
        matches!(boom, ToolResponse::Err { description, .. } if description.contains("boom failed")),
        "the failing call should surface a typed error, got {boom:?}"
    );

    let echo = result
        .tool_calls()
        .into_iter()
        .find(|call| call.name == "echo_tool")
        .and_then(|call| result.tool_response(&call.id))
        .expect("the succeeding call should have a response");
    assert!(
        matches!(echo, ToolResponse::Json { json, .. } if *json == serde_json::json!({ "echo": "ok" })),
        "the succeeding call should still return its output, got {echo:?}"
    );
}
