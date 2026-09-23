//! API -> PostgreSQL admission -> worker -> shared executor regressions.
//! Access, agent side effects, and broker redelivery are simulated; no model or
//! Kafka connection is made. Each test owns an isolated migrated database.

use std::{
    future::pending,
    sync::{Arc, Mutex},
    time::Duration,
};

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
};
use chrono::Utc;
use entity_access::domain::models::{
    AccessLevel, Entity, EntityAccessReceipt, EntityPermission, EntityType,
};
use macro_authorization::{
    InternalIdentityClaims, MacroAuthorizationError, MacroAuthorizationService,
    MacroAuthorizationState,
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::{Uuid, generate_uuid_v7};
use model::user::UserContext;
use rootcause::Report;
use scheduled_action::{
    domain::{
        event_runs::{
            AuthorizedEventRun, ClaimToken, ClaimedEventRun, CurrentOwnerAccess,
            EventAccessCapability, EventExecutor, EventIngestion, EventIngestionResult,
            EventRunKey, EventRunOutcome, EventRunRepository, FinalizationResult, PageSize,
            PendingEventRun,
            admission::EventAdmissionService,
            dispatch::{DispatchResult, EventDispatchService, EventRunDispatch},
        },
        event_trigger::{
            EventEntityType, EventId, EventPayload, EventReference, EventRejection, IncomingEvent,
        },
        models::{MAX_ACTION_TIME, ScheduledAction, ScheduledActionUpdate},
        ports::{ScheduledActionLiveUpdate, ScheduledActionRepo, ScheduledAgentRunner},
        service::ScheduledActionServiceImpl,
    },
    inbound::{
        axum_router::{ScheduledActionRouterState, scheduled_action_router},
        event_run_worker::run_event_worker,
    },
    outbound::{
        inprocess_executor::InProcessExecutor, pg_event_run_repo::PgEventRunRepo,
        pg_scheduled_action_repo::PgScheduledActionRepo,
    },
};
use serde_json::{Value, json};
use sqlx::PgPool;
use tokio::sync::{Semaphore, mpsc};
use tokio_util::{sync::CancellationToken, task::TaskTracker};
use tower::ServiceExt;

const USER: &str = "macro|event-run@macro.com";
const ACTOR: &str = "macro|event-actor@macro.com";
const BOT: &str = "bot|01900000-0000-7000-8000-000000000004";
const TEST_TIMEOUT: Duration = Duration::from_secs(10);

fn page() -> PageSize {
    PageSize::try_from(100).unwrap()
}

#[derive(Clone)]
struct FakeAuth;
impl MacroAuthorizationService for FakeAuth {
    async fn authorize(&self, jwt: &str) -> Result<UserContext, Report<MacroAuthorizationError>> {
        if jwt != "owner" {
            return Err(Report::new(MacroAuthorizationError::InvalidCredentials));
        }
        Ok(UserContext {
            user_id: USER.into(),
            ..Default::default()
        })
    }
    async fn authorize_internal(
        &self,
        _: &str,
        _: InternalIdentityClaims,
    ) -> Result<Option<UserContext>, Report<MacroAuthorizationError>> {
        Err(Report::new(MacroAuthorizationError::InvalidCredentials))
    }
}

struct FakeAccess;
impl CurrentOwnerAccess for FakeAccess {
    async fn authorize(
        &self,
        owner: &MacroUserIdStr<'static>,
        event: &EventReference,
    ) -> Result<Option<EventAccessCapability>, Report> {
        // The event actor is intentionally different from the routine owner.
        assert_eq!(owner.as_ref(), USER);
        let entity = Entity {
            entity_id: event.entity_id().to_string(),
            entity_type: match event.entity_type() {
                EventEntityType::Document => EntityType::Document,
                EventEntityType::Channel => EntityType::Channel,
            },
        };
        let access = match event.entity_type() {
            EventEntityType::Document => EventAccessCapability::Document(
                EntityAccessReceipt::try_new_authenticated_user(
                    owner.clone(),
                    entity,
                    EntityPermission::AccessLevel {
                        access_level: AccessLevel::View,
                    },
                )
                .unwrap(),
            ),
            EventEntityType::Channel => EventAccessCapability::Channel(
                EntityAccessReceipt::try_new_authenticated_user(
                    owner.clone(),
                    entity,
                    EntityPermission::ChannelViewOnly,
                )
                .unwrap(),
            ),
        };
        Ok(Some(access))
    }
}

#[derive(Default)]
struct FakeRunner {
    calls: Mutex<Vec<(Uuid, Option<EventReference>)>>,
    fail_event: Mutex<Option<EventId>>,
    permits: Option<Semaphore>,
    outputs: Mutex<Vec<IncomingEvent>>,
    emit_bot_outputs: bool,
}
impl ScheduledAgentRunner for FakeRunner {
    async fn create_chat(&self, _: &ScheduledAction) -> anyhow::Result<String> {
        Ok(generate_uuid_v7().to_string())
    }
    async fn run(
        &self,
        action: &ScheduledAction,
        _: &str,
        event: Option<&EventReference>,
    ) -> anyhow::Result<()> {
        self.calls
            .lock()
            .unwrap()
            .push((action.id.unwrap(), event.cloned()));
        if let Some(permits) = &self.permits {
            permits.acquire().await.unwrap().forget();
        }
        if self.emit_bot_outputs {
            let mut outputs = self.outputs.lock().unwrap();
            outputs.push(incoming("document.updated", BOT));
            outputs.push(incoming("channel.message_posted", BOT));
        }
        if event.is_some_and(|event| Some(event.event_id()) == *self.fail_event.lock().unwrap()) {
            anyhow::bail!("simulated agent failure after side effects");
        }
        Ok(())
    }
}

struct NoLiveUpdates;
impl ScheduledActionLiveUpdate for NoLiveUpdates {
    async fn publish_update(&self, _: ScheduledActionUpdate) {}
}

type Executor = InProcessExecutor<PgScheduledActionRepo, NoLiveUpdates, FakeRunner>;
type Admission = EventAdmissionService<PgEventRunRepo, FakeAccess>;
type Dispatch = EventDispatchService<PgEventRunRepo, FakeAccess, Executor>;

struct Harness {
    pool: PgPool,
    app: Router,
    actions: Arc<PgScheduledActionRepo>,
    runs: Arc<PgEventRunRepo>,
    runner: Arc<FakeRunner>,
    executor: Arc<Executor>,
    tracker: TaskTracker,
    // Keep the cron notification receiver alive; these tests drive dispatch explicitly.
    _notifications: mpsc::Receiver<scheduled_action::domain::models::DispatchEvent>,
}
impl Harness {
    async fn new(pool: PgPool, runner: FakeRunner) -> Self {
        let user_id = generate_uuid_v7();
        sqlx::query!(
            "INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $2, $2) ON CONFLICT DO NOTHING",
            user_id, USER,
        ).execute(&pool).await.unwrap();
        sqlx::query!(
            r#"INSERT INTO "User" (id, email, macro_user_id)
           SELECT $1, $1, id FROM macro_user WHERE email = $1 ON CONFLICT DO NOTHING"#,
            USER,
        )
        .execute(&pool)
        .await
        .unwrap();
        let actions = Arc::new(PgScheduledActionRepo::new(pool.clone()));
        let runs = Arc::new(PgEventRunRepo::new(pool.clone()));
        let runner = Arc::new(runner);
        let tracker = TaskTracker::new();
        let executor = Arc::new(InProcessExecutor::new(
            actions.clone(),
            runner.clone(),
            Arc::new(NoLiveUpdates),
            tracker.clone(),
            CancellationToken::new(),
        ));
        let (tx, notifications) = mpsc::channel(100);
        let service = ScheduledActionServiceImpl::new(actions.clone(), executor.clone(), tx)
            .with_event_management_enabled(true);
        let app = scheduled_action_router(ScheduledActionRouterState {
            service: Arc::new(service),
            authorization_state: MacroAuthorizationState::new(Arc::new(FakeAuth)),
        });
        Self {
            pool,
            app,
            actions,
            runs,
            runner,
            executor,
            tracker,
            _notifications: notifications,
        }
    }
    fn admission(&self) -> Admission {
        // Fresh adapters model restarted intake using only durable state.
        EventAdmissionService::new(
            Arc::new(PgEventRunRepo::new(self.pool.clone())),
            Arc::new(FakeAccess),
            PageSize::try_from(1).unwrap(),
        )
    }
    fn dispatch(&self) -> Dispatch {
        EventDispatchService::new(
            Arc::new(PgEventRunRepo::new(self.pool.clone())),
            Arc::new(FakeAccess),
            self.executor.clone(),
        )
    }
    async fn create(&self, body: Value) -> Value {
        let (status, action) = request(&self.app, "POST", "/scheduled-actions", body).await;
        assert_eq!(status, StatusCode::CREATED, "{action}");
        // UUIDv7 publication times have millisecond precision, while API activation
        // uses PostgreSQL timestamps. Publish strictly after the activation tick.
        let activation = Utc::now().timestamp_millis();
        while Utc::now().timestamp_millis() <= activation {
            tokio::time::sleep(Duration::from_millis(1)).await;
        }
        action
    }
    async fn ingest(&self, event: &IncomingEvent, inserted: u64) {
        assert_eq!(
            self.admission().ingest(event).await.unwrap(),
            EventIngestionResult::Admitted { inserted }
        );
    }
    async fn head(&self) -> PendingEventRun {
        self.runs.pending_runs(page()).await.unwrap().remove(0)
    }
    async fn dispatch_head(&self) {
        assert_eq!(
            self.dispatch()
                .dispatch(self.head().await, pending())
                .await
                .unwrap(),
            DispatchResult::Finished(FinalizationResult::Finalized)
        );
    }
    async fn count(&self) -> i64 {
        sqlx::query_scalar!("SELECT count(*) FROM scheduled_action_event_run")
            .fetch_one(&self.pool)
            .await
            .unwrap()
            .unwrap()
    }
    async fn state(&self, key: EventRunKey) -> (String, Option<Value>, Option<Uuid>) {
        let row = sqlx::query!(
            "SELECT state, outcome, execution_record_id FROM scheduled_action_event_run WHERE action_id = $1 AND event_id = $2",
            key.action_id, key.event_id.as_uuid(),
        ).fetch_one(&self.pool).await.unwrap();
        (row.state, row.outcome, row.execution_record_id)
    }
    async fn assert_terminal(&self, key: EventRunKey, outcome: EventRunOutcome, history: bool) {
        let (state, stored, record) = self.state(key).await;
        assert_eq!(state, "finished");
        assert_eq!(stored, Some(serde_json::to_value(outcome).unwrap()));
        assert_eq!(record.is_some(), history);
    }
    async fn claim_head(&self) -> ClaimedEventRun {
        let head = self.head().await;
        let configuration = self
            .runs
            .current_configuration(head.action_id)
            .await
            .unwrap()
            .unwrap();
        let access = FakeAccess
            .authorize(configuration.owner.as_user().unwrap(), &head.event)
            .await
            .unwrap()
            .unwrap();
        let authorized = AuthorizedEventRun::prepare(head, &configuration, access).unwrap();
        let now = Utc::now();
        self.runs
            .claim(
                authorized,
                ClaimToken::generate(),
                now,
                now + MAX_ACTION_TIME,
            )
            .await
            .unwrap()
            .unwrap()
    }
    fn event_calls(&self) -> Vec<EventRunKey> {
        self.runner
            .calls
            .lock()
            .unwrap()
            .iter()
            .map(|(action_id, event)| EventRunKey {
                action_id: *action_id,
                event_id: event.as_ref().unwrap().event_id(),
            })
            .collect()
    }
}

async fn request(app: &Router, method: &str, uri: &str, body: Value) -> (StatusCode, Value) {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(method)
                .uri(uri)
                .header(header::AUTHORIZATION, "Bearer owner")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}
fn legacy() -> Value {
    json!({"name":"legacy", "kind":"Agent", "schedule":"0 0 9 * * *", "timezone":"UTC", "task":{}, "enabled":true})
}
fn event_action() -> Value {
    json!({"name":"events", "kind":"Agent", "trigger":{"type":"events", "filters":[{"events":["document.updated", "channel.message_posted"]}]}, "task":{}, "enabled":true})
}
fn action_id(action: &Value) -> Uuid {
    action["id"].as_str().unwrap().parse().unwrap()
}
fn key(action_id: Uuid, event: &IncomingEvent) -> EventRunKey {
    EventRunKey {
        action_id,
        event_id: EventId::try_from(event.event_id).unwrap(),
    }
}
fn incoming(name: &str, actor: &str) -> IncomingEvent {
    let envelope = json!({"event_type":name, "metadata":{
        "document_id":generate_uuid_v7(), "owner":USER, "actor":actor,
        "actor_user_id":ACTOR, "share_permission_updated":false,
        "channel_id":generate_uuid_v7(), "message_id":generate_uuid_v7(),
        "sender":actor, "channel_type":"public", "content":"simulated tool output", "mentions":[], "attachments":[],
        "created_at":Utc::now(), "updated_at":Utc::now()
    }});
    IncomingEvent {
        event_id: generate_uuid_v7(),
        schema_version: 1,
        payload: if name.starts_with("document.") {
            EventPayload::Document(serde_json::from_value(envelope).unwrap())
        } else {
            EventPayload::Channel(serde_json::from_value(envelope).unwrap())
        },
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn legacy_cron_and_canonical_events_share_crud_and_manual_execution(pool: PgPool) {
    let h = Harness::new(pool, FakeRunner::default()).await;
    let cron = h.create(legacy()).await;
    let events = h.create(event_action()).await;
    assert_eq!(cron["schedule"], cron["trigger"]["schedule"]);
    assert!(events.get("schedule").is_none());
    assert!(events["next_run_at"].is_null());
    let (status, list) = request(&h.app, "GET", "/scheduled-actions", Value::Null).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(list.as_array().unwrap().len(), 1);
    assert_eq!(list[0]["id"], cron["id"]);
    let (_, all) = request(
        &h.app,
        "GET",
        "/scheduled-actions?include_events=true",
        Value::Null,
    )
    .await;
    assert_eq!(all.as_array().unwrap().len(), 2);

    for (created, mut input) in [(cron, legacy()), (events, event_action())] {
        let id = action_id(&created);
        let url = format!("/scheduled-actions/{id}");
        input["name"] = json!("updated");
        let (status, updated) = request(&h.app, "PUT", &url, input).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(updated["configuration_revision"], 2);
        assert_eq!(updated["name"], "updated");
        let (status, execution) =
            request(&h.app, "POST", &format!("{url}/execute"), Value::Null).await;
        assert_eq!(status, StatusCode::OK);
        h.tracker.close();
        tokio::time::timeout(TEST_TIMEOUT, h.tracker.wait())
            .await
            .unwrap();
        let (status, history) =
            request(&h.app, "GET", &format!("{url}/history"), Value::Null).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(history.as_array().unwrap().len(), 1);
        assert_eq!(history[0]["resource_id"], execution["chat_id"]);
        assert_eq!(history[0]["is_success"], true);
        assert_eq!(
            request(&h.app, "DELETE", &url, Value::Null).await.0,
            StatusCode::NO_CONTENT
        );
        assert!(
            h.actions
                .get_action(&id, MacroUserIdStr::parse_from_str(USER).unwrap())
                .await
                .unwrap()
                .is_none()
        );
    }
    assert_eq!(h.count().await, 0);
    let calls = h.runner.calls.lock().unwrap();
    assert_eq!(calls.len(), 2);
    assert!(calls.iter().all(|(_, context)| context.is_none()));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn two_worker_replicas_queue_two_arrivals_while_active_without_rerunning_failure(
    pool: PgPool,
) {
    let h = Harness::new(
        pool,
        FakeRunner {
            permits: Some(Semaphore::new(0)),
            ..Default::default()
        },
    )
    .await;
    let id = action_id(&h.create(event_action()).await);
    let first = incoming("document.updated", ACTOR);
    *h.runner.fail_event.lock().unwrap() = Some(key(id, &first).event_id);
    h.ingest(&first, 1).await;
    let shutdown = CancellationToken::new();
    let executions = TaskTracker::new();
    let mut workers = Vec::new();
    for _ in 0..2 {
        workers.push(tokio::spawn(run_event_worker(
            h.dispatch(),
            shutdown.clone(),
            executions.clone(),
            PageSize::try_from(2).unwrap(),
        )));
    }
    tokio::time::timeout(TEST_TIMEOUT, async {
        while h.event_calls().is_empty() {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    let second = incoming("document.updated", ACTOR);
    let third = incoming("document.updated", ACTOR);
    h.ingest(&second, 1).await;
    h.ingest(&third, 1).await;
    h.ingest(&second, 0).await;
    h.ingest(&first, 0).await;
    assert_eq!(h.count().await, 3);
    assert_eq!(h.event_calls(), vec![key(id, &first)]);
    assert!(h.runs.pending_runs(page()).await.unwrap().is_empty());
    assert_eq!(h.state(key(id, &second)).await.0, "pending");
    assert_eq!(h.state(key(id, &third)).await.0, "pending");
    h.runner.permits.as_ref().unwrap().add_permits(3);
    tokio::time::timeout(TEST_TIMEOUT, async {
        while h.actions.get_execution_records(&id).await.unwrap().len() < 3 {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    shutdown.cancel();
    for worker in workers {
        tokio::time::timeout(TEST_TIMEOUT, worker)
            .await
            .unwrap()
            .unwrap();
    }
    executions.close();
    tokio::time::timeout(TEST_TIMEOUT, executions.wait())
        .await
        .unwrap();
    assert_eq!(
        h.event_calls(),
        vec![key(id, &first), key(id, &second), key(id, &third)]
    );
    h.assert_terminal(key(id, &first), EventRunOutcome::Failed, true)
        .await;
    for event in [&second, &third] {
        h.assert_terminal(key(id, event), EventRunOutcome::Succeeded, true)
            .await;
    }
    h.ingest(&first, 0).await;
    assert!(h.dispatch().pending(page()).await.unwrap().is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn overlapping_filters_and_multiple_routines_deduplicate_concurrent_redelivery(pool: PgPool) {
    let h = Harness::new(pool, FakeRunner::default()).await;
    let mut input = event_action();
    input["trigger"]["filters"]
        .as_array_mut()
        .unwrap()
        .push(json!({"events":["document.updated"]}));
    let a = action_id(&h.create(input.clone()).await);
    let b = action_id(&h.create(input).await);
    let event = incoming("document.updated", ACTOR);
    let intake_a = h.admission();
    let intake_b = h.admission();
    let (left, right) = tokio::join!(intake_a.ingest(&event), intake_b.ingest(&event));
    let inserted = [left.unwrap(), right.unwrap()]
        .into_iter()
        .map(|result| match result {
            EventIngestionResult::Admitted { inserted } => inserted,
            other => panic!("unexpected rejection: {other:?}"),
        })
        .sum::<u64>();
    assert_eq!(inserted, 2);
    assert_eq!(h.count().await, 2);
    let heads = h.runs.pending_runs(page()).await.unwrap();
    assert_eq!(heads.len(), 2);
    let worker_a = h.dispatch();
    let worker_b = h.dispatch();
    let (left, right) = tokio::join!(
        worker_a.dispatch(heads[0].clone(), pending()),
        worker_b.dispatch(heads[0].clone(), pending())
    );
    let results = [left.unwrap(), right.unwrap()];
    assert!(results.contains(&DispatchResult::Finished(FinalizationResult::Finalized)));
    assert!(results.contains(&DispatchResult::NotStarted));
    h.dispatch_head().await;
    h.ingest(&event, 0).await;
    for id in [a, b] {
        h.assert_terminal(key(id, &event), EventRunOutcome::Succeeded, true)
            .await;
        assert_eq!(
            h.event_calls()
                .iter()
                .filter(|run| run.action_id == id)
                .count(),
            1
        );
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn crash_before_admission_commit_and_after_admission_before_offset_commit(pool: PgPool) {
    let h = Harness::new(pool, FakeRunner::default()).await;
    let id = action_id(&h.create(event_action()).await);
    let event = incoming("document.updated", ACTOR);
    let mut lock = h.pool.begin().await.unwrap();
    sqlx::query_scalar!(
        "SELECT id FROM scheduled_action WHERE id = $1 FOR UPDATE SKIP LOCKED",
        id
    )
    .fetch_one(&mut *lock)
    .await
    .unwrap();
    // Hold the admission transaction before it can insert/commit, then drop the
    // intake future as a process crash would. No acknowledgment is simulated.
    assert!(
        tokio::time::timeout(Duration::from_millis(100), h.admission().ingest(&event))
            .await
            .is_err()
    );
    assert_eq!(h.count().await, 0);
    lock.rollback().await.unwrap();
    h.ingest(&event, 1).await;
    // Crash after durable admission but before Kafka offset commit: a fresh
    // intake instance receives the identical event ID and must insert nothing.
    h.ingest(&event, 0).await;
    assert_eq!(h.count().await, 1);
    h.dispatch_head().await;
    h.assert_terminal(key(id, &event), EventRunOutcome::Succeeded, true)
        .await;
    assert_eq!(h.event_calls(), vec![key(id, &event)]);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn crashes_after_start_and_after_side_effects_are_interrupted_without_reexecution(
    pool: PgPool,
) {
    let h = Harness::new(
        pool,
        FakeRunner {
            emit_bot_outputs: true,
            ..Default::default()
        },
    )
    .await;
    let id = action_id(&h.create(event_action()).await);
    let before_runner = incoming("document.updated", ACTOR);
    let after_runner = incoming("document.updated", ACTOR);
    let later = incoming("document.updated", ACTOR);
    for event in [&before_runner, &after_runner, &later] {
        h.ingest(event, 1).await;
    }

    let claimed = h.claim_head().await;
    let deadline = claimed.deadline;
    drop(claimed); // Started committed, but runner was never invoked.
    assert!(h.event_calls().is_empty());
    assert!(h.runner.outputs.lock().unwrap().is_empty());
    assert!(h.dispatch().pending(page()).await.unwrap().is_empty());
    assert_eq!(h.runs.reconcile(deadline, page()).await.unwrap(), 1);
    h.assert_terminal(key(id, &before_runner), EventRunOutcome::Interrupted, false)
        .await;
    h.ingest(&before_runner, 0).await;

    let claimed = h.claim_head().await;
    assert_eq!(claimed.run.pending.key(), key(id, &after_runner));
    let execution = h.executor.execute(&claimed, pending()).await;
    assert_eq!(execution.outcome, EventRunOutcome::Succeeded);
    assert_eq!(h.runner.outputs.lock().unwrap().len(), 2);
    let deadline = claimed.deadline;
    drop(execution); // Side effect happened; terminal transaction never ran.
    drop(claimed);
    assert_eq!(h.state(key(id, &after_runner)).await.0, "started");
    assert!(
        h.actions
            .get_execution_records(&id)
            .await
            .unwrap()
            .is_empty()
    );
    assert!(h.dispatch().pending(page()).await.unwrap().is_empty());
    assert_eq!(h.runs.reconcile(deadline, page()).await.unwrap(), 1);
    assert_eq!(h.runs.reconcile(deadline, page()).await.unwrap(), 0);
    h.assert_terminal(key(id, &after_runner), EventRunOutcome::Interrupted, false)
        .await;
    h.ingest(&after_runner, 0).await;

    let stale_pending = h.head().await;
    h.dispatch_head().await;
    h.assert_terminal(key(id, &later), EventRunOutcome::Succeeded, true)
        .await;
    // Restart after terminal finalization: both redelivery and a stale worker's
    // pending snapshot must leave the already-finalized execution alone.
    h.ingest(&later, 0).await;
    assert_eq!(
        h.dispatch()
            .dispatch(stale_pending, pending())
            .await
            .unwrap(),
        DispatchResult::NotStarted
    );
    assert_eq!(
        h.event_calls(),
        vec![key(id, &after_runner), key(id, &later)]
    );
    assert_eq!(h.actions.get_execution_records(&id).await.unwrap().len(), 1);
    assert_eq!(h.runner.outputs.lock().unwrap().len(), 4);
    assert_eq!(h.count().await, 3);
    assert!(h.dispatch().pending(page()).await.unwrap().is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn simulated_bot_document_and_channel_outputs_cannot_start_a_routine_loop(pool: PgPool) {
    let h = Harness::new(
        pool,
        FakeRunner {
            emit_bot_outputs: true,
            ..Default::default()
        },
    )
    .await;
    h.create(event_action()).await;
    let event = incoming("channel.message_posted", ACTOR);
    h.ingest(&event, 1).await;
    h.dispatch_head().await;
    let outputs = std::mem::take(&mut *h.runner.outputs.lock().unwrap());
    assert_eq!(outputs.len(), 2);
    for output in outputs {
        // Human ownership/legacy actor metadata must not override explicit bot
        // authorship. Deliver each output twice, as Kafka may do on recovery.
        for _ in 0..2 {
            assert_eq!(
                h.admission().ingest(&output).await.unwrap(),
                EventIngestionResult::Rejected(EventRejection::UnsafeAttribution)
            );
        }
    }
    assert_eq!(h.count().await, 1);
    assert_eq!(h.event_calls().len(), 1);
    assert!(h.dispatch().pending(page()).await.unwrap().is_empty());
}
