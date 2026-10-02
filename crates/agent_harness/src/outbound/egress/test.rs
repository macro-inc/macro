use super::*;
use agent_session::domain::model::AgentMcpServer;
use mcp_client::domain::models::McpServerRecord;

fn slug(name: &str) -> McpServerSlug {
    McpServerSlug::parse(name).expect("a valid app slug")
}

struct FixedConnections(Vec<pipedream_mcp::domain::models::PipedreamConnection>);

impl ConnectionStore for FixedConnections {
    type Err = std::convert::Infallible;

    async fn save(
        &self,
        _record: &pipedream_mcp::domain::models::PipedreamConnection,
    ) -> Result<(), Self::Err> {
        unreachable!("provisioning never writes")
    }

    async fn load(
        &self,
        _user_id: &MacroUserIdStr<'static>,
        _app_slug: &str,
    ) -> Result<Option<pipedream_mcp::domain::models::PipedreamConnection>, Self::Err> {
        unreachable!("provisioning lists, never loads one")
    }

    async fn delete(
        &self,
        _user_id: &MacroUserIdStr<'static>,
        _app_slug: &str,
    ) -> Result<(), Self::Err> {
        unreachable!("provisioning never deletes")
    }

    async fn list(
        &self,
        _user_id: &MacroUserIdStr<'static>,
    ) -> Result<Vec<pipedream_mcp::domain::models::PipedreamConnection>, Self::Err> {
        Ok(self.0.clone())
    }
}

struct FixedServers(Vec<McpServerRecord>);

impl McpServerStore for FixedServers {
    type Err = std::convert::Infallible;

    async fn save(&self, _record: &McpServerRecord) -> Result<(), Self::Err> {
        unreachable!("provisioning never writes")
    }

    async fn load(
        &self,
        _user_id: &MacroUserIdStr<'static>,
        _server_url: &str,
    ) -> Result<Option<McpServerRecord>, Self::Err> {
        unreachable!("provisioning lists, never loads one")
    }

    async fn delete(
        &self,
        _user_id: &MacroUserIdStr<'static>,
        _server_url: &str,
    ) -> Result<(), Self::Err> {
        unreachable!("provisioning never deletes")
    }

    async fn list(
        &self,
        _user_id: &MacroUserIdStr<'static>,
    ) -> Result<Vec<McpServerRecord>, Self::Err> {
        Ok(self.0.clone())
    }
}

fn custom_server(url: &str, name: &str, enabled: bool) -> McpServerRecord {
    McpServerRecord {
        user_id: MacroUserIdStr::try_from_email("owner@example.com").expect("a valid user id"),
        url: url.to_owned(),
        server_name: name.to_owned(),
        credentials: None,
        enabled,
    }
}

fn connection(app_slug: &str, enabled: bool) -> pipedream_mcp::domain::models::PipedreamConnection {
    pipedream_mcp::domain::models::PipedreamConnection {
        user_id: MacroUserIdStr::try_from_email("owner@example.com").expect("a valid user id"),
        app_slug: app_slug.to_owned(),
        server_name: app_slug.to_owned(),
        account_id: format!("apn_{app_slug}"),
        enabled,
    }
}

/// Provisioning lists the owner's enabled app slugs verbatim - nothing is
/// derived, disabled apps are absent, and an app slug the strict parse
/// refuses is skipped rather than repaired into something dialable.
#[tokio::test]
async fn lists_enabled_app_slugs_verbatim() {
    let provisioner = EgressProvisioner::new(
        Arc::new(FixedConnections(vec![
            connection("linear", true),
            connection("google_sheets", true),
            connection("datadog", false),
            connection("Not A Slug!", true),
        ])),
        Arc::new(FixedServers(vec![])),
        "https://egress.macro.com",
    );

    let provisioned = provisioner
        .provision(
            AgentSessionId::new(),
            &MacroUserIdStr::try_from_email("owner@example.com").expect("a valid user id"),
            &AgentMcpServers::OwnerConnections,
        )
        .await
        .expect("provisioned");

    let slugs: Vec<String> = provisioned
        .sandbox
        .mcp_servers
        .iter()
        .map(ToString::to_string)
        .collect();
    assert_eq!(slugs, ["linear", "google_sheets"]);
}

