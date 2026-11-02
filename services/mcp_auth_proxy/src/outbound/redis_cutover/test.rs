use std::time::{Duration, SystemTime};

use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;

use super::*;
use crate::{
    domain::models::{AccessToken, RefreshToken},
    test_support::{FakeClientRegistry, FakeInflightAuth, FakeKms},
};

type Store<C = FakeClientRegistry, I = FakeInflightAuth> = RedisCutoverAuthStore<C, I>;

fn postgres(pool: PgPool) -> PostgresAuthStore {
    PostgresAuthStore::new(pool, Arc::new(FakeKms::default()))
}

fn cutover(pool: PgPool) -> (Store, Arc<FakeClientRegistry>, Arc<FakeInflightAuth>) {
    let legacy_clients = Arc::new(FakeClientRegistry::default());
    let legacy_inflight = Arc::new(FakeInflightAuth::default());
    let store = RedisCutoverAuthStore::new(
        postgres(pool),
        legacy_clients.clone(),
        legacy_inflight.clone(),
    );
    (store, legacy_clients, legacy_inflight)
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

/// A legacy store whose every call fails, like Redis refusing writes.
struct BrokenLegacy;

fn broken<T>() -> anyhow::Result<T> {
    Err(anyhow::anyhow!(
        "ReadOnly: You can't write against a read only replica."
    ))
}

impl ClientRegistrationStore for BrokenLegacy {
    fn insert_client<'a>(&'a self, _client: &'a RegisteredClient) -> StoreWriteFuture<'a> {
        Box::pin(async { broken() })
    }

    fn find_client<'a>(&'a self, _client_id: &'a str) -> RegisteredClientFuture<'a> {
        Box::pin(async { broken() })
    }
}

impl RefreshTokenBindingStore for BrokenLegacy {
    fn bind<'a>(
        &'a self,
        _digest: &'a str,
        _binding: &'a RefreshTokenBinding,
    ) -> StoreWriteFuture<'a> {
        Box::pin(async { broken() })
    }

    fn binding<'a>(&'a self, _digest: &'a str) -> RefreshTokenBindingFuture<'a> {
        Box::pin(async { broken() })
    }

    fn unbind<'a>(&'a self, _digest: &'a str) -> StoreWriteFuture<'a> {
        Box::pin(async { broken() })
    }

    fn revoke_grant<'a>(&'a self, _grant_id: &'a str) -> StoreWriteFuture<'a> {
        Box::pin(async { broken() })
    }

    fn is_grant_revoked<'a>(&'a self, _grant_id: &'a str) -> GrantRevokedFuture<'a> {
        Box::pin(async { broken() })
    }
}

impl InflightAuthStore for BrokenLegacy {
    async fn insert_pending(&self, _: &str, _: PendingAuthorization) -> anyhow::Result<()> {
        broken()
    }

    async fn take_pending(&self, _: &str) -> anyhow::Result<Option<PendingAuthorization>> {
        broken()
    }

    async fn insert_issued(&self, _: &str, _: IssuedAuthorizationCode) -> anyhow::Result<()> {
        broken()
    }

    async fn take_issued(&self, _: &str) -> anyhow::Result<Option<IssuedAuthorizationCode>> {
        broken()
    }

