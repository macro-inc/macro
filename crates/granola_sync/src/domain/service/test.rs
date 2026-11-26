use super::*;
use macro_user_id::cowlike::CowLike;

fn user(name: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(&format!("macro|{name}@test.com"))
        .unwrap()
        .into_owned()
}
fn state(name: &str) -> SyncState {
    SyncState {
        id: macro_uuid::generate_uuid_v7(),
        user_id: user(name),
        scope: Scope::All,
        enabled: true,
        has_endpoint: true,
        started_at: chrono::Utc::now(),
        last_error: None,
    }
}

#[test]
fn connecting_an_account_starts_sync_without_user_action() {
    let plan = plan(&[user("a")], &[], chrono::Utc::now());
    assert_eq!(plan.start, vec![user("a")]);
    assert!(plan.stop.is_empty());
}

#[test]
fn an_active_sync_at_the_widest_scope_is_left_alone() {
    let plan = plan(&[user("a")], &[state("a")], chrono::Utc::now());
    assert_eq!(plan, Plan::default());
}

#[test]
fn removing_the_connection_stops_its_sync() {
    let removed = state("a");
    let removed_id = removed.id;
    let plan = plan(&[user("b")], &[removed, state("b")], chrono::Utc::now());
    assert_eq!(plan.stop, vec![removed_id]);
    assert!(plan.start.is_empty());
}

#[test]
fn narrower_scopes_from_earlier_settings_are_widened() {
    let plan = plan(
        &[user("a")],
        &[SyncState {
            scope: Scope::Personal,
            ..state("a")
        }],
        chrono::Utc::now(),
    );
    assert_eq!(plan.start, vec![user("a")]);
}

#[test]
fn failed_setups_wait_for_the_retry_delay_but_reconnects_restart_at_once() {
    let now = chrono::Utc::now();
    let failed = |issue: SyncIssue, age: chrono::Duration| SyncState {
        enabled: false,
        has_endpoint: false,
        started_at: now - age,
        last_error: Some(issue),
        ..state("a")
    };
    let accounts = [user("a")];
    let recent = failed(SyncIssue::SetupFailed, chrono::Duration::minutes(5));
    assert!(plan(&accounts, &[recent], now).start.is_empty());
    let old = failed(SyncIssue::SetupFailed, chrono::Duration::hours(2));
    assert_eq!(plan(&accounts, &[old], now).start.len(), 1);
    let stopped = failed(SyncIssue::Stopped, chrono::Duration::minutes(1));
    assert_eq!(plan(&accounts, &[stopped], now).start.len(), 1);
}

#[test]
fn an_in_flight_reservation_is_not_raced() {
    let now = chrono::Utc::now();
    let reserving = |age| SyncState {
        enabled: false,
        has_endpoint: false,
        started_at: now - age,
        ..state("a")
    };
    let accounts = [user("a")];
    let fresh = reserving(chrono::Duration::seconds(10));
    assert!(plan(&accounts, &[fresh], now).start.is_empty());
    let abandoned = reserving(chrono::Duration::minutes(5));
    assert_eq!(plan(&accounts, &[abandoned], now).start.len(), 1);
}

// Reconcile, over the connectors services' shared fake.

use crate::outbound::accounts::ConnectedAccounts;
use call::domain::imports::{ImportedCall, ImportedCallPreview, ImportedCallRecord};
use call::domain::records::{CallEntityRecord, CallProvider};
use connectors::fake::{FakeConnection, FakeConnectors};
use std::sync::Mutex;

/// Sync rows in memory, recording which syncs were stopped.
#[derive(Default)]
struct FakeRepo {
    connections: Mutex<Vec<Connection>>,
    stopped: Mutex<Vec<Uuid>>,
    /// Queued webhook deliveries, claimed in order.
    events: Mutex<Vec<Event>>,
    backfill: Mutex<BackfillState>,
    /// Every way a backfill page ended, in order.
    steps: Mutex<Vec<BackfillStep>>,
}

#[derive(Default)]
struct BackfillState {
    cursor: Option<String>,
    done: bool,
    attempts: i32,
}

