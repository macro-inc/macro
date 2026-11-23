//! Schema-level tests of the time tracking adapter over a scripted domain.

use std::sync::{Arc, Mutex};

use async_graphql::{
    Context, EmptySubscription, Object, Request, Schema, SimpleObject, Value, value,
};
use chrono::{DateTime, NaiveDate, TimeZone, Utc};
use entity_access::domain::models::{
    AccessError, AccessLevel, Entity, EntityAccessReceipt, EntityPermission, EntityType,
    RequiredPermission,
};
use graphql_soup::SoupEntityEdges;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use time_tracking::domain::{
    models::{
        LoggedTime, NewTimeEntry, RunningTimer, StartTimer, StartedTimer, StopTimer, StoppedTimer,
        TaskTimeTotal, TimeEntry, TimeEntryChanges, TimeEntryCursor, TimeEntryPage,
        TimeEntryPageRequest, TimeEntrySource, TimeTrackingError, TimerState,
    },
    service::{TaskEditReceipt, TaskViewReceipt, TimeTrackingService},
};
use uuid::Uuid;

use crate::{
    GraphqlTimeEntryPage, GraphqlTimeTracking, TimeTrackingAuthorizer, TimeTrackingGraphqlContext,
    TimeTrackingMutationRoot, load_time_entries, resolve_time_tracking, time_entries_loader,
};

const AUTHOR: &str = "macro|author@example.com";
const VIEWER: &str = "macro|viewer@example.com";
const TASK: &str = "00000000-0000-0000-0000-0000000000a1";
const HIDDEN_TASK: &str = "00000000-0000-0000-0000-0000000000a2";
const ENTRY: &str = "0196a000-0000-7000-8000-000000000001";
const OTHER_ENTRY: &str = "0196a000-0000-7000-8000-000000000002";
const TIMER: &str = "0196a000-0000-7000-8000-0000000000f1";

fn user(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(id).unwrap().into_owned()
}

fn noon() -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 11, 20, 12, 0, 0).unwrap()
}

fn entry(id: &str, author: &str, minutes: u16) -> TimeEntry {
    TimeEntry {
        id: id.parse().unwrap(),
        task_id: TASK.to_string(),
        user_id: user(author),
        date: NaiveDate::from_ymd_opt(2026, 11, 20).unwrap(),
        minutes,
        note: None,
        started_at: None,
        ended_at: None,
        source: TimeEntrySource::Manual,
        created_at: noon(),
        updated_at: noon(),
    }
}

fn timer() -> RunningTimer {
    RunningTimer {
        id: TIMER.parse().unwrap(),
        task_id: TASK.to_string(),
        started_at: noon() - chrono::TimeDelta::hours(9),
    }
}

/// A domain refusal the script answers with; built per call, as errors do not clone.
type Refusal = fn() -> TimeTrackingError;

/// What the scripted domain answers.
#[derive(Default)]
struct Script {
    entries: Vec<TimeEntry>,
    timer: Option<RunningTimer>,
    /// The page request the last list received.
    listed: Option<TimeEntryPageRequest>,
    delete: Option<Refusal>,
    start_over_limit: bool,
}

#[derive(Clone, Default)]
struct ScriptedService(Arc<Mutex<Script>>);

impl TimeTrackingService for ScriptedService {
    async fn list_entries(
        &self,
        _: &TaskViewReceipt,
        page: TimeEntryPageRequest,
    ) -> Result<TimeEntryPage, TimeTrackingError> {
        let mut script = self.0.lock().unwrap();
        script.listed = Some(page);
        let limit = usize::from(page.limit.unwrap_or(50));
        let entries: Vec<TimeEntry> = script.entries.iter().take(limit).cloned().collect();
        let next_cursor = (script.entries.len() > limit)
            .then(|| entries.last())
            .flatten()
            .map(|last| TimeEntryCursor {
                date: last.date,
                id: last.id,
            });
        Ok(TimeEntryPage {
            entries,
            total_minutes: 0,
            next_cursor,
        })
    }

