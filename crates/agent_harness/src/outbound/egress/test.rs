use super::*;
use agent_session::domain::model::AgentMcpServer;
use connectors::fake::{FakeConnection, FakeConnectors};

fn slug(name: &str) -> McpServerSlug {
    McpServerSlug::parse(name).expect("a valid app slug")
}

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("owner@example.com").expect("a valid user id")
}

const WIKI: &str = "https://wiki.example.com/mcp";

fn provisioner(fake: &FakeConnectors) -> EgressProvisioner<connectors::Connectors> {
    EgressProvisioner::new(Arc::new(fake.build()), "https://egress.macro.com")
}

fn selected(slugs: &[&str]) -> AgentMcpServers {
    AgentMcpServers::Selected {
        servers: slugs
            .iter()
            .map(|slug| AgentMcpServer {
                app_slug: (*slug).to_owned(),
                server_name: (*slug).to_owned(),
            })
            .collect(),
    }
}

async fn advertised(
    fake: &FakeConnectors,
    selection: &AgentMcpServers,
) -> (Vec<String>, Vec<CustomMcpServerListing>) {
    let provisioned = provisioner(fake)
        .provision(AgentSessionId::new(), &owner(), selection)
        .await
        .expect("provisioned");
    let mut slugs: Vec<String> = provisioned
        .sandbox
        .mcp_servers
        .iter()
        .map(ToString::to_string)
        .collect();
    if matches!(selection, AgentMcpServers::OwnerConnections) {
        slugs.sort();
    }
    (slugs, provisioned.sandbox.custom_servers)
}

/// An agent given everything is advertised every app the owner can use;
/// a disabled app, or one needing authorization again, is absent.
#[tokio::test]
async fn an_agent_given_everything_is_advertised_the_owners_usable_apps() {
    let fake = FakeConnectors::new()
        .with_connection(&owner(), FakeConnection::app("linear"))
        .with_connection(&owner(), FakeConnection::app("google_sheets"))
        .with_connection(&owner(), FakeConnection::app("datadog").disabled())
        .with_connection(&owner(), FakeConnection::app("sentry").needs_reauth());

    let (slugs, custom) = advertised(&fake, &AgentMcpServers::OwnerConnections).await;

    assert_eq!(slugs, ["google_sheets", "linear"]);
    assert!(custom.is_empty());
}

/// `restore` rebuilds the same environment around a token that already
/// exists: nothing is minted, and the server list is read fresh.
#[tokio::test]
async fn restore_wraps_an_existing_token_in_a_fresh_listing() {
    let fake = FakeConnectors::new().with_connection(&owner(), FakeConnection::app("linear"));

    let restored = provisioner(&fake)
        .restore(
            &owner(),
            "already-minted-token".to_owned(),
            &AgentMcpServers::OwnerConnections,
        )
        .await
        .expect("restored");

    assert_eq!(restored.session_token, "already-minted-token");
    let slugs: Vec<String> = restored
        .mcp_servers
        .iter()
        .map(ToString::to_string)
        .collect();
    assert_eq!(slugs, ["linear"]);
}

/// A selected list is advertised whole, in the agent's order, whatever the
/// owner has connected (rule 7): an unconnected app is still dialable,
/// because the proxy answers it with how to connect, and a connected app
/// that was not selected is not offered at all. A slug that is not an app
/// slug is skipped rather than repaired.
#[tokio::test]
async fn a_selected_list_is_advertised_regardless_of_connections() {
    let fake = FakeConnectors::new()
        .with_connection(&owner(), FakeConnection::app("datadog"))
        .with_connection(&owner(), FakeConnection::app("linear").disabled());

    let (slugs, custom) = advertised(&fake, &selected(&["notion", "linear", "Not A Slug!"])).await;

    assert_eq!(slugs, ["notion", "linear"]);
    assert!(custom.is_empty());
}

/// An explicitly empty selection is the agent author's choice: nothing of the
/// owner's is offered in its place.
#[tokio::test]
async fn an_empty_selection_offers_nothing_of_the_owners() {
    let fake = FakeConnectors::new()
        .with_connection(&owner(), FakeConnection::app("datadog"))
        .with_connection(&owner(), FakeConnection::server(WIKI));

    let (slugs, custom) = advertised(&fake, &selected(&[])).await;

    assert!(slugs.is_empty());
    assert!(custom.is_empty());
}