impl FakeRepo {
    fn syncing(user: MacroUserIdStr<'static>) -> Self {
        let repo = Self::default();
        repo.connections.lock().unwrap().push(Connection {
            id: macro_uuid::generate_uuid_v7(),
            namespace: macro_uuid::generate_uuid_v7(),
            user_id: user,
            scope: Scope::All,
            enabled: true,
            endpoint_id: Some("endpoint".to_owned()),
            secret: Some(SigningSecret("secret".to_owned())),
            started_at: chrono::Utc::now(),
            last_synced_at: None,
            last_error: None,
        });
        repo
    }
}

#[async_trait]
impl SyncRepository for FakeRepo {
    async fn by_user(&self, user: &MacroUserIdStr<'static>) -> Result<Option<Connection>> {
        let connections = self.connections.lock().unwrap();
        Ok(connections.iter().find(|c| &c.user_id == user).cloned())
    }
    async fn by_id(&self, id: Uuid) -> Result<Option<Connection>> {
        let connections = self.connections.lock().unwrap();
        Ok(connections.iter().find(|c| c.id == id).cloned())
    }
    async fn states(&self) -> Result<Vec<SyncState>> {
        let connections = self.connections.lock().unwrap();
        Ok(connections
            .iter()
            .map(|c| SyncState {
                id: c.id,
                user_id: c.user_id.clone(),
                scope: c.scope,
                enabled: c.enabled,
                has_endpoint: c.endpoint_id.is_some(),
                started_at: c.started_at,
                last_error: c.last_error,
            })
            .collect())
    }
    async fn reserve(&self, connection: &Connection) -> Result<bool> {
        let mut connections = self.connections.lock().unwrap();
        connections.retain(|held| held.user_id != connection.user_id);
        connections.push(connection.clone());
        Ok(true)
    }
    async fn activate(&self, id: Uuid, webhook: Webhook, scope: Scope) -> Result<bool> {
        let mut connections = self.connections.lock().unwrap();
        let Some(connection) = connections.iter_mut().find(|held| held.id == id) else {
            return Ok(false);
        };
        connection.enabled = true;
        connection.scope = scope;
        connection.endpoint_id = Some(webhook.id);
        connection.secret = Some(webhook.secret);
        Ok(true)
    }
    async fn stop(&self, id: Uuid) -> Result<()> {
        self.stopped.lock().unwrap().push(id);
        Ok(())
    }
    async fn failed_setup(&self, _id: Uuid) -> Result<()> {
        Ok(())
    }
    async fn enqueue(&self, _id: Uuid, _event: Event) -> Result<()> {
        Ok(())
    }
    async fn claim(&self) -> Result<Option<Job>> {
        let mut events = self.events.lock().unwrap();
        if events.is_empty() {
            return Ok(None);
        }
        let connection = self.connections.lock().unwrap()[0].clone();
        Ok(Some(Job {
            connection,
            event: events.remove(0),
            lease_id: macro_uuid::generate_uuid_v7(),
            attempts: 1,
        }))
    }
    async fn finish(&self, _job: &Job, _success: bool) -> Result<()> {
        Ok(())
    }
    async fn claim_backfill(&self) -> Result<Option<BackfillJob>> {
        let connections = self.connections.lock().unwrap();
        let Some(connection) = connections.iter().find(|c| c.enabled) else {
            return Ok(None);
        };
        let mut backfill = self.backfill.lock().unwrap();
        if backfill.done {
            return Ok(None);
        }
        backfill.attempts += 1;
        Ok(Some(BackfillJob {
            connection: connection.clone(),
            cursor: backfill.cursor.clone(),
            lease_id: macro_uuid::generate_uuid_v7(),
            attempts: backfill.attempts,
        }))
    }
    async fn finish_backfill(&self, _job: &BackfillJob, step: BackfillStep) -> Result<()> {
        let mut backfill = self.backfill.lock().unwrap();
        match &step {
            BackfillStep::Next(cursor) => {
                backfill.cursor = Some(cursor.clone());
                backfill.attempts = 0;
            }
            BackfillStep::Done => {
                backfill.done = true;
                backfill.attempts = 0;
            }
            BackfillStep::Retry => {}
            BackfillStep::Throttled(_) | BackfillStep::Deferred => backfill.attempts -= 1,
        }
        self.steps.lock().unwrap().push(step);
        Ok(())
    }
}

