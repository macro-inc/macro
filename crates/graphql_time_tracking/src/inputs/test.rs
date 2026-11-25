use async_graphql::{ErrorExtensions, Value};
use chrono::{TimeZone, Utc};

use super::*;

const ENTRY: &str = "0196a000-0000-7000-8000-000000000001";
const TASK: &str = "00000000-0000-0000-0000-0000000000a1";

fn code(error: &async_graphql::Error) -> Option<Value> {
    error
        .clone()
        .extend()
        .extensions
        .and_then(|extensions| extensions.get("code").cloned())
}

fn log_input() -> LogTimeInput {
    LogTimeInput {
        id: ID(ENTRY.to_string()),
        task_id: ID(TASK.to_string()),
        date: "2026-11-20".to_string(),
        minutes: 90,
        note: Some("Review".to_string()),
        started_at: Some("2026-11-20T09:00:00-05:00".to_string()),
        ended_at: Some("2026-11-20T10:30:00-05:00".to_string()),
    }
}

#[test]
fn log_input_becomes_the_domain_entry_with_its_client_id_and_utc_span() {
    let (task_id, entry) = log_input().into_domain().unwrap();
    assert_eq!(task_id, TASK);
    assert_eq!(entry.id, Some(ENTRY.parse().unwrap()));
    assert_eq!(entry.date, NaiveDate::from_ymd_opt(2026, 11, 20).unwrap());
    assert_eq!(entry.minutes, 90);
    assert_eq!(entry.note.as_deref(), Some("Review"));
    assert_eq!(
        entry.started_at,
        Utc.with_ymd_and_hms(2026, 11, 20, 14, 0, 0).single()
    );
    assert_eq!(
        entry.ended_at,
        Utc.with_ymd_and_hms(2026, 11, 20, 15, 30, 0).single()
    );
}

#[test]
fn log_input_refuses_values_the_domain_cannot_hold_as_bad_input() {
    let cases = [
        LogTimeInput {
            date: "20 Nov 2026".to_string(),
            ..log_input()
        },
        LogTimeInput {
            minutes: -5,
            ..log_input()
        },
        LogTimeInput {
            minutes: i32::from(u16::MAX) + 1,
            ..log_input()
        },
        LogTimeInput {
            started_at: Some("yesterday".to_string()),
            ..log_input()
        },
    ];
    for input in cases {
        let error = input.into_domain().unwrap_err();
        assert_eq!(
            code(&error),
            Some(Value::from("BAD_USER_INPUT")),
            "{error:?}"
        );
    }
}

fn update_input() -> UpdateTimeEntryInput {
    UpdateTimeEntryInput {
        id: ID(ENTRY.to_string()),
        date: None,
        minutes: None,
        note: MaybeUndefined::Undefined,
        started_at: MaybeUndefined::Undefined,
        ended_at: MaybeUndefined::Undefined,
    }
}

#[test]
fn an_omitted_field_keeps_the_stored_value_and_null_clears_it() {
    let (id, kept) = update_input().into_domain().unwrap();
    assert_eq!(id, ENTRY.parse::<Uuid>().unwrap());
    assert_eq!(kept, TimeEntryChanges::default());

    let (_, cleared) = UpdateTimeEntryInput {
        note: MaybeUndefined::Null,
        started_at: MaybeUndefined::Null,
        ended_at: MaybeUndefined::Null,
        ..update_input()
    }
    .into_domain()
    .unwrap();
    assert_eq!(cleared.note, FieldEdit::Clear);
    assert_eq!(cleared.started_at, FieldEdit::Clear);
    assert_eq!(cleared.ended_at, FieldEdit::Clear);

    let (_, set) = UpdateTimeEntryInput {
        date: Some("2026-11-19".to_string()),
        minutes: Some(45),
        note: MaybeUndefined::Value("Call".to_string()),
        ..update_input()
    }
    .into_domain()
    .unwrap();
    assert_eq!(set.date, NaiveDate::from_ymd_opt(2026, 11, 19));
    assert_eq!(set.minutes, Some(45));
    assert_eq!(set.note, FieldEdit::Set("Call".to_string()));
    assert_eq!(set.started_at, FieldEdit::Keep);
}

#[test]
fn a_stop_says_when_it_stopped_or_logs_all_but_not_both() {
    let stop = |ended_at: Option<&str>, log_all: Option<bool>| StopTimerInput {
        timer_id: ID(ENTRY.to_string()),
        time_zone: Some("America/New_York".to_string()),
        ended_at: ended_at.map(str::to_string),
        log_all,
    };
    assert_eq!(
        stop(None, None).into_domain().unwrap().ending,
        TimerEnding::Now
    );
    assert_eq!(
        stop(None, Some(true)).into_domain().unwrap().ending,
        TimerEnding::LogAll
    );
    assert_eq!(
        stop(Some("2026-11-20T17:00:00Z"), None)
            .into_domain()
            .unwrap()
            .ending,
        TimerEnding::At(Utc.with_ymd_and_hms(2026, 11, 20, 17, 0, 0).unwrap())
    );
    let both = stop(Some("2026-11-20T17:00:00Z"), Some(true))
        .into_domain()
        .unwrap_err();
    assert_eq!(code(&both), Some(Value::from("BAD_USER_INPUT")));
}

#[test]
fn an_unknown_time_zone_is_bad_input() {
    let error = StartTimerInput {
        id: ID(ENTRY.to_string()),
        task_id: ID(TASK.to_string()),
        time_zone: Some("Mars/Olympus".to_string()),
        started_at: None,
    }
    .into_domain()
    .unwrap_err();
    assert_eq!(code(&error), Some(Value::from("BAD_USER_INPUT")));
}

#[test]
fn a_cursor_a_page_returns_reads_back_as_the_same_position() {
    let cursor = TimeEntryCursor {
        date: NaiveDate::from_ymd_opt(2026, 11, 20).unwrap(),
        id: ENTRY.parse().unwrap(),
    };
    let page = page_request(Some(20), Some(&encode_cursor(cursor).unwrap())).unwrap();
    assert_eq!(page.limit, Some(20));
    assert_eq!(page.after, Some(cursor));
}

#[test]
fn a_page_defaults_to_the_domain_page_size_and_refuses_foreign_cursors() {
    assert_eq!(
        page_request(None, None).unwrap(),
        TimeEntryPageRequest {
            limit: Some(DEFAULT_PAGE_LIMIT),
            after: None,
        }
    );
    assert!(page_request(Some(i32::from(MAX_PAGE_LIMIT) + 1), None).is_err());
    let error = page_request(None, Some("2026-11-20_not-an-id")).unwrap_err();
    assert_eq!(code(&error), Some(Value::from("BAD_USER_INPUT")));
}