/// The owner's usable custom servers ride along for an agent given
/// everything, keyed by the digest of their address rather than the address
/// itself, under the owner's name for them; one turned off is absent.
#[tokio::test]
async fn lists_the_owners_usable_custom_servers_by_key() {
    let fake = FakeConnectors::new()
        .with_connection(
            &owner(),
            FakeConnection::server(WIKI).named("Internal wiki"),
        )
        .with_connection(
            &owner(),
            FakeConnection::server("https://old.example.com/mcp")
                .named("Retired")
                .disabled(),
        );

    let provisioned = provisioner(&fake)
        .provision(
            AgentSessionId::new(),
            &owner(),
            &AgentMcpServers::OwnerConnections,
        )
        .await
        .expect("provisioned");

    assert_eq!(
        provisioned.sandbox.custom_servers,
        [listing(WIKI, "Internal wiki")]
    );
    let printed = format!("{:?}", provisioned.sandbox);
    assert!(!printed.contains("wiki.example.com"), "{printed}");
}

/// A selected app list is an author's choice of apps; the owner's servers
/// added by URL are not added behind it.
#[tokio::test]
async fn a_selected_list_carries_none_of_the_owners_custom_servers() {
    let fake = FakeConnectors::new().with_connection(&owner(), FakeConnection::server(WIKI));

    let (_, custom) = advertised(&fake, &selected(&["notion"])).await;

    assert!(custom.is_empty());
}

/// An overlaid app is one app whichever server holds it: connected through
/// the vendor's own server, it is advertised under its app slug, as every
/// app is, and the proxy reaches the vendor's server for it.
#[tokio::test]
async fn an_overlaid_app_is_advertised_as_the_app() {
    let fake = FakeConnectors::new()
        .with_overlay("sentry", "https://mcp.sentry.dev/mcp")
        .with_connection(&owner(), FakeConnection::app("sentry").named("Sentry"));

    for selection in [AgentMcpServers::OwnerConnections, selected(&["sentry"])] {
        let (slugs, custom) = advertised(&fake, &selection).await;

        assert_eq!(slugs, ["sentry"]);
        assert!(custom.is_empty());
    }
}

/// `slack` and `slack_v2` are one app, advertised once.
#[tokio::test]
async fn an_aliased_app_is_advertised_once() {
    let fake = FakeConnectors::new().with_connection(&owner(), FakeConnection::app("slack_v2"));

    let (slugs, _) = advertised(&fake, &AgentMcpServers::OwnerConnections).await;

    assert_eq!(slugs, ["slack"]);
}

fn egress(slugs: &[&str]) -> SandboxEgress {
    SandboxEgress {
        base_url: "https://egress.macro.com".to_owned(),
        session_token: "session-token".to_owned(),
        mcp_servers: slugs.iter().map(|name| slug(name)).collect(),
        custom_servers: Vec::new(),
    }
}

fn listing(url: &str, name: &str) -> CustomMcpServerListing {
    CustomMcpServerListing {
        key: CustomMcpServerKey::for_url(url),
        name: name.to_owned(),
    }
}

/// Custom servers are advertised after the apps, on the proxy's custom
/// route, under a name reduced to what tool namespaces tolerate - and a
/// name that would repeat an earlier entry, Macro's own included, is made
/// unique with a piece of the server's key rather than dropped or allowed
/// to shadow.
#[test]
fn custom_servers_are_advertised_under_unique_sanitized_names() {
    let mut egress = egress(&["linear"]);
    egress.custom_servers = vec![
        listing("https://wiki.example.com/mcp", "Internal wiki"),
        listing("https://a.example.com/mcp", "macro"),
        listing("https://b.example.com/mcp", "  "),
        listing("https://c.example.com/mcp", "linear"),
        listing("https://d.example.com/mcp", "Internal wiki"),
    ];
    let key = |url: &str| CustomMcpServerKey::for_url(url);

    let entries: Vec<(String, String)> = egress.server_entries().collect();

    let expected_tail = [
        (
            "Internal_wiki".to_owned(),
            key("https://wiki.example.com/mcp"),
        ),
        (
            format!("macro_{}", &key("https://a.example.com/mcp").as_str()[..8]),
            key("https://a.example.com/mcp"),
        ),
        ("custom".to_owned(), key("https://b.example.com/mcp")),
        (
            format!("linear_{}", &key("https://c.example.com/mcp").as_str()[..8]),
            key("https://c.example.com/mcp"),
        ),
        (
            format!(
                "Internal_wiki_{}",
                &key("https://d.example.com/mcp").as_str()[..8]
            ),
            key("https://d.example.com/mcp"),
        ),
    ]
    .map(|(name, key)| (name, format!("https://egress.macro.com/mcp-custom/{key}")));
    assert_eq!(entries[4..], expected_tail);

    let mut names: Vec<&String> = entries.iter().map(|(name, _)| name).collect();
    let total = names.len();
    names.sort();
    names.dedup();
    assert_eq!(names.len(), total, "every advertised name is unique");
    assert!(
        entries.iter().all(|(name, _)| !name.is_empty()),
        "every advertised name is non-empty"
    );
}

