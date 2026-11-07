//! Repro: multiple MCP calls in a single execution from *different* providers.
//!
//! Simulates the DCS `CombinedToolSet` wiring: static tools (a LoadTools
//! stand-in) plus a searchable catalog of MCP tools mangled as
//! `mcp__<server>__<tool>` from two different servers. The scripted model
//! loads tools from both servers and then calls one tool from each.

use super::util;
use crate::AgentError;
use crate::stream::ToolResponse;
use ai_toolset::tool_search::{
    LOAD_TOOLS, LoadToolsResponse, SEARCH_TOOLS, SearchToolsResponse, ToolMatch,
};
use ai_toolset::{
    AsyncTool, AsyncToolCollection, RequestContext, RequestSchema, SearchableTool, ServiceContext,
    ToolResult, ToolSet as AiToolSet, ToolSetError,
};
use ai_toolset::{ToolAnnotated, ToolAnnotations};
use async_trait::async_trait;
use rig_agent::agent::StreamingError;
use rig_agent::completion::PromptError;
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
    title = "SearchTools",
    description = "Find and stage searchable tools."
)]
struct SearchToolsTest {}

impl ToolAnnotated for SearchToolsTest {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("Search tools");
}

#[async_trait]
impl AsyncTool<()> for SearchToolsTest {
    type Output = SearchToolsResponse;

    async fn call(
        &self,
        _service_context: ServiceContext<()>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let matched: Vec<SearchableTool> =
            request_context.searchable_tools.iter().cloned().collect();
        let results = matched.iter().map(ToolMatch::of).collect();
        if let Some(loader) = request_context.tool_loader.as_ref() {
            loader.load(matched);
        }
        Ok(SearchToolsResponse {
            results,
            additional_matches: Vec::new(),
        })
    }
}

/// Stand-in for `ai_tools::LoadTools`: looks names up in the request context's
/// searchable catalog and hands them to the loader.
#[derive(Deserialize, JsonSchema)]
#[schemars(title = "LoadTools", description = "Load searchable tools by name.")]
struct LoadToolsTest {
    names: Vec<String>,
}

impl ToolAnnotated for LoadToolsTest {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("Load tools");
}

#[async_trait]
impl AsyncTool<()> for LoadToolsTest {
    type Output = LoadToolsResponse;

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
        let loaded = matched.iter().map(ToolMatch::of).collect();
        if let Some(loader) = request_context.tool_loader.as_ref() {
            loader.load(matched);
        }
        Ok(LoadToolsResponse {
            loaded,
            not_found: Vec::new(),
        })
    }
}

/// Fake `CombinedToolSet`: static tools + a searchable catalog of a deferred
/// Macro tool and MCP tools spanning two servers (`a` and `b`).
struct FakeCombined {
    static_tools: Arc<AsyncToolCollection<()>>,
    catalog_tools: Vec<String>,
}

impl FakeCombined {
    fn new() -> Self {
        Self {
            static_tools: Arc::new(
                AsyncToolCollection::<()>::new()
                    .add_tool::<SearchToolsTest, ()>()
                    .add_tool::<LoadToolsTest, ()>(),
            ),
            catalog_tools: vec![
                "ReadInitiative".to_owned(),
                "mcp__a__t1".to_owned(),
                "mcp__b__t2".to_owned(),
                "mcp__a__t3".to_owned(),
            ],
        }
    }
}

