use super::*;
use agent_client_protocol::schema::v1::{HttpHeader, McpServerHttp, McpServerStdio};
use mcp_toolset::RemoteMcpToolSet;
use std::sync::Mutex;

/// A connector that records which servers it was asked to dial and finds no
/// tools on them.
#[derive(Default)]
struct RecordingConnector {
    dialed: Mutex<Vec<String>>,
}

impl McpToolConnector for RecordingConnector {
    async fn connect(&self, servers: Vec<McpServerHttp>) -> Option<RemoteMcpToolSet> {
        self.dialed
            .lock()
            .expect("not poisoned")
            .extend(servers.into_iter().map(|server| server.name));
        None
    }
}

fn http(name: &str) -> McpServer {
    McpServer::Http(
        McpServerHttp::new(name, format!("https://egress.test/mcp/{name}")).headers(vec![
            HttpHeader::new("Authorization", "Bearer session-token"),
        ]),
    )
}

#[tokio::test]
async fn every_http_server_is_listed_including_macros_own() {
    let connector = Arc::new(RecordingConnector::default());
    let catalog = McpToolCatalog::new(Arc::clone(&connector));

    let definitions = catalog
        .tool_definitions(vec![
            http("macro"),
            McpServer::Stdio(McpServerStdio::new("local", "some-binary")),
            http("linear"),
        ])
        .await;

    assert!(definitions.is_empty(), "no server yielded a tool");
    assert_eq!(
        connector.dialed.lock().expect("not poisoned").as_slice(),
        ["macro", "linear"],
        "HTTP servers are dialed, Macro's included; stdio entries are not"
    );
}
