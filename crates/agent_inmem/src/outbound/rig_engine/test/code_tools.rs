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
    let (server_io, client_io) = tokio::io::duplex(4096);
    let (server, client) = tokio::join!(
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
    let remote = RemoteMcpToolSet::from_listed(
        vec![ListedServer {
            name: "macro_internal".into(),
            client: Arc::new(client.unwrap()),
            tools,
        }],
        None,
    );
    (server.unwrap(), remote)
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
        reviewer: None,
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
        unseen::CodeModeOnly::new(tools),
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
