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

fn other_user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|dialpad-b@example.com")
        .unwrap()
        .into_owned()
}

#[derive(Clone, Copy, PartialEq)]
enum GrantState {
    Active,
    NotConnected,
    NeedsReauth,
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
            GrantState::NeedsReauth => Grant::NeedsReauth,
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
    fail_unregister: Mutex<bool>,
    close_after_subscribe: Mutex<Option<PgPool>>,
    pages: Mutex<VecDeque<CallPage>>,
    listed_since: Mutex<Option<DateTime<Utc>>>,
    transcript_pause: Mutex<Option<(Arc<tokio::sync::Notify>, Arc<tokio::sync::Notify>)>>,
    /// Transcript fetches fail: `true` as an auth error, `false` as an outage.
    transcript_fails: Mutex<Option<bool>>,
    /// Calls whose recap fetch fails.
    failing_calls: Mutex<Vec<DialpadId>>,
    fail_listing: Mutex<bool>,
    listings: Mutex<usize>,
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
        let pool = self.close_after_subscribe.lock().unwrap().take();
        if let Some(pool) = pool {
            pool.close().await;
        }
        Ok(DialpadId(33))
    }
    async fn unregister(&self, _: &AccessToken, registration: Registration) -> Result<()> {
        self.unregistered.lock().unwrap().push(registration);
        if *self.fail_unregister.lock().unwrap() {
            return Err(rootcause::report!("Dialpad temporarily unavailable"));
        }
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
    ) -> std::result::Result<Option<Vec<TranscriptLine>>, TranscriptError> {
        let pause = self.transcript_pause.lock().unwrap().clone();
        if let Some((started, resume)) = pause {
            started.notify_one();
            resume.notified().await;
        }
        match *self.transcript_fails.lock().unwrap() {
            Some(true) => return Err(TranscriptError::Unauthorized),
            Some(false) => {
                return Err(TranscriptError::Unavailable(rootcause::report!(
                    "Dialpad API returned HTTP 429 Too Many Requests"
                )));
            }
            None => {}
        }
        Ok(Some(vec![
            serde_json::from_value(json!({
                "type": "transcript", "name": "Jane Doe",
                "time": "2025-05-05T18:16:50.000", "content": "Can you send a quote?"
            }))
            .unwrap(),
        ]))
    }
    async fn recap(&self, _: &AccessToken, call: DialpadId) -> Result<Option<Recap>> {
        if self.failing_calls.lock().unwrap().contains(&call) {
            return Err(rootcause::report!("Dialpad API returned HTTP 500"));
        }
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
        *self.listings.lock().unwrap() += 1;
        if *self.fail_listing.lock().unwrap() {
            return Err(rootcause::report!("Dialpad API returned HTTP 503"));
        }
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
async fn only_the_connected_dialpad_user_s_calls_import(pool: PgPool) {
    let calls = Arc::new(Calls::default());
    let service = service(pool, GrantState::Active, calls.clone());
    let mut someone_elses = call_event(2, "hangup", 0);
    someone_elses["target"] = json!({"id": 99, "name": "Another Rep"});
    service.dialpad.pages.lock().unwrap().push_back(CallPage {
        calls: vec![
            serde_json::from_value(call_event(1, "hangup", 0)).unwrap(),
            serde_json::from_value(someone_elses).unwrap(),
        ],
        cursor: None,
    });
    service.connect(&user(), Backfill::Week).await.unwrap();
    service.complete(&user()).await.unwrap();
    service.reconcile().await.unwrap();

    let connection = service.repo.by_user(&user()).await.unwrap().unwrap();
    let secret = service.dialpad.secret();
    for (call_id, target) in [
        (3, json!({"id": 99, "name": "Another Rep"})),
        (4, json!(null)),
        (5, json!({"name": "Sam Rep"})),
    ] {
        let body = signed(
            &secret,
            call_event(call_id, "hangup", 2),
            json!({ "target": target }),
        );
        service.receive(connection.id, &body).await.unwrap();
    }
    // Stored before setup read the Dialpad user; the import checks again.
    let mut early = call_event(6, "hangup", 2);
    early["target"] = json!({"id": 99});
    service
        .repo
        .enqueue(connection.id, serde_json::from_value(early).unwrap(), None)
        .await
        .unwrap();
    drain(&service).await;

    let imported: Vec<String> = calls
        .0
        .lock()
        .unwrap()
        .iter()
        .map(|(call_id, _, _)| call_id.clone())
        .collect();
    assert_eq!(imported, vec!["1".to_owned()]);
    let stored = sqlx::query_scalar!(
        r#"SELECT count(*) AS "count!" FROM dialpad_sync_events WHERE call_id IN (2, 3, 4, 5)"#
    )
    .fetch_one(&service.repo.pool)
    .await
    .unwrap();
    assert_eq!(stored, 0, "another user's call is never stored");
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

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("users"))
)]
async fn setup_finishes_only_under_the_lease_that_stored_the_secret(pool: PgPool) {
    let service = service(pool, GrantState::Active, Arc::new(Calls::default()));
    service.connect(&user(), Backfill::None).await.unwrap();
    let connection = service.repo.by_user(&user()).await.unwrap().unwrap();
    let id = connection.id;
    let secret = || SigningSecret("secret".into());
    let first = service
        .repo
        .begin_setup(&connection, &secret())
        .await
        .unwrap()
        .unwrap();
    // The first lease expires while its setup is still talking to Dialpad.
    sqlx::query!(
        "UPDATE dialpad_sync_connections SET setup_started_at = now() - interval '1 hour' WHERE id = $1",
        id
    )
    .execute(&service.repo.pool)
    .await
    .unwrap();
    let second = service
        .repo
        .begin_setup(&connection, &secret())
        .await
        .unwrap()
        .unwrap();
    let registration = Registration {
        webhook_id: DialpadId(1),
        subscription_id: DialpadId(2),
    };
    assert!(
        !service
            .repo
            .activate(id, first, DialpadId(3), registration)
            .await
            .unwrap()
    );
    let event = serde_json::from_value(call_event(9, "hangup", 2)).unwrap();
    service.repo.enqueue(id, event, None).await.unwrap();
    service.repo.failed_setup(id, first).await.unwrap();
    assert!(
        service
            .repo
            .by_id(id)
            .await
            .unwrap()
            .unwrap()
            .last_error
            .is_none()
    );
    assert_eq!(
        service.repo.events(id, DialpadId(9)).await.unwrap().len(),
        1
    );
    assert!(
        service
            .repo
            .activate(id, second, DialpadId(3), registration)
            .await
            .unwrap()
    );
    service.repo.failed_setup(id, first).await.unwrap();
    assert!(service.repo.by_id(id).await.unwrap().unwrap().enabled);
    assert_eq!(
        service.repo.events(id, DialpadId(9)).await.unwrap().len(),
        1
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("users"))
)]
async fn setup_failure_after_disconnect_cannot_restart_the_sync(pool: PgPool) {
    let service = service(pool, GrantState::Active, Arc::new(Calls::default()));
    service.connect(&user(), Backfill::None).await.unwrap();
    let connection = service.repo.by_user(&user()).await.unwrap().unwrap();
    let id = connection.id;
    let lease = service
        .repo
        .begin_setup(&connection, &SigningSecret("secret".into()))
        .await
        .unwrap()
        .unwrap();
    let connection = service.repo.by_id(id).await.unwrap().unwrap();
    service.repo.disconnect(&connection, false).await.unwrap();
    service.repo.failed_setup(id, lease).await.unwrap();
    assert_eq!(
        service.status(&user()).await.unwrap(),
        SyncStatus::NotConnected
    );
    assert!(service.repo.awaiting_setup(1).await.unwrap().is_empty());
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("users"))
)]
async fn stale_backfill_pages_cannot_queue_calls_or_replace_progress(pool: PgPool) {
    let service = service(pool, GrantState::Active, Arc::new(Calls::default()));
    service.connect(&user(), Backfill::Week).await.unwrap();
    service.complete(&user()).await.unwrap();
    let first = service.repo.by_user(&user()).await.unwrap().unwrap();
    service
        .repo
        .advance_backfill(&first, vec![], Some("next".into()))
        .await
        .unwrap();
    let next = service.repo.by_user(&user()).await.unwrap().unwrap();

    let late = serde_json::from_value(call_event(9, "backfill", 2)).unwrap();
    service
        .repo
        .advance_backfill(&first, vec![late], None)
        .await
        .unwrap();
    assert_eq!(
        service
            .repo
            .by_id(first.id)
            .await
            .unwrap()
            .unwrap()
            .backfill,
        next.backfill
    );
    assert!(
        service
            .repo
            .events(first.id, DialpadId(9))
            .await
            .unwrap()
            .is_empty()
    );

    service.disconnect(&user()).await.unwrap();
    let late = serde_json::from_value(call_event(10, "backfill", 2)).unwrap();
    service
        .repo
        .advance_backfill(&next, vec![late], None)
        .await
        .unwrap();
    assert!(
        service
            .repo
            .events(first.id, DialpadId(10))
            .await
            .unwrap()
            .is_empty()
    );

    service.connect(&user(), Backfill::Month).await.unwrap();
    service.complete(&user()).await.unwrap();
    let renewed = service.repo.by_user(&user()).await.unwrap().unwrap();
    let late = serde_json::from_value(call_event(11, "backfill", 2)).unwrap();
    service
        .repo
        .advance_backfill(&next, vec![late], None)
        .await
        .unwrap();
    assert_eq!(
        service
            .repo
            .by_id(first.id)
            .await
            .unwrap()
            .unwrap()
            .backfill,
        renewed.backfill
    );
    assert!(
        service
            .repo
            .events(first.id, DialpadId(11))
            .await
            .unwrap()
            .is_empty()
    );

    let current = serde_json::from_value(call_event(12, "backfill", 2)).unwrap();
    service
        .repo
        .advance_backfill(&renewed, vec![current], None)
        .await
        .unwrap();
    assert_eq!(
        service
            .repo
            .by_id(first.id)
            .await
            .unwrap()
            .unwrap()
            .backfill,
        BackfillState::Done
    );
    assert_eq!(
        service
            .repo
            .events(first.id, DialpadId(12))
            .await
            .unwrap()
            .len(),
        1
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("users"))
)]
async fn backfill_reports_a_lost_grant_without_waiting_for_a_delivery(pool: PgPool) {
    let service = service(pool, GrantState::Active, Arc::new(Calls::default()));
    service.connect(&user(), Backfill::Week).await.unwrap();
    service.complete(&user()).await.unwrap();
    service.grants.set(GrantState::NeedsReauth);
    service.reconcile().await.unwrap();
    assert!(matches!(
        service.status(&user()).await.unwrap(),
        SyncStatus::Connected {
            issue: Some(SyncIssue::NeedsReauth),
            ..
        }
    ));
    service.grants.set(GrantState::NotConnected);
    service.reconcile().await.unwrap();
    assert_eq!(
        service.status(&user()).await.unwrap(),
        SyncStatus::Failed {
            issue: SyncIssue::Stopped
        }
    );
    assert!(service.dialpad.listed_since.lock().unwrap().is_none());
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("users"))
)]
async fn a_refused_old_cleanup_does_not_block_reconnect(pool: PgPool) {
    let service = service(pool, GrantState::Active, Arc::new(Calls::default()));
    service.connect(&user(), Backfill::None).await.unwrap();
    service.complete(&user()).await.unwrap();
    let old = service.repo.by_user(&user()).await.unwrap().unwrap();
    *service.dialpad.fail_unregister.lock().unwrap() = true;
    service.disconnect(&user()).await.unwrap();
    service.connect(&user(), Backfill::None).await.unwrap();
    service.complete(&user()).await.unwrap();
    let current = service.repo.by_user(&user()).await.unwrap().unwrap();
    assert!(current.enabled);
    assert!(
        service
            .dialpad
            .unregistered
            .lock()
            .unwrap()
            .contains(&old.registration.unwrap())
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("users"))
)]
async fn late_events_wait_for_the_calls_active_import(pool: PgPool) {
    let service = service(pool, GrantState::Active, Arc::new(Calls::default()));
    service.connect(&user(), Backfill::None).await.unwrap();
    service.complete(&user()).await.unwrap();
    let id = service.repo.by_user(&user()).await.unwrap().unwrap().id;
    let first = serde_json::from_value(call_event(9, "call_transcription", 3)).unwrap();
    service.repo.enqueue(id, first, None).await.unwrap();
    let job = service.repo.claim().await.unwrap().unwrap();
    let late = serde_json::from_value(call_event(9, "recap_summary", 2)).unwrap();
    service.repo.enqueue(id, late, None).await.unwrap();
    assert!(service.repo.claim().await.unwrap().is_none());

    let other = serde_json::from_value(call_event(10, "hangup", 4)).unwrap();
    service.repo.enqueue(id, other, None).await.unwrap();
    let other_job = service.repo.claim().await.unwrap().unwrap();
    assert_eq!(other_job.call_id, DialpadId(10));
    service
        .repo
        .finish(&other_job, JobOutcome::Done)
        .await
        .unwrap();
    service.repo.finish(&job, JobOutcome::Done).await.unwrap();
    let late_job = service.repo.claim().await.unwrap().unwrap();
    assert_eq!(late_job.call_id, DialpadId(9));
    assert_eq!(
        service.repo.events(id, DialpadId(9)).await.unwrap().len(),
        2
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("users"))
)]
async fn stale_grant_checks_cannot_stop_a_new_setup_or_enrollment(pool: PgPool) {
    let service = service(pool, GrantState::Active, Arc::new(Calls::default()));
    service.connect(&user(), Backfill::None).await.unwrap();
    let abandoned = service.repo.by_user(&user()).await.unwrap().unwrap();
    service.repo.disconnect(&abandoned, false).await.unwrap();
    service
        .repo
        .stop(&abandoned, SyncIssue::NeedsReauth)
        .await
        .unwrap();
    assert_eq!(
        service.status(&user()).await.unwrap(),
        SyncStatus::NotConnected
    );
    service.connect(&user(), Backfill::None).await.unwrap();
    let waiting = service.repo.by_user(&user()).await.unwrap().unwrap();
    let lease = service
        .repo
        .begin_setup(&waiting, &SigningSecret("secret".into()))
        .await
        .unwrap()
        .unwrap();
    service
        .repo
        .stop(&waiting, SyncIssue::NeedsReauth)
        .await
        .unwrap();
    assert!(
        service
            .repo
            .by_id(waiting.id)
            .await
            .unwrap()
            .unwrap()
            .last_error
            .is_none()
    );
    service
        .repo
        .activate(
            waiting.id,
            lease,
            DialpadId(22),
            Registration {
                webhook_id: DialpadId(11),
                subscription_id: DialpadId(33),
            },
        )
        .await
        .unwrap();
    service
        .repo
        .stop(&waiting, SyncIssue::Disconnected)
        .await
        .unwrap();
    assert!(
        service
            .repo
            .by_id(waiting.id)
            .await
            .unwrap()
            .unwrap()
            .enabled
    );
    let running = service.repo.by_id(waiting.id).await.unwrap().unwrap();
    service.disconnect(&user()).await.unwrap();
    service.connect(&user(), Backfill::None).await.unwrap();
    assert!(
        service
            .repo
            .begin_setup(&running, &SigningSecret("stale".into()))
            .await
            .unwrap()
            .is_none()
    );
    service.complete(&user()).await.unwrap();
    service
        .repo
        .stop(&running, SyncIssue::Stopped)
        .await
        .unwrap();
    service
        .repo
        .flag(&running, SyncIssue::NeedsReauth)
        .await
        .unwrap();
    service.repo.disconnect(&running, true).await.unwrap();
    assert!(matches!(
        service.status(&user()).await.unwrap(),
        SyncStatus::Connected { issue: None, .. }
    ));
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("users"))
)]
async fn a_fetch_started_before_reconnect_cannot_import_after_it(pool: PgPool) {
    let calls = Arc::new(Calls::default());
    let service = Arc::new(service(pool, GrantState::Active, calls.clone()));
    service.connect(&user(), Backfill::None).await.unwrap();
    service.complete(&user()).await.unwrap();
    let connection = service.repo.by_user(&user()).await.unwrap().unwrap();
    let event = serde_json::from_value(call_event(9, "call_transcription", 3)).unwrap();
    service
        .repo
        .enqueue(connection.id, event, None)
        .await
        .unwrap();
    let started = Arc::new(tokio::sync::Notify::new());
    let resume = Arc::new(tokio::sync::Notify::new());
    *service.dialpad.transcript_pause.lock().unwrap() = Some((started.clone(), resume.clone()));
    let worker_service = service.clone();
    let worker = tokio::spawn(async move { worker_service.tick().await });
    started.notified().await;
    service.disconnect(&user()).await.unwrap();
    service.connect(&user(), Backfill::None).await.unwrap();
    service.complete(&user()).await.unwrap();
    resume.notify_one();
    worker.await.unwrap().unwrap();
    assert!(calls.0.lock().unwrap().is_empty());
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("users"))
)]
async fn an_activation_error_attempts_cleanup_and_preserves_the_cause(pool: PgPool) {
    let service = service(pool.clone(), GrantState::Active, Arc::new(Calls::default()));
    service.connect(&user(), Backfill::None).await.unwrap();
    *service.dialpad.close_after_subscribe.lock().unwrap() = Some(pool);
    *service.dialpad.fail_unregister.lock().unwrap() = true;
    let error = service.complete(&user()).await.unwrap_err();
    assert!(error.to_string().contains("closed pool"), "{error}");
    assert_eq!(
        service.dialpad.unregistered.lock().unwrap().as_slice(),
        &[Registration {
            webhook_id: DialpadId(11),
            subscription_id: DialpadId(33),
        }]
    );
}

