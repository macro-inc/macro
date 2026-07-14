//! Repro: multiple MCP calls in a single execution from *different* providers.
//!
//! Simulates the DCS `CombinedToolSet` wiring: static tools (a LoadTools
//! stand-in) plus a searchable catalog of MCP tools mangled as
//! `mcp__<server>__<tool>` from two different servers. The scripted model
//! loads tools from both servers and then calls one tool from each.

use super::util;
use crate::stream::ToolResponse;
use ai_toolset::{
    AsyncTool, AsyncToolCollection, RequestContext, RequestSchema, SearchableTool, ServiceContext,
    ToolResult, ToolSet as AiToolSet, ToolSetError,
};
use async_trait::async_trait;
use rig_core::test_utils::{MockCompletionModel, MockStreamEvent};
use schemars::{JsonSchema, Schema};
use serde::Deserialize;
use std::pin::Pin;
use std::sync::Arc;

/// Stand-in for `ai_tools::SearchTools`: returns all tools and stages them so
/// they are callable on the next model turn. (The real tool auto-loads only
/// the top-ranked matches; with this test catalog everything fits the cap.)
#[derive(Deserialize, JsonSchema)]
#[schemars(
    title = "search_tools",
    description = "Find and stage searchable tools."
)]
struct SearchToolsTest {}

#[async_trait]
impl AsyncTool<()> for SearchToolsTest {
    type Output = serde_json::Value;

    async fn call(
        &self,
        _service_context: ServiceContext<()>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let matched: Vec<SearchableTool> =
            request_context.searchable_tools.iter().cloned().collect();
        let results: Vec<String> = matched.iter().map(|t| t.name.clone()).collect();
        if let Some(loader) = request_context.tool_loader.as_ref() {
            loader.load(matched);
        }
        Ok(serde_json::json!({ "results": results }))
    }
}

/// Stand-in for `ai_tools::LoadTools`: looks names up in the request context's
/// searchable catalog and hands them to the loader.
#[derive(Deserialize, JsonSchema)]
#[schemars(title = "load_tools", description = "Load searchable tools by name.")]
struct LoadToolsTest {
    names: Vec<String>,
}

#[async_trait]
impl AsyncTool<()> for LoadToolsTest {
    type Output = serde_json::Value;

    async fn call(
        &self,
        _service_context: ServiceContext<()>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let matched: Vec<SearchableTool> = request_context
            .searchable_tools
            .iter()
            .filter(|t| self.names.contains(&t.name))
            .cloned()
            .collect();
        let loaded: Vec<String> = matched.iter().map(|t| t.name.clone()).collect();
        if let Some(loader) = request_context.tool_loader.as_ref() {
            loader.load(matched);
        }
        Ok(serde_json::json!({ "loaded": loaded }))
    }
}

/// Fake `CombinedToolSet`: static tools + a searchable MCP catalog spanning
/// two servers (`a` and `b`).
struct FakeCombined {
    static_tools: Arc<AsyncToolCollection<()>>,
    mcp_tools: Vec<String>,
}

impl FakeCombined {
    fn new() -> Self {
        Self {
            static_tools: Arc::new(
                AsyncToolCollection::<()>::new()
                    .add_tool::<SearchToolsTest, ()>()
                    .add_tool::<LoadToolsTest, ()>(),
            ),
            mcp_tools: vec!["mcp__a__t1".to_owned(), "mcp__b__t2".to_owned()],
        }
    }
}

impl AiToolSet<()> for FakeCombined {
    fn try_tool_call<'a>(
        &'a self,
        context: (),
        request_context: RequestContext,
        tool_name: &'a str,
        json: &'a serde_json::Value,
    ) -> Pin<
        Box<dyn Future<Output = Result<ToolResult<serde_json::Value>, ToolSetError>> + 'a + Send>,
    > {
        if tool_name.starts_with("mcp__") {
            let known = self.mcp_tools.iter().any(|t| t == tool_name);
            let name = tool_name.to_owned();
            return Box::pin(async move {
                if known {
                    Ok(Ok(serde_json::json!({ "ok": name })))
                } else {
                    Err(ToolSetError::NotFound(name))
                }
            });
        }
        self.static_tools
            .try_tool_call(context, request_context, tool_name, json)
    }

    fn request_schemas(&self) -> Option<Vec<RequestSchema>> {
        self.static_tools.request_schemas()
    }

    fn searchable_catalog(&self) -> Vec<SearchableTool> {
        self.mcp_tools
            .iter()
            .map(|name| SearchableTool {
                name: name.clone(),
                description: format!("tool {name}"),
                schema: Schema::default(),
            })
            .collect()
    }

    fn searchable_toolset_names(&self) -> Vec<String> {
        vec!["a".to_owned(), "b".to_owned()]
    }
}

