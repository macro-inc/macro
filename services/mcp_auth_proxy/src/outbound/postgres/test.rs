use macro_db_migrator::MACRO_DB_MIGRATIONS;

use super::*;
use crate::test_support::FakeKms;

fn store(pool: PgPool) -> PostgresAuthStore {
    PostgresAuthStore::new(pool, Arc::new(FakeKms::default()))
}

fn registered_client(client_id: &str) -> RegisteredClient {
    RegisteredClient {
        client_id: client_id.to_owned(),
        client_name: "test-client".to_owned(),
        redirect_uris: vec!["http://127.0.0.1:51000/oauth/callback".to_owned()],
    }
}

fn binding(client_id: &str, grant_id: &str) -> RefreshTokenBinding {
    RefreshTokenBinding {
        client_id: client_id.to_owned(),
        grant_id: grant_id.to_owned(),
    }
}

fn issued_code(client_id: &str) -> IssuedAuthorizationCode {
    IssuedAuthorizationCode {
        client_id: client_id.to_owned(),
        access_token: AccessToken::from("upstream-access-token"),
        refresh_token: RefreshToken::from("upstream-refresh-token"),
        code_challenge: "challenge".to_owned(),
        redirect_uri: "http://127.0.0.1:51000/oauth/callback".to_owned(),
        access_token_expires_at: SystemTime::UNIX_EPOCH + Duration::from_secs(4_000_000_000),
    }
}