    async fn log_entry(
        &self,
        receipt: &TaskEditReceipt,
        entry: NewTimeEntry,
    ) -> Result<LoggedTime, TimeTrackingError> {
        let logged = TimeEntry {
            id: entry.id.unwrap(),
            user_id: receipt.get_authenticated_user().unwrap().clone(),
            date: entry.date,
            minutes: entry.minutes,
            note: entry.note,
            ..self::entry(ENTRY, AUTHOR, entry.minutes)
        };
        self.0.lock().unwrap().entries.insert(0, logged.clone());
        Ok(LoggedTime {
            entry: logged,
            total_minutes: 0,
        })
    }

    async fn update_entry(
        &self,
        _: &MacroUserIdStr<'static>,
        _: Uuid,
        _: TimeEntryChanges,
    ) -> Result<LoggedTime, TimeTrackingError> {
        Err(TimeTrackingError::NotAuthor)
    }

    async fn delete_entry(
        &self,
        _: &MacroUserIdStr<'static>,
        _: Uuid,
    ) -> Result<TaskTimeTotal, TimeTrackingError> {
        match self.0.lock().unwrap().delete {
            Some(error) => Err(error()),
            None => Ok(TaskTimeTotal { total_minutes: 0 }),
        }
    }

    async fn timer(&self, _: &MacroUserIdStr<'static>) -> Result<TimerState, TimeTrackingError> {
        Ok(TimerState {
            timer: self.0.lock().unwrap().timer.clone(),
            server_now: noon(),
        })
    }

    async fn start_timer(
        &self,
        _: &TaskEditReceipt,
        _: StartTimer,
    ) -> Result<StartedTimer, TimeTrackingError> {
        let script = self.0.lock().unwrap();
        match (&script.timer, script.start_over_limit) {
            (Some(running), true) => Err(TimeTrackingError::TimerOverLimit(running.clone())),
            _ => Err(TimeTrackingError::Conflict("not scripted")),
        }
    }

    async fn stop_timer(
        &self,
        _: &MacroUserIdStr<'static>,
        stop: StopTimer,
    ) -> Result<StoppedTimer, TimeTrackingError> {
        let mut script = self.0.lock().unwrap();
        let stopped = script
            .timer
            .take()
            .filter(|timer| timer.id == stop.timer_id);
        Ok(StoppedTimer {
            logged: stopped.map(|timer| LoggedTime {
                entry: TimeEntry {
                    id: timer.id,
                    source: TimeEntrySource::Timer,
                    ..entry(TIMER, AUTHOR, 540)
                },
                total_minutes: 540,
            }),
        })
    }

    async fn discard_timer(
        &self,
        _: &MacroUserIdStr<'static>,
        _: Uuid,
    ) -> Result<(), TimeTrackingError> {
        self.0.lock().unwrap().timer = None;
        Ok(())
    }
}

/// Gives the author edit access to the task and everyone else view access;
/// nobody sees the hidden task.
struct AuthorEdits;

impl TimeTrackingAuthorizer for AuthorEdits {
    async fn authorize<T: RequiredPermission>(
        &self,
        user: &MacroUserIdStr<'static>,
        task_id: &str,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        if task_id == HIDDEN_TASK {
            return Err(AccessError::NotFound("task"));
        }
        let access_level = if user.as_ref() == AUTHOR {
            AccessLevel::Edit
        } else {
            AccessLevel::View
        };
        EntityAccessReceipt::try_new_authenticated_user(
            user.clone(),
            Entity {
                entity_id: task_id.to_string(),
                entity_type: EntityType::Document,
            },
            EntityPermission::AccessLevel { access_level },
        )
    }
}

#[derive(Clone, SimpleObject)]
struct TestEdges {
    available: bool,
}

