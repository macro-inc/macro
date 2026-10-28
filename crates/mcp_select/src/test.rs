use super::*;
use mcp_client::domain::models::McpServerRecord;
use pipedream_mcp::domain::models::{McpServer, PipedreamConnection};
use std::sync::Mutex;

mod combined_tools;

const SLACK: ConnectorRef<'static> = ConnectorRef {
    pipedream_app_slugs: &["slack", "slack_v2"],
    native_server_url: "https://mcp.slack.com/mcp",
};

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap()
}

#[derive(Default)]
struct FakeStore {
    connections: Vec<PipedreamConnection>,
    native_records: Vec<McpServerRecord>,
}

impl ConnectionStore for FakeStore {
    type Err = ();

    async fn save(&self, _: &PipedreamConnection) -> Result<(), Self::Err> {
        panic!("selection must not save connections")
    }

    async fn load(
        &self,
        _: &MacroUserIdStr<'static>,
        _: &str,
    ) -> Result<Option<PipedreamConnection>, Self::Err> {
        panic!("selection must list connections")
    }

    async fn delete(&self, _: &MacroUserIdStr<'static>, _: &str) -> Result<(), Self::Err> {
        panic!("selection must not delete connections")
    }

    async fn list(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> Result<Vec<PipedreamConnection>, Self::Err> {
        assert_eq!(user, &self::user());
        Ok(self.connections.clone())
    }
}

impl McpServerStore for FakeStore {
    type Err = ();

    async fn save(&self, _: &McpServerRecord) -> Result<(), Self::Err> {
        panic!("selection must not save native servers")
    }

    async fn load(
        &self,
        _: &MacroUserIdStr<'static>,
        _: &str,
    ) -> Result<Option<McpServerRecord>, Self::Err> {
        panic!("selection must list native servers")
    }

    async fn delete(&self, _: &MacroUserIdStr<'static>, _: &str) -> Result<(), Self::Err> {
        panic!("selection must not delete native servers")
    }

    async fn list(&self, _: &MacroUserIdStr<'static>) -> Result<Vec<McpServerRecord>, Self::Err> {
        Ok(self.native_records.clone())
    }
}

#[derive(Default)]
struct FakeConnection {
    attempts: Mutex<Vec<String>>,
}

impl McpConnection for FakeConnection {
    fn is_configured(&self) -> bool {
        true
    }

