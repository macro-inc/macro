//! The composed services over the real native store and overlay table, with
//! Pipedream and Connect unconfigured and the account link unreachable.

use super::*;
use crate::domain::models::{AddedBy, ConnectorKey, ServerUrl, Status};
use crate::domain::service::{ConnectionManagementService, McpConnectionsService};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;

const OWNER: &str = "macro|owner@example.com";
const WIKI: &str = "https://wiki.example.com/mcp";
/// Nothing listens here: the account link and Redis are unreachable.
const NOWHERE: &str = "http://127.0.0.1:9";

fn connectors(pool: PgPool) -> Connectors {
    let (config, redis, auth_service) = setup();
    build(config, pool, redis, auth_service).unwrap()
}

fn setup() -> (ConnectorsConfig, Arc<redis::Client>, AuthServiceClient) {
    let config = ConnectorsConfig {
        environment: Environment::Local,
        app_origin: Url::parse("http://localhost:3000").unwrap(),
        mcp_credentials_key: AesKey::try_from(vec![7; 32]).unwrap(),
        mcp_oauth_client: OAuthClientMetadata::new(
            format!("{NOWHERE}/client-metadata"),
            format!("{NOWHERE}/callback"),
        ),
        #[cfg(feature = "providers")]
        mcp_pre_registered: PreRegisteredProviders::empty(),
        pipedream: None,
        connect: None,
        autodesk: None,
        feature_flags: None,
    };
    let redis = Arc::new(redis::Client::open("redis://127.0.0.1:9").unwrap());
    let auth_service = AuthServiceClient::new("internal-key".to_owned(), NOWHERE.to_owned());

    (config, redis, auth_service)
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("users"))
)]
async fn a_server_added_through_the_composed_services_is_usable(pool: PgPool) {
    let connectors = connectors(pool);
    let owner = MacroUserIdStr::parse_from_str(OWNER).unwrap();
    let wiki = ServerUrl::parse(WIKI).unwrap();

    let added = connectors
        .add_server(&owner, wiki.clone(), "Wiki", AddedBy::User)
        .await
        .unwrap();
    assert_eq!(*added.key(), ConnectorKey::Server(wiki.clone()));

    // Tool loading answers without the unreachable account link.
    let connections = connectors.connections(&owner).await.unwrap();
    assert_eq!(
        connections.status(&ConnectorKey::Server(wiki)),
        Status::Connected
    );
    assert_eq!(connections.handles().count(), 1);

    // The settings list does not: it never says "not connected" for a
    // source it could not read.
    assert!(connectors.list(&owner).await.is_err());
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("users"))
)]
async fn the_routes_get_a_catalog_and_sign_ins_over_the_same_services(pool: PgPool) {
    use crate::domain::discovery::ConnectorCatalogService;
    use crate::domain::sign_in::ServerSignInService;

    let (config, redis, auth_service) = setup();
    let composed = compose(config, pool, redis, auth_service).unwrap();
    let owner = MacroUserIdStr::parse_from_str(OWNER).unwrap();

    // Without Pipedream the catalog is empty, not an error.
    let page = composed
        .catalog
        .search(&owner, Some("linear"), None, None)
        .await
        .unwrap();
    assert!(page.apps.is_empty());

    assert_eq!(
        composed.sign_ins.client_metadata()["client_id"],
        format!("{NOWHERE}/client-metadata")
    );
    // An unknown state cannot be completed (Redis is unreachable here).
    assert!(
        composed
            .sign_ins
            .complete_sign_in("a-code", "a-state")
            .await
            .is_err()
    );

    // The routes' services are the connectors': a server added through
    // them is listed.
    composed
        .connectors
        .add_server(
            &owner,
            ServerUrl::parse(WIKI).unwrap(),
            "Wiki",
            AddedBy::User,
        )
        .await
        .unwrap();
}

/// Macro's Autodesk client, over a KMS client that is never called here.
fn autodesk() -> AutodeskConfig {
    let kms = aws_sdk_kms::Client::from_conf(
        aws_sdk_kms::Config::builder()
            .behavior_version(aws_sdk_kms::config::BehaviorVersion::latest())
            .region(aws_sdk_kms::config::Region::new("us-east-1"))
            .build(),
    );
    AutodeskConfig {
        client_id: "client".to_owned(),
        client_secret: zeroize::Zeroizing::new("secret".to_owned()),
        redirect_uri: Url::parse("https://cognition.example.com/connectors/apps/auth/callback")
            .unwrap(),
        kms,
        kms_key_id: "alias/autodesk".to_owned(),
    }
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("users"))
)]
async fn autodesk_is_connectable_and_listed_only_when_configured(pool: PgPool) {
    use crate::domain::discovery::ConnectorCatalogService;
    use crate::domain::models::ConnectorId;

    let owner = MacroUserIdStr::parse_from_str(OWNER).unwrap();
    let app = ConnectorId::parse("autodesk").unwrap();

    let (config, redis, auth_service) = setup();
    let without = compose(config, pool.clone(), redis, auth_service).unwrap();
    assert!(!without.serves_native_api_app(&app));
    assert!(!without.connectors.connectable(&app).await.unwrap());
    assert!(
        without
            .catalog
            .search(&owner, Some("autodesk"), None, None)
            .await
            .unwrap()
            .apps
            .is_empty()
    );

    let (mut config, redis, auth_service) = setup();
    config.autodesk = Some(autodesk());
    let with = compose(config, pool, redis, auth_service).unwrap();
    assert!(with.serves_native_api_app(&app));
    assert!(with.connectors.connectable(&app).await.unwrap());
    let page = with
        .catalog
        .search(&owner, Some("auto"), None, None)
        .await
        .unwrap();
    assert_eq!(page.apps[0].id, app);
    assert_eq!(page.apps[0].name, "Autodesk");
    assert!(page.apps[0].icon_url.is_some());
    let details = with.catalog.inspect(&owner, &app).await.unwrap().unwrap();
    assert_eq!(details.status, Status::NotConnected);
    assert!(details.tools.is_empty());
}
