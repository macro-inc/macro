use super::*;
use mcp_client::domain::models::McpServerRecord;
use pipedream_mcp::domain::models::{McpServer, PipedreamConnection};
use std::sync::Mutex;

const SLACK: ConnectorRef<'static> = ConnectorRef {
    pipedream_app_slugs: &["slack", "slack_v2"],
    native_server_url: "https://mcp.slack.com/mcp",
};

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap()
}

struct FakeStore(Vec<PipedreamConnection>);

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
        Ok(self.0.clone())
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
        assert!(
            self.0.is_empty(),
            "Pipedream connections exclude the native stack"
        );
        Ok(vec![])
    }
}

#[derive(Default)]
struct FakeConnection {
    attempts: Mutex<Vec<String>>,
}

impl McpConnection for FakeConnection {
    async fn connect(&self, record: &PipedreamConnection) -> anyhow::Result<McpServer> {
        self.attempts.lock().unwrap().push(record.app_slug.clone());
        // Exercise selection without a live MCP transport. Failed sessions
        // are skipped by PipedreamToolSet, but must not try another alias.
        anyhow::bail!("synthetic connection failure")
    }
}

fn selector(slugs: &[&str]) -> McpToolSelector<FakeStore, FakeStore, FakeConnection> {
    let records = slugs
        .iter()
        .map(|slug| PipedreamConnection {
            user_id: user(),
            app_slug: (*slug).to_string(),
            server_name: "Slack".to_string(),
            account_id: format!("apn_{slug}"),
            enabled: true,
        })
        .collect();
    let store = Arc::new(FakeStore(records));
    McpToolSelector::new(store.clone(), store, Arc::new(FakeConnection::default()))
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

mod combined_catalog {
    use super::*;
    use ai_toolset::{AsyncTool, ServiceContext, ToolAnnotated, ToolAnnotations};
    use schemars::JsonSchema;
    use serde::Deserialize;

    #[derive(JsonSchema, Deserialize)]
    #[schemars(title = "EditDeck", description = "Edit a slide deck.")]
    struct EditDeck {}

    impl ToolAnnotated for EditDeck {
        const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("Edit deck");
    }

    #[async_trait::async_trait]
    impl AsyncTool<()> for EditDeck {
        type Output = String;
        async fn call(&self, _: ServiceContext<()>, _: RequestContext) -> ToolResult<String> {
            Ok("edited".to_string())
        }
    }

    struct OneMcpTool;

    impl ToolSet<()> for OneMcpTool {
        fn dispatch_tool_call<'a>(
            &'a self,
            _: (),
            _: RequestContext,
            tool_name: &'a str,
            _: &'a serde_json::Value,
        ) -> ai_toolset::ToolCallFuture<'a> {
            Box::pin(async move { Err(ToolSetError::NotFound(tool_name.to_owned())) })
        }

        fn request_schemas(&self) -> Option<Vec<RequestSchema>> {
            None
        }

        fn searchable_catalog(&self) -> Vec<SearchableTool> {
            vec![SearchableTool {
                name: "mcp__linear__create_issue".to_string(),
                description: "Create a Linear issue.".to_string(),
                schema: schemars::Schema::default(),
            }]
        }
    }

    #[test]
    fn the_catalog_holds_deferred_static_tools_and_mcp_tools() {
        let static_tools = AsyncToolCollection::<()>::new()
            .add_tool::<EditDeck, ()>()
            .defer_all_except(&[]);
        let combined = CombinedToolSet::new(Arc::new(static_tools), OneMcpTool);

        let names: Vec<String> = combined
            .searchable_catalog()
            .into_iter()
            .map(|tool| tool.name)
            .collect();

        assert_eq!(
            names,
            vec![
                "EditDeck".to_string(),
                "mcp__linear__create_issue".to_string()
            ]
        );
    }
}
