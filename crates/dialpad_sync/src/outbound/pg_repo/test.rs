use super::*;
use crate::{
    domain::{
        ports::{Dialpad, Grants},
        service::{Service, SyncService},
    },
    outbound::jwt::JwtVerifier,
};
use call::domain::{
    imports::{CallImportService, ImportedCall, ImportedCallPreview},
    records::CallEntityRecord,
};
use jsonwebtoken::{Algorithm, EncodingKey, Header};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use serde_json::json;
use std::{
    collections::VecDeque,
    sync::{Arc, Mutex},
};
use zeroize::Zeroizing;

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|dialpad-a@example.com")
        .unwrap()
        .into_owned()
}

#[derive(Clone, Copy, PartialEq)]
enum GrantState {
    Active,
    NotConnected,
}

struct FakeGrants {
    state: Mutex<GrantState>,
    disconnected: Mutex<bool>,
}

impl FakeGrants {
    fn new(state: GrantState) -> Self {
        Self {
            state: Mutex::new(state),
            disconnected: Mutex::new(false),
        }
    }
    fn set(&self, state: GrantState) {
        *self.state.lock().unwrap() = state;
    }
}

#[async_trait]
impl Grants for FakeGrants {
    async fn grant(&self, _: &MacroUserIdStr<'static>) -> Result<Grant> {
        Ok(match *self.state.lock().unwrap() {
            GrantState::Active => Grant::Active(AccessToken(Zeroizing::new("token".into()))),
            GrantState::NotConnected => Grant::NotConnected,
        })
    }
    async fn connect_url(&self, _: &MacroUserIdStr<'static>, redirect: &str) -> Result<String> {
        Ok(format!("https://connect.test/session?return={redirect}"))
    }
    async fn disconnect(&self, _: &MacroUserIdStr<'static>) -> Result<()> {
        *self.disconnected.lock().unwrap() = true;
        Ok(())
    }
}

#[derive(Default)]
struct FakeDialpad {
    webhooks: Mutex<Vec<(String, String)>>,
    deleted_webhooks: Mutex<Vec<DialpadId>>,
    unregistered: Mutex<Vec<Registration>>,
    fail_subscribe: Mutex<bool>,
    pages: Mutex<VecDeque<CallPage>>,
    listed_since: Mutex<Option<DateTime<Utc>>>,
}

impl FakeDialpad {
    fn secret(&self) -> String {
        self.webhooks.lock().unwrap().last().unwrap().1.clone()
    }
}

#[async_trait]
impl Dialpad for FakeDialpad {
    async fn me(&self, _: &AccessToken) -> Result<DialpadId> {
        Ok(DialpadId(22))
    }
    async fn create_webhook(
        &self,
        _: &AccessToken,
        url: &str,
        secret: &SigningSecret,
    ) -> Result<DialpadId> {
        self.webhooks
            .lock()
            .unwrap()
            .push((url.to_owned(), secret.0.clone()));
        Ok(DialpadId(11))
    }
    async fn subscribe(&self, _: &AccessToken, _: DialpadId, _: DialpadId) -> Result<DialpadId> {
        if *self.fail_subscribe.lock().unwrap() {
            return Err(rootcause::report!("Dialpad requires a company admin"));
        }
        Ok(DialpadId(33))
    }
    async fn unregister(&self, _: &AccessToken, registration: Registration) -> Result<()> {
        self.unregistered.lock().unwrap().push(registration);
        Ok(())
    }
    async fn delete_webhook(&self, _: &AccessToken, webhook: DialpadId) -> Result<()> {
        self.deleted_webhooks.lock().unwrap().push(webhook);
        Ok(())
    }
    async fn transcript(
        &self,
        _: &AccessToken,
        _: DialpadId,
    ) -> Result<Option<Vec<TranscriptLine>>> {
        Ok(Some(vec![serde_json::from_value(json!({
            "type": "transcript", "name": "Jane Doe",
            "time": "2025-05-05T18:16:50.000", "content": "Can you send a quote?"
        }))?]))
    }
    async fn recap(&self, _: &AccessToken, _: DialpadId) -> Result<Option<Recap>> {
        Ok(Some(Recap {
            summary: Some("Past call recap.".into()),
            action_items: vec![],
        }))
    }
    async fn calls(
        &self,
        _: &AccessToken,
        _: DialpadId,
        since: DateTime<Utc>,
        _: Option<&str>,
    ) -> Result<CallPage> {
        *self.listed_since.lock().unwrap() = Some(since);
        Ok(self.pages.lock().unwrap().pop_front().unwrap_or(CallPage {
            calls: vec![],
            cursor: None,
        }))
    }
}