impl AiToolSet<()> for FakeCombined {
    fn dispatch_tool_call<'a>(
        &'a self,
        context: (),
        request_context: RequestContext,
        tool_name: &'a str,
        json: &'a serde_json::Value,
    ) -> Pin<
        Box<dyn Future<Output = Result<ToolResult<serde_json::Value>, ToolSetError>> + 'a + Send>,
    > {
        if self.catalog_tools.iter().any(|t| t == tool_name) {
            let name = tool_name.to_owned();
            return Box::pin(async move { Ok(Ok(serde_json::json!({ "ok": name }))) });
        }
        self.static_tools
            .dispatch_tool_call(context, request_context, tool_name, json)
    }

    fn request_schemas(&self) -> Option<Vec<RequestSchema>> {
        self.static_tools.request_schemas()
    }

    fn searchable_catalog(&self) -> Vec<SearchableTool> {
        self.catalog_tools
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
                LOAD_TOOLS,
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
            MockStreamEvent::tool_call("call-search", SEARCH_TOOLS, serde_json::json!({})),
            MockStreamEvent::final_response_with_default_usage(),
        ],
        vec![
            MockStreamEvent::tool_call("call-a", "mcp__a__t1", serde_json::json!({})),
            // The model may redundantly call LoadTools and the tool in the same
            // turn. Because SearchTools already staged it, the tool is in this
            // turn's normal allowed set and no invalid-call recovery is needed.
            MockStreamEvent::tool_call(
                "call-load-b",
                LOAD_TOOLS,
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

/// Auto-loads are recoveries, not mistakes, so they don't spend the
/// invalid-call budget: a turn that calls three unloaded catalog tools one
/// after another still finishes.
#[tokio::test]
async fn three_unloaded_searchable_tools_in_one_turn_all_self_heal() {
    let model = MockCompletionModel::from_stream_turns([
        vec![
            MockStreamEvent::tool_call("call-a", "mcp__a__t1", serde_json::json!({})),
            MockStreamEvent::final_response_with_default_usage(),
        ],
        vec![
            MockStreamEvent::tool_call("call-a-retry", "mcp__a__t1", serde_json::json!({})),
            MockStreamEvent::final_response_with_default_usage(),
        ],
        vec![
            MockStreamEvent::tool_call("call-b", "mcp__b__t2", serde_json::json!({})),
            MockStreamEvent::final_response_with_default_usage(),
        ],
        vec![
            MockStreamEvent::tool_call("call-b-retry", "mcp__b__t2", serde_json::json!({})),
            MockStreamEvent::final_response_with_default_usage(),
        ],
        vec![
            MockStreamEvent::tool_call("call-c", "mcp__a__t3", serde_json::json!({})),
            MockStreamEvent::final_response_with_default_usage(),
        ],
        vec![
            MockStreamEvent::tool_call("call-c-retry", "mcp__a__t3", serde_json::json!({})),
            MockStreamEvent::final_response_with_default_usage(),
        ],
        vec![MockStreamEvent::final_response_with_default_usage()],
    ]);

    let toolset: Arc<dyn AiToolSet<()> + Send + Sync> = Arc::new(FakeCombined::new());
    let mut session = util::session(toolset, Arc::new(()), model).await;
    let result = util::drive(&mut session, "use three integration tools without loading").await;

    assert!(
        result.error.is_none(),
        "stream ended with error: {:?}",
        result.error
    );
    expect_json_ok(&result, "mcp__a__t1");
    expect_json_ok(&result, "mcp__b__t2");
    expect_json_ok(&result, "mcp__a__t3");
}

/// A model that keeps calling a name that exists nowhere still fails the turn
/// with `UnknownToolCall` once the invalid-call budget is spent.
#[tokio::test]
async fn repeated_hallucinated_tool_name_fails_after_the_budget() {
    let model = MockCompletionModel::from_stream_turns([
        vec![
            MockStreamEvent::tool_call("call-bad-1", "mcp__zz__nope", serde_json::json!({})),
            MockStreamEvent::final_response_with_default_usage(),
        ],
        vec![
            MockStreamEvent::tool_call("call-bad-2", "mcp__zz__nope", serde_json::json!({})),
            MockStreamEvent::final_response_with_default_usage(),
        ],
        vec![
            MockStreamEvent::tool_call("call-bad-3", "mcp__zz__nope", serde_json::json!({})),
            MockStreamEvent::final_response_with_default_usage(),
        ],
        vec![
            MockStreamEvent::text("should never be reached"),
            MockStreamEvent::final_response_with_default_usage(),
        ],
    ]);

    let toolset: Arc<dyn AiToolSet<()> + Send + Sync> = Arc::new(FakeCombined::new());
    let mut session = util::session(toolset, Arc::new(()), model).await;
    let result = util::drive(&mut session, "keep calling a tool that does not exist").await;

    match &result.error {
        Some(AgentError::Streaming(StreamingError::Prompt(error))) => match error.as_ref() {
            PromptError::UnknownToolCall { tool_name, .. } => {
                assert_eq!(tool_name, "mcp__zz__nope");
            }
            other => panic!("expected UnknownToolCall, got {other:?}"),
        },
        other => panic!("expected UnknownToolCall, got {other:?}"),
    }
    assert!(!result.content().contains("should never be reached"));
}

/// Load + call server a, then load + call server b, all in one execution.
#[tokio::test]
async fn mcp_calls_from_two_providers_loaded_sequentially() {
    let model = MockCompletionModel::from_stream_turns([
        vec![
            MockStreamEvent::tool_call(
                "call-load-a",
                LOAD_TOOLS,
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
                LOAD_TOOLS,
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

/// Sessions are rebuilt every turn, so a tool loaded on an earlier turn would
/// be gone on the next, and the model would pay a reload round trip each time.
/// A catalog tool the history already called is loaded before the first
/// request instead; one the history never called stays out.
#[tokio::test]
async fn a_tool_called_earlier_in_the_conversation_is_loaded_upfront() {
    use rig_core::OneOrMany;
    use rig_core::message::{AssistantContent, Message};

    let model = MockCompletionModel::from_stream_turns([vec![
        MockStreamEvent::text("done"),
        MockStreamEvent::final_response_with_default_usage(),
    ]]);
    let toolset: Arc<dyn AiToolSet<()> + Send + Sync> = Arc::new(FakeCombined::new());
    let mut session = util::session(toolset, Arc::new(()), model.clone()).await;

    let stream = session
        .send_message(vec![
            Message::user("use integration a"),
            Message::Assistant {
                id: None,
                content: OneOrMany::one(AssistantContent::tool_call(
                    "call-a",
                    "mcp__a__t1",
                    serde_json::json!({}),
                )),
            },
            Message::tool_result("call-a", "{\"ok\":\"mcp__a__t1\"}"),
            Message::user("again"),
        ])
        .await
        .expect("send_message should start the stream");
    let result = util::collect(stream).await;
    assert!(result.error.is_none(), "{:?}", result.error);

    let requests = model.requests();
    let advertised: Vec<&str> = requests[0]
        .tools
        .iter()
        .map(|tool| tool.name.as_str())
        .collect();
    assert!(advertised.contains(&"mcp__a__t1"), "{advertised:?}");
    assert!(!advertised.contains(&"mcp__b__t2"), "{advertised:?}");
}

/// A deferred tool loaded with `LoadTools` on one turn and never called there
/// is still loaded on the next: the call goes through on the first request,
/// with no invalid-call recovery.
#[tokio::test]
async fn a_tool_loaded_on_an_earlier_turn_is_callable_on_the_next() {
    use rig_core::OneOrMany;
    use rig_core::message::{AssistantContent, Message};

    let first_model = MockCompletionModel::from_stream_turns([
        vec![
            MockStreamEvent::tool_call(
                "call-load",
                LOAD_TOOLS,
                serde_json::json!({ "names": ["ReadInitiative"] }),
            ),
            MockStreamEvent::final_response_with_default_usage(),
        ],
        vec![
            MockStreamEvent::text("I'm checking your access on that project."),
            MockStreamEvent::final_response_with_default_usage(),
        ],
    ]);
    let toolset: Arc<dyn AiToolSet<()> + Send + Sync> = Arc::new(FakeCombined::new());
    let mut first = util::session(toolset.clone(), Arc::new(()), first_model).await;
    let first_turn = util::drive(&mut first, "link these tasks to the Agents project").await;
    assert!(first_turn.error.is_none(), "{:?}", first_turn.error);
    let Some(loaded) =
        first_turn
            .tool_responses()
            .into_iter()
            .find_map(|response| match response {
                ToolResponse::Json { name, json, .. } if name == LOAD_TOOLS => Some(json),
                _ => None,
            })
    else {
        panic!("expected the LoadTools result");
    };

    let second_model = MockCompletionModel::from_stream_turns([
        vec![
            MockStreamEvent::tool_call("call-read", "ReadInitiative", serde_json::json!({})),
            MockStreamEvent::final_response_with_default_usage(),
        ],
        vec![
            MockStreamEvent::text("You can view the project."),
            MockStreamEvent::final_response_with_default_usage(),
        ],
    ]);
    let mut second = util::session(toolset, Arc::new(()), second_model.clone()).await;
    let stream = second
        .send_message(vec![
            Message::user("link these tasks to the Agents project"),
            Message::Assistant {
                id: None,
                content: OneOrMany::one(AssistantContent::tool_call(
                    "call-load",
                    LOAD_TOOLS,
                    serde_json::json!({ "names": ["ReadInitiative"] }),
                )),
            },
            Message::tool_result("call-load", loaded.to_string()),
            Message::assistant("I'm checking your access on that project."),
            Message::user("did it work?"),
        ])
        .await
        .expect("send_message should start the stream");
    let second_turn = util::collect(stream).await;

    assert!(second_turn.error.is_none(), "{:?}", second_turn.error);
    expect_json_ok(&second_turn, "ReadInitiative");
    let requests = second_model.requests();
    assert_eq!(requests.len(), 2, "the call needed no recovery");
    assert!(
        requests[0]
            .tools
            .iter()
            .any(|tool| tool.name == "ReadInitiative"),
        "ReadInitiative is advertised on the first request"
    );
}