/// `restore` rebuilds the same environment around a token that already
/// exists: nothing is minted, and the server list is read fresh.
#[tokio::test]
async fn restore_wraps_an_existing_token_in_a_fresh_listing() {
    let provisioner = EgressProvisioner::new(
        Arc::new(FixedConnections(vec![connection("linear", true)])),
        Arc::new(FixedServers(vec![])),
        "https://egress.macro.com",
    );

    let restored = provisioner
        .restore(
            &MacroUserIdStr::try_from_email("owner@example.com").expect("a valid user id"),
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

/// A selected list is advertised whole, in the agent's order, whatever the
/// owner has connected: an unconnected app is still dialable, because the
/// proxy answers it with a "not connected" tool result rather than refusing
/// it, and a connected-but-unselected app is not offered at all.
#[tokio::test]
async fn a_selected_list_is_advertised_regardless_of_connections() {
    let provisioner = EgressProvisioner::new(
        Arc::new(FixedConnections(vec![
            connection("datadog", true),
            connection("linear", false),
        ])),
        Arc::new(FixedServers(vec![])),
        "https://egress.macro.com",
    );

    let provisioned = provisioner
        .provision(
            AgentSessionId::new(),
            &MacroUserIdStr::try_from_email("owner@example.com").expect("a valid user id"),
            &selected(&["notion", "linear", "Not A Slug!"]),
        )
        .await
        .expect("provisioned");

    let slugs: Vec<String> = provisioned
        .sandbox
        .mcp_servers
        .iter()
        .map(ToString::to_string)
        .collect();
    assert_eq!(slugs, ["notion", "linear"]);

    let restored = provisioner
        .restore(
            &MacroUserIdStr::try_from_email("owner@example.com").expect("a valid user id"),
            "already-minted-token".to_owned(),
            &selected(&["notion"]),
        )
        .await
        .expect("restored");
    let slugs: Vec<String> = restored
        .mcp_servers
        .iter()
        .map(ToString::to_string)
        .collect();
    assert_eq!(slugs, ["notion"]);
}

/// An explicitly empty selection is the agent author's choice: nothing of the
/// owner's is offered in its place.
#[tokio::test]
async fn an_empty_selection_offers_nothing_of_the_owners() {
    let provisioner = EgressProvisioner::new(
        Arc::new(FixedConnections(vec![connection("datadog", true)])),
        Arc::new(FixedServers(vec![])),
        "https://egress.macro.com",
    );

    let provisioned = provisioner
        .provision(
            AgentSessionId::new(),
            &MacroUserIdStr::try_from_email("owner@example.com").expect("a valid user id"),
            &selected(&[]),
        )
        .await
        .expect("provisioned");
    assert!(provisioned.sandbox.mcp_servers.is_empty());
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

/// The owner's enabled custom servers ride along with their connections,
/// keyed by the digest of their URL rather than the URL itself, and a server
/// the owner turned off is absent. The lapsed-connection case is not
/// distinguished here: the record's credentials never reach the listing.
#[tokio::test]
async fn lists_the_owners_enabled_custom_servers_by_key() {
    let provisioner = EgressProvisioner::new(
        Arc::new(FixedConnections(vec![connection("linear", true)])),
        Arc::new(FixedServers(vec![
            custom_server("https://wiki.example.com/mcp", "Internal wiki", true),
            custom_server("https://old.example.com/mcp", "Retired", false),
        ])),
        "https://egress.macro.com",
    );

    let provisioned = provisioner
        .provision(
            AgentSessionId::new(),
            &MacroUserIdStr::try_from_email("owner@example.com").expect("a valid user id"),
            &AgentMcpServers::OwnerConnections,
        )
        .await
        .expect("provisioned");

    assert_eq!(
        provisioned.sandbox.custom_servers,
        [listing("https://wiki.example.com/mcp", "Internal wiki")]
    );
    let printed = format!("{:?}", provisioned.sandbox);
    assert!(!printed.contains("wiki.example.com"), "{printed}");

    let restored = provisioner
        .restore(
            &MacroUserIdStr::try_from_email("owner@example.com").expect("a valid user id"),
            "already-minted-token".to_owned(),
            &AgentMcpServers::OwnerConnections,
        )
        .await
        .expect("restored");
    assert_eq!(
        restored.custom_servers,
        [listing("https://wiki.example.com/mcp", "Internal wiki")]
    );
}

/// A selected app list is an author's choice of apps; the owner's private
/// servers are not added behind it.
#[tokio::test]
async fn a_selected_list_carries_none_of_the_owners_custom_servers() {
    let provisioner = EgressProvisioner::new(
        Arc::new(FixedConnections(vec![])),
        Arc::new(FixedServers(vec![custom_server(
            "https://wiki.example.com/mcp",
            "Internal wiki",
            true,
        )])),
        "https://egress.macro.com",
    );

    let provisioned = provisioner
        .provision(
            AgentSessionId::new(),
            &MacroUserIdStr::try_from_email("owner@example.com").expect("a valid user id"),
            &selected(&["notion"]),
        )
        .await
        .expect("provisioned");

    assert!(provisioned.sandbox.custom_servers.is_empty());
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
        Arc::new(FixedConnections(vec![])),
        Arc::new(FixedServers(vec![])),
        "http://agent-harness-service:8102",
    )
    .with_external_base_url(Some("http://localhost:28102/".into()));
    let sandbox = egress(&[]);
    let servers = provisioner.external_mcp_servers(&sandbox);
    assert_eq!(servers.len(), 2);
    for (server, path) in servers.iter().zip(["/mcp/internal", "/mcp-preview"]) {
        let McpServer::Http(server) = server else {
            panic!("expected HTTP MCP");
        };
        assert_eq!(server.url, format!("http://localhost:28102{path}"));
        assert_eq!(server.headers[0].value, sandbox.authorization_header());
    }
    assert_eq!(sandbox.base_url, "https://egress.macro.com");
}
