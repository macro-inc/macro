use super::*;
use crate::domain::ports::GrantState;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::cowlike::CowLike;
use sqlx::PgPool;
use std::sync::Mutex;
use url::Url;

const USER: &str = "macro|owner@example.com";

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(USER).unwrap().into_owned()
}

fn app(slug: &str) -> ConnectorId {
    ConnectorId::parse(slug).unwrap()
}

fn entry(id: &str, pipedream_app_slugs: &[&str], access: &[&str]) -> wire::CatalogEntry {
    wire::CatalogEntry {
        id: id.to_owned(),
        name: id.to_owned(),
        description: String::new(),
        access: access.iter().map(|access| (*access).to_owned()).collect(),
        oauth_client: None,
        mcp_url: format!("https://mcp.{id}.example/mcp"),
        icon_url: None,
        pipedream_app_slugs: pipedream_app_slugs
            .iter()
            .map(|slug| (*slug).to_owned())
            .collect(),
        org_setup: None,
    }
}

fn status(app_id: &str, status: wire::ConnectionStatus) -> wire::Connection {
    wire::Connection {
        app_id: app_id.to_owned(),
        status,
        scopes: Vec::new(),
        created_at: chrono::DateTime::parse_from_rfc3339("2026-11-21T10:00:00Z")
            .unwrap()
            .into(),
    }
}

/// Macro Connect as far as the source needs it: its catalog, the user's
/// connections there, and the grants revoked through it.
struct FakeConnect {
    catalog: Arc<Vec<wire::CatalogEntry>>,
    connections: Vec<wire::Connection>,
    revoked: Mutex<Vec<String>>,
}

impl FakeConnect {
    fn new(connections: Vec<wire::Connection>) -> Self {
        Self {
            catalog: Arc::new(vec![
                entry("slack", &["slack", "slack_v2"], &["mcp", "api"]),
                entry("granola", &["granola"], &["mcp"]),
                entry("acme", &[], &["mcp"]),
            ]),
            connections,
            revoked: Mutex::new(Vec::new()),
        }
    }
}

#[async_trait::async_trait]
impl RevokeGrant for FakeConnect {
    async fn revoke(
        &self,
        _user: &MacroUserIdStr<'static>,
        account_id: &str,
    ) -> Result<(), Report> {
        self.revoked.lock().unwrap().push(account_id.to_owned());
        Ok(())
    }
}

#[async_trait::async_trait]
impl ConnectVendor for FakeConnect {
    async fn catalog(&self) -> Result<Arc<Vec<wire::CatalogEntry>>, Report> {
        Ok(self.catalog.clone())
    }

    async fn connect_url(
        &self,
        _user: &MacroUserIdStr<'static>,
        app_id: &str,
        app_slug: &str,
    ) -> Result<Url, Report> {
        Ok(Url::parse(&format!(
            "https://connect.example/consent/{app_id}?as={app_slug}"
        ))
        .unwrap())
    }

    async fn connections(
        &self,
        _user: &MacroUserIdStr<'static>,
    ) -> Result<Vec<wire::Connection>, Report> {
        Ok(self.connections.clone())
    }

    async fn dial(
        &self,
        _user: &MacroUserIdStr<'static>,
        _app_id: &str,
    ) -> Result<McpServer, Report> {
        Err(rootcause::report!("not dialed in source tests"))
    }

    fn upstream(&self, _user: &MacroUserIdStr<'static>, _app_id: &str) -> Upstream {
        Upstream::new(
            Url::parse("https://connect.example/mcp").unwrap(),
            None,
            http::HeaderMap::new(),
        )
    }

    async fn call(
        &self,
        _user: &MacroUserIdStr<'static>,
        _app_id: &str,
        _request: ApiRequest,
    ) -> Result<ApiResponse, Report> {
        Err(Report::new(connect_client::Error::NeedsReauth).into_dynamic())
    }
}

/// Revocations of Pipedream grants.
#[derive(Default)]
struct FakePipedreamGrants {
    revoked: Mutex<Vec<String>>,
}

#[async_trait::async_trait]
impl RevokeGrant for FakePipedreamGrants {
    async fn revoke(
        &self,
        _user: &MacroUserIdStr<'static>,
        account_id: &str,
    ) -> Result<(), Report> {
        self.revoked.lock().unwrap().push(account_id.to_owned());
        Ok(())
    }
}

