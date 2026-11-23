use ::time_tracking::domain::{
    models::{
        LoggedTime, NewTimeEntry, RunningTimer, StartTimer, StartedTimer, StopTimer, StoppedTimer,
        TaskTimeTotal, TimeEntry, TimeEntryChanges, TimeEntryPage, TimeEntryPageRequest,
        TimeEntrySource, TimeTrackingError, TimerState,
    },
    service::{TaskEditReceipt, TaskViewReceipt, TimeTrackingService},
};
use chrono::{NaiveDate, TimeZone};
use graphql_time_tracking::{TimeTrackingAuthorizer, TimeTrackingGraphqlContext};

use super::*;

const TASK_ID: Uuid = Uuid::from_u128(0x7a5c);
const ENTRY_ID: Uuid = Uuid::from_u128(0xe17);
const TIMER_ID: Uuid = Uuid::from_u128(0x71e);

fn noon() -> chrono::DateTime<chrono::Utc> {
    chrono::Utc
        .with_ymd_and_hms(2026, 11, 20, 12, 0, 0)
        .unwrap()
}

fn entry(id: Uuid, minutes: u16) -> TimeEntry {
    TimeEntry {
        id,
        task_id: TASK_ID.to_string(),
        user_id: MacroUserIdStr::parse_from_str(VALID_USER_ID).unwrap(),
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

/// Answers reads with one entry and one running timer, and logs what it is given.
struct OneTaskTime;

impl TimeTrackingService for OneTaskTime {
    async fn list_entries(
        &self,
        receipt: &TaskViewReceipt,
        _: TimeEntryPageRequest,
    ) -> Result<TimeEntryPage, TimeTrackingError> {
        assert_eq!(receipt.entity().entity_id, TASK_ID.to_string());
        Ok(TimeEntryPage {
            entries: vec![entry(ENTRY_ID, 90)],
            total_minutes: 90,
            next_cursor: None,
        })
    }

    async fn log_entry(
        &self,
        _: &TaskEditReceipt,
        logged: NewTimeEntry,
    ) -> Result<LoggedTime, TimeTrackingError> {
        Ok(LoggedTime {
            entry: entry(logged.id.unwrap(), logged.minutes),
            total_minutes: 90 + u32::from(logged.minutes),
        })
    }

    async fn update_entry(
        &self,
        _: &MacroUserIdStr<'static>,
        _: Uuid,
        _: TimeEntryChanges,
    ) -> Result<LoggedTime, TimeTrackingError> {
        unimplemented!()
    }

    async fn delete_entry(
        &self,
        _: &MacroUserIdStr<'static>,
        _: Uuid,
    ) -> Result<TaskTimeTotal, TimeTrackingError> {
        unimplemented!()
    }

    async fn timer(&self, _: &MacroUserIdStr<'static>) -> Result<TimerState, TimeTrackingError> {
        Ok(TimerState {
            timer: Some(RunningTimer {
                id: TIMER_ID,
                task_id: TASK_ID.to_string(),
                started_at: noon(),
            }),
            server_now: noon(),
        })
    }

    async fn start_timer(
        &self,
        _: &TaskEditReceipt,
        _: StartTimer,
    ) -> Result<StartedTimer, TimeTrackingError> {
        unimplemented!()
    }

    async fn stop_timer(
        &self,
        _: &MacroUserIdStr<'static>,
        _: StopTimer,
    ) -> Result<StoppedTimer, TimeTrackingError> {
        unimplemented!()
    }

    async fn discard_timer(
        &self,
        _: &MacroUserIdStr<'static>,
        _: Uuid,
    ) -> Result<(), TimeTrackingError> {
        unimplemented!()
    }
}

/// The viewer edits every task.
struct EditsEveryTask;

impl TimeTrackingAuthorizer for EditsEveryTask {
    async fn authorize<T: RequiredPermission>(
        &self,
        user: &MacroUserIdStr<'static>,
        task_id: &str,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        EntityAccessReceipt::try_new_authenticated_user(
            user.clone(),
            entity_access::domain::models::Entity {
                entity_id: task_id.to_owned(),
                entity_type: EntityType::Document,
            },
            EntityPermission::AccessLevel {
                access_level: AccessLevel::Edit,
            },
        )
    }
}

async fn execute_time_query(harness: &TestHarness, query: &str) -> async_graphql::Response {
    let viewer = MacroUserIdStr::parse_from_str(VALID_USER_ID).unwrap();
    let context = TimeTrackingGraphqlContext::new(Arc::new(OneTaskTime), Arc::new(EditsEveryTask));
    harness
        .schema
        .execute(
            harness
                .request(query, authenticated_parts())
                .data(viewer.clone())
                .data(graphql_time_tracking::time_entries_loader(
                    context.clone(),
                    viewer,
                ))
                .data(context),
        )
        .await
}

#[tokio::test]
async fn a_task_lists_its_entries_and_the_viewer_reads_their_timer_with_its_task() {
    let harness = harness();
    harness
        .primary_soup_service
        .set_raw_response(vec![soup_document(TASK_ID)]);

    let response = execute_time_query(
        &harness,
        &format!(
            r#"{{ user {{
                id
                soupEntity(input: {{ entityType: DOCUMENT, entityId: "{TASK_ID}" }}) {{
                    __typename id
                    ... on GraphqlSoupDocument {{
                        timeEntries {{ entries {{ id taskId minutes canEdit }} nextCursor }}
                    }}
                }}
                timeTracking {{
                    id
                    serverNow
                    runningTimer {{ id taskId task {{ __typename id name }} }}
                }}
            }} }}"#
        ),
    )
    .await;

    assert!(response.errors.is_empty(), "{:?}", response.errors);
    let data = response.data.into_json().unwrap();
    assert_eq!(
        data["user"]["soupEntity"]["timeEntries"],
        serde_json::json!({
            "entries": [{
                "id": ENTRY_ID.to_string(),
                "taskId": TASK_ID.to_string(),
                "minutes": 90,
                "canEdit": true,
            }],
            "nextCursor": null,
        })
    );
    let tracking = &data["user"]["timeTracking"];
    assert_eq!(tracking["id"], VALID_USER_ID);
    assert_eq!(tracking["serverNow"], noon().to_rfc3339());
    assert_eq!(tracking["runningTimer"]["id"], TIMER_ID.to_string());
    assert_eq!(
        tracking["runningTimer"]["task"],
        serde_json::json!({
            "__typename": "GraphqlSoupDocument",
            "id": TASK_ID.to_string(),
            "name": format!("Document {TASK_ID}"),
        })
    );
}

#[tokio::test]
async fn logging_time_replies_with_the_task_read_from_the_primary() {
    let harness = harness();
    // The replica has not seen the task; only the primary answers.
    harness.soup_service.set_raw_response(Vec::new());
    harness
        .primary_soup_service
        .set_raw_response(vec![soup_document(TASK_ID)]);
    let logged = Uuid::from_u128(0xe18);

    let response = execute_time_query(
        &harness,
        &format!(
            r#"mutation {{ logTime(input: {{
                id: "{logged}", taskId: "{TASK_ID}", date: "2026-11-20", minutes: 30,
            }}) {{
                entry {{ id minutes canEdit }}
                task {{ __typename id timeEntries {{ entries {{ id }} }} }}
            }} }}"#
        ),
    )
    .await;

    assert!(response.errors.is_empty(), "{:?}", response.errors);
    assert_eq!(
        response.data.into_json().unwrap(),
        serde_json::json!({ "logTime": {
            "entry": { "id": logged.to_string(), "minutes": 30, "canEdit": true },
            "task": {
                "__typename": "GraphqlSoupDocument",
                "id": TASK_ID.to_string(),
                "timeEntries": { "entries": [{ "id": ENTRY_ID.to_string() }] },
            },
        } })
    );
}