impl SoupEntityEdges for TestEdges {
    type Property = String;
    type Notification = String;
    type NotificationFilter = String;
    type ActivityEvent = String;
    type EmailThreadEdges = TestEdges;
    type CrmRecordEdges = TestEdges;
    type InitiativeEdges = TestEdges;
    type AgentSessionEdges = TestEdges;
    type DocumentEdges = TestEdges;

    fn from_entity(_: model_entity::Entity<'static>) -> Self {
        Self { available: true }
    }

    fn document_edges(_: Uuid, _: bool) -> Self::DocumentEdges {
        Self { available: true }
    }

    fn initiative_edges(_: Uuid) -> Self::InitiativeEdges {
        Self { available: true }
    }

    fn email_thread_edges(_: Uuid) -> Self::EmailThreadEdges {
        Self { available: true }
    }

    fn crm_record_edges(_: model_entity::Entity<'static>) -> Self::CrmRecordEdges {
        Self { available: true }
    }

    async fn resolve_email_cache_projection(
        &self,
        _: &Context<'_>,
        _: Uuid,
    ) -> async_graphql::Result<Option<String>> {
        Ok(None)
    }

    fn agent_session_edges(_: Uuid, _: Uuid) -> Self::AgentSessionEdges {
        Self { available: true }
    }

    async fn resolve_properties(&self, _: &Context<'_>) -> async_graphql::Result<Vec<String>> {
        Ok(Vec::new())
    }

    async fn resolve_notifications(
        &self,
        _: &Context<'_>,
        _: Option<String>,
        _: Option<i32>,
    ) -> async_graphql::Result<Vec<String>> {
        Ok(Vec::new())
    }

    async fn resolve_is_favorited(&self, _: &Context<'_>) -> async_graphql::Result<bool> {
        Ok(false)
    }

    async fn resolve_viewer_permission(
        &self,
        _: &Context<'_>,
    ) -> async_graphql::Result<Option<graphql_permission::GraphqlEntityPermission>> {
        Ok(None)
    }

    async fn resolve_activity(
        &self,
        _: &Context<'_>,
        _: Option<i32>,
    ) -> async_graphql::Result<Vec<String>> {
        Ok(Vec::new())
    }
}

struct QueryRoot;

#[Object]
impl QueryRoot {
    async fn time_tracking(
        &self,
        ctx: &Context<'_>,
    ) -> async_graphql::Result<GraphqlTimeTracking<TestEdges>> {
        let user = graphql_common::require_authenticated_user(ctx)?;
        resolve_time_tracking(ctx, &user).await
    }

    async fn time_entries(
        &self,
        ctx: &Context<'_>,
        task_id: Option<String>,
        limit: Option<i32>,
        after: Option<String>,
    ) -> async_graphql::Result<GraphqlTimeEntryPage> {
        let task_id = task_id.as_deref().unwrap_or(TASK).parse().unwrap();
        load_time_entries(ctx, task_id, limit, after).await
    }
}

type TestSchema = Schema<QueryRoot, TimeTrackingMutationRoot<TestEdges>, EmptySubscription>;

fn schema() -> TestSchema {
    Schema::build(
        QueryRoot,
        TimeTrackingMutationRoot::default(),
        EmptySubscription,
    )
    .finish()
}

async fn execute(service: &ScriptedService, viewer: &str, query: &str) -> async_graphql::Response {
    let context = TimeTrackingGraphqlContext::new(Arc::new(service.clone()), Arc::new(AuthorEdits));
    schema()
        .execute(
            Request::new(query)
                .data(user(viewer))
                .data(time_entries_loader(context.clone(), user(viewer)))
                .data(context),
        )
        .await
}

fn error_code(response: &async_graphql::Response) -> Option<Value> {
    response
        .errors
        .first()?
        .extensions
        .as_ref()?
        .get("code")
        .cloned()
}

