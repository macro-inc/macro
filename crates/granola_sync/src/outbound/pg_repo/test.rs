use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;

fn connection() -> Connection {
    Connection {
        id: macro_uuid::generate_uuid_v7(),
        namespace: macro_uuid::generate_uuid_v7(),
        user_id: MacroUserIdStr::parse_from_str("macro|granola-a@test.com")
            .unwrap()
            .into_owned(),
        scope: Scope::Personal,
        enabled: false,
        endpoint_id: None,
        secret: None,
        started_at: chrono::Utc::now(),
        last_synced_at: None,
        last_error: None,
    }
}
fn event() -> Event {
    Event {
        event_id: macro_uuid::generate_uuid_v7(),
        event_type: EventType::Generated,
        note_id: NoteId("not_123456789abcde".into()),
        occurred_at: chrono::Utc::now(),
    }
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("users"))
)]
async fn durable_deduplication_leases_and_stop(pool: PgPool) {
    let repo = PgSyncRepository::new(pool.clone(), &[7; 32]);
    let connection = connection();
    assert!(repo.reserve(&connection).await.unwrap());
    assert!(!repo.reserve(&connection).await.unwrap());
    assert!(
        repo.activate(
            connection.id,
            Webhook {
                id: "whe_test".into(),
                secret: SigningSecret("secret".into())
            },
            Scope::All,
        )
        .await
        .unwrap()
    );
    assert_eq!(
        repo.by_id(connection.id)
            .await
            .unwrap()
            .unwrap()
            .secret
            .unwrap()
            .0,
        "secret"
    );
    let event = event();
    repo.enqueue(connection.id, event.clone()).await.unwrap();
    repo.enqueue(connection.id, event.clone()).await.unwrap();
    let job = repo.claim().await.unwrap().unwrap();
    assert!(repo.claim().await.unwrap().is_none());
    repo.finish(&job, false).await.unwrap();
    assert!(repo.claim().await.unwrap().is_none());
    sqlx::query!(
        "UPDATE granola_sync_events SET available_at = now() WHERE connection_id = $1",
        connection.id
    )
    .execute(&pool)
    .await
    .unwrap();
    let retry = repo.claim().await.unwrap().unwrap();
    assert_ne!(job.lease_id, retry.lease_id);
    repo.finish(&job, true).await.unwrap(); // expired worker cannot complete a newer lease
    let state = sqlx::query!(
        "SELECT completed_at FROM granola_sync_events WHERE connection_id = $1",
        connection.id
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(state.completed_at.is_none());
    repo.finish(&retry, true).await.unwrap();
    repo.enqueue(connection.id, event).await.unwrap();
    assert!(repo.claim().await.unwrap().is_none());
    repo.enqueue(connection.id, super::test::event())
        .await
        .unwrap();
    repo.stop(connection.id).await.unwrap();
    assert!(repo.claim().await.unwrap().is_none());
}

#[tokio::test]
async fn encryption_is_bound_to_the_connection() {
    // No database I/O: a lazy pool suffices for the cipher round trip.
    let pool = sqlx::postgres::PgPoolOptions::new()
        .connect_lazy("postgres://localhost/test")
        .unwrap();
    let repo = PgSyncRepository::new(pool, &[7; 32]);
    let id = macro_uuid::generate_uuid_v7();
    let encrypted = repo.encrypt(id, SigningSecret("secret".into())).unwrap();
    assert!(
        repo.decrypt(macro_uuid::generate_uuid_v7(), encrypted)
            .is_err()
    );
}

use crate::domain::service::{Service, SyncService};
use crate::outbound::{accounts::ConnectedAccounts, api::GranolaApi};
use call::domain::{
    imports::{CallImportService, ImportedCall, ImportedCallPreview, ImportedCallRecord},
    records::{CallEntityRecord, CallProvider},
};
use connectors::fake::{FakeConnection, FakeConnectors};
use connectors::{ConnectionManagementService, ConnectorId, ConnectorKey, Connectors};
use std::sync::Arc;

/// Granola's answer to every call: a webhook registered for a personal key.
const REGISTERED: &str = r#"{"id":"whe_test","signing_secret":"whsec_c2VjcmV0"}"#;

fn service(
    pool: PgPool,
    connectors: Arc<Connectors>,
) -> Service<
    PgSyncRepository,
    GranolaApi<Connectors>,
    ConnectedAccounts<Connectors>,
    crate::outbound::signature::StandardWebhooks,
> {
    Service {
        repo: PgSyncRepository::new(pool, &[7; 32]),
        granola: GranolaApi(connectors.clone()),
        accounts: ConnectedAccounts(connectors),
        verifier: crate::outbound::signature::StandardWebhooks,
        calls: Arc::new(Calls),
        public_url: "https://macro.test".into(),
    }
}

struct Calls;
#[async_trait]
impl CallImportService for Calls {
    async fn ingest(&self, _: ImportedCall) -> Result<Uuid> {
        panic!("webhook receipt must only enqueue")
    }
    async fn list(&self, _: &MacroUserIdStr<'static>) -> Result<Vec<ImportedCallPreview>> {
        Ok(vec![])
    }
    async fn list_source_records(
        &self,
        _: &MacroUserIdStr<'static>,
        _: CallProvider,
    ) -> Result<Vec<ImportedCallRecord>> {
        Ok(vec![])
    }
    async fn read(&self, _: &MacroUserIdStr<'static>, _: Uuid) -> Result<Option<CallEntityRecord>> {
        Ok(None)
    }
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("users"))
)]
async fn connecting_starts_sync_and_disconnecting_stops_it_without_leaking_deliveries(
    pool: PgPool,
) {
    use base64::Engine;
    use hmac::{Hmac, Mac};
    let user = connection().user_id;
    let fake = FakeConnectors::new().with_connection(
        &user,
        FakeConnection::app("granola").answering(http::StatusCode::OK, REGISTERED),
    );
    let connectors = Arc::new(fake.build());
    let service = service(pool, connectors.clone());
    // Connecting the account is enough; no user action starts sync.
    service.reconcile().await.unwrap();
    let connection = service.repo.by_user(&user).await.unwrap().unwrap();
    assert!(connection.enabled);
    assert_eq!(connection.scope, Scope::All);
    service.reconcile().await.unwrap();
    assert_eq!(
        service.repo.by_user(&user).await.unwrap().unwrap().id,
        connection.id,
        "an active sync is not re-registered"
    );
    let id = macro_uuid::generate_uuid_v7().to_string();
    let timestamp = chrono::Utc::now().timestamp().to_string();
    let body = serde_json::to_vec(&serde_json::json!({
        "event_id":id, "event_type":"note.generated", "note_id":"not_123456789abcde",
        "occurred_at": connection.started_at - chrono::Duration::seconds(30)
    }))
    .unwrap();
    let mut mac = <Hmac<sha2::Sha256> as Mac>::new_from_slice(b"secret").unwrap();
    mac.update(format!("{id}.{timestamp}.").as_bytes());
    mac.update(&body);
    let signature = format!(
        "v1,{}",
        base64::engine::general_purpose::STANDARD.encode(mac.finalize().into_bytes())
    );
    let delivery = || Delivery {
        id: &id,
        timestamp: &timestamp,
        signature: &signature,
        body: &body,
    };
    let calls_before = fake.api_calls().len();
    service.receive(connection.id, delivery()).await.unwrap();
    assert_eq!(
        fake.api_calls().len(),
        calls_before,
        "webhook receipt must only enqueue, never fetch provider content"
    );
    let job = service.repo.claim().await.unwrap().unwrap();
    assert_eq!(job.event.event_id.to_string(), id); // accepted despite provider clock skew
    service.repo.finish(&job, true).await.unwrap();
    let invalid = Delivery {
        signature: "v1,invalid",
        ..delivery()
    };
    assert!(matches!(
        service.receive(connection.id, invalid).await,
        Err(SyncError::InvalidDelivery)
    ));
    // Disconnecting stops sync; reconnecting restarts it with the same namespace.
    let granola = ConnectorKey::App(ConnectorId::parse("granola").unwrap());
    connectors
        .set_enabled(&user, &granola, false)
        .await
        .unwrap();
    service.reconcile().await.unwrap();
    assert!(!service.repo.by_user(&user).await.unwrap().unwrap().enabled);
    connectors.set_enabled(&user, &granola, true).await.unwrap();
    service.reconcile().await.unwrap();
    let renewed = service.repo.by_user(&user).await.unwrap().unwrap();
    assert!(renewed.enabled);
    assert_ne!(renewed.id, connection.id);
    assert_eq!(renewed.namespace, connection.namespace);
    assert!(matches!(
        service.receive(connection.id, delivery()).await,
        Err(SyncError::InvalidDelivery)
    ));
}