/// Granola, recording which webhooks were registered and unregistered.
#[derive(Default)]
struct FakeGranola {
    registered: Mutex<Vec<Uuid>>,
    unregistered: Mutex<Vec<Uuid>>,
}

#[async_trait]
impl Granola for FakeGranola {
    async fn register(
        &self,
        connection: &Connection,
        _url: &str,
        _scope: Scope,
    ) -> Result<Registration> {
        self.registered.lock().unwrap().push(connection.id);
        Ok(Registration::Registered(Webhook {
            id: format!("endpoint-{}", connection.id),
            secret: SigningSecret("secret".to_owned()),
        }))
    }
    async fn unregister(&self, connection: &Connection) -> Result<()> {
        self.unregistered.lock().unwrap().push(connection.id);
        Ok(())
    }
    async fn meeting(
        &self,
        _connection: &Connection,
        _note: &NoteId,
    ) -> Result<Option<ImportedCall>> {
        Ok(None)
    }
    async fn notes(&self, _connection: &Connection, _cursor: Option<&str>) -> Result<NotesPage> {
        Ok(NotesPage {
            notes: vec![],
            next: None,
        })
    }
}

/// History backfill rolled out to every user, or to none.
struct Rollout(bool);

#[async_trait]
impl BackfillRollout for Rollout {
    async fn enabled(&self, _user: &MacroUserIdStr<'static>) -> Result<bool> {
        Ok(self.0)
    }
}

struct AcceptAll;

impl DeliveryVerifier for AcceptAll {
    fn verify(&self, _secret: &SigningSecret, _delivery: &Delivery<'_>) -> bool {
        true
    }
}

struct NoCalls;

#[async_trait]
impl CallImportService for NoCalls {
    async fn ingest(&self, _call: ImportedCall) -> Result<Uuid> {
        Err(rootcause::report!("no calls in this test"))
    }
    async fn list(&self, _user: &MacroUserIdStr<'static>) -> Result<Vec<ImportedCallPreview>> {
        Ok(Vec::new())
    }
    async fn list_source_records(
        &self,
        _user: &MacroUserIdStr<'static>,
        _provider: CallProvider,
    ) -> Result<Vec<ImportedCallRecord>> {
        Ok(Vec::new())
    }
    async fn read(
        &self,
        _user: &MacroUserIdStr<'static>,
        _id: Uuid,
    ) -> Result<Option<CallEntityRecord>> {
        Ok(None)
    }
}

type FakeService =
    Service<FakeRepo, FakeGranola, ConnectedAccounts<connectors::Connectors>, AcceptAll>;

fn service(repo: FakeRepo, fake: &FakeConnectors) -> FakeService {
    Service {
        repo,
        granola: FakeGranola::default(),
        accounts: ConnectedAccounts(Arc::new(fake.build())),
        verifier: AcceptAll,
        calls: Arc::new(NoCalls),
        backfill_rollout: Arc::new(Rollout(true)),
        public_url: "https://macro.example.com".to_owned(),
    }
}

