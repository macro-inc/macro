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

fn mode(request: &TurnRequest, only_code: bool) -> Option<ToolMode> {
    tool_mode(request, only_code).ok()
}

#[tokio::test]
async fn conversation_turns_run_code_mode_whenever_every_code_tool_is_listed() {
    assert_eq!(mode(&request(None), false), Some(ToolMode::Standard));
    for names in [
        vec![],
        vec!["ExecuteCode"],
        vec!["DescribeCodeTools"],
        vec!["ExecuteCode", "DescribeCodeTools"],
    ] {
        let (server, tools) = remote(&names).await;
        assert_eq!(mode(&request(Some(tools)), false), Some(ToolMode::Standard));
        server.cancel().await.unwrap();
    }
    let (server, tools) = remote(&["ExecuteCode", "DescribeCodeTools", "ReadCodeDocs"]).await;
    let mut turn = request(Some(tools));
    turn.purpose = TurnPurpose::Summary;
    assert_eq!(mode(&turn, false), Some(ToolMode::Standard));
    turn.purpose = TurnPurpose::Conversation;
    assert_eq!(mode(&turn, false), Some(ToolMode::Code));
    server.cancel().await.unwrap();
}

#[tokio::test]
async fn code_mode_only_turns_never_fall_back_to_direct_tools() {
    assert!(tool_mode(&request(None), true).is_err());
    for names in [vec![], vec!["ExecuteCode", "DescribeCodeTools"]] {
        let (server, tools) = remote(&names).await;
        assert!(tool_mode(&request(Some(tools)), true).is_err());
        server.cancel().await.unwrap();
    }
    let mut summary = request(None);
    summary.purpose = TurnPurpose::Summary;
    assert_eq!(mode(&summary, true), Some(ToolMode::Code));
    let (server, tools) = remote(&["ExecuteCode", "DescribeCodeTools", "ReadCodeDocs"]).await;
    assert_eq!(mode(&request(Some(tools)), true), Some(ToolMode::Code));
    server.cancel().await.unwrap();
}

#[tokio::test]
async fn sessions_without_a_user_owner_keep_the_direct_tools() {
    let mut turn = request(None);
    turn.owner = Owner::Team(uuid::Uuid::new_v4());
    assert_eq!(mode(&turn, true), Some(ToolMode::Standard));
}
