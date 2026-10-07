use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;

fn connection() -> Connection {
    Connection {
        id: macro_uuid::generate_uuid_v7(),
        namespace: macro_uuid::generate_uuid_v7(),
        user_id: MacroUserIdStr::parse_from_str("macro|granola-a@test.com")
            .unwrap()
            .into_owned(),
        account_id: "apn_test".into(),
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
        note_id: "not_123456789abcde".to_owned().try_into().unwrap(),
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
            }
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

use crate::domain::{
    ports::{Accounts, Granola},
    service::{Service, SyncService},
};
use call::domain::{
    imports::{CallImportService, ImportedCall, ImportedCallPreview},
    records::CallEntityRecord,
};
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

struct Account(Arc<AtomicBool>);
#[async_trait]
impl Accounts for Account {
    async fn account(&self, _: &MacroUserIdStr<'static>) -> Result<Option<String>> {
        Ok(self.0.load(Ordering::SeqCst).then(|| "apn_test".into()))
    }
}
struct Provider;
#[async_trait]
impl Granola for Provider {
    async fn register(&self, _: &Connection, _: &str) -> Result<Webhook> {
        Ok(Webhook {
            id: "whe_test".into(),
            secret: SigningSecret("whsec_c2VjcmV0".into()),
        })
    }
    async fn unregister(&self, _: &Connection) -> Result<()> {
        Ok(())
    }
    async fn meeting(&self, _: &Connection, _: &NoteId) -> Result<Option<ImportedCall>> {
        panic!("webhook receipt must not fetch provider content")
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
    async fn read(&self, _: &MacroUserIdStr<'static>, _: Uuid) -> Result<Option<CallEntityRecord>> {
        Ok(None)
    }
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("users"))
)]
async fn registration_races_clock_skew_and_disconnect_do_not_lose_or_leak_deliveries(pool: PgPool) {
    use base64::Engine;
    use hmac::{Hmac, Mac};
    let enabled = Arc::new(AtomicBool::new(true));
    let service = Service {
        repo: PgSyncRepository::new(pool, &[7; 32]),
        granola: Provider,
        accounts: Account(enabled.clone()),
        verifier: crate::outbound::signature::StandardWebhooks,
        calls: Arc::new(Calls),
        public_url: "https://macro.test".into(),
    };
    let connection = connection();
    service.repo.reserve(&connection).await.unwrap();
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
    assert!(matches!(
        service.receive(connection.id, delivery()).await,
        Err(SyncError::Unavailable)
    ));
    service
        .repo
        .activate(
            connection.id,
            service
                .granola
                .register(&connection, "https://macro.test")
                .await
                .unwrap(),
        )
        .await
        .unwrap();
    service.receive(connection.id, delivery()).await.unwrap();
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
    enabled.store(false, Ordering::SeqCst);
    assert!(
        !service
            .status(connection.user_id.clone())
            .await
            .unwrap()
            .enabled
    );
    assert!(matches!(
        service
            .start(connection.user_id.clone(), Scope::Personal)
            .await,
        Err(SyncError::NotConnected)
    ));
    service.stop(connection.user_id.clone()).await.unwrap();
    enabled.store(true, Ordering::SeqCst);
    service
        .start(connection.user_id.clone(), Scope::All)
        .await
        .unwrap();
    let renewed = service
        .repo
        .by_user(&connection.user_id)
        .await
        .unwrap()
        .unwrap();
    assert_ne!(renewed.id, connection.id);
    assert_eq!(renewed.namespace, connection.namespace);
    assert!(matches!(
        service.receive(connection.id, delivery()).await,
        Err(SyncError::InvalidDelivery)
    ));
}