fn expect_json_ok(result: &util::Collected, tool: &str) {
    let response = result
        .tool_responses()
        .into_iter()
        .find(|r| matches!(r, ToolResponse::Json { name, .. } | ToolResponse::Err { name, .. } if name == tool));
    match response {
        Some(ToolResponse::Json { json, .. }) => {
            assert_eq!(*json, serde_json::json!({ "ok": tool }), "for {tool}");
        }
        other => panic!("expected success response for {tool}, got {other:?}"),
    }
}

/// Load tools from two servers in one LoadTools call, then call one tool from
/// each server in a single subsequent turn.
#[tokio::test]
async fn mcp_calls_from_two_providers_in_one_turn() {
    let model = MockCompletionModel::from_stream_turns([
        vec![
            MockStreamEvent::tool_call(
                "call-load",
                "load_tools",
                serde_json::json!({ "names": ["mcp__a__t1", "mcp__b__t2"] }),
            ),
            MockStreamEvent::final_response_with_default_usage(),
        ],
        vec![
            MockStreamEvent::tool_call("call-a", "mcp__a__t1", serde_json::json!({})),
            MockStreamEvent::tool_call("call-b", "mcp__b__t2", serde_json::json!({})),
            MockStreamEvent::final_response_with_default_usage(),
        ],
        vec![MockStreamEvent::final_response_with_default_usage()],
    ]);

    let toolset: Arc<dyn AiToolSet<()> + Send + Sync> = Arc::new(FakeCombined::new());
    let mut session = util::session(toolset, Arc::new(()), model).await;
    let result = util::drive(&mut session, "use both integrations").await;

    assert!(
        result.error.is_none(),
        "stream ended with error: {:?}",
        result.error
    );
    expect_json_ok(&result, "mcp__a__t1");
    expect_json_ok(&result, "mcp__b__t2");
}

/// Searching stages all matches, so the following turn can call tools from
/// multiple providers without first spending a separate `LoadTools` turn.
#[tokio::test]
async fn search_stages_tools_from_multiple_providers_for_the_next_turn() {
    let model = MockCompletionModel::from_stream_turns([
        vec![
            MockStreamEvent::tool_call("call-search", "search_tools", serde_json::json!({})),
            MockStreamEvent::final_response_with_default_usage(),
        ],
        vec![
            MockStreamEvent::tool_call("call-a", "mcp__a__t1", serde_json::json!({})),
            // The model may redundantly call LoadTools and the tool in the same
            // turn. Because SearchTools already staged it, the tool is in this
            // turn's normal allowed set and no invalid-call recovery is needed.
            MockStreamEvent::tool_call(
                "call-load-b",
                "load_tools",
                serde_json::json!({ "names": ["mcp__b__t2"] }),
            ),
            MockStreamEvent::tool_call("call-b", "mcp__b__t2", serde_json::json!({})),
            MockStreamEvent::final_response_with_default_usage(),
        ],
        vec![MockStreamEvent::final_response_with_default_usage()],
    ]);

    let toolset: Arc<dyn AiToolSet<()> + Send + Sync> = Arc::new(FakeCombined::new());
    let mut session = util::session(toolset, Arc::new(()), model).await;
    let result = util::drive(&mut session, "search, then use both integrations").await;

    assert!(
        result.error.is_none(),
        "stream ended with error: {:?}",
        result.error
    );
    expect_json_ok(&result, "mcp__a__t1");
    expect_json_ok(&result, "mcp__b__t2");
}