async fn insert(pool: &PgPool, slug: &str, account: &str, provider: &str) {
    sqlx::query!(
        "INSERT INTO pipedream_mcp_connections (user_id, app_slug, server_name, account_id, enabled, provider) VALUES ($1, $2, $3, $4, TRUE, $5)",
        USER,
        slug,
        slug,
        account,
        provider,
    )
    .execute(pool)
    .await
    .unwrap();
}

fn source(
    pool: PgPool,
    vendor: Arc<FakeConnect>,
    pipedream: Arc<FakePipedreamGrants>,
) -> ConnectSource {
    ConnectSource::new(
        vendor,
        HostedRepo::new(pool, Provider::Connect),
        Some(pipedream),
    )
}

/// The source answers only its own rows. A connection is authorized while
/// Connect reports it active, and provides the API only where Connect's
/// catalog lists API access.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("users"))
)]
async fn connections_are_the_connect_rows_only(pool: PgPool) {
    insert(&pool, "slack_v2", "slack", "connect").await;
    insert(&pool, "granola", "granola", "connect").await;
    insert(&pool, "linear", "apn_linear", "pipedream").await;
    let vendor = Arc::new(FakeConnect::new(vec![
        status("slack", wire::ConnectionStatus::Active),
        status("granola", wire::ConnectionStatus::NeedsReauth),
    ]));
    let connect = source(pool, vendor, Arc::default());

    let connections = connect.connections(&user()).await.unwrap();

    let summary: Vec<_> = connections
        .iter()
        .map(|connection| {
            (
                connection.source,
                connection.key.clone(),
                connection.source_id.as_str(),
                connection.grant,
                connection.mcp.is_some(),
                connection.api.is_some(),
            )
        })
        .collect();
    assert_eq!(
        summary,
        vec![
            (
                SourceKind::Connect,
                ConnectorKey::App(app("granola")),
                "granola",
                GrantState::Dead,
                true,
                false
            ),
            (
                SourceKind::Connect,
                ConnectorKey::App(app("slack")),
                "slack_v2",
                GrantState::Working,
                true,
                true
            ),
        ]
    );
}

/// Apps are keyed by the Pipedream slugs they replace, folded, or by
/// Connect's id when they replace none; surfaces are the catalog's.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn supports_reads_the_catalog(pool: PgPool) {
    let connect = source(pool, Arc::new(FakeConnect::new(Vec::new())), Arc::default());

    assert_eq!(
        connect.supports(&app("slack_v2")).await.unwrap(),
        Some(Surfaces::new(true, true))
    );
    assert_eq!(
        connect.supports(&app("granola")).await.unwrap(),
        Some(Surfaces::new(true, false))
    );
    assert_eq!(
        connect.supports(&app("acme")).await.unwrap(),
        Some(Surfaces::new(true, false))
    );
    assert_eq!(connect.supports(&app("linear")).await.unwrap(), None);
}

/// An app's admin setup is the one its catalog entry lists, under the slugs
/// Macro addresses it by; one whose settings page is not `https` is left out.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn org_setups_read_the_catalog(pool: PgPool) {
    let setup = |settings_url: &str| wire::OrgSetup {
        summary: "An admin allows it once.".to_owned(),
        steps: vec!["Open settings.".to_owned()],
        settings_url: settings_url.to_owned(),
        required: true,
        allowlist_url: Some("https://connect.example/callback".to_owned()),
    };
    let mut vendor = FakeConnect::new(Vec::new());
    vendor.catalog = Arc::new(
        vendor
            .catalog
            .iter()
            .cloned()
            .map(|mut entry| {
                entry.org_setup = match entry.id.as_str() {
                    "slack" => Some(setup("https://slack.example/admin")),
                    "acme" => Some(setup("javascript:alert(1)")),
                    _ => None,
                };
                entry
            })
            .collect(),
    );
    let connect = source(pool, Arc::new(vendor), Arc::default());

    let setups = connect
        .org_setups(&[app("slack_v2"), app("granola"), app("acme"), app("linear")])
        .await
        .unwrap();

    assert_eq!(
        setups,
        HashMap::from([(
            app("slack_v2"),
            OrgSetup {
                summary: "An admin allows it once.".to_owned(),
                steps: vec!["Open settings.".to_owned()],
                settings_url: "https://slack.example/admin".to_owned(),
                required: true,
                allowlist_url: Some("https://connect.example/callback".to_owned()),
            }
        )])
    );
}

