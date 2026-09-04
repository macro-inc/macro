use super::*;
use agent_egress::domain::model::{AdvertisedMcp, CustomMcpId};
use mcp_client::domain::models::{McpServerRecord, StoredCredentials};
use oauth2::{AccessToken, basic::BasicTokenType};
use rmcp::transport::auth::{OAuthTokenResponse, VendorExtraTokenFields};

fn slug(name: &str) -> McpServerSlug {
    McpServerSlug::parse(name).expect("a valid app slug")
}

fn pipedream(name: &str) -> AdvertisedMcp {
    AdvertisedMcp::Pipedream(slug(name))
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
        None::<Arc<FixedCustom>>,
        "https://egress.macro.com",
    );

    let provisioned = provisioner
        .provision(
            AgentSessionId::new(),
            &MacroUserIdStr::try_from_email("owner@example.com").expect("a valid user id"),
            "https://github.com/macro-inc/macro",
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
        None::<Arc<FixedCustom>>,
        "https://egress.macro.com",
    );

    let restored = provisioner
        .restore(
            &MacroUserIdStr::try_from_email("owner@example.com").expect("a valid user id"),
            "already-minted-token".to_owned(),
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

fn egress(slugs: &[&str]) -> SandboxEgress {
    SandboxEgress {
        base_url: "https://egress.macro.com".to_owned(),
        session_token: "session-token".to_owned(),
        mcp_servers: slugs.iter().map(|name| pipedream(name)).collect(),
    }
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

struct FixedCustom(Vec<McpServerRecord>);

impl McpServerStore for FixedCustom {
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

fn token_response(access_token: &str) -> OAuthTokenResponse {
    OAuthTokenResponse::new(
        AccessToken::new(access_token.to_owned()),
        BasicTokenType::Bearer,
        VendorExtraTokenFields::default(),
    )
}

fn native_record(
    url: &str,
    server_name: &str,
    enabled: bool,
    credentialed: bool,
) -> McpServerRecord {
    McpServerRecord {
        user_id: MacroUserIdStr::try_from_email("owner@example.com").expect("a valid user id"),
        url: url.to_owned(),
        server_name: server_name.to_owned(),
        credentials: credentialed.then(|| {
            StoredCredentials::new(
                "client-id".to_owned(),
                Some(token_response("access-token")),
                vec![],
                None,
            )
        }),
        enabled,
    }
}

/// An enabled, credentialed native URL is advertised on `/mcp-custom/{id}`.
/// Disabled or unauthenticated rows are omitted.
#[tokio::test]
async fn advertises_authenticated_native_servers_on_their_own_route() {
    let live = "https://mcp.example.com/mcp";
    let provisioner = EgressProvisioner::new(
        Arc::new(FixedConnections(vec![connection("linear", true)])),
        Some(Arc::new(FixedCustom(vec![
            native_record(live, "Example Server", true, true),
            native_record("https://disabled.example/mcp", "Disabled", false, true),
            native_record("https://public.example/mcp", "Public", true, false),
            McpServerRecord {
                user_id: MacroUserIdStr::try_from_email("owner@example.com")
                    .expect("a valid user id"),
                url: "https://tokenless.example/mcp".to_owned(),
                server_name: "Tokenless".to_owned(),
                credentials: Some(StoredCredentials::new(
                    "client-id".to_owned(),
                    None,
                    vec![],
                    None,
                )),
                enabled: true,
            },
        ]))),
        "https://egress.macro.com",
    );

    let provisioned = provisioner
        .provision(
            AgentSessionId::new(),
            &MacroUserIdStr::try_from_email("owner@example.com").expect("a valid user id"),
            "https://github.com/macro-inc/macro",
        )
        .await
        .expect("provisioned");

    let entries: Vec<(String, String)> = provisioned.sandbox.server_entries().collect();
    let id = CustomMcpId::from_url(live);
    assert_eq!(
        entries,
        [
            (
                "macro".to_owned(),
                "https://egress.macro.com/mcp-macro".to_owned()
            ),
            (
                "linear".to_owned(),
                "https://egress.macro.com/mcp/linear".to_owned()
            ),
            (
                "example-server".to_owned(),
                format!("https://egress.macro.com/mcp-custom/{id}")
            ),
        ]
    );
}

/// A Pipedream slug that is already `custom-{id}` takes that ACP name.
/// The custom server then uses the 16-hex id, and still dials `/mcp-custom/{id}`.
#[tokio::test]
async fn custom_id_falls_through_when_custom_prefix_is_taken() {
    let live = "https://mcp.example.com/mcp";
    let id = CustomMcpId::from_url(live);
    let pipedream_slug = format!("custom-{id}");
    let provisioner = EgressProvisioner::new(
        Arc::new(FixedConnections(vec![connection(&pipedream_slug, true)])),
        Some(Arc::new(FixedCustom(vec![native_record(
            live, "", true, true,
        )]))),
        "https://egress.macro.com",
    );

    let provisioned = provisioner
        .provision(
            AgentSessionId::new(),
            &MacroUserIdStr::try_from_email("owner@example.com").expect("a valid user id"),
            "https://github.com/macro-inc/macro",
        )
        .await
        .expect("provisioned");

    let entries: Vec<(String, String)> = provisioned.sandbox.server_entries().collect();
    assert_eq!(
        entries,
        [
            (
                "macro".to_owned(),
                "https://egress.macro.com/mcp-macro".to_owned()
            ),
            (
                pipedream_slug.clone(),
                format!("https://egress.macro.com/mcp/{pipedream_slug}")
            ),
            (
                id.as_str().to_owned(),
                format!("https://egress.macro.com/mcp-custom/{id}")
            ),
        ]
    );
}