/// A holder whose connection could not be resolved is not a removed
/// connection: reconcile fails and retries, and stops nothing.
#[tokio::test]
async fn a_holder_that_cannot_be_resolved_keeps_its_sync() {
    let fake = FakeConnectors::new()
        .with_connections_unreachable(&user("a"))
        .with_connection(&user("a"), FakeConnection::app("granola"))
        .with_connection(&user("b"), FakeConnection::app("granola"));
    let service = service(FakeRepo::syncing(user("a")), &fake);

    assert!(service.reconcile().await.is_err());

    assert!(service.repo.stopped.lock().unwrap().is_empty());
    assert!(service.granola.unregistered.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_removed_connection_stops_its_sync_and_unregisters_its_webhook() {
    let fake = FakeConnectors::new().with_connection(&user("b"), FakeConnection::app("granola"));
    let repo = FakeRepo::syncing(user("a"));
    let id = repo.connections.lock().unwrap()[0].id;
    let service = service(repo, &fake);

    service.reconcile().await.unwrap();

    assert_eq!(*service.repo.stopped.lock().unwrap(), vec![id]);
    assert_eq!(*service.granola.unregistered.lock().unwrap(), vec![id]);
}

/// Connecting Granola again, perhaps to another account, moves the sync
/// onto the new connection at once: the old webhook goes, a new one comes.
#[tokio::test]
async fn connecting_granola_restarts_the_sync() {
    let fake = FakeConnectors::new().with_connection(&user("a"), FakeConnection::app("granola"));
    let repo = FakeRepo::syncing(user("a"));
    let old = repo.connections.lock().unwrap()[0].id;
    let service = service(repo, &fake);

    service.connected(user("a")).await.unwrap();

    assert_eq!(*service.granola.unregistered.lock().unwrap(), vec![old]);
    let registered = service.granola.registered.lock().unwrap().clone();
    assert_eq!(registered.len(), 1);
    assert_ne!(registered[0], old);
    let current = service.repo.by_user(&user("a")).await.unwrap().unwrap();
    assert_eq!(current.id, registered[0]);
    assert!(current.enabled);
}

/// A user whose Granola connection gives no API access is not synced, even
/// right after connecting.
#[tokio::test]
async fn connecting_granola_without_api_access_starts_nothing() {
    let flagged = user("flagged");
    let fake = FakeConnectors::new()
        .with_connect_app("granola", false)
        .with_macro_connect_enabled(&flagged)
        .with_connection(&flagged, FakeConnection::app("granola"));
    let service = service(FakeRepo::default(), &fake);

    service.connected(flagged).await.unwrap();

    assert!(service.granola.registered.lock().unwrap().is_empty());
}

// History backfill, against a scripted Granola: the real REST adapter over
// the connectors fake, answering each request in turn.

use crate::outbound::api::GranolaApi;
use connectors::{ApiResponse, Connectors};
use serde_json::{Value, json};

/// Records every imported call instead of storing it.
#[derive(Default)]
struct RecordedCalls(Mutex<Vec<ImportedCall>>);

#[async_trait]
impl CallImportService for RecordedCalls {
    async fn ingest(&self, call: ImportedCall) -> Result<Uuid> {
        self.0.lock().unwrap().push(call);
        Ok(macro_uuid::generate_uuid_v7())
    }
    async fn list(&self, _user: &MacroUserIdStr<'static>) -> Result<Vec<ImportedCallPreview>> {
        Ok(Vec::new())
    }
    async fn list_source_records(
        &self,
        _user: &MacroUserIdStr<'static>,
        _provider: CallProvider,
    ) -> Result<Vec<ImportedCallRecord>> {
        Ok(Vec::new())
    }
    async fn read(
        &self,
        _user: &MacroUserIdStr<'static>,
        _id: Uuid,
    ) -> Result<Option<CallEntityRecord>> {
        Ok(None)
    }
}

type ScriptedService = ScriptedOn<GranolaApi<Connectors>>;
type ScriptedOn<G> = Service<FakeRepo, G, ConnectedAccounts<Connectors>, AcceptAll>;

fn response(status: u16, body: Value) -> ApiResponse {
    ApiResponse {
        status: http::StatusCode::from_u16(status).unwrap(),
        headers: http::HeaderMap::new(),
        body: if body.is_null() {
            String::new()
        } else {
            body.to_string()
        },
    }
}

/// A syncing user whose Granola answers `responses` in turn through `wrap`
/// of the real adapter, recording calls.
fn scripted_with<G: Granola>(
    responses: Vec<ApiResponse>,
    rollout: bool,
    wrap: impl FnOnce(GranolaApi<Connectors>) -> G,
) -> (FakeConnectors, Arc<RecordedCalls>, ScriptedOn<G>) {
    let fake = FakeConnectors::new().with_connection(
        &user("a"),
        FakeConnection::app("granola").answering_in_turn(responses),
    );
    let connectors = Arc::new(fake.build());
    let calls = Arc::new(RecordedCalls::default());
    let service = Service {
        repo: FakeRepo::syncing(user("a")),
        granola: wrap(GranolaApi(connectors.clone())),
        accounts: ConnectedAccounts(connectors),
        verifier: AcceptAll,
        calls: calls.clone(),
        backfill_rollout: Arc::new(Rollout(rollout)),
        public_url: "https://macro.example.com".to_owned(),
    };
    (fake, calls, service)
}

/// A syncing user, opted into backfill, whose Granola answers `responses`
/// in turn.
fn scripted(responses: Vec<(u16, Value)>) -> (FakeConnectors, Arc<RecordedCalls>, ScriptedService) {
    let responses = responses
        .into_iter()
        .map(|(status, body)| response(status, body))
        .collect();
    scripted_with(responses, true, |api| api)
}

/// A note as the list returns it.
fn listed(id: &str) -> Value {
    json!({"id": id, "object": "note", "title": "Listed", "owner": {"email": "owner@example.com"},
        "created_at": "2026-09-01T10:00:00Z", "updated_at": "2026-09-01T11:00:00Z",
        "deleted_at": null})
}

fn page(ids: &[&str], cursor: Option<&str>) -> (u16, Value) {
    let notes: Vec<Value> = ids.iter().map(|id| listed(id)).collect();
    (
        200,
        json!({"notes": notes, "hasMore": cursor.is_some(), "cursor": cursor}),
    )
}

fn deleted(id: &str) -> Value {
    json!({"id": id, "object": "note", "title": "Gone", "owner": {"email": "owner@example.com"},
        "created_at": "2026-09-01T10:00:00Z", "updated_at": "2026-09-01T11:00:00Z",
        "deleted_at": "2026-09-02T00:00:00Z"})
}

/// The note as `GET /notes/{id}` returns it, with the owner's private notes.
fn note(id: &str) -> (u16, Value) {
    (
        200,
        json!({"id": id, "object": "note", "title": format!("Meeting {id}"),
            "owner": {"name": "Owner", "email": "owner@example.com"},
            "created_at": "2026-09-01T10:00:00Z", "updated_at": "2026-09-01T11:00:00Z",
            "deleted_at": null, "web_url": format!("https://notes.granola.ai/d/{id}"),
            "attendees": [{"name": "Guest", "email": "guest@example.com"}],
            "summary_markdown": "Agreed next steps",
            "private_notes_text": "Private scratch note",
            "private_notes_markdown": "Private scratch note"}),
    )
}

/// No transcript for the note; the meeting still imports.
fn no_transcript() -> (u16, Value) {
    (404, Value::Null)
}

fn imported_ids(calls: &RecordedCalls) -> Vec<String> {
    calls
        .0
        .lock()
        .unwrap()
        .iter()
        .map(|call| call.source.external_id.as_ref().to_owned())
        .collect()
}

#[tokio::test(start_paused = true)]
async fn backfill_imports_history_page_by_page_without_deleted_or_private_notes() {
    let (fake, calls, service) = scripted(vec![
        (
            200,
            json!({"notes": [listed("not_aaaaaaaaaaaaaa"), deleted("not_bbbbbbbbbbbbbb")],
                "hasMore": true, "cursor": "page-2"}),
        ),
        note("not_aaaaaaaaaaaaaa"),
        no_transcript(),
        page(&["not_cccccccccccccc"], None),
        note("not_cccccccccccccc"),
        no_transcript(),
    ]);
    let namespace = service.repo.connections.lock().unwrap()[0].namespace;

    assert!(service.backfill().await.unwrap());
    assert!(service.backfill().await.unwrap());
    assert!(!service.backfill().await.unwrap());

    assert_eq!(
        imported_ids(&calls),
        vec!["not_aaaaaaaaaaaaaa", "not_cccccccccccccc"]
    );
    for call in calls.0.lock().unwrap().iter() {
        assert_eq!(call.source.namespace, namespace.to_string());
        assert_eq!(call.source.provider, CallProvider::Granola);
        assert_eq!(call.source.object_type, "note");
        assert!(
            !json!(call.source.metadata)
                .to_string()
                .contains("Private scratch note")
        );
    }
    assert_eq!(
        *service.repo.steps.lock().unwrap(),
        vec![BackfillStep::Next("page-2".into()), BackfillStep::Done]
    );
    let urls: Vec<String> = fake.api_calls().into_iter().map(|c| c.url).collect();
    assert!(urls.iter().all(|url| !url.contains("not_bbbbbbbbbbbbbb")));
    assert!(urls[3].ends_with("/notes?page_size=10&cursor=page-2"));
}

#[tokio::test(start_paused = true)]
async fn a_failed_page_is_retried_from_its_saved_cursor() {
    let (fake, calls, service) = scripted(vec![
        page(&["not_aaaaaaaaaaaaaa"], Some("page-2")),
        note("not_aaaaaaaaaaaaaa"),
        no_transcript(),
        (500, json!({"code": "INTERNAL_ERROR"})),
        page(&["not_cccccccccccccc"], None),
        note("not_cccccccccccccc"),
        no_transcript(),
    ]);

    for _ in 0..3 {
        assert!(service.backfill().await.unwrap());
    }

    assert_eq!(
        *service.repo.steps.lock().unwrap(),
        vec![
            BackfillStep::Next("page-2".into()),
            BackfillStep::Retry,
            BackfillStep::Done
        ]
    );
    assert_eq!(
        imported_ids(&calls),
        vec!["not_aaaaaaaaaaaaaa", "not_cccccccccccccc"]
    );
    let lists: Vec<String> = fake
        .api_calls()
        .into_iter()
        .map(|c| c.url)
        .filter(|url| url.contains("/notes?"))
        .collect();
    assert_eq!(lists.len(), 3);
    assert!(lists[0].ends_with("/notes?page_size=10"));
    assert!(lists[1].ends_with("&cursor=page-2"));
    assert!(lists[2].ends_with("&cursor=page-2"));
}

/// A note that fails to fetch holds the page back for a retry, until the
/// last attempt, when the rest of history is not blocked on it.
#[tokio::test(start_paused = true)]
async fn a_note_that_keeps_failing_is_skipped_only_on_the_last_attempt() {
    let responses = || {
        vec![
            page(&["not_aaaaaaaaaaaaaa", "not_cccccccccccccc"], None),
            (500, json!({"code": "INTERNAL_ERROR"})),
            note("not_cccccccccccccc"),
            no_transcript(),
        ]
    };
    let (_, calls, service) = scripted(responses());
    assert!(service.backfill().await.unwrap());
    assert_eq!(
        *service.repo.steps.lock().unwrap(),
        vec![BackfillStep::Retry]
    );
    assert_eq!(imported_ids(&calls), vec!["not_cccccccccccccc"]);

    let (_, calls, service) = scripted(responses());
    service.repo.backfill.lock().unwrap().attempts = BACKFILL_PAGE_ATTEMPTS - 1;
    assert!(service.backfill().await.unwrap());
    assert_eq!(
        *service.repo.steps.lock().unwrap(),
        vec![BackfillStep::Done]
    );
    assert_eq!(imported_ids(&calls), vec!["not_cccccccccccccc"]);
}

/// Backfill and webhook delivery import a note under one source identity,
/// so whichever lands second updates the same call instead of adding one.
#[tokio::test(start_paused = true)]
async fn backfill_and_webhook_import_a_note_as_the_same_call() {
    let (_, calls, service) = scripted(vec![
        note("not_aaaaaaaaaaaaaa"),
        no_transcript(),
        page(&["not_aaaaaaaaaaaaaa"], None),
        note("not_aaaaaaaaaaaaaa"),
        no_transcript(),
    ]);
    service.repo.events.lock().unwrap().push(Event {
        event_id: macro_uuid::generate_uuid_v7(),
        event_type: EventType::Generated,
        note_id: NoteId("not_aaaaaaaaaaaaaa".into()),
        occurred_at: chrono::Utc::now(),
    });

    assert!(service.tick().await.unwrap());
    assert!(service.backfill().await.unwrap());

    let calls = calls.0.lock().unwrap();
    assert_eq!(calls.len(), 2);
    let identity = |call: &ImportedCall| {
        (
            call.source.user_id.clone(),
            call.source.namespace.clone(),
            call.source.provider,
            call.source.object_type.clone(),
            call.source.external_id.as_ref().to_owned(),
        )
    };
    assert_eq!(identity(&calls[0]), identity(&calls[1]));
}

/// Without API access to Granola, backfill calls nothing and imports nothing.
#[tokio::test(start_paused = true)]
async fn backfill_without_api_access_imports_nothing() {
    let flagged = user("a");
    let fake = FakeConnectors::new()
        .with_connect_app("granola", false)
        .with_macro_connect_enabled(&flagged)
        .with_connection(&flagged, FakeConnection::app("granola"));
    let connectors = Arc::new(fake.build());
    let calls = Arc::new(RecordedCalls::default());
    let service = Service {
        repo: FakeRepo::syncing(flagged),
        granola: GranolaApi(connectors.clone()),
        accounts: ConnectedAccounts(connectors),
        verifier: AcceptAll,
        calls: calls.clone(),
        backfill_rollout: Arc::new(Rollout(true)),
        public_url: "https://macro.example.com".to_owned(),
    };

    assert!(service.backfill().await.unwrap());

    assert!(fake.api_calls().is_empty());
    assert!(calls.0.lock().unwrap().is_empty());
    assert_eq!(
        *service.repo.steps.lock().unwrap(),
        vec![BackfillStep::Retry]
    );
}

/// Rate limiting is not a failing note: the page stops, waits, and keeps
/// its attempts, so no note is skipped because Granola throttled the key.
#[tokio::test(start_paused = true)]
async fn a_rate_limited_page_waits_without_skipping_notes() {
    let (fake, calls, service) = scripted(vec![
        page(
            &[
                "not_aaaaaaaaaaaaaa",
                "not_cccccccccccccc",
                "not_dddddddddddddd",
            ],
            None,
        ),
        note("not_aaaaaaaaaaaaaa"),
        no_transcript(),
        (429, json!({"code": "RATE_LIMITED"})),
    ]);
    service.repo.backfill.lock().unwrap().attempts = BACKFILL_PAGE_ATTEMPTS - 1;

    assert!(service.backfill().await.unwrap());

    assert_eq!(
        *service.repo.steps.lock().unwrap(),
        vec![BackfillStep::Throttled(std::time::Duration::from_secs(60))]
    );
    assert_eq!(
        service.repo.backfill.lock().unwrap().attempts,
        BACKFILL_PAGE_ATTEMPTS - 1
    );
    assert_eq!(imported_ids(&calls), vec!["not_aaaaaaaaaaaaaa"]);
    // The page stopped at the throttled note instead of fetching the rest.
    assert_eq!(fake.api_calls().len(), 4);

    let (_, calls, service) = scripted(vec![(429, json!({"code": "RATE_LIMITED"}))]);
    assert!(service.backfill().await.unwrap());
    assert_eq!(
        *service.repo.steps.lock().unwrap(),
        vec![BackfillStep::Throttled(std::time::Duration::from_secs(60))]
    );
    assert!(calls.0.lock().unwrap().is_empty());
}

/// Granola, slowed so each note takes the given time to fetch.
struct Slow<G>(G, std::time::Duration);

#[async_trait]
impl<G: Granola> Granola for Slow<G> {
    async fn register(
        &self,
        connection: &Connection,
        url: &str,
        scope: Scope,
    ) -> Result<Registration> {
        self.0.register(connection, url, scope).await
    }
    async fn unregister(&self, connection: &Connection) -> Result<()> {
        self.0.unregister(connection).await
    }
    async fn meeting(
        &self,
        connection: &Connection,
        note: &NoteId,
    ) -> Result<Option<ImportedCall>> {
        tokio::time::sleep(self.1).await;
        self.0.meeting(connection, note).await
    }
    async fn notes(&self, connection: &Connection, cursor: Option<&str>) -> Result<NotesPage> {
        self.0.notes(connection, cursor).await
    }
}

/// A page whose notes are slow to fetch stops at its time budget, well
/// inside the worker's timeout, so it always records its outcome: the notes
/// fetched so far are already imported, and the page counts an attempt.
#[tokio::test(start_paused = true)]
async fn a_slow_page_stops_at_its_budget_and_counts_an_attempt() {
    let responses = || {
        vec![
            response(
                200,
                page(
                    &[
                        "not_aaaaaaaaaaaaaa",
                        "not_cccccccccccccc",
                        "not_dddddddddddddd",
                        "not_eeeeeeeeeeeeee",
                    ],
                    None,
                )
                .1,
            ),
            response(200, note("not_aaaaaaaaaaaaaa").1),
            response(404, Value::Null),
            response(200, note("not_cccccccccccccc").1),
            response(404, Value::Null),
        ]
    };
    let slow = |api| Slow(api, std::time::Duration::from_secs(55));

    let (_, calls, service) = scripted_with(responses(), true, slow);
    let started = tokio::time::Instant::now();
    assert!(service.backfill().await.unwrap());
    assert!(started.elapsed() <= BACKFILL_PAGE_BUDGET + std::time::Duration::from_secs(1));
    assert_eq!(
        *service.repo.steps.lock().unwrap(),
        vec![BackfillStep::Retry]
    );
    assert_eq!(
        imported_ids(&calls),
        vec!["not_aaaaaaaaaaaaaa", "not_cccccccccccccc"]
    );

    // On the last attempt the page moves on, skipping the notes it never
    // reached, so a slow page cannot hold history back forever.
    let (_, calls, service) = scripted_with(responses(), true, slow);
    service.repo.backfill.lock().unwrap().attempts = BACKFILL_PAGE_ATTEMPTS - 1;
    assert!(service.backfill().await.unwrap());
    assert_eq!(
        *service.repo.steps.lock().unwrap(),
        vec![BackfillStep::Done]
    );
    assert_eq!(
        imported_ids(&calls),
        vec!["not_aaaaaaaaaaaaaa", "not_cccccccccccccc"]
    );
}

/// Backfill is off unless the user is opted in: nothing reaches Granola.
#[tokio::test(start_paused = true)]
async fn backfill_waits_for_the_user_to_be_opted_in() {
    let (fake, calls, service) = scripted_with(
        vec![response(200, page(&["not_aaaaaaaaaaaaaa"], None).1)],
        false,
        |api| api,
    );

    assert!(service.backfill().await.unwrap());

    assert_eq!(
        *service.repo.steps.lock().unwrap(),
        vec![BackfillStep::Deferred]
    );
    assert!(fake.api_calls().is_empty());
    assert!(calls.0.lock().unwrap().is_empty());
}

/// A rate-limited page waits as long as Granola's `Retry-After` asks.
#[tokio::test(start_paused = true)]
async fn a_throttled_page_waits_as_long_as_granola_asks() {
    let mut limited = response(429, json!({"code": "RATE_LIMITED"}));
    limited.headers.insert(
        http::header::RETRY_AFTER,
        http::HeaderValue::from_static("120"),
    );
    let (_, _, service) = scripted_with(vec![limited], true, |api| api);

    assert!(service.backfill().await.unwrap());

    assert_eq!(
        *service.repo.steps.lock().unwrap(),
        vec![BackfillStep::Throttled(std::time::Duration::from_secs(120))]
    );
}

/// A listing that hands back the cursor it was given would repeat the same
/// page forever; it is a failed page instead.
#[tokio::test(start_paused = true)]
async fn a_repeated_listing_cursor_is_a_failed_page() {
    let (_, _, service) = scripted(vec![
        page(&["not_aaaaaaaaaaaaaa"], Some("page-2")),
        note("not_aaaaaaaaaaaaaa"),
        no_transcript(),
    ]);
    service.repo.backfill.lock().unwrap().cursor = Some("page-2".into());

    assert!(service.backfill().await.unwrap());

    assert_eq!(
        *service.repo.steps.lock().unwrap(),
        vec![BackfillStep::Retry]
    );
}
