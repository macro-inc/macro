use super::*;
use crate::domain::engine::{AwaitingUser, TurnPurpose};
use mcp_toolset::{ListedServer, RemoteMcpToolSet};
use rmcp::{ServerHandler, ServiceExt};
use tokio_util::sync::CancellationToken;

struct StubServer;
impl ServerHandler for StubServer {}

async fn remote(
    names: &[&str],
) -> (
    rmcp::service::RunningService<rmcp::RoleServer, StubServer>,
    RemoteMcpToolSet,
) {
    remote_named("macro_internal", names).await
}

async fn remote_named(
    server_name: &str,
    names: &[&str],
) -> (
    rmcp::service::RunningService<rmcp::RoleServer, StubServer>,
    RemoteMcpToolSet,
) {
    let (server, listed) = listed(server_name, names).await;
    (server, RemoteMcpToolSet::from_listed(vec![listed], None))
}

/// One fixture MCP server named `server` listing `names`.
async fn listed(
    server: &str,
    names: &[&str],
) -> (
    rmcp::service::RunningService<rmcp::RoleServer, StubServer>,
    ListedServer,
) {
    let (server_io, client_io) = tokio::io::duplex(4096);
    let (running, client) = tokio::join!(
        StubServer.serve(server_io),
        mcp_toolset::client_info().serve(client_io),
    );
    let tools = names
        .iter()
        .map(|name| {
            rmcp::model::Tool::new(
                (*name).to_owned(),
                "Fixture tool",
                Arc::new(
                    serde_json::json!({"type":"object"})
                        .as_object()
                        .unwrap()
                        .clone(),
                ),
            )
        })
        .collect();
    (
        running.unwrap(),
        ListedServer {
            name: server.into(),
            client: Arc::new(client.unwrap()),
            tools,
            trace_context: mcp_toolset::TraceContext::Withhold,
        },
    )
}

fn request(mcp_tools: Option<RemoteMcpToolSet>) -> TurnRequest {
    TurnRequest {
        feature: ai_usage::AiFeature::AgentSession,
        delivery: crate::domain::engine::ReplyDelivery::Streamed,
        purpose: TurnPurpose::Conversation,
        session_id: AgentSessionId::new(),
        awaiting: Arc::new(AwaitingUser::default()),
        owner: Owner::User(MacroUserIdStr::try_from("macro|owner@example.com".to_owned()).unwrap()),
        model: "unused".into(),
        reasoning_effort: Default::default(),
        speed: Default::default(),
        identity: None,
        instructions: None,
        messages: Vec::new(),
        mcp_tools,
        cancel: CancellationToken::new(),
        user_input: None,
        agent_key: None,
    }
}

#[tokio::test]
async fn conversation_turns_need_every_code_tool_and_never_fall_back() {
    assert!(code_tools_listed(&request(None)).is_err());
    for names in [
        vec![],
        vec!["ExecuteCode"],
        vec!["DescribeCodeTools"],
        vec!["ExecuteCode", "DescribeCodeTools"],
    ] {
        let (server, tools) = remote(&names).await;
        assert!(
            code_tools_listed(&request(Some(tools))).is_err(),
            "{names:?}"
        );
        server.cancel().await.unwrap();
    }
    let (server, tools) = remote(&["ExecuteCode", "DescribeCodeTools", "ReadCodeDocs"]).await;
    assert!(code_tools_listed(&request(Some(tools))).is_ok());
    server.cancel().await.unwrap();
}

#[tokio::test]
async fn summaries_and_other_owners_need_no_code_tools() {
    let mut summary = request(None);
    summary.purpose = TurnPurpose::Summary;
    assert!(code_tools_listed(&summary).is_ok());
    let mut team = request(None);
    team.owner = Owner::Team(uuid::Uuid::now_v7());
    assert!(code_tools_listed(&team).is_ok());
}

/// An unseen turn advertises code mode's three tools and nothing else the
/// servers list, with `ExecuteCode` stripped of what it would present, and
/// refuses a call to any other tool.
#[tokio::test]
async fn unseen_turns_get_only_code_mode() {
    let (server, tools) = remote(&[
        "ExecuteCode",
        "DescribeCodeTools",
        "ReadCodeDocs",
        "PresentReview",
        "link_task",
    ])
    .await;
    let set = mcp_select::CombinedToolSet::new(
        Arc::new(AsyncToolCollection::<()>::new()),
        unseen::code_mode_only(tools),
    )
    .with_eager_mcp_tools(crate::domain::mcp::CODE_MODE_MCP_TOOLS);

    let mut advertised: Vec<_> = AiToolSet::<()>::request_schemas(&set)
        .unwrap()
        .into_iter()
        .map(|schema| (schema.name, schema.description))
        .collect();
    advertised.sort();
    let names: Vec<_> = advertised.iter().map(|(name, _)| name.as_str()).collect();
    assert_eq!(
        names,
        [
            "mcp__macro_internal__DescribeCodeTools",
            "mcp__macro_internal__ExecuteCode",
            "mcp__macro_internal__ReadCodeDocs",
        ]
    );
    assert_eq!(
        advertised[1].1,
        agent_code_mode::inbound::toolset::unseen_execute_code_description()
    );
    assert!(!advertised[1].1.contains("Optional reviews"));
    assert!(!advertised[1].1.contains("execution.reviews"));
    assert!(AiToolSet::<()>::searchable_catalog(&set).is_empty());
    assert!(AiToolSet::<()>::searchable_toolset_names(&set).is_empty());

    let refused = AiToolSet::<()>::dispatch_tool_call(
        &set,
        (),
        RequestContext::new(MacroUserIdStr::try_from_email("owner@example.com").unwrap()),
        "mcp__macro_internal__PresentReview",
        &serde_json::json!({}),
    )
    .await;
    assert!(matches!(
        refused,
        Err(ai_toolset::ToolSetError::NotFound(_))
    ));
    server.cancel().await.unwrap();
}

