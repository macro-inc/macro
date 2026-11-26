use super::*;
use crate::domain::discovery::Catalog;
use crate::domain::service::{Connectors, McpConnectionsService};
use crate::fake::{FakeConnection, FakeConnectors};
use crate::inbound::test_support::{services, user};
use ai_toolset::{RequestContext, ServiceContext};

type Context = ConnectorToolContext<Connectors, Catalog<Connectors>>;

fn context(fake: &FakeConnectors) -> (Context, Connectors) {
    let (connectors, catalog) = services(fake);
    (
        ConnectorToolContext::wired(connectors.clone(), catalog),
        connectors,
    )
}

async fn discover(
    context: &Context,
    owner: &str,
    request: DiscoveryRequest,
) -> ToolResult<DiscoverConnectorsResponse> {
    DiscoverConnectors { request }
        .call(
            ServiceContext(context.clone()),
            RequestContext::new(user(owner)),
        )
        .await
}

fn inspect(slug: &str) -> DiscoveryRequest {
    DiscoveryRequest::Inspect {
        app_slug: slug.to_owned(),
    }
}

fn connected(response: &DiscoverConnectorsResponse) -> bool {
    match &response.result {
        DiscoveryResult::Inspect { connected, .. } => *connected,
        DiscoveryResult::Search { .. } => panic!("expected an inspection"),
    }
}

#[tokio::test]
async fn the_tool_schemas_are_unchanged() {
    let discover = serde_json::to_value(schemars::schema_for!(DiscoverConnectors)).unwrap();
    let connect = serde_json::to_value(schemars::schema_for!(ConnectMcpServer)).unwrap();

    assert_eq!(discover["title"], "DiscoverConnectors");
    assert_eq!(discover["required"], serde_json::json!(["request"]));
    let request = serde_json::to_string(&discover).unwrap();
    assert!(request.contains("\"app_slug\"") && request.contains("\"query\""));
    assert_eq!(connect["title"], "ConnectMcpServer");
    assert_eq!(
        connect["required"],
        serde_json::json!(["url", "serverName"])
    );
}

#[tokio::test]
async fn search_lists_catalog_apps_by_slug() {
    let (context, _) = context(&FakeConnectors::new());

    let response = discover(
        &context,
        "owner",
        DiscoveryRequest::Search {
            query: "lin".to_owned(),
        },
    )
    .await
    .unwrap();

    let DiscoveryResult::Search { apps, more_results } = &response.result else {
        panic!("expected a search");
    };
    assert_eq!(apps[0].app_slug, "linear");
    assert!(*more_results);
    assert_eq!(response.connect_markup, None);
}

#[tokio::test]
async fn an_empty_search_is_refused() {
    let (context, _) = context(&FakeConnectors::new());

    let error = discover(
        &context,
        "owner",
        DiscoveryRequest::Search {
            query: "  ".to_owned(),
        },
    )
    .await
    .unwrap_err();

    assert_eq!(error.description, "Search for an app name, such as Linear");
}

#[tokio::test]
async fn inspecting_a_connected_app_offers_no_connect_markup() {
    let owner = user("owner");
    let fake = FakeConnectors::new()
        .with_catalog_app("linear")
        .with_connection(&owner, FakeConnection::app("linear"));
    let (context, _) = context(&fake);

    let response = discover(&context, "owner", inspect("linear"))
        .await
        .unwrap();

    assert!(connected(&response));
    assert_eq!(response.connect_markup, None);
}

