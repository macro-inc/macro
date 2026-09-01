use super::*;
use crate::domain::model::{AgentKind, AgentRuntimeConfig};

fn slug(name: &str) -> McpServerSlug {
    McpServerSlug::parse(name).expect("a valid app slug")
}

#[test]
fn reads_the_repository_out_of_a_configured_url() {
    for url in [
        "https://github.com/macro-inc/macro",
        "https://github.com/macro-inc/macro/",
        "https://github.com/macro-inc/macro.git",
    ] {
        let repo = repo_slug(url).expect(url);
        assert_eq!(repo.to_string(), "macro-inc/macro", "for {url}");
    }
}

#[test]
fn refuses_a_url_that_does_not_name_a_repository() {
    for url in [
        "",
        "not a url",
        "https://github.com",
        "https://github.com/macro-inc",
        "https://gitlab.com/macro-inc/macro",
        "https://github.com.evil.example/macro-inc/macro",
        "https://github.com/macro-inc/macro/tree/main",
    ] {
        assert!(repo_slug(url).is_err(), "accepted {url}");
    }
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

/// A directory answering one fixed selection for every bot, or nothing.
struct FixedSelection(Option<McpServerSelection>);

impl AgentRuntimeDirectory for FixedSelection {
    async fn runtime_for(&self, _bot: BotId) -> Result<Option<AgentRuntimeConfig>> {
        Ok(self.0.clone().map(|mcp_servers| AgentRuntimeConfig {
            kind: AgentKind::SandboxedCoder,
            model: "model".to_owned(),
            harness: "opencode".to_owned(),
            instructions: String::new(),
            mcp_servers,
        }))
    }
}

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("owner@example.com").expect("a valid user id")
}

fn provisioner(
    connections: Vec<pipedream_mcp::domain::models::PipedreamConnection>,
    selection: Option<McpServerSelection>,
) -> EgressProvisioner<FixedConnections, FixedSelection> {
    EgressProvisioner::new(
        Arc::new(FixedConnections(connections)),
        Arc::new(FixedSelection(selection)),
        "https://egress.macro.com",
    )
}

async fn provisioned_slugs(
    provisioner: &EgressProvisioner<FixedConnections, FixedSelection>,
) -> Vec<String> {
    provisioner
        .provision(
            AgentSessionId::new(),
            &owner(),
            BotId::TEST_A,
            "https://github.com/macro-inc/macro",
        )
        .await
        .expect("provisioned")
        .sandbox
        .mcp_servers
        .iter()
        .map(ToString::to_string)
        .collect()
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
    let provisioner = provisioner(
        vec![
            connection("linear", true),
            connection("google_sheets", true),
            connection("datadog", false),
            connection("Not A Slug!", true),
        ],
        Some(McpServerSelection::AllConnected),
    );

    assert_eq!(
        provisioned_slugs(&provisioner).await,
        ["linear", "google_sheets"]
    );
}

/// An agent that names its servers gets exactly those, in its own order, and
/// only where the owner has the app connected and enabled: the agent's
/// configuration chooses among the owner's credentials, it never adds any.
#[tokio::test]
async fn a_selecting_agent_gets_only_the_owners_connected_servers_it_named() {
    let provisioner = provisioner(
        vec![
            connection("linear", true),
            connection("google_sheets", true),
            connection("datadog", false),
        ],
        Some(McpServerSelection::Selected(vec![
            McpServerRef::pipedream("google_sheets"),
            McpServerRef::pipedream("datadog"),
            McpServerRef::pipedream("notion"),
            McpServerRef::pipedream("linear"),
        ])),
    );

    assert_eq!(
        provisioned_slugs(&provisioner).await,
        ["google_sheets", "linear"]
    );
}

/// A native-stack server has no route on the proxy yet, so naming one adds
/// nothing to the list - and takes nothing away from the rest.
#[tokio::test]
async fn native_servers_are_not_advertised_yet() {
    let provisioner = provisioner(
        vec![connection("linear", true)],
        Some(McpServerSelection::Selected(vec![
            McpServerRef::native("https://mcp.grafana.com/mcp"),
            McpServerRef::pipedream("linear"),
        ])),
    );

    assert_eq!(provisioned_slugs(&provisioner).await, ["linear"]);
}

/// An agent that selected nothing, and a bot the directory does not know,
/// both get only Macro's own server: neither is a reason to hand out every
/// credential the owner holds.
#[tokio::test]
async fn an_empty_selection_and_an_unknown_bot_advertise_nothing() {
    let connections = vec![connection("linear", true)];

    let empty = provisioner(
        connections.clone(),
        Some(McpServerSelection::Selected(Vec::new())),
    );
    assert!(provisioned_slugs(&empty).await.is_empty());

    let unknown = provisioner(connections, None);
    assert!(provisioned_slugs(&unknown).await.is_empty());
}

/// `restore` rebuilds the same environment around a token that already
/// exists: nothing is minted, and the server list is read fresh.
#[tokio::test]
async fn restore_wraps_an_existing_token_in_a_fresh_listing() {
    let provisioner = provisioner(
        vec![connection("linear", true)],
        Some(McpServerSelection::AllConnected),
    );

    let restored = provisioner
        .restore(&owner(), BotId::TEST_A, "already-minted-token".to_owned())
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

fn egress(slugs: &[&str]) -> SandboxEgress {
    SandboxEgress {
        base_url: "https://egress.macro.com".to_owned(),
        session_token: "session-token".to_owned(),
        mcp_servers: slugs.iter().map(|name| slug(name)).collect(),
    }
}

/// Every server points at the proxy and carries the session token rather than
/// any upstream credential; Macro's own server leads the list on its own
/// route.
#[test]
fn points_every_acp_server_at_the_proxy() {
    let servers = egress(&["datadog", "linear"]).acp_servers();

    let rendered: Vec<(String, String, Vec<(String, String)>)> = servers
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
        [(
            "macro".to_owned(),
            "https://egress.macro.com/mcp-macro".to_owned()
        )]
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