/// Completing records Connect's active connection, takes the row Pipedream
/// held for the app and revokes Pipedream's grant.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("users"))
)]
async fn completing_replaces_the_pipedream_row_and_revokes_its_grant(pool: PgPool) {
    insert(&pool, "slack_v2", "apn_slack", "pipedream").await;
    let vendor = Arc::new(FakeConnect::new(vec![status(
        "slack",
        wire::ConnectionStatus::Active,
    )]));
    let pipedream = Arc::new(FakePipedreamGrants::default());
    let connect = source(pool.clone(), vendor.clone(), pipedream.clone());

    let connection = connect
        .complete_connect(&user(), &app("slack"))
        .await
        .unwrap();

    assert_eq!(connection.key, ConnectorKey::App(app("slack")));
    assert!(connection.enabled && connection.grant == GrantState::Working);
    assert_eq!(*pipedream.revoked.lock().unwrap(), ["apn_slack"]);
    assert!(vendor.revoked.lock().unwrap().is_empty());
    let rows = sqlx::query!("SELECT app_slug, account_id, provider FROM pipedream_mcp_connections")
        .fetch_all(&pool)
        .await
        .unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(
        (
            rows[0].app_slug.as_str(),
            rows[0].account_id.as_str(),
            rows[0].provider.as_str()
        ),
        ("slack", "slack", "connect")
    );
}

/// Nothing is recorded until Connect lists an active connection, and an app
/// outside its catalog is not Connect's to start.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("users"))
)]
async fn completing_without_an_active_connection_is_refused(pool: PgPool) {
    insert(&pool, "granola", "apn_granola", "pipedream").await;
    let vendor = Arc::new(FakeConnect::new(vec![status(
        "granola",
        wire::ConnectionStatus::NeedsReauth,
    )]));
    let connect = source(pool.clone(), vendor, Arc::default());

    let refusal_of = |error: Report| error.downcast_current_context::<SourceRefusal>().cloned();
    assert_eq!(
        refusal_of(
            connect
                .complete_connect(&user(), &app("slack"))
                .await
                .unwrap_err()
        ),
        Some(SourceRefusal::NotFound(ConnectorKey::App(app("slack"))))
    );
    assert_eq!(
        refusal_of(
            connect
                .complete_connect(&user(), &app("granola"))
                .await
                .unwrap_err()
        ),
        Some(SourceRefusal::NeedsReauth(ConnectorKey::App(app(
            "granola"
        ))))
    );
    assert_eq!(
        refusal_of(
            connect
                .start_connect(&user(), &ConnectorKey::App(app("linear")))
                .await
                .unwrap_err()
        ),
        Some(SourceRefusal::Unsupported(ConnectorKey::App(app("linear"))))
    );

    let rows = sqlx::query_scalar!("SELECT provider FROM pipedream_mcp_connections")
        .fetch_all(&pool)
        .await
        .unwrap();
    assert_eq!(rows, ["pipedream"]);
}

/// Connect's consent page opens on Connect's id for the app.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn start_connect_opens_connects_consent_page(pool: PgPool) {
    let connect = source(pool, Arc::new(FakeConnect::new(Vec::new())), Arc::default());

    let step = connect
        .start_connect(&user(), &ConnectorKey::App(app("slack_v2")))
        .await
        .unwrap();

    assert_eq!(
        step,
        ConnectStep::OpenUrl(Url::parse("https://connect.example/consent/slack?as=slack").unwrap())
    );
}

/// An API call whose grant Connect can no longer export is a reauth
/// refusal for the app.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("users"))
)]
async fn an_unexportable_grant_needs_reauth(pool: PgPool) {
    insert(&pool, "slack", "slack", "connect").await;
    let vendor = Arc::new(FakeConnect::new(vec![status(
        "slack",
        wire::ConnectionStatus::Active,
    )]));
    let connect = source(pool, vendor, Arc::default());
    let connections = connect.connections(&user()).await.unwrap();
    let api = connections[0].api.clone().unwrap();

    let error = api
        .call(ApiRequest {
            method: http::Method::GET,
            url: "https://slack.com/api/auth.test".to_owned(),
            headers: http::HeaderMap::new(),
            body: None,
        })
        .await
        .unwrap_err();

    assert_eq!(
        error.downcast_current_context::<SourceRefusal>(),
        Some(&SourceRefusal::NeedsReauth(ConnectorKey::App(app("slack"))))
    );
}