/// Macro Connect holds Granola as tools only, so a user on it gets no sync:
/// reconciling registers nothing and calls nothing.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("users"))
)]
async fn users_on_macro_connect_get_no_granola_sync(pool: PgPool) {
    let user = connection().user_id;
    let fake = FakeConnectors::new()
        .with_connect_app("granola", false)
        .with_macro_connect_enabled(&user)
        .with_connection(&user, FakeConnection::app("granola"));
    let service = service(pool, Arc::new(fake.build()));

    service.reconcile().await.unwrap();

    assert!(service.repo.by_user(&user).await.unwrap().is_none());
    assert!(fake.api_calls().is_empty());
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("users"))
)]
async fn backfill_pages_are_leased_resumed_and_restarted_on_connect(pool: PgPool) {
    let repo = PgSyncRepository::new(pool.clone(), &[7; 32]);
    let webhook = || Webhook {
        id: "whe_test".into(),
        secret: SigningSecret("secret".into()),
    };
    let connection = connection();
    assert!(repo.reserve(&connection).await.unwrap());
    // A reservation still being set up has nothing to backfill yet.
    assert!(repo.claim_backfill().await.unwrap().is_none());
    assert!(
        repo.activate(connection.id, webhook(), Scope::All)
            .await
            .unwrap()
    );

    let first = repo.claim_backfill().await.unwrap().unwrap();
    assert_eq!(first.connection.id, connection.id);
    assert_eq!(first.cursor, None);
    assert_eq!(first.attempts, 1);
    assert!(repo.claim_backfill().await.unwrap().is_none());

    repo.finish_backfill(&first, BackfillStep::Next("page-2".into()))
        .await
        .unwrap();
    let second = repo.claim_backfill().await.unwrap().unwrap();
    assert_eq!(second.cursor.as_deref(), Some("page-2"));
    assert_eq!(second.attempts, 1);

    // An expired worker's lease cannot move the backfill.
    repo.finish_backfill(&first, BackfillStep::Done)
        .await
        .unwrap();
    repo.finish_backfill(&second, BackfillStep::Retry)
        .await
        .unwrap();
    // A failed page waits out its backoff before it is retried.
    assert!(repo.claim_backfill().await.unwrap().is_none());
    sqlx::query!(
        "UPDATE granola_sync_connections SET backfill_available_at = now() WHERE id = $1",
        connection.id
    )
    .execute(&pool)
    .await
    .unwrap();
    let retry = repo.claim_backfill().await.unwrap().unwrap();
    assert_eq!(retry.cursor.as_deref(), Some("page-2"));
    assert_eq!(retry.attempts, 2);

    // A throttled page waits briefly and does not spend its attempt.
    repo.finish_backfill(&retry, BackfillStep::Throttled)
        .await
        .unwrap();
    assert!(repo.claim_backfill().await.unwrap().is_none());
    sqlx::query!(
        "UPDATE granola_sync_connections SET backfill_available_at = now() WHERE id = $1",
        connection.id
    )
    .execute(&pool)
    .await
    .unwrap();
    let retry = repo.claim_backfill().await.unwrap().unwrap();
    assert_eq!(retry.cursor.as_deref(), Some("page-2"));
    assert_eq!(retry.attempts, 2);

    repo.finish_backfill(&retry, BackfillStep::Done)
        .await
        .unwrap();
    assert!(repo.claim_backfill().await.unwrap().is_none());

    // Connecting Granola again starts history over on the new connection.
    let reconnected = Connection {
        id: macro_uuid::generate_uuid_v7(),
        ..connection.clone()
    };
    assert!(repo.reserve(&reconnected).await.unwrap());
    assert!(
        repo.activate(reconnected.id, webhook(), Scope::All)
            .await
            .unwrap()
    );
    let restarted = repo.claim_backfill().await.unwrap().unwrap();
    assert_eq!(restarted.connection.id, reconnected.id);
    assert_eq!(restarted.cursor, None);
    assert_eq!(restarted.attempts, 1);

    // A stopped sync is not backfilled.
    repo.finish_backfill(&restarted, BackfillStep::Retry)
        .await
        .unwrap();
    repo.stop(reconnected.id).await.unwrap();
    sqlx::query!(
        "UPDATE granola_sync_connections SET backfill_available_at = now() WHERE id = $1",
        reconnected.id
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(repo.claim_backfill().await.unwrap().is_none());
}
