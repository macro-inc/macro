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
        feature_flags: None,
    };
    let redis = Arc::new(redis::Client::open("redis://127.0.0.1:9").unwrap());
    let auth_service = AuthServiceClient::new("internal-key".to_owned(), NOWHERE.to_owned());

    build(config, pool, redis, auth_service).unwrap()
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
