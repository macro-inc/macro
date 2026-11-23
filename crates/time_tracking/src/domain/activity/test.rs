use activity::{Action, Ingest, TimeLog, TimeLogSource, activity_id};
use chrono::NaiveDate;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use uuid::Uuid;

use super::*;

const TASK: &str = "00000000-0000-0000-0000-0000000000a1";

fn change(source: TimeEntrySource) -> TimeEntryChange {
    TimeEntryChange {
        entry_id: Uuid::from_u128(7),
        task_id: TASK.to_owned(),
        user_id: MacroUserIdStr::parse_from_str("macro|author@example.com")
            .expect("valid user id")
            .into_owned(),
        minutes: 90,
        entry_date: NaiveDate::from_ymd_opt(2026, 11, 20).expect("valid date"),
        source,
        total_minutes: 135,
    }
}

#[test]
fn logging_time_is_an_activity_on_the_task_by_the_person_who_logged_it() {
    let event_id = Uuid::now_v7();

    let Ingest::Insert(activities) =
        TimeEntryTopicEvent::Logged(change(TimeEntrySource::Timer)).ingest(event_id)
    else {
        panic!("a logged entry inserts an activity");
    };

    assert_eq!(activities.len(), 1);
    let activity = &activities[0];
    assert_eq!(activity.id, activity_id(event_id, 0));
    assert_eq!(activity.entity_type, EntityType::Document);
    assert_eq!(activity.entity_id, TASK);
    assert_eq!(activity.actor.as_ref(), "macro|author@example.com");
    assert_eq!(activity.subject_id, "macro|author@example.com");
    assert_eq!(activity.occurred_at, event_time(event_id));
    assert_eq!(
        activity.action,
        Action::TimeLogged(TimeLog {
            minutes: 90,
            entry_date: NaiveDate::from_ymd_opt(2026, 11, 20).expect("valid date"),
            source: TimeLogSource::Timer,
        })
    );
}

#[test]
fn typed_time_records_its_source_as_manual() {
    let Ingest::Insert(activities) =
        TimeEntryTopicEvent::Logged(change(TimeEntrySource::Manual)).ingest(Uuid::now_v7())
    else {
        panic!("a logged entry inserts an activity");
    };

    assert!(matches!(
        &activities[0].action,
        Action::TimeLogged(TimeLog {
            source: TimeLogSource::Manual,
            ..
        })
    ));
}

#[test]
fn correcting_or_deleting_an_entry_records_no_activity() {
    let edited = TimeEntryTopicEvent::Updated(change(TimeEntrySource::Manual));
    let deleted = TimeEntryTopicEvent::Deleted(change(TimeEntrySource::Manual));

    assert_eq!(edited.ingest(Uuid::now_v7()), Ingest::Ignore);
    assert_eq!(deleted.ingest(Uuid::now_v7()), Ingest::Ignore);
}