/// What each import carried: title, summary, transcript length.
#[derive(Default)]
struct Calls(Mutex<Vec<(String, Option<String>, usize)>>);

#[async_trait]
impl CallImportService for Calls {
    async fn ingest(&self, call: ImportedCall) -> Result<Uuid> {
        assert_eq!(
            call.source.provider,
            call::domain::records::CallProvider::Dialpad
        );
        self.0.lock().unwrap().push((
            call.source.external_id.0,
            call.source.metadata["summary"].as_str().map(str::to_owned),
            call.transcript
                .map_or(0, |transcript| transcript.segments.len()),
        ));
        Ok(macro_uuid::generate_uuid_v7())
    }
    async fn list(&self, _: &MacroUserIdStr<'static>) -> Result<Vec<ImportedCallPreview>> {
        Ok(vec![])
    }
    async fn read(&self, _: &MacroUserIdStr<'static>, _: Uuid) -> Result<Option<CallEntityRecord>> {
        Ok(None)
    }
}

type TestService = Service<PgSyncRepository, FakeGrants, FakeDialpad, JwtVerifier>;

fn service(pool: PgPool, grant: GrantState, calls: Arc<Calls>) -> TestService {
    Service {
        repo: PgSyncRepository::new(pool, &[7; 32]),
        grants: FakeGrants::new(grant),
        dialpad: FakeDialpad::default(),
        verifier: JwtVerifier,
        calls,
        public_url: "https://macro.test".into(),
        return_url: "https://app.test/app/settings/connections".into(),
    }
}

fn call_event(call_id: i64, state: &str, timestamp: i64) -> serde_json::Value {
    json!({
        "call_id": call_id, "state": state, "event_timestamp": timestamp,
        "date_started": 1_746_469_000_000_i64, "date_connected": 1_746_469_010_000_i64,
        "date_ended": 1_746_469_070_000_i64, "external_number": "+1604311",
        "contact": {"name": "Jane Doe", "phone": "+1604311"},
        "target": {"id": 22, "name": "Sam Rep", "email": "dialpad-a@example.com"},
    })
}