fn issue(status: SyncStatus) -> Option<SyncIssue> {
    match status {
        SyncStatus::Connected { issue, .. } => issue,
        status => panic!("expected a running sync, got {status:?}"),
    }
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("users"))
)]
async fn a_failing_call_stays_visible_until_it_imports_or_gives_up(pool: PgPool) {
    let calls = Arc::new(Calls::default());
    let service = service(pool, GrantState::Active, calls.clone());
    service.connect(&user(), Backfill::None).await.unwrap();
    service.complete(&user()).await.unwrap();
    let id = service.repo.by_user(&user()).await.unwrap().unwrap().id;
    service
        .dialpad
        .failing_calls
        .lock()
        .unwrap()
        .push(DialpadId(7));
    let enqueue = |call_id, state, timestamp| {
        let event = serde_json::from_value(call_event(call_id, state, timestamp)).unwrap();
        service.repo.enqueue(id, event, None)
    };

    // Past calls fetch their recap, which fails for call 7.
    enqueue(7, "backfill", 2).await.unwrap();
    drain(&service).await;
    // Another call importing does not hide the one still failing.
    enqueue(8, "backfill", 3).await.unwrap();
    drain(&service).await;
    assert_eq!(calls.0.lock().unwrap().len(), 1);
    assert_eq!(
        issue(service.status(&user()).await.unwrap()),
        Some(SyncIssue::CallSyncFailed)
    );

    // Its last attempt fails: it stops retrying and says so.
    let due_on_last_attempt = || {
        sqlx::query!(
            "UPDATE dialpad_sync_events SET available_at = now(), attempts = $2 - 1
            WHERE connection_id = $1 AND call_id = 7",
            id,
            crate::domain::service::MAX_CALL_ATTEMPTS
        )
        .execute(&service.repo.pool)
    };
    due_on_last_attempt().await.unwrap();
    drain(&service).await;
    assert!(service.repo.claim().await.unwrap().is_none());
    assert_eq!(
        issue(service.status(&user()).await.unwrap()),
        Some(SyncIssue::CallsAbandoned)
    );

    // A new event for the call starts its attempts over.
    enqueue(7, "recap_summary", 4).await.unwrap();
    drain(&service).await;
    assert_eq!(
        issue(service.status(&user()).await.unwrap()),
        Some(SyncIssue::CallSyncFailed)
    );
    service.dialpad.failing_calls.lock().unwrap().clear();
    sqlx::query!(
        "UPDATE dialpad_sync_events SET available_at = now() WHERE connection_id = $1",
        id
    )
    .execute(&service.repo.pool)
    .await
    .unwrap();
    drain(&service).await;
    assert_eq!(calls.0.lock().unwrap().len(), 2);
    assert_eq!(issue(service.status(&user()).await.unwrap()), None);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("users"))
)]
async fn a_transcript_outage_imports_the_call_without_it(pool: PgPool) {
    let calls = Arc::new(Calls::default());
    let service = service(pool, GrantState::Active, calls.clone());
    service.connect(&user(), Backfill::None).await.unwrap();
    service.complete(&user()).await.unwrap();
    let id = service.repo.by_user(&user()).await.unwrap().unwrap().id;

    *service.dialpad.transcript_fails.lock().unwrap() = Some(false);
    let event = serde_json::from_value(call_event(9, "call_transcription", 3)).unwrap();
    service.repo.enqueue(id, event, None).await.unwrap();
    drain(&service).await;
    assert_eq!(
        calls.0.lock().unwrap().as_slice(),
        &[("9".to_owned(), None, 0)]
    );
    assert_eq!(issue(service.status(&user()).await.unwrap()), None);

    // A rejected token is not an outage: the call waits for a reconnect.
    *service.dialpad.transcript_fails.lock().unwrap() = Some(true);
    let event = serde_json::from_value(call_event(10, "call_transcription", 3)).unwrap();
    service.repo.enqueue(id, event, None).await.unwrap();
    drain(&service).await;
    assert_eq!(calls.0.lock().unwrap().len(), 1);
    assert_eq!(
        issue(service.status(&user()).await.unwrap()),
        Some(SyncIssue::CallSyncFailed)
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("users"))
)]
async fn a_failing_backfill_backs_off_behind_the_others_and_says_so(pool: PgPool) {
    let service = service(pool, GrantState::Active, Arc::new(Calls::default()));
    for user in [user(), other_user()] {
        service.connect(&user, Backfill::Week).await.unwrap();
        service.complete(&user).await.unwrap();
    }
    let a = service.repo.by_user(&user()).await.unwrap().unwrap();
    let b = service.repo.by_user(&other_user()).await.unwrap().unwrap();
    let due = || async {
        service
            .repo
            .backfilling(10)
            .await
            .unwrap()
            .into_iter()
            .map(|connection| connection.id)
            .collect::<Vec<_>>()
    };
    assert_eq!(due().await, [a.id, b.id]);
    // Each page moves a backfill behind the others, so they take turns.
    service
        .repo
        .advance_backfill(&a, vec![], Some("next".into()))
        .await
        .unwrap();
    assert_eq!(due().await, [b.id, a.id]);
    // A failed page backs off, and Settings says so.
    service.repo.backfill_failed(&b).await.unwrap();
    assert_eq!(due().await, [a.id]);
    assert_eq!(
        issue(service.status(&other_user()).await.unwrap()),
        Some(SyncIssue::BackfillFailed)
    );
    assert_eq!(issue(service.status(&user()).await.unwrap()), None);

    // A failing listing is not retried on every reconcile.
    *service.dialpad.fail_listing.lock().unwrap() = true;
    service.reconcile().await.unwrap();
    service.reconcile().await.unwrap();
    assert_eq!(*service.dialpad.listings.lock().unwrap(), 1);
    assert_eq!(
        issue(service.status(&user()).await.unwrap()),
        Some(SyncIssue::BackfillFailed)
    );

    // Once Dialpad answers, both finish and the issue clears.
    *service.dialpad.fail_listing.lock().unwrap() = false;
    sqlx::query!("UPDATE dialpad_sync_connections SET backfill_due_at = now()")
        .execute(&service.repo.pool)
        .await
        .unwrap();
    service.reconcile().await.unwrap();
    for user in [user(), other_user()] {
        let connection = service.repo.by_user(&user).await.unwrap().unwrap();
        assert_eq!(connection.backfill, BackfillState::Done);
        assert_eq!(issue(service.status(&user).await.unwrap()), None);
    }
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("users"))
)]
async fn signed_events_are_read_leniently_and_unreadable_ones_acknowledged(pool: PgPool) {
    let calls = Arc::new(Calls::default());
    let service = service(pool, GrantState::Active, calls.clone());
    service.connect(&user(), Backfill::None).await.unwrap();
    service.complete(&user()).await.unwrap();
    let id = service.repo.by_user(&user()).await.unwrap().unwrap().id;
    let secret = service.dialpad.secret();

    // Shapes Dialpad has been seen to vary still import.
    let lenient = signed(
        &secret,
        call_event(1, "hangup", 2),
        json!({
            "direction": "sideways",
            "date_connected": "1746469010000",
            "contact": {"id": 4501, "name": "Jane Doe", "phone": "+1604311"},
        }),
    );
    service.receive(id, &lenient).await.unwrap();

    // Signed but unreadable: acknowledged, never stored.
    let unreadable = signed(
        &secret,
        call_event(2, "hangup", 2),
        json!({"date_started": "soon"}),
    );
    let mut undated = call_event(3, "hangup", 2);
    for field in ["event_timestamp", "date_started", "date_ended"] {
        undated[field] = json!(null);
    }
    let undated = signed(&secret, undated, json!({}));
    for body in [&unreadable, &undated] {
        service.receive(id, body).await.unwrap();
    }

    // Only a bad signature is refused.
    let forged = signed("not-the-secret", call_event(4, "hangup", 2), json!({}));
    assert!(matches!(
        service.receive(id, &forged).await,
        Err(SyncError::InvalidDelivery)
    ));

    drain(&service).await;
    let imported: Vec<String> = calls
        .0
        .lock()
        .unwrap()
        .iter()
        .map(|(call_id, _, _)| call_id.clone())
        .collect();
    assert_eq!(imported, ["1"]);
    let stored = sqlx::query_scalar!(
        r#"SELECT count(*) AS "count!" FROM dialpad_sync_events WHERE call_id <> 1"#
    )
    .fetch_one(&service.repo.pool)
    .await
    .unwrap();
    assert_eq!(stored, 0);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("users"))
)]
async fn a_reconnect_during_an_import_still_imports_the_call(pool: PgPool) {
    let calls = Arc::new(Calls::default());
    let service = Arc::new(service(pool, GrantState::Active, calls.clone()));
    service.connect(&user(), Backfill::None).await.unwrap();
    service.complete(&user()).await.unwrap();
    let connection = service.repo.by_user(&user()).await.unwrap().unwrap();
    let event = serde_json::from_value(call_event(9, "call_transcription", 3)).unwrap();
    service
        .repo
        .enqueue(connection.id, event, None)
        .await
        .unwrap();
    let started = Arc::new(tokio::sync::Notify::new());
    let resume = Arc::new(tokio::sync::Notify::new());
    *service.dialpad.transcript_pause.lock().unwrap() = Some((started.clone(), resume.clone()));
    let worker_service = service.clone();
    let worker = tokio::spawn(async move { worker_service.tick().await });
    started.notified().await;
    // Reconnecting a running sync (say, to refresh the grant) keeps it on.
    service.connect(&user(), Backfill::None).await.unwrap();
    service.complete(&user()).await.unwrap();
    resume.notify_one();
    worker.await.unwrap().unwrap();
    assert_eq!(calls.0.lock().unwrap().len(), 1);
}