    async fn cleanup_expired(&self) -> anyhow::Result<()> {
        broken()
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_registration_only_in_redis_is_found_and_copied(pool: PgPool) {
    let (store, legacy_clients, _) = cutover(pool.clone());
    legacy_clients
        .insert_client(&registered_client("pre-cutover"))
        .await
        .expect("legacy insert");

    let found = store
        .find_client("pre-cutover")
        .await
        .expect("lookup")
        .expect("legacy registration");
    assert_eq!(found.client_id, "pre-cutover");

    let copied = postgres(pool)
        .find_client("pre-cutover")
        .await
        .expect("lookup");
    assert!(copied.is_some(), "the fallback should copy into Postgres");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_new_registration_is_written_to_both_stores(pool: PgPool) {
    let (store, legacy_clients, _) = cutover(pool.clone());

    store
        .insert_client(&registered_client("new"))
        .await
        .expect("insert");

    assert!(
        postgres(pool)
            .find_client("new")
            .await
            .expect("lookup")
            .is_some()
    );
    assert!(
        legacy_clients
            .find_client("new")
            .await
            .expect("lookup")
            .is_some(),
        "replicas still on the Redis-only build must see new registrations"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_binding_only_in_redis_is_found_and_copied(pool: PgPool) {
    let (store, legacy_clients, _) = cutover(pool.clone());
    legacy_clients
        .bind("pre-cutover-digest", &binding("client", "grant"))
        .await
        .expect("legacy bind");

    assert_eq!(
        store.binding("pre-cutover-digest").await.expect("lookup"),
        Some(binding("client", "grant"))
    );
    assert_eq!(
        postgres(pool)
            .binding("pre-cutover-digest")
            .await
            .expect("lookup"),
        Some(binding("client", "grant"))
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_unbound_digest_stays_unbound_in_both_stores(pool: PgPool) {
    let (store, legacy_clients, _) = cutover(pool);
    store
        .bind("digest", &binding("client", "grant"))
        .await
        .expect("bind");
    assert!(
        legacy_clients
            .binding("digest")
            .await
            .expect("lookup")
            .is_some(),
        "a binding is mirrored to Redis"
    );

    store.unbind("digest").await.expect("unbind");

    assert!(store.binding("digest").await.expect("lookup").is_none());
    assert!(
        legacy_clients
            .binding("digest")
            .await
            .expect("lookup")
            .is_none()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_revocation_is_written_to_both_stores(pool: PgPool) {
    let (store, legacy_clients, _) = cutover(pool.clone());

    store.revoke_grant("grant").await.expect("revoke");

    assert!(
        postgres(pool)
            .is_grant_revoked("grant")
            .await
            .expect("lookup")
    );
    assert!(
        legacy_clients
            .is_grant_revoked("grant")
            .await
            .expect("lookup"),
        "replicas still on the Redis-only build must refuse the family too"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_revocation_only_in_redis_is_honored_and_copied(pool: PgPool) {
    let (store, legacy_clients, _) = cutover(pool.clone());
    legacy_clients
        .revoke_grant("pre-cutover-grant")
        .await
        .expect("legacy revoke");

    assert!(
        store
            .is_grant_revoked("pre-cutover-grant")
            .await
            .expect("lookup")
    );
    assert!(
        postgres(pool)
            .is_grant_revoked("pre-cutover-grant")
            .await
            .expect("lookup"),
        "the fallback should copy into Postgres"
    );
    assert!(!store.is_grant_revoked("other").await.expect("lookup"));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn issued_codes_are_never_written_to_redis(pool: PgPool) {
    let (store, _, legacy_inflight) = cutover(pool);

    store
        .insert_issued("broker-code", issued_code("client"))
        .await
        .expect("insert");

    assert!(!legacy_inflight.holds_issued_code("broker-code"));
    assert!(
        store
            .take_issued("broker-code")
            .await
            .expect("take")
            .is_some()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_code_issued_before_the_cutover_redeems_once(pool: PgPool) {
    let (store, _, legacy_inflight) = cutover(pool);
    legacy_inflight
        .insert_issued("pre-cutover-code", issued_code("client"))
        .await
        .expect("legacy insert");

    let issued = store
        .take_issued("pre-cutover-code")
        .await
        .expect("take")
        .expect("legacy code");
    assert_eq!(issued.client_id, "client");
    assert!(
        store
            .take_issued("pre-cutover-code")
            .await
            .expect("take")
            .is_none()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_failing_redis_does_not_fail_requests(pool: PgPool) {
    let store: Store<BrokenLegacy, BrokenLegacy> = RedisCutoverAuthStore::new(
        postgres(pool),
        Arc::new(BrokenLegacy),
        Arc::new(BrokenLegacy),
    );

    store
        .insert_client(&registered_client("client"))
        .await
        .expect("registration succeeds without Redis");
    assert!(store.find_client("client").await.expect("lookup").is_some());
    assert!(
        store
            .find_client("unknown")
            .await
            .expect("lookup")
            .is_none()
    );

    store
        .bind("digest", &binding("client", "grant"))
        .await
        .expect("bind");
    assert!(store.binding("other").await.expect("lookup").is_none());
    store.revoke_grant("grant").await.expect("revoke");
    assert!(!store.is_grant_revoked("other").await.expect("lookup"));
    store.unbind("digest").await.expect("unbind");

    assert!(store.take_pending("session").await.expect("take").is_none());
    assert!(store.take_issued("code").await.expect("take").is_none());
}