/// Repro for the reported "silent empty-turn stall": the model calls an
/// integration tool that exists in the searchable catalog but was never
/// loaded, so it is not advertised this turn. Instead of the stream dying with
/// `UnknownToolCall` (surfaced to the user as a turn that announced a tool
/// call and then went silent), the bridge loads the tool from the catalog and
/// the retried call succeeds.
#[tokio::test]
async fn calling_a_searchable_tool_before_loading_self_heals() {
    let model = MockCompletionModel::from_stream_turns([
        // Calls the tool directly, skipping search/load entirely.
        vec![
            MockStreamEvent::tool_call("call-a", "mcp__a__t1", serde_json::json!({})),
            MockStreamEvent::final_response_with_default_usage(),
        ],
        // Retry turn: the tool is loaded now; the same call goes through.
        vec![
            MockStreamEvent::tool_call("call-a-retry", "mcp__a__t1", serde_json::json!({})),
            MockStreamEvent::final_response_with_default_usage(),
        ],
        vec![MockStreamEvent::final_response_with_default_usage()],
    ]);

    let toolset: Arc<dyn AiToolSet<()> + Send + Sync> = Arc::new(FakeCombined::new());
    let mut session = util::session(toolset, Arc::new(()), model).await;
    let result = util::drive(&mut session, "use integration a without loading it").await;

    assert!(
        result.error.is_none(),
        "stream ended with error: {:?}",
        result.error
    );
    expect_json_ok(&result, "mcp__a__t1");
}

/// A call to a name that exists nowhere — not even the searchable catalog —
/// feeds corrective feedback back to the model instead of failing the stream;
/// the model recovers and finishes the turn normally.
#[tokio::test]
async fn hallucinated_tool_name_gets_feedback_and_the_turn_recovers() {
    let model = MockCompletionModel::from_stream_turns([
        vec![
            MockStreamEvent::tool_call("call-bad", "mcp__zz__nope", serde_json::json!({})),
            MockStreamEvent::final_response_with_default_usage(),
        ],
        // Retry turn: the model answers in text instead.
        vec![
            MockStreamEvent::text("recovered without the tool"),
            MockStreamEvent::final_response_with_default_usage(),
        ],
    ]);

    let toolset: Arc<dyn AiToolSet<()> + Send + Sync> = Arc::new(FakeCombined::new());
    let mut session = util::session(toolset, Arc::new(()), model).await;
    let result = util::drive(&mut session, "use a tool that does not exist").await;

    assert!(
        result.error.is_none(),
        "stream ended with error: {:?}",
        result.error
    );
    assert!(result.tool_responses().is_empty());
    assert!(result.content().contains("recovered without the tool"));
}

/// Load + call server a, then load + call server b, all in one execution.
#[tokio::test]
async fn mcp_calls_from_two_providers_loaded_sequentially() {
    let model = MockCompletionModel::from_stream_turns([
        vec![
            MockStreamEvent::tool_call(
                "call-load-a",
                "load_tools",
                serde_json::json!({ "names": ["mcp__a__t1"] }),
            ),
            MockStreamEvent::final_response_with_default_usage(),
        ],
        vec![
            MockStreamEvent::tool_call("call-a", "mcp__a__t1", serde_json::json!({})),
            MockStreamEvent::final_response_with_default_usage(),
        ],
        vec![
            MockStreamEvent::tool_call(
                "call-load-b",
                "load_tools",
                serde_json::json!({ "names": ["mcp__b__t2"] }),
            ),
            MockStreamEvent::final_response_with_default_usage(),
        ],
        vec![
            MockStreamEvent::tool_call("call-b", "mcp__b__t2", serde_json::json!({})),
            MockStreamEvent::final_response_with_default_usage(),
        ],
        vec![MockStreamEvent::final_response_with_default_usage()],
    ]);

    let toolset: Arc<dyn AiToolSet<()> + Send + Sync> = Arc::new(FakeCombined::new());
    let mut session = util::session(toolset, Arc::new(()), model).await;
    let result = util::drive(&mut session, "use both integrations one after another").await;

    assert!(
        result.error.is_none(),
        "stream ended with error: {:?}",
        result.error
    );
    expect_json_ok(&result, "mcp__a__t1");
    expect_json_ok(&result, "mcp__b__t2");
}
