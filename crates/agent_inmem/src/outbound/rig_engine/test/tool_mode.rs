use super::*;
use crate::domain::engine::{AwaitingUser, TurnPurpose};
use mcp_toolset::{ListedServer, RemoteMcpToolSet};
use rmcp::{ServerHandler, ServiceExt};
use std::{future::Future, pin::Pin};
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
    }
}

#[derive(Default)]
struct RecordingSelector(Mutex<Vec<String>>);

impl ToolModeSelector for RecordingSelector {
    fn select<'a>(
        &'a self,
        owner: &'a MacroUserIdStr<'_>,
    ) -> Pin<Box<dyn Future<Output = ToolMode> + Send + 'a>> {
        self.0.lock().unwrap().push(owner.to_string());
        Box::pin(async { ToolMode::Code })
    }
}

#[tokio::test]
async fn requires_both_code_tools_and_loads_once_as_the_session_owner() {
    let selector = RecordingSelector::default();
    assert_eq!(
        select_tool_mode(&selector, &request(None)).await,
        Some(ToolMode::Standard)
    );
    for names in [vec![], vec!["ExecuteCode"], vec!["DescribeCodeTools"]] {
        let (server, tools) = remote(&names).await;
        assert_eq!(
            select_tool_mode(&selector, &request(Some(tools))).await,
            Some(ToolMode::Standard)
        );
        server.cancel().await.unwrap();
    }
    assert!(selector.0.lock().unwrap().is_empty());
    let (server, tools) = remote(&["ExecuteCode", "DescribeCodeTools"]).await;
    let mut turn = request(Some(tools));
    turn.purpose = TurnPurpose::Summary;
    assert_eq!(
        select_tool_mode(&selector, &turn).await,
        Some(ToolMode::Standard)
    );
    assert!(selector.0.lock().unwrap().is_empty());
    turn.purpose = TurnPurpose::Conversation;
    assert_eq!(
        select_tool_mode(&selector, &turn).await,
        Some(ToolMode::Code)
    );
    assert_eq!(*selector.0.lock().unwrap(), ["macro|owner@example.com"]);
    server.cancel().await.unwrap();
}

struct PendingSelector(tokio::sync::Notify);

impl ToolModeSelector for PendingSelector {
    fn select<'a>(
        &'a self,
        _: &'a MacroUserIdStr<'_>,
    ) -> Pin<Box<dyn Future<Output = ToolMode> + Send + 'a>> {
        Box::pin(async {
            self.0.notify_one();
            std::future::pending().await
        })
    }
}

#[tokio::test]
async fn stopping_during_flag_loading_does_not_start_a_turn() {
    let (server, tools) = remote(&["ExecuteCode", "DescribeCodeTools"]).await;
    let turn = request(Some(tools));
    let selector = PendingSelector(tokio::sync::Notify::new());
    let (selected, ()) = tokio::time::timeout(std::time::Duration::from_secs(1), async {
        tokio::join!(select_tool_mode(&selector, &turn), async {
            selector.0.notified().await;
            turn.cancel.cancel();
        })
    })
    .await
    .unwrap();
    assert_eq!(selected, None);
    server.cancel().await.unwrap();
}