#[tokio::test]
async fn entries_say_which_the_viewer_may_change_and_page_by_an_opaque_cursor() {
    let service = ScriptedService::default();
    service.0.lock().unwrap().entries =
        vec![entry(ENTRY, VIEWER, 30), entry(OTHER_ENTRY, AUTHOR, 45)];

    let first = execute(
        &service,
        VIEWER,
        "{ timeEntries(limit: 1) { entries { id userId minutes canEdit } nextCursor } }",
    )
    .await;
    assert!(first.errors.is_empty(), "{:?}", first.errors);
    let data = first.data.into_json().unwrap();
    assert_eq!(data["timeEntries"]["entries"][0]["id"], ENTRY);
    assert_eq!(data["timeEntries"]["entries"][0]["canEdit"], true);
    let cursor = data["timeEntries"]["nextCursor"]
        .as_str()
        .unwrap()
        .to_string();

    let next = execute(
        &service,
        VIEWER,
        &format!(
            "{{ timeEntries(limit: 1, after: {}) {{ entries {{ id }} }} }}",
            serde_json::to_string(&cursor).unwrap()
        ),
    )
    .await;
    assert!(next.errors.is_empty(), "{:?}", next.errors);
    assert_eq!(
        service.0.lock().unwrap().listed.unwrap().after,
        Some(TimeEntryCursor {
            date: NaiveDate::from_ymd_opt(2026, 11, 20).unwrap(),
            id: ENTRY.parse().unwrap(),
        })
    );

    let others = execute(&service, AUTHOR, "{ timeEntries { entries { canEdit } } }").await;
    assert_eq!(
        others.data,
        value!({ "timeEntries": { "entries": [{ "canEdit": false }, { "canEdit": true }] } })
    );
}

#[tokio::test]
async fn one_batch_answers_each_task_and_refuses_only_the_hidden_one() {
    let service = ScriptedService::default();
    service.0.lock().unwrap().entries = vec![entry(ENTRY, VIEWER, 30)];

    let response = execute(
        &service,
        VIEWER,
        &format!(
            r#"{{
                visible: timeEntries {{ entries {{ id }} }}
                hidden: timeEntries(taskId: "{HIDDEN_TASK}") {{ entries {{ id }} }}
            }}"#
        ),
    )
    .await;
    assert_eq!(response.errors.len(), 1, "{:?}", response.errors);
    assert_eq!(error_code(&response), Some(Value::from("NOT_FOUND")));
    assert_eq!(
        response.data.into_json().unwrap()["visible"],
        serde_json::json!({ "entries": [{ "id": ENTRY }] })
    );
}

const LOG: &str = r#"mutation {
    logTime(input: {
        id: "0196a000-0000-7000-8000-000000000001",
        taskId: "00000000-0000-0000-0000-0000000000a1",
        date: "2026-11-20",
        minutes: 90,
    }) { entry { id minutes source canEdit } }
}"#;

#[tokio::test]
async fn logging_needs_edit_access_on_the_task() {
    let service = ScriptedService::default();

    let refused = execute(&service, VIEWER, LOG).await;
    assert_eq!(error_code(&refused), Some(Value::from("FORBIDDEN")));
    assert!(service.0.lock().unwrap().entries.is_empty());

    let logged = execute(&service, AUTHOR, LOG).await;
    assert!(logged.errors.is_empty(), "{:?}", logged.errors);
    assert_eq!(
        logged.data,
        value!({ "logTime": { "entry": {
            "id": ENTRY, "minutes": 90, "source": "MANUAL", "canEdit": true,
        } } })
    );
}

const DELETE: &str = r#"mutation {
    deleteTimeEntry(input: {
        id: "0196a000-0000-7000-8000-000000000001",
        taskId: "00000000-0000-0000-0000-0000000000a1",
    }) { deletedEntryId }
}"#;