/// A watched turn gets Macro's own MCP tools, eagerly, and none of a
/// connected app's: programs reach those through `macro.connectedApps`, so
/// nothing is left to search for or load, and a direct call is refused.
#[tokio::test]
async fn watched_turns_reach_connected_apps_only_from_code() {
    let (internal, internal_tools) = listed(
        "macro_internal",
        &[
            "ExecuteCode",
            "DescribeCodeTools",
            "ReadCodeDocs",
            "PresentReview",
            "link_task",
        ],
    )
    .await;
    let (linear, linear_tools) = listed("linear", &["create_issue"]).await;
    let set = mcp_select::CombinedToolSet::new(
        Arc::new(AsyncToolCollection::<()>::new()),
        mcp_allowlist::McpAllowlist::new(
            RemoteMcpToolSet::from_listed(vec![internal_tools, linear_tools], None),
            EAGER_INTERNAL_MCP_TOOLS,
        ),
    )
    .with_eager_mcp_tools(EAGER_INTERNAL_MCP_TOOLS);

    let mut names: Vec<_> = AiToolSet::<()>::request_schemas(&set)
        .unwrap()
        .into_iter()
        .map(|schema| schema.name)
        .collect();
    names.sort();
    assert_eq!(
        names,
        [
            "mcp__macro_internal__DescribeCodeTools",
            "mcp__macro_internal__ExecuteCode",
            "mcp__macro_internal__PresentReview",
            "mcp__macro_internal__ReadCodeDocs",
        ]
    );
    assert!(AiToolSet::<()>::searchable_catalog(&set).is_empty());
    assert!(AiToolSet::<()>::searchable_toolset_names(&set).is_empty());

    for tool in [
        "mcp__linear__create_issue",
        "mcp__macro_internal__link_task",
    ] {
        let refused = AiToolSet::<()>::dispatch_tool_call(
            &set,
            (),
            RequestContext::new(MacroUserIdStr::try_from_email("owner@example.com").unwrap()),
            tool,
            &serde_json::json!({}),
        )
        .await;
        assert!(
            matches!(refused, Err(ai_toolset::ToolSetError::NotFound(_))),
            "{tool}"
        );
    }
    internal.cancel().await.unwrap();
    linear.cancel().await.unwrap();
}

/// Code tools served by a custom server named to mangle like the internal
/// one are not the code runner.
#[tokio::test]
async fn code_tools_from_a_lookalike_server_are_not_listed() {
    let (server, tools) = remote_named(
        "macro_internal_",
        &["ExecuteCode", "DescribeCodeTools", "ReadCodeDocs"],
    )
    .await;
    assert!(code_tools_listed(&request(Some(tools))).is_err());
    drop(server);
}

/// A lookalike server's code tools mangle to the internal names but are
/// neither advertised nor callable.
#[tokio::test]
async fn the_allowlist_keeps_only_the_internal_servers_tools() {
    let (lookalike, lookalike_tools) = listed("macro_internal_", &["ExecuteCode"]).await;
    let set = mcp_select::CombinedToolSet::new(
        Arc::new(AsyncToolCollection::<()>::new()),
        mcp_allowlist::McpAllowlist::new(
            RemoteMcpToolSet::from_listed(vec![lookalike_tools], None),
            EAGER_INTERNAL_MCP_TOOLS,
        ),
    )
    .with_eager_mcp_tools(EAGER_INTERNAL_MCP_TOOLS);

    assert!(
        AiToolSet::<()>::request_schemas(&set)
            .unwrap_or_default()
            .is_empty()
    );
    let refused = AiToolSet::<()>::dispatch_tool_call(
        &set,
        (),
        RequestContext::new(MacroUserIdStr::try_from_email("owner@example.com").unwrap()),
        "mcp__macro_internal__ExecuteCode",
        &serde_json::json!({}),
    )
    .await;
    assert!(matches!(
        refused,
        Err(ai_toolset::ToolSetError::NotFound(_))
    ));
    lookalike.cancel().await.unwrap();
}
