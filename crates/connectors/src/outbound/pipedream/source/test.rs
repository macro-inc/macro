use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::cowlike::CowLike;
use sqlx::PgPool;
use std::sync::Mutex;

const USER: &str = "macro|owner@example.com";

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(USER).unwrap().into_owned()
}

fn app(slug: &str) -> ConnectorId {
    ConnectorId::parse(slug).unwrap()
}

/// Pipedream as far as the source needs it: its directory, the accounts it
/// holds for the user, and the grants revoked through it.
#[derive(Default)]
struct FakePipedream {
    directory: Vec<&'static str>,
    accounts: Vec<PipedreamAccount>,
    asked: Mutex<Vec<String>>,
    revoked: Mutex<Vec<String>>,
}

#[async_trait::async_trait]
impl RevokeGrant for FakePipedream {
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
impl PipedreamVendor for FakePipedream {
    async fn app(&self, slug: &str) -> Result<Option<CatalogEntry>, Report> {
        self.asked.lock().unwrap().push(slug.to_owned());
        Ok(self.directory.contains(&slug).then(|| CatalogEntry {
            app_slug: slug.to_owned(),
            display_name: slug.to_owned(),
            description: None,
            icon_url: None,
            categories: Vec::new(),
        }))
    }

    async fn connect_token(&self, _user: &MacroUserIdStr<'static>) -> Result<ConnectToken, Report> {
        Ok(ConnectToken {
            token: "ctok_1".to_owned(),
            expires_at: "2026-11-21T12:00:00Z".to_owned(),
            connect_link_url: "https://pipedream.com/_static/connect.html?token=ctok_1".to_owned(),
        })
    }

    async fn accounts(
        &self,
        _user: &MacroUserIdStr<'static>,
        slug: &str,
    ) -> Result<Vec<PipedreamAccount>, Report> {
        Ok(self
            .accounts
            .iter()
            .filter(|account| account.app_slug == slug)
            .cloned()
            .collect())
    }

    async fn dial(&self, _record: &PipedreamConnection) -> Result<McpServer, Report> {
        Err(rootcause::report!("not dialed in source tests"))
    }

    async fn upstream(&self, _record: &PipedreamConnection) -> Result<McpUpstreamCall, Report> {
        Err(rootcause::report!("not addressed in source tests"))
    }

    async fn proxy(
        &self,
        _record: &PipedreamConnection,
        _request: ApiRequest,
    ) -> Result<ApiResponse, Report> {
        Err(rootcause::report!("not called in source tests"))
    }
}

/// Revocations of Connect grants.
#[derive(Default)]
struct FakeConnectGrants {
    revoked: Mutex<Vec<String>>,
}

#[async_trait::async_trait]
impl RevokeGrant for FakeConnectGrants {
    async fn revoke(
        &self,
        _user: &MacroUserIdStr<'static>,
        account_id: &str,
    ) -> Result<(), Report> {
        self.revoked.lock().unwrap().push(account_id.to_owned());
        Ok(())
    }
}

fn account(id: &str, slug: &str, created_minute: u32) -> PipedreamAccount {
    PipedreamAccount {
        id: id.to_owned(),
        external_user_id: Some(USER.to_owned()),
        app_slug: slug.to_owned(),
        app_name: "Slack".to_owned(),
        healthy: true,
        created_at: Some(
            chrono::DateTime::parse_from_rfc3339(&format!("2026-11-21T10:{created_minute:02}:00Z"))
                .unwrap()
                .into(),
        ),
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
    vendor: Arc<FakePipedream>,
    connect: Arc<FakeConnectGrants>,
) -> PipedreamSource {
    PipedreamSource::new(
        vendor,
        HostedRepo::new(pool, Provider::Pipedream),
        Some(connect),
    )
}

/// The source answers only its own rows, keyed by the app with `slack_v2`
/// folded to `slack`, and offers each as MCP and API.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("users"))
)]
async fn connections_are_the_pipedream_rows_only(pool: PgPool) {
    insert(&pool, "slack_v2", "apn_slack", "pipedream").await;
    insert(&pool, "notion", "notion", "connect").await;
    let pipedream = source(pool, Arc::default(), Arc::default());

    let connections = pipedream.connections(&user()).await.unwrap();

    assert_eq!(connections.len(), 1);
    let slack = &connections[0];
    assert_eq!(slack.source, SourceKind::Pipedream);
    assert_eq!(slack.key, ConnectorKey::App(app("slack")));
    assert_eq!(slack.source_id, "slack_v2");
    assert!(slack.enabled && slack.authorized);
    assert!(slack.mcp.is_some() && slack.api.is_some());
}

