use super::*;
use mcp_toolset::ListedServer;
use rmcp::{ServerHandler, ServiceExt};

struct StubServer;
impl ServerHandler for StubServer {}

/// The internal server listing `names` with a fixture description each.
async fn listed(
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
                "Listed when the session connected",
                std::sync::Arc::new(serde_json::Map::new()),
            )
        })
        .collect();
    let remote = RemoteMcpToolSet::from_listed(
        vec![ListedServer {
            name: MACRO_INTERNAL_MCP_NAME.into(),
            client: std::sync::Arc::new(client.unwrap()),
            tools,
            trace_context: mcp_toolset::TraceContext::Withhold,
        }],
        None,
    );
    (server.unwrap(), remote)
}

/// Whatever the session listed when it connected, a turn shows its model
/// the code tools of its own kind, and the other tools as listed.
#[tokio::test]
async fn a_turn_shows_its_own_kinds_code_tools() {
    let (server, remote) = listed(&["ExecuteCode", "DescribeCodeTools", "link_task"]).await;
    for kind in [CodeModeKind::TypeScript, CodeModeKind::Dialect] {
        let tools = TurnCodeTools::new(remote.clone(), kind);
        let catalog = ToolSet::<()>::searchable_catalog(&tools);
        let expected = agent_code_mode::inbound::toolset::session_toolset(kind);
        let execute = catalog
            .iter()
            .find(|tool| tool.name == "mcp__macro_internal__ExecuteCode")
            .unwrap();
        assert_eq!(
            execute.description,
            expected.tools["ExecuteCode"].description
        );
        assert_eq!(
            serde_json::to_value(&execute.schema).unwrap(),
            serde_json::Value::Object(expected.tools["ExecuteCode"].input_schema.clone())
        );
        let other = catalog
            .iter()
            .find(|tool| tool.name == "mcp__macro_internal__link_task")
            .unwrap();
        assert_eq!(other.description, "Listed when the session connected");
        // Nothing the session didn't list appears.
        assert_eq!(catalog.len(), 3);
    }
    server.cancel().await.unwrap();
}
