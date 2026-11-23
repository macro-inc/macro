use ai_toolset::schema::generate_validated_input_schema;
use ai_toolset::{AsyncTool, RequestContext, ServiceContext};
use chrono::NaiveDate;

use super::read_time_entries::RECENT_ENTRIES as RECENT;
use super::*;
use crate::{
    domain::service::TimeTrackingServiceImpl,
    test_support::{
        EDITOR, FakeAccess, FakeRepo, FixedRollout, OUTSIDER, RecordingPublisher, TASK, TestClock,
        VIEWER, noon, user,
    },
};

type Service = TimeTrackingServiceImpl<FakeRepo, FakeAccess, RecordingPublisher, TestClock>;

struct Tools {
    context: TimeTrackingToolContext<Service, FakeAccess>,
    repo: FakeRepo,
}

fn tools(enabled: bool) -> Tools {
    let access = Arc::new(FakeAccess::team());
    let repo = FakeRepo::with_live_tasks(&[TASK]);
    let service = TimeTrackingServiceImpl::new(
        repo.clone(),
        access.clone(),
        Arc::new(FixedRollout(enabled)),
        RecordingPublisher::default(),
    )
    .with_clock(TestClock::at(noon()));
    Tools {
        context: TimeTrackingToolContext {
            service: Arc::new(service),
            access,
        },
        repo,
    }
}

fn day() -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 11, 20).unwrap()
}

fn log(minutes: u16) -> LogTime {
    LogTime {
        task_id: TASK.to_string(),
        minutes,
        date: day(),
        note: Some("Review".to_string()),
    }
}

async fn log_as(tools: &Tools, who: &str, tool: LogTime) -> ToolResult<LogTimeResponse> {
    tool.call(
        ServiceContext(tools.context.clone()),
        RequestContext::new(user(who)),
    )
    .await
}

async fn read_as(tools: &Tools, who: &str) -> ToolResult<ReadTimeEntriesResponse> {
    ReadTimeEntries {
        task_id: TASK.to_string(),
    }
    .call(
        ServiceContext(tools.context.clone()),
        RequestContext::new(user(who)),
    )
    .await
}

#[test]
fn schemas_validate_and_steer_time_away_from_set_entity_property() {
    let log_time = generate_validated_input_schema::<LogTime>().unwrap();
    assert_eq!(log_time.name, "LogTime");
    assert!(log_time.description.contains("never SetEntityProperty"));
    assert!(
        log_time
            .description
            .contains("no logging time for someone else")
    );
    let schema = serde_json::to_string(&log_time.schema).unwrap();
    for field in ["task_id", "minutes", "date", "note"] {
        assert!(schema.contains(field), "LogTime schema lacks {field}");
    }
    assert!(
        !schema.contains("user_id"),
        "LogTime takes no user to log for"
    );

    let read = generate_validated_input_schema::<ReadTimeEntries>().unwrap();
    assert_eq!(read.name, "ReadTimeEntries");
    let schema = serde_json::to_string(&read.schema).unwrap();
    assert!(!schema.contains("cursor") && !schema.contains("limit"));
}

#[tokio::test]
async fn an_editor_logs_time_as_themselves_and_the_total_follows() {
    let tools = tools(true);

    let first = log_as(&tools, EDITOR, log(90)).await.unwrap();
    let second = log_as(&tools, EDITOR, log(45)).await.unwrap();

    assert_eq!(first.entry.user_id, EDITOR);
    assert_eq!(first.entry.minutes, 90);
    assert_eq!(first.entry.date, day());
    assert_eq!(first.entry.note.as_deref(), Some("Review"));
    assert_eq!(first.total_minutes, 90);
    assert_eq!(second.total_minutes, 135);
    assert_eq!(
        second.summary,
        "Logged 45m on 2026-11-20; the task's Time logged is now 2h 15m."
    );
    assert_eq!(tools.repo.total(TASK), 135);
}

#[tokio::test]
async fn a_viewer_cannot_log_time() {
    let tools = tools(true);

    let error = log_as(&tools, VIEWER, log(30)).await.unwrap_err();

    assert_eq!(
        error.description,
        "You need edit access to the task to log time on it."
    );
    assert_eq!(tools.repo.entry_count(), 0);
}

#[tokio::test]
async fn logging_is_refused_while_time_tracking_is_off_for_the_user() {
    let tools = tools(false);

    let error = log_as(&tools, EDITOR, log(30)).await.unwrap_err();

    assert!(error.description.contains("time tracking is not available"));
    assert_eq!(tools.repo.entry_count(), 0);
}

#[tokio::test]
async fn an_entry_over_a_day_is_refused_with_the_rule() {
    let tools = tools(true);

    let error = log_as(&tools, EDITOR, log(24 * 60 + 1)).await.unwrap_err();

    assert!(error.description.contains("24"), "{}", error.description);
    assert_eq!(tools.repo.entry_count(), 0);
}

#[tokio::test]
async fn a_viewer_reads_everyones_entries_and_the_total() {
    let tools = tools(true);
    log_as(&tools, EDITOR, log(90)).await.unwrap();

    let read = read_as(&tools, VIEWER).await.unwrap();

    assert_eq!(read.total_minutes, 90);
    assert_eq!(read.entries.len(), 1);
    assert_eq!(read.entries[0].user_id, EDITOR);
    assert!(!read.truncated);
    assert_eq!(read.summary, "1h 30m logged in 1 entry.");
}

#[tokio::test]
async fn a_long_history_returns_the_newest_entries_and_says_so() {
    let tools = tools(true);
    for _ in 0..=RECENT {
        log_as(&tools, EDITOR, log(1)).await.unwrap();
    }

    let read = read_as(&tools, VIEWER).await.unwrap();

    assert_eq!(read.entries.len(), usize::from(RECENT));
    assert!(read.truncated);
    assert_eq!(read.total_minutes, u32::from(RECENT) + 1);
    assert!(read.summary.contains("showing the 50 most recent"));
}

#[tokio::test]
async fn someone_without_access_reads_nothing() {
    let tools = tools(true);
    log_as(&tools, EDITOR, log(90)).await.unwrap();

    let error = read_as(&tools, OUTSIDER).await.unwrap_err();

    assert_eq!(
        error.description,
        "The task was not found or you cannot view it."
    );
}

#[tokio::test]
async fn an_empty_task_reads_as_no_time() {
    let tools = tools(true);

    let read = read_as(&tools, VIEWER).await.unwrap();

    assert_eq!(read.total_minutes, 0);
    assert!(read.entries.is_empty());
    assert_eq!(read.summary, "No time has been logged on this task.");
}