fn signed(secret: &str, mut event: serde_json::Value, extra: serde_json::Value) -> Vec<u8> {
    if let serde_json::Value::Object(extra) = extra {
        event.as_object_mut().unwrap().extend(extra);
    }
    jsonwebtoken::encode(
        &Header::new(Algorithm::HS256),
        &event,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .unwrap()
    .into_bytes()
}

async fn drain(service: &TestService) {
    while service.tick().await.unwrap() {}
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("users"))
)]
async fn a_connected_user_s_calls_import_from_signed_deliveries_until_disconnect(pool: PgPool) {
    let calls = Arc::new(Calls::default());
    let service = service(pool, GrantState::NotConnected, calls.clone());
    assert_eq!(
        service.status(&user()).await.unwrap(),
        SyncStatus::NotConnected
    );

    let url = service.connect(&user(), Backfill::None).await.unwrap();
    assert_eq!(
        url,
        "https://connect.test/session?return=https://app.test/app/settings/connections"
    );
    // Until the user approves Dialpad in Macro Connect, nothing is set up.
    service.reconcile().await.unwrap();
    assert_eq!(
        service.status(&user()).await.unwrap(),
        SyncStatus::Connecting
    );
    assert!(service.dialpad.webhooks.lock().unwrap().is_empty());

    service.grants.set(GrantState::Active);
    let status = service.complete(&user()).await.unwrap();
    assert!(matches!(status, SyncStatus::Connected { issue: None, .. }));
    let connection = service.repo.by_user(&user()).await.unwrap().unwrap();
    assert_eq!(connection.dialpad_user_id, Some(DialpadId(22)));
    assert_eq!(
        connection.registration,
        Some(Registration {
            webhook_id: DialpadId(11),
            subscription_id: DialpadId(33)
        })
    );
    assert_eq!(
        service.dialpad.webhooks.lock().unwrap()[0].0,
        format!(
            "https://macro.test/integrations/dialpad/webhooks/{}",
            connection.id
        )
    );
    service.reconcile().await.unwrap();
    assert_eq!(
        service.dialpad.webhooks.lock().unwrap().len(),
        1,
        "a running sync is not registered again"
    );

    // Out of order, with a redelivery: the call is rebuilt from all of them.
    let secret = service.dialpad.secret();
    let transcript = signed(&secret, call_event(9, "call_transcription", 3), json!({}));
    let hangup = signed(&secret, call_event(9, "hangup", 2), json!({}));
    let recap = signed(
        &secret,
        call_event(9, "recap_summary", 4),
        json!({"recap_summary": "Jane wants a quote."}),
    );
    for body in [&transcript, &hangup, &hangup, &recap] {
        service.receive(connection.id, body).await.unwrap();
    }
    let forged = signed("not-our-secret", call_event(9, "hangup", 5), json!({}));
    assert!(matches!(
        service.receive(connection.id, &forged).await,
        Err(SyncError::InvalidDelivery)
    ));
    assert!(matches!(
        service.receive(Uuid::from_u128(9), &hangup).await,
        Err(SyncError::InvalidDelivery)
    ));
    drain(&service).await;
    let imports = calls.0.lock().unwrap().clone();
    assert_eq!(
        imports.len(),
        1,
        "one import covers the call's pending events"
    );
    assert_eq!(
        imports.last().unwrap(),
        &("9".to_owned(), Some("Jane wants a quote.".to_owned()), 1)
    );
    assert!(matches!(
        service.status(&user()).await.unwrap(),
        SyncStatus::Connected {
            last_synced_at: Some(_),
            issue: None
        }
    ));

    service.disconnect(&user()).await.unwrap();
    assert!(*service.grants.disconnected.lock().unwrap());
    assert_eq!(
        service.dialpad.unregistered.lock().unwrap().as_slice(),
        &[connection.registration.unwrap()]
    );
    assert_eq!(
        service.status(&user()).await.unwrap(),
        SyncStatus::NotConnected
    );

    // Reconnecting keeps the import namespace, so past calls never duplicate.
    service.connect(&user(), Backfill::Week).await.unwrap();
    service.complete(&user()).await.unwrap();
    let reconnected = service.repo.by_user(&user()).await.unwrap().unwrap();
    assert!(reconnected.enabled);
    assert_eq!(reconnected.id, connection.id);
    assert_eq!(reconnected.namespace, connection.namespace);
    assert!(matches!(
        reconnected.backfill,
        BackfillState::Pending { .. }
    ));
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("users"))
)]
async fn a_removed_connect_grant_stops_sync_and_drops_pending_deliveries(pool: PgPool) {
    let calls = Arc::new(Calls::default());
    let service = service(pool, GrantState::Active, calls.clone());
    service.connect(&user(), Backfill::None).await.unwrap();
    service.complete(&user()).await.unwrap();
    let connection = service.repo.by_user(&user()).await.unwrap().unwrap();
    let secret = service.dialpad.secret();
    service
        .receive(
            connection.id,
            &signed(&secret, call_event(9, "hangup", 2), json!({})),
        )
        .await
        .unwrap();

    service.grants.set(GrantState::NotConnected);
    drain(&service).await;
    assert!(calls.0.lock().unwrap().is_empty());
    assert_eq!(
        service.status(&user()).await.unwrap(),
        SyncStatus::Failed {
            issue: SyncIssue::Stopped
        }
    );
    assert!(service.repo.claim().await.unwrap().is_none());
    // Dialpad may keep delivering to a stopped sync; nothing piles up.
    service
        .receive(
            connection.id,
            &signed(&secret, call_event(11, "hangup", 3), json!({})),
        )
        .await
        .unwrap();
    let stored = sqlx::query_scalar!(
        r#"SELECT count(*) AS "count!" FROM dialpad_sync_events WHERE call_id = 11"#
    )
    .fetch_one(&service.repo.pool)
    .await
    .unwrap();
    assert_eq!(stored, 0);

    // Reconnecting restarts sync under a new secret and the same import namespace.
    service.grants.set(GrantState::Active);
    service.connect(&user(), Backfill::None).await.unwrap();
    service.complete(&user()).await.unwrap();
    let renewed = service.repo.by_user(&user()).await.unwrap().unwrap();
    assert!(renewed.enabled);
    assert_eq!(renewed.namespace, connection.namespace);
    assert_eq!(
        service.dialpad.unregistered.lock().unwrap().as_slice(),
        &[connection.registration.unwrap()],
        "the stopped sync's subscription is removed before a new one"
    );
    let stale = signed(&secret, call_event(10, "hangup", 2), json!({}));
    assert!(matches!(
        service.receive(renewed.id, &stale).await,
        Err(SyncError::InvalidDelivery)
    ));
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("users"))
)]
async fn a_failed_subscription_cleans_up_and_waits_before_retrying(pool: PgPool) {
    let service = service(pool, GrantState::Active, Arc::new(Calls::default()));
    *service.dialpad.fail_subscribe.lock().unwrap() = true;
    service.connect(&user(), Backfill::None).await.unwrap();
    assert!(service.complete(&user()).await.is_err());
    assert_eq!(
        service.status(&user()).await.unwrap(),
        SyncStatus::Failed {
            issue: SyncIssue::SetupFailed
        }
    );
    assert_eq!(
        service.dialpad.deleted_webhooks.lock().unwrap().as_slice(),
        &[DialpadId(11)]
    );
    service.reconcile().await.unwrap();
    assert_eq!(service.dialpad.webhooks.lock().unwrap().len(), 1);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("users"))
)]
async fn first_connect_imports_past_calls_a_page_at_a_time(pool: PgPool) {
    let calls = Arc::new(Calls::default());
    let service = service(pool, GrantState::Active, calls.clone());
    let call = |id: i64, connected: bool| -> CallEvent {
        let mut event = call_event(id, "hangup", 0);
        event["event_timestamp"] = json!(null);
        if !connected {
            event["date_connected"] = json!(null);
        }
        serde_json::from_value(event).unwrap()
    };
    service.dialpad.pages.lock().unwrap().extend([
        CallPage {
            calls: vec![call(1, true), call(2, false)],
            cursor: Some("next".into()),
        },
        CallPage {
            calls: vec![call(3, true)],
            cursor: None,
        },
    ]);
    let before = Utc::now();
    service.connect(&user(), Backfill::Week).await.unwrap();
    service.complete(&user()).await.unwrap();

    service.reconcile().await.unwrap();
    let since = service.dialpad.listed_since.lock().unwrap().unwrap();
    assert!(since <= before - chrono::Duration::days(7) + chrono::Duration::minutes(1));
    let connection = service.repo.by_user(&user()).await.unwrap().unwrap();
    assert!(matches!(
        connection.backfill,
        BackfillState::Pending { cursor: Some(ref cursor), .. } if cursor == "next"
    ));
    service.reconcile().await.unwrap();
    let connection = service.repo.by_user(&user()).await.unwrap().unwrap();
    assert_eq!(connection.backfill, BackfillState::Done);

    drain(&service).await;
    let mut imports = calls.0.lock().unwrap().clone();
    imports.sort();
    assert_eq!(
        imports,
        vec![
            ("1".to_owned(), Some("Past call recap.".to_owned()), 1),
            ("3".to_owned(), Some("Past call recap.".to_owned()), 1),
        ],
        "an unanswered past call is not imported"
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("users"))
)]
async fn an_enrollment_never_finished_in_connect_is_dropped(pool: PgPool) {
    let service = service(
        pool.clone(),
        GrantState::NotConnected,
        Arc::new(Calls::default()),
    );
    service.connect(&user(), Backfill::None).await.unwrap();
    sqlx::query!("UPDATE dialpad_sync_connections SET enrolled_at = now() - interval '2 hours'")
        .execute(&pool)
        .await
        .unwrap();
    service.reconcile().await.unwrap();
    assert_eq!(
        service.status(&user()).await.unwrap(),
        SyncStatus::NotConnected
    );
}