#[tokio::test]
async fn inspecting_an_unconnected_app_offers_connect_markup() {
    let (context, _) = context(&FakeConnectors::new().with_catalog_app("notion"));

    let response = discover(&context, "owner", inspect("notion"))
        .await
        .unwrap();

    assert!(!connected(&response));
    assert_eq!(
        response.connect_markup.as_deref(),
        Some(r#"<m-connect-app>{"appSlug":"notion","name":"Notion"}</m-connect-app>"#)
    );
}

#[tokio::test]
async fn connected_follows_the_rules_not_the_rows() {
    let owner = user("owner");
    let fake = FakeConnectors::new()
        .with_catalog_app("linear")
        .with_catalog_app("notion")
        .with_connection(&owner, FakeConnection::app("linear").disabled())
        .with_connection(&user("stranger"), FakeConnection::app("notion"));
    let (context, connectors) = context(&fake);

    let disabled = discover(&context, "owner", inspect("linear"))
        .await
        .unwrap();
    let someone_elses = discover(&context, "owner", inspect("notion"))
        .await
        .unwrap();

    // The same answer chat gets.
    let status = connectors.connections(&owner).await.unwrap().status(
        &crate::domain::models::ConnectorKey::App(ConnectorId::parse("linear").unwrap()),
    );
    assert_eq!(status, Status::Disabled);
    assert!(!connected(&disabled));
    assert!(disabled.connect_markup.is_some());
    assert!(!connected(&someone_elses));
}

#[tokio::test]
async fn inspecting_an_unknown_app_is_refused() {
    let (context, _) = context(&FakeConnectors::new());

    for slug in ["figma", "Not A Slug"] {
        let error = discover(&context, "owner", inspect(slug))
            .await
            .unwrap_err();
        assert_eq!(
            error.description,
            "No connectable app has that slug; search the catalog first"
        );
    }
}

#[tokio::test]
async fn unwired_tools_fail_clearly() {
    let context: Context = ConnectorToolContext::unwired();

    let discovery = discover(&context, "owner", inspect("linear"))
        .await
        .unwrap_err();
    let connect = ConnectMcpServer {
        url: "https://mcp.example.com/mcp".to_owned(),
        server_name: "Example".to_owned(),
    }
    .call(ServiceContext(context), RequestContext::new(user("owner")))
    .await
    .unwrap_err();

    assert_eq!(
        discovery.description,
        "Connector discovery is not configured on this deployment"
    );
    assert_eq!(
        connect.description,
        "Connecting MCP servers is not available here."
    );
}

async fn connect_server(context: &Context, url: &str) -> ToolResult<ConnectMcpServerResponse> {
    ConnectMcpServer {
        url: url.to_owned(),
        server_name: "Example".to_owned(),
    }
    .call(
        ServiceContext(context.clone()),
        RequestContext::new(user("owner")),
    )
    .await
}

#[tokio::test]
async fn connecting_a_server_adds_it_for_the_caller() {
    let (context, connectors) = context(&FakeConnectors::new());

    let response = connect_server(&context, "https://mcp.example.com/mcp/")
        .await
        .unwrap();

    assert_eq!(response.url, "https://mcp.example.com/mcp");
    assert_eq!(response.server_name, "Example");
    assert!(response.enabled);
    assert!(response.summary.contains("Settings → Connections"));
    let listed = connectors.list(&user("owner")).await.unwrap();
    assert_eq!(listed.len(), 1);
    assert!(connectors.list(&user("stranger")).await.unwrap().is_empty());
}

#[tokio::test]
async fn connecting_a_server_the_user_turned_off_says_so() {
    let owner = user("owner");
    let fake = FakeConnectors::new().with_connection(
        &owner,
        FakeConnection::server("https://mcp.example.com/mcp")
            .named("Example")
            .disabled(),
    );
    let (context, _) = context(&fake);

    let response = connect_server(&context, "https://mcp.example.com/mcp")
        .await
        .unwrap();

    assert_eq!(response.status, ConnectorStatus::Disabled);
    assert!(!response.enabled);
    assert!(response.summary.contains("turned off"));
}

#[tokio::test]
async fn an_agent_may_add_only_public_https_servers() {
    let (context, connectors) = context(&FakeConnectors::new());

    let plain = connect_server(&context, "http://mcp.example.com/mcp").await;
    let not_a_url = connect_server(&context, "mcp.example.com").await;

    assert!(plain.is_err());
    assert!(not_a_url.is_err());
    assert!(connectors.list(&user("owner")).await.unwrap().is_empty());
}

/// Hosts that are not an agent loop tell the caller's mistakes from their
/// own outages: a server an agent may not add, an empty search and an
/// unknown app are refusals; a host without the services is unavailable.
#[tokio::test]
async fn refusals_and_outages_are_told_apart() {
    let (context, _) = context(&FakeConnectors::new());
    let owner = user("owner");

    let plain = ConnectMcpServer {
        url: "http://mcp.example.com/mcp".to_owned(),
        server_name: "Example".to_owned(),
    }
    .run(&context, &owner)
    .await;
    let empty = DiscoverConnectors {
        request: DiscoveryRequest::Search {
            query: " ".to_owned(),
        },
    }
    .run(&context, &owner)
    .await;
    let unknown = DiscoverConnectors {
        request: inspect("Not A Slug"),
    }
    .run(&context, &owner)
    .await;

    assert!(matches!(plain, Err(ConnectorToolError::Refused(_))));
    assert!(matches!(empty, Err(ConnectorToolError::Refused(_))));
    assert!(matches!(unknown, Err(ConnectorToolError::Refused(_))));

    let unwired: Context = ConnectorToolContext::unwired();
    let add = ConnectMcpServer {
        url: "https://mcp.example.com/mcp".to_owned(),
        server_name: "Example".to_owned(),
    }
    .run(&unwired, &owner)
    .await;
    let search = DiscoverConnectors {
        request: inspect("linear"),
    }
    .run(&unwired, &owner)
    .await;

    assert!(matches!(add, Err(ConnectorToolError::Unavailable { .. })));
    assert!(matches!(
        search,
        Err(ConnectorToolError::Unavailable { .. })
    ));
}