/// Every server points at the proxy and carries the session token rather than
/// any upstream credential; Macro's own server leads the list on its own
/// route.
#[test]
fn points_every_acp_server_at_the_proxy() {
    let servers = egress(&["datadog", "linear"]).acp_servers();

    type RenderedServer = (String, String, Vec<(String, String)>);
    let rendered: Vec<RenderedServer> = servers
        .into_iter()
        .map(|server| match server {
            agent_client_protocol::schema::v1::McpServer::Http(http) => (
                http.name,
                http.url,
                http.headers
                    .into_iter()
                    .map(|header| (header.name, header.value))
                    .collect(),
            ),
            other => panic!("every egress server is http transport, got {other:?}"),
        })
        .collect();

    let authorization = vec![(
        "Authorization".to_owned(),
        "Bearer session-token".to_owned(),
    )];
    assert_eq!(
        rendered,
        [
            (
                "macro".to_owned(),
                "https://egress.macro.com/mcp-macro".to_owned(),
                authorization.clone(),
            ),
            (
                "macro_internal".to_owned(),
                "https://egress.macro.com/mcp/internal".to_owned(),
                authorization.clone(),
            ),
            (
                "macro-preview".to_owned(),
                "https://egress.macro.com/mcp-preview".to_owned(),
                authorization.clone(),
            ),
            (
                "datadog".to_owned(),
                "https://egress.macro.com/mcp/datadog".to_owned(),
                authorization.clone(),
            ),
            (
                "linear".to_owned(),
                "https://egress.macro.com/mcp/linear".to_owned(),
                authorization,
            ),
        ]
    );
}

/// An owner with no connected apps still gets Macro's own server.
#[test]
fn an_owner_with_no_connected_apps_still_gets_the_macro_server() {
    let entries: Vec<(String, String)> = egress(&[]).server_entries().collect();

    assert_eq!(
        entries,
        [
            (
                "macro".to_owned(),
                "https://egress.macro.com/mcp-macro".to_owned()
            ),
            (
                "macro_internal".to_owned(),
                "https://egress.macro.com/mcp/internal".to_owned()
            ),
            (
                "macro-preview".to_owned(),
                "https://egress.macro.com/mcp-preview".to_owned()
            )
        ]
    );
}

/// The environment carries the token, so nothing about this value may reach a
/// log.
#[test]
fn the_egress_environment_does_not_print_its_secrets() {
    let egress = egress(&["linear"]);

    let printed = format!("{egress:?}");
    assert!(!printed.contains("session-token"), "{printed}");
    assert!(printed.contains("https://egress.macro.com"), "{printed}");

    let environment: Vec<String> = egress
        .environment()
        .into_iter()
        .map(|(name, _value)| name)
        .collect();
    assert_eq!(
        environment,
        [
            "MACRO_EGRESS_URL".to_owned(),
            "MACRO_SESSION_TOKEN".to_owned()
        ]
    );
}

#[test]
fn external_runtime_uses_host_reachable_urls_with_the_existing_session_credential() {
    use agent_client_protocol::schema::v1::McpServer;
    let provisioner = EgressProvisioner::new(
        Arc::new(FakeConnectors::new().build()),
        "http://agent-harness-service:8102",
    )
    .with_external_base_url(Some("http://localhost:28102/".into()));
    let mut sandbox = egress(&["datadog"]);
    let custom = listing("https://wiki.example.com/mcp", "Wiki");
    let custom_path = format!("/mcp-custom/{}", custom.key);
    sandbox.custom_servers.push(custom);
    let servers = provisioner.external_mcp_servers(&sandbox);
    assert_eq!(servers.len(), 5);
    for (server, (name, path)) in servers.iter().zip([
        ("macro", "/mcp-macro"),
        ("macro_internal", "/mcp/internal"),
        ("macro-preview", "/mcp-preview"),
        ("datadog", "/mcp/datadog"),
        ("Wiki", custom_path.as_str()),
    ]) {
        let McpServer::Http(server) = server else {
            panic!("expected HTTP MCP");
        };
        assert_eq!(server.url, format!("http://localhost:28102{path}"));
        assert_eq!(server.name, name);
        assert_eq!(server.headers[0].value, sandbox.authorization_header());
    }
    assert_eq!(sandbox.base_url, "https://egress.macro.com");
}