#[tokio::test]
async fn deleting_an_entry_that_is_already_gone_settles_as_deleted() {
    let service = ScriptedService::default();
    service.0.lock().unwrap().delete = Some(|| TimeTrackingError::NotFound("time entry"));

    let response = execute(&service, AUTHOR, DELETE).await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    assert_eq!(
        response.data,
        value!({ "deleteTimeEntry": { "deletedEntryId": ENTRY } })
    );
}

#[tokio::test]
async fn deleting_keeps_every_other_refusal() {
    let cases: [(Refusal, &str); 3] = [
        (|| TimeTrackingError::NotAuthor, "NOT_AUTHOR"),
        (|| TimeTrackingError::NotFound("time tracking"), "NOT_FOUND"),
        (|| TimeTrackingError::Busy, "UNAVAILABLE"),
    ];
    for (error, code) in cases {
        let service = ScriptedService::default();
        service.0.lock().unwrap().delete = Some(error);
        let response = execute(&service, AUTHOR, DELETE).await;
        assert_eq!(error_code(&response), Some(Value::from(code)));
    }
}

#[tokio::test]
async fn a_start_refused_for_a_timer_past_the_limit_names_that_timer() {
    let service = ScriptedService::default();
    {
        let mut script = service.0.lock().unwrap();
        script.timer = Some(timer());
        script.start_over_limit = true;
    }

    let response = execute(
        &service,
        AUTHOR,
        r#"mutation { startTimer(input: {
            id: "0196a000-0000-7000-8000-0000000000f2",
            taskId: "00000000-0000-0000-0000-0000000000a1",
        }) { timeTracking { id } } }"#,
    )
    .await;
    let extensions = response.errors[0].extensions.as_ref().unwrap();
    assert_eq!(
        extensions.get("code"),
        Some(&Value::from("TIMER_OVER_LIMIT"))
    );
    assert_eq!(
        extensions.get("timer"),
        Some(&value!({
            "id": TIMER,
            "taskId": TASK,
            "startedAt": timer().started_at.to_rfc3339(),
        }))
    );
}

#[tokio::test]
async fn the_viewers_time_tracking_is_one_record_that_a_stop_clears() {
    let service = ScriptedService::default();
    service.0.lock().unwrap().timer = Some(timer());

    let read = execute(
        &service,
        AUTHOR,
        "{ timeTracking { id runningTimer { id taskId } serverNow } }",
    )
    .await;
    assert_eq!(
        read.data,
        value!({ "timeTracking": {
            "id": AUTHOR,
            "runningTimer": { "id": TIMER, "taskId": TASK },
            "serverNow": noon().to_rfc3339(),
        } })
    );

    let stopped = execute(
        &service,
        AUTHOR,
        r#"mutation { stopTimer(input: { timerId: "0196a000-0000-7000-8000-0000000000f1" }) {
            timeTracking { id runningTimer { id } }
            entry { id source minutes }
        } }"#,
    )
    .await;
    assert!(stopped.errors.is_empty(), "{:?}", stopped.errors);
    assert_eq!(
        stopped.data,
        value!({ "stopTimer": {
            "timeTracking": { "id": AUTHOR, "runningTimer": null },
            "entry": { "id": TIMER, "source": "TIMER", "minutes": 540 },
        } })
    );

    let discarded = execute(
        &service,
        AUTHOR,
        r#"mutation { discardTimer(timerId: "0196a000-0000-7000-8000-0000000000f1") {
            timeTracking { runningTimer { id } }
        } }"#,
    )
    .await;
    assert_eq!(
        discarded.data,
        value!({ "discardTimer": { "timeTracking": { "runningTimer": null } } })
    );
}

#[tokio::test]
async fn an_edit_by_someone_else_is_refused_as_not_author() {
    let response = execute(
        &ScriptedService::default(),
        VIEWER,
        r#"mutation { updateTimeEntry(input: {
            id: "0196a000-0000-7000-8000-000000000001", minutes: 5,
        }) { entry { id } } }"#,
    )
    .await;
    assert_eq!(error_code(&response), Some(Value::from("NOT_AUTHOR")));
}