async fn client_expires_at(pool: &PgPool, client_id: &str) -> DateTime<Utc> {
    sqlx::query_scalar!(
        "SELECT expires_at FROM mcp_oauth_clients WHERE client_id = $1",
        client_id
    )
    .fetch_one(pool)
    .await
    .expect("registration row")
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_registration_is_found_until_it_expires(pool: PgPool) {
    let store = store(pool);
    store
        .insert_client(&registered_client("live"))
        .await
        .expect("insert");
    store
        .import_client(&registered_client("lapsed"), Duration::ZERO)
        .await
        .expect("import");

    let found = store
        .find_client("live")
        .await
        .expect("lookup")
        .expect("live client");
    assert_eq!(found.client_name, "test-client");
    assert_eq!(
        found.redirect_uris,
        ["http://127.0.0.1:51000/oauth/callback"]
    );
    assert!(store.find_client("lapsed").await.expect("lookup").is_none());
    assert!(
        store
            .find_client("unknown")
            .await
            .expect("lookup")
            .is_none()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn finding_a_registration_extends_it(pool: PgPool) {
    let store = store(pool.clone());
    store
        .import_client(&registered_client("client"), Duration::from_secs(60))
        .await
        .expect("import");
    let before = client_expires_at(&pool, "client").await;

    store
        .find_client("client")
        .await
        .expect("lookup")
        .expect("client");

    let after = client_expires_at(&pool, "client").await;
    assert!(
        after > before + chrono::Duration::days(89),
        "a used registration should get a fresh 90-day window"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_import_never_replaces_an_existing_row(pool: PgPool) {
    let store = store(pool);
    store
        .bind("digest", &binding("current-client", "current-grant"))
        .await
        .expect("bind");

    store
        .import_binding(
            "digest",
            &binding("stale-client", "stale-grant"),
            Duration::from_secs(60),
        )
        .await
        .expect("import");

    assert_eq!(
        store.binding("digest").await.expect("lookup"),
        Some(binding("current-client", "current-grant"))
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_binding_follows_bind_rebind_and_unbind(pool: PgPool) {
    let store = store(pool);
    store
        .bind("digest", &binding("client-a", "grant-a"))
        .await
        .expect("bind");
    store
        .bind("digest", &binding("client-b", "grant-b"))
        .await
        .expect("rebind");
    assert_eq!(
        store.binding("digest").await.expect("lookup"),
        Some(binding("client-b", "grant-b"))
    );

    store.unbind("digest").await.expect("unbind");
    assert!(store.binding("digest").await.expect("lookup").is_none());

    store
        .import_binding("lapsed", &binding("client-a", "grant-a"), Duration::ZERO)
        .await
        .expect("import");
    assert!(store.binding("lapsed").await.expect("lookup").is_none());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_revoked_grant_stays_revoked_until_it_expires(pool: PgPool) {
    let store = store(pool);
    assert!(!store.is_grant_revoked("grant").await.expect("lookup"));

    store.revoke_grant("grant").await.expect("revoke");
    store.revoke_grant("grant").await.expect("revoke again");
    assert!(store.is_grant_revoked("grant").await.expect("lookup"));
    assert!(!store.is_grant_revoked("other").await.expect("lookup"));

    store
        .import_revoked_grant("lapsed", Duration::ZERO)
        .await
        .expect("import");
    assert!(!store.is_grant_revoked("lapsed").await.expect("lookup"));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_pending_authorization_is_taken_once(pool: PgPool) {
    let store = store(pool);
    store
        .insert_pending(
            "session",
            PendingAuthorization {
                client_id: "client".to_owned(),
                code_challenge: "challenge".to_owned(),
                client_state: "state".to_owned(),
                client_redirect_uri: "http://127.0.0.1:51000/oauth/callback".to_owned(),
            },
        )
        .await
        .expect("insert");

    let pending = store
        .take_pending("session")
        .await
        .expect("take")
        .expect("pending");
    assert_eq!(pending.client_state, "state");
    assert!(store.take_pending("session").await.expect("take").is_none());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_issued_code_redeems_once_for_its_tokens(pool: PgPool) {
    let store = store(pool);
    store
        .insert_issued("broker-code", issued_code("client"))
        .await
        .expect("insert");

    let issued = store
        .take_issued("broker-code")
        .await
        .expect("take")
        .expect("issued code");
    assert_eq!(issued.client_id, "client");
    assert_eq!(issued.access_token.as_str(), "upstream-access-token");
    assert_eq!(issued.refresh_token.as_str(), "upstream-refresh-token");
    assert_eq!(issued.redirect_uri, "http://127.0.0.1:51000/oauth/callback");
    assert_eq!(
        issued.access_token_expires_at,
        SystemTime::UNIX_EPOCH + Duration::from_secs(4_000_000_000)
    );
    assert!(
        store
            .take_issued("broker-code")
            .await
            .expect("take")
            .is_none()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_issued_code_row_holds_neither_the_code_nor_the_tokens(pool: PgPool) {
    let store = store(pool.clone());
    store
        .insert_issued("broker-code", issued_code("client"))
        .await
        .expect("insert");

    let row =
        sqlx::query!("SELECT code_digest, tokens_ciphertext FROM mcp_oauth_authorization_codes")
            .fetch_one(&pool)
            .await
            .expect("row");
    assert_ne!(row.code_digest, "broker-code");
    let ciphertext = String::from_utf8_lossy(&row.tokens_ciphertext);
    assert!(!ciphertext.contains("upstream-access-token"));
    assert!(!ciphertext.contains("upstream-refresh-token"));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn tokens_moved_to_another_client_do_not_decrypt(pool: PgPool) {
    let store = store(pool.clone());
    store
        .insert_issued("broker-code", issued_code("client"))
        .await
        .expect("insert");
    sqlx::query!("UPDATE mcp_oauth_authorization_codes SET client_id = 'attacker'")
        .execute(&pool)
        .await
        .expect("tamper");

    assert!(store.take_issued("broker-code").await.is_err());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn cleanup_deletes_only_expired_rows(pool: PgPool) {
    let store = store(pool.clone());
    store
        .insert_client(&registered_client("live"))
        .await
        .expect("insert");
    store
        .import_client(&registered_client("lapsed"), Duration::ZERO)
        .await
        .expect("import");
    store
        .bind("live", &binding("live", "live"))
        .await
        .expect("bind");
    store
        .import_binding("lapsed", &binding("lapsed", "lapsed"), Duration::ZERO)
        .await
        .expect("import");

    store.cleanup_expired().await.expect("cleanup");

    let clients = sqlx::query_scalar!("SELECT client_id FROM mcp_oauth_clients")
        .fetch_all(&pool)
        .await
        .expect("clients");
    let bindings =
        sqlx::query_scalar!("SELECT refresh_token_digest FROM mcp_oauth_refresh_token_bindings")
            .fetch_all(&pool)
            .await
            .expect("bindings");
    assert_eq!(clients, ["live"]);
    assert_eq!(bindings, ["live"]);
}