/// Slack is looked up under Pipedream's current Slack app.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn supports_asks_pipedream_for_the_connectable_slug(pool: PgPool) {
    let vendor = Arc::new(FakePipedream {
        directory: vec!["slack_v2"],
        ..FakePipedream::default()
    });
    let pipedream = source(pool, vendor.clone(), Arc::default());

    assert_eq!(
        pipedream.supports(&app("slack")).await.unwrap(),
        Some(Surfaces::new(true, true))
    );
    assert_eq!(pipedream.supports(&app("unknown_app")).await.unwrap(), None);
    assert_eq!(*vendor.asked.lock().unwrap(), ["slack_v2", "unknown_app"]);
}

/// Completing stores the newest account Pipedream holds for the user, takes
/// the row Connect held for the app and revokes Connect's grant.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("users"))
)]
async fn completing_stores_the_newest_account_and_revokes_the_replaced_grant(pool: PgPool) {
    insert(&pool, "slack", "slack", "connect").await;
    let vendor = Arc::new(FakePipedream {
        accounts: vec![
            account("apn_old", "slack_v2", 1),
            account("apn_new", "slack_v2", 2),
        ],
        ..FakePipedream::default()
    });
    let connect = Arc::new(FakeConnectGrants::default());
    let pipedream = source(pool.clone(), vendor.clone(), connect.clone());

    let connection = pipedream
        .complete_connect(&user(), &app("slack"))
        .await
        .unwrap();

    assert_eq!(connection.key, ConnectorKey::App(app("slack")));
    assert_eq!(connection.source_id, "slack_v2");
    assert_eq!(*connect.revoked.lock().unwrap(), ["slack"]);
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
        ("slack_v2", "apn_new", "pipedream")
    );
}

/// Without an account at Pipedream there is nothing to record.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn completing_without_an_account_is_refused_as_not_found(pool: PgPool) {
    let pipedream = source(pool, Arc::default(), Arc::default());

    let error = pipedream
        .complete_connect(&user(), &app("linear"))
        .await
        .unwrap_err();

    assert_eq!(
        error.downcast_current_context::<SourceRefusal>(),
        Some(&SourceRefusal::NotFound(ConnectorKey::App(app("linear"))))
    );
}

/// The dialog's link opens Pipedream's flow on the app's connectable slug.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn start_connect_deep_links_the_app(pool: PgPool) {
    let pipedream = source(pool, Arc::default(), Arc::default());

    let step = pipedream
        .start_connect(&user(), &ConnectorKey::App(app("slack")))
        .await
        .unwrap();

    let ConnectStep::EmbeddedDialog { token, link, .. } = step else {
        panic!("Pipedream connects in its embedded dialog");
    };
    assert_eq!(token, "ctok_1");
    assert_eq!(
        link.as_str(),
        "https://pipedream.com/_static/connect.html?token=ctok_1&app=slack_v2"
    );
}

/// Removing revokes the Pipedream accounts of every slug of the app and
/// leaves Connect's rows alone.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("users"))
)]
async fn remove_revokes_and_deletes_only_pipedream_rows(pool: PgPool) {
    insert(&pool, "slack", "apn_legacy", "pipedream").await;
    insert(&pool, "slack_v2", "apn_slack", "pipedream").await;
    insert(&pool, "notion", "notion", "connect").await;
    let vendor = Arc::new(FakePipedream::default());
    let pipedream = source(pool.clone(), vendor.clone(), Arc::default());

    pipedream
        .remove(&user(), &ConnectorKey::App(app("slack")))
        .await
        .unwrap();
    pipedream
        .remove(&user(), &ConnectorKey::App(app("notion")))
        .await
        .unwrap();

    assert_eq!(*vendor.revoked.lock().unwrap(), ["apn_legacy", "apn_slack"]);
    let left = sqlx::query_scalar!("SELECT app_slug FROM pipedream_mcp_connections")
        .fetch_all(&pool)
        .await
        .unwrap();
    assert_eq!(left, ["notion"]);
}