    async fn connect(&self, record: &PipedreamConnection) -> anyhow::Result<McpServer> {
        self.attempts.lock().unwrap().push(record.app_slug.clone());
        // Exercise selection without a live MCP transport. Failed sessions
        // are skipped by PipedreamToolSet, but must not try another alias.
        anyhow::bail!("synthetic connection failure")
    }
}

fn connections(slugs: &[&str]) -> Vec<PipedreamConnection> {
    slugs
        .iter()
        .map(|slug| PipedreamConnection {
            user_id: user(),
            app_slug: (*slug).to_string(),
            server_name: "Slack".to_string(),
            account_id: format!("apn_{slug}"),
            enabled: true,
        })
        .collect()
}

fn selector(slugs: &[&str]) -> McpToolSelector<FakeStore, FakeStore, FakeConnection> {
    let store = Arc::new(FakeStore {
        connections: connections(slugs),
        ..Default::default()
    });
    McpToolSelector::new(store.clone(), store, Arc::new(FakeConnection::default()))
}

#[tokio::test]
async fn unconfigured_pipedream_preserves_native_connector_selection() {
    let connectors = [
        SLACK,
        ConnectorRef {
            pipedream_app_slugs: &["notion"],
            native_server_url: "https://mcp.notion.com/mcp",
        },
        ConnectorRef {
            pipedream_app_slugs: &["linear"],
            native_server_url: "https://mcp.linear.app/mcp",
        },
    ];
    let store = Arc::new(FakeStore {
        connections: connections(&["slack", "notion", "linear"]),
        native_records: connectors
            .iter()
            .map(|connector| McpServerRecord {
                user_id: user(),
                url: connector.native_server_url.to_string(),
                server_name: connector.pipedream_app_slugs[0].to_string(),
                credentials: None,
                // Only exercise routing; no live server should be contacted.
                enabled: false,
            })
            .collect(),
    });
    let selector =
        McpToolSelector::new(store.clone(), store, Arc::new(None::<Arc<FakeConnection>>));

    assert!(matches!(
        selector.user_toolset(&user()).await,
        UserMcpTools::Pipedream(_)
    ));
    for connector in connectors {
        assert!(matches!(
            selector
                .connector_toolset(&user(), connector)
                .await
                .unwrap(),
            None
        ));
        assert!(
            !selector
                .connector_connected(&user(), connector)
                .await
                .unwrap(),
            "stored Pipedream accounts must not report a usable connection"
        );
    }
}

#[tokio::test]
async fn configured_optional_pipedream_remains_available() {
    let configured = selector(&["slack"]);
    let selector = McpToolSelector::new(
        configured.native_store,
        configured.pipedream_store,
        Arc::new(Some(configured.pipedream_connection)),
    );

    assert!(matches!(
        selector.connector_toolset(&user(), SLACK).await.unwrap(),
        Some(UserMcpTools::Pipedream(_))
    ));
    assert!(selector.connector_connected(&user(), SLACK).await.unwrap());
}

#[test]
fn matches_only_declared_slugs() {
    assert!(SLACK.matches_pipedream_slug("slack"));
    assert!(SLACK.matches_pipedream_slug("slack_v2"));
    for slug in ["slack_bot", "Slack", "slack_v", "linear", ""] {
        assert!(!SLACK.matches_pipedream_slug(slug), "{slug}");
    }
    assert!(
        !ConnectorRef {
            pipedream_app_slugs: &[],
            ..SLACK
        }
        .matches_pipedream_slug("slack")
    );
}

#[tokio::test]
async fn either_slack_alias_is_connected_and_selected() {
    for slug in SLACK.pipedream_app_slugs {
        let selector = selector(&["linear", slug]);
        assert!(selector.connector_connected(&user(), SLACK).await.unwrap());
        let tools = selector.connector_toolset(&user(), SLACK).await.unwrap();
        assert!(matches!(tools, Some(UserMcpTools::Pipedream(_))));
        assert_eq!(
            *selector.pipedream_connection.attempts.lock().unwrap(),
            [*slug]
        );
    }
}

#[tokio::test]
async fn selects_only_first_preferred_alias_regardless_of_store_order() {
    for slugs in [["slack", "slack_v2"], ["slack_v2", "slack"]] {
        for preference in [["slack", "slack_v2"], ["slack_v2", "slack"]] {
            let selector = selector(&slugs);
            let connector = ConnectorRef {
                pipedream_app_slugs: &preference,
                ..SLACK
            };
            assert!(
                selector
                    .connector_connected(&user(), connector)
                    .await
                    .unwrap()
            );
            let tools = selector
                .connector_toolset(&user(), connector)
                .await
                .unwrap();
            assert!(matches!(tools, Some(UserMcpTools::Pipedream(_))));
            assert_eq!(
                *selector.pipedream_connection.attempts.lock().unwrap(),
                [preference[0]],
            );
        }
    }
}

#[tokio::test]
async fn unrelated_or_missing_connections_do_not_match() {
    for slugs in [vec!["linear", "slack_bot"], vec![]] {
        let selector = selector(&slugs);
        assert!(!selector.connector_connected(&user(), SLACK).await.unwrap());
        assert!(
            selector
                .connector_toolset(&user(), SLACK)
                .await
                .unwrap()
                .is_none()
        );
        assert!(
            selector
                .pipedream_connection
                .attempts
                .lock()
                .unwrap()
                .is_empty()
        );
    }
}

#[tokio::test]
async fn empty_alias_list_does_not_match() {
    let selector = selector(&["slack", "slack_v2"]);
    let connector = ConnectorRef {
        pipedream_app_slugs: &[],
        ..SLACK
    };
    assert!(
        !selector
            .connector_connected(&user(), connector)
            .await
            .unwrap()
    );
    assert!(
        selector
            .connector_toolset(&user(), connector)
            .await
            .unwrap()
            .is_none()
    );
    assert!(
        selector
            .pipedream_connection
            .attempts
            .lock()
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn native_status_survives_unrelated_pipedream_connection() {
    let mut selector = selector(&["stripe"]);
    selector.native_store = Arc::new(FakeStore {
        connections: vec![],
        native_records: vec![McpServerRecord {
            user_id: user(),
            url: SLACK.native_server_url.into(),
            server_name: "Renamed".into(),
            enabled: true,
            credentials: Some(
                serde_json::from_value(
                    serde_json::json!({"client_id":"test", "token_response":null}),
                )
                .unwrap(),
            ),
        }],
    });
    assert!(selector.connector_connected(&user(), SLACK).await.unwrap());
}

#[tokio::test]
async fn disabled_pipedream_is_not_connected_or_dispatched() {
    let mut selector = selector(&["slack"]);
    let mut records = selector.pipedream_store.connections.clone();
    records[0].enabled = false;
    selector.pipedream_store = Arc::new(FakeStore {
        connections: records,
        native_records: vec![],
    });
    assert!(!selector.connector_connected(&user(), SLACK).await.unwrap());
    assert!(
        selector
            .connector_toolset(&user(), SLACK)
            .await
            .unwrap()
            .is_none()
    );
}

// Real MCP clients against a local JSON-RPC server exercise discovery and
// dispatch on both stacks without requiring third-party credentials.
async fn mock_mcp(axum::Json(request): axum::Json<serde_json::Value>) -> axum::response::Response {
    use axum::response::IntoResponse;
    let Some(id) = request.get("id") else {
        return axum::http::StatusCode::ACCEPTED.into_response();
    };
    let result = match request["method"].as_str().unwrap_or_default() {
        "initialize" => serde_json::json!({
            "protocolVersion": "2025-03-26", "capabilities": {"tools": {}},
            "serverInfo": {"name": "test", "version": "1"}
        }),
        "tools/list" => serde_json::json!({"tools":[{
            "name":"ping", "description":"Test tool", "inputSchema":{"type":"object","properties":{}}
        }]}),
        "tools/call" => {
            serde_json::json!({"content":[{"type":"text","text":"pong"}], "isError":false})
        }
        _ => serde_json::json!({}),
    };
    axum::Json(serde_json::json!({"jsonrpc":"2.0", "id":id, "result":result})).into_response()
}

struct HttpConnection(String);
impl McpConnection for HttpConnection {
    fn is_configured(&self) -> bool {
        true
    }

    async fn connect(&self, _: &PipedreamConnection) -> anyhow::Result<McpServer> {
        use rmcp::ServiceExt;
        Ok(mcp_client::domain::models::client_info()
            .serve(rmcp::transport::StreamableHttpClientTransport::from_uri(
                self.0.clone(),
            ))
            .await?)
    }
}

#[tokio::test]
async fn mixed_stack_discovers_and_dispatches_both_and_deduplicates_names() {
    tokio::time::timeout(std::time::Duration::from_secs(15), async {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/mcp", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            axum::serve(
                listener,
                axum::Router::new().route("/mcp", axum::routing::post(mock_mcp)),
            )
            .await
            .unwrap();
        });
        for hosted_name in ["Hosted", "Native"] {
            let store = Arc::new(FakeStore {
                connections: vec![PipedreamConnection {
                    user_id: user(),
                    app_slug: "stripe".into(),
                    server_name: hosted_name.into(),
                    account_id: "test".into(),
                    enabled: true,
                }],
                native_records: vec![McpServerRecord {
                    user_id: user(),
                    url: url.clone(),
                    server_name: "Native".into(),
                    credentials: None,
                    enabled: true,
                }],
            });
            let selector =
                McpToolSelector::new(store.clone(), store, Arc::new(HttpConnection(url.clone())));
            let tools = selector.user_toolset(&user()).await;
            assert!(matches!(tools, UserMcpTools::Mixed { .. }));
            let catalog = tools.catalog();
            assert_eq!(catalog.len(), if hosted_name == "Hosted" { 2 } else { 1 });
            assert_eq!(
                ToolSet::<()>::request_schemas(&tools).unwrap().len(),
                catalog.len()
            );
            for tool in catalog {
                let result = tools
                    .dispatch_tool_call(
                        (),
                        RequestContext::new(user()),
                        &tool.name,
                        &serde_json::json!({}),
                    )
                    .await
                    .unwrap()
                    .unwrap();
                assert!(result.to_string().contains("pong"));
            }
        }
        server.abort();
    })
    .await
    .expect("local MCP discovery must not hang");
}
