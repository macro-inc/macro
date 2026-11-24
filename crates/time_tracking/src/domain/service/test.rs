use chrono::{NaiveDate, TimeDelta};
use entity_access::domain::models::{AccessLevel, Entity, EntityPermission};

use super::*;
use crate::{
    domain::{events::TimeEntryTopicEvent, models::FieldEdit},
    test_support::{
        AUTHOR, EDITOR, FakeAccess, FakeRepo, FixedRollout, OTHER_TASK, OUTSIDER,
        RecordingPublisher, RecordingUpdates, TASK, TestClock, VIEWER, noon, user,
    },
};

type Service =
    TimeTrackingServiceImpl<FakeRepo, FakeAccess, RecordingPublisher, RecordingUpdates, TestClock>;

struct Harness {
    service: Service,
    repo: FakeRepo,
    events: RecordingPublisher,
    updates: RecordingUpdates,
    clock: TestClock,
}

fn harness_with(rollout: bool) -> Harness {
    let repo = FakeRepo::with_live_tasks(&[TASK, OTHER_TASK]);
    let events = RecordingPublisher::default();
    let updates = RecordingUpdates::default();
    let clock = TestClock::at(noon());
    let service = TimeTrackingServiceImpl::new(
        repo.clone(),
        Arc::new(FakeAccess::team()),
        Arc::new(FixedRollout(rollout)),
        events.clone(),
        updates.clone(),
    )
    .with_clock(clock.clone());
    Harness {
        service,
        repo,
        events,
        updates,
        clock,
    }
}

fn harness() -> Harness {
    harness_with(true)
}

fn edit_receipt(user_id: &str, task_id: &str) -> TaskEditReceipt {
    EntityAccessReceipt::try_new_authenticated_user(
        user(user_id),
        Entity {
            entity_id: task_id.to_string(),
            entity_type: EntityType::Document,
        },
        EntityPermission::AccessLevel {
            access_level: AccessLevel::Edit,
        },
    )
    .unwrap()
}

fn view_receipt(user_id: &str, task_id: &str) -> TaskViewReceipt {
    EntityAccessReceipt::try_new_authenticated_user(
        user(user_id),
        Entity {
            entity_id: task_id.to_string(),
            entity_type: EntityType::Document,
        },
        EntityPermission::AccessLevel {
            access_level: AccessLevel::View,
        },
    )
    .unwrap()
}

fn day(date: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 11, date).unwrap()
}

fn typed(id: u128, minutes: u16) -> NewTimeEntry {
    NewTimeEntry {
        id: Some(Uuid::from_u128(id)),
        date: day(20),
        minutes,
        note: Some("review".to_string()),
        started_at: None,
        ended_at: None,
    }
}

async fn log(harness: &Harness, user_id: &str, id: u128, minutes: u16) -> LoggedTime {
    harness
        .service
        .log_entry(&edit_receipt(user_id, TASK), typed(id, minutes))
        .await
        .unwrap()
}

fn event_kinds(events: &RecordingPublisher) -> Vec<(&'static str, u32)> {
    events
        .published()
        .into_iter()
        .map(|(_, event)| match event {
            TimeEntryTopicEvent::Logged(change) => ("logged", change.total_minutes),
            TimeEntryTopicEvent::Updated(change) => ("updated", change.total_minutes),
            TimeEntryTopicEvent::Deleted(change) => ("deleted", change.total_minutes),
        })
        .collect()
}

// Logging and reading

#[tokio::test]
async fn an_editor_logs_time_and_the_task_total_follows() {
    let harness = harness();

    let first = log(&harness, AUTHOR, 1, 45).await;
    let second = log(&harness, EDITOR, 2, 30).await;

    assert_eq!(first.total_minutes, 45);
    assert_eq!(second.total_minutes, 75);
    assert_eq!(second.entry.user_id, user(EDITOR));
    assert_eq!(second.entry.source, TimeEntrySource::Manual);
    assert_eq!(
        event_kinds(&harness.events),
        vec![("logged", 45), ("logged", 75)]
    );
    assert!(
        harness
            .events
            .published()
            .iter()
            .all(|(key, _)| key == TASK)
    );
}

#[tokio::test]
async fn a_replayed_log_returns_the_stored_entry_and_logs_nothing_twice() {
    let harness = harness();
    let first = log(&harness, AUTHOR, 1, 45).await;

    let replay = harness
        .service
        .log_entry(&edit_receipt(AUTHOR, TASK), typed(1, 90))
        .await
        .unwrap();

    assert_eq!(replay, first);
    assert_eq!(harness.repo.entry_count(), 1);
    assert_eq!(event_kinds(&harness.events), vec![("logged", 45)]);
}

#[tokio::test]
async fn an_entry_id_taken_by_someone_else_is_a_conflict() {
    let harness = harness();
    log(&harness, AUTHOR, 1, 45).await;

    let error = harness
        .service
        .log_entry(&edit_receipt(EDITOR, TASK), typed(1, 30))
        .await
        .unwrap_err();

    assert!(matches!(error, TimeTrackingError::Conflict(_)));
}

#[tokio::test]
async fn time_cannot_be_logged_on_a_trashed_task_or_a_non_task() {
    let harness = harness();
    harness.repo.trash(TASK);

    let error = harness
        .service
        .log_entry(&edit_receipt(AUTHOR, TASK), typed(1, 30))
        .await
        .unwrap_err();

    assert!(matches!(error, TimeTrackingError::NotFound("task")));
    assert_eq!(harness.repo.entry_count(), 0);
}

#[tokio::test]
async fn a_viewer_sees_the_entries_newest_first_in_pages() {
    let harness = harness();
    for (id, date) in [(1, 18), (2, 20), (3, 19)] {
        harness
            .service
            .log_entry(
                &edit_receipt(AUTHOR, TASK),
                NewTimeEntry {
                    date: day(date),
                    ..typed(id, 10)
                },
            )
            .await
            .unwrap();
    }

    let first = harness
        .service
        .list_entries(
            &view_receipt(VIEWER, TASK),
            TimeEntryPageRequest {
                limit: Some(2),
                after: None,
            },
        )
        .await
        .unwrap();
    let second = harness
        .service
        .list_entries(
            &view_receipt(VIEWER, TASK),
            TimeEntryPageRequest {
                limit: Some(2),
                after: first.next_cursor,
            },
        )
        .await
        .unwrap();

    let ids = |page: &TimeEntryPage| {
        page.entries
            .iter()
            .map(|e| e.id.as_u128())
            .collect::<Vec<_>>()
    };
    assert_eq!(ids(&first), vec![2, 3]);
    assert_eq!(first.total_minutes, 30);
    assert_eq!(ids(&second), vec![1]);
    assert_eq!(second.next_cursor, None);
}

#[tokio::test]
async fn a_page_lists_one_to_two_hundred_entries() {
    let harness = harness();

    for limit in [0, MAX_PAGE_LIMIT + 1] {
        let error = harness
            .service
            .list_entries(
                &view_receipt(VIEWER, TASK),
                TimeEntryPageRequest {
                    limit: Some(limit),
                    after: None,
                },
            )
            .await
            .unwrap_err();
        assert!(
            matches!(error, TimeTrackingError::InvalidInput(_)),
            "{limit}"
        );
    }
}

// Changing and deleting

#[tokio::test]
async fn the_author_edits_their_entry_and_the_total_follows() {
    let harness = harness();
    log(&harness, AUTHOR, 1, 45).await;
    log(&harness, EDITOR, 2, 30).await;

    let edited = harness
        .service
        .update_entry(
            &user(AUTHOR),
            Uuid::from_u128(1),
            TimeEntryChanges {
                minutes: Some(60),
                note: FieldEdit::Clear,
                ..TimeEntryChanges::default()
            },
        )
        .await
        .unwrap();

    assert_eq!(edited.entry.minutes, 60);
    assert_eq!(edited.entry.note, None);
    assert_eq!(edited.total_minutes, 90);
    assert_eq!(
        event_kinds(&harness.events),
        vec![("logged", 45), ("logged", 75), ("updated", 90)]
    );
}

#[tokio::test]
async fn an_edit_that_loses_a_race_merges_onto_the_other_devices_change() {
    let harness = harness();
    log(&harness, AUTHOR, 1, 45).await;
    harness.repo.edit_elsewhere_before_next_update(75);

    let edited = harness
        .service
        .update_entry(
            &user(AUTHOR),
            Uuid::from_u128(1),
            TimeEntryChanges {
                note: FieldEdit::Set("reviewed".to_string()),
                ..TimeEntryChanges::default()
            },
        )
        .await
        .unwrap();

    assert_eq!(
        edited.entry.minutes, 75,
        "the other device's length is kept"
    );
    assert_eq!(edited.entry.note.as_deref(), Some("reviewed"));
    assert_eq!(edited.total_minutes, 75);
}

#[tokio::test]
async fn someone_who_can_see_the_task_cannot_change_another_persons_entry() {
    let harness = harness();
    log(&harness, AUTHOR, 1, 45).await;

    for other in [EDITOR, VIEWER] {
        let edit = harness
            .service
            .update_entry(
                &user(other),
                Uuid::from_u128(1),
                TimeEntryChanges {
                    minutes: Some(5),
                    ..TimeEntryChanges::default()
                },
            )
            .await
            .unwrap_err();
        let delete = harness
            .service
            .delete_entry(&user(other), Uuid::from_u128(1))
            .await
            .unwrap_err();
        assert!(matches!(edit, TimeTrackingError::NotAuthor), "{other}");
        assert!(matches!(delete, TimeTrackingError::NotAuthor), "{other}");
    }
    assert_eq!(harness.repo.total(TASK), 45);
}

#[tokio::test]
async fn someone_who_cannot_see_the_task_does_not_learn_the_entry_exists() {
    let harness = harness();
    log(&harness, AUTHOR, 1, 45).await;

    let error = harness
        .service
        .delete_entry(&user(OUTSIDER), Uuid::from_u128(1))
        .await
        .unwrap_err();

    assert!(matches!(error, TimeTrackingError::NotFound("time entry")));
}

#[tokio::test]
async fn an_author_reduced_to_viewer_still_corrects_their_own_entry() {
    let repo = FakeRepo::with_live_tasks(&[TASK]);
    let events = RecordingPublisher::default();
    let service = TimeTrackingServiceImpl::new(
        repo.clone(),
        Arc::new(FakeAccess::default().grant(AUTHOR, TASK, AccessLevel::View)),
        Arc::new(FixedRollout(true)),
        events,
        RecordingUpdates::default(),
    )
    .with_clock(TestClock::at(noon()));
    service
        .log_entry(&edit_receipt(AUTHOR, TASK), typed(1, 45))
        .await
        .unwrap();

    let total = service
        .delete_entry(&user(AUTHOR), Uuid::from_u128(1))
        .await
        .unwrap();

    assert_eq!(total.total_minutes, 0);
}

#[tokio::test]
async fn the_author_deletes_their_entry_and_the_total_drops() {
    let harness = harness();
    log(&harness, AUTHOR, 1, 45).await;
    log(&harness, AUTHOR, 2, 15).await;

    let total = harness
        .service
        .delete_entry(&user(AUTHOR), Uuid::from_u128(1))
        .await
        .unwrap();
    let again = harness
        .service
        .delete_entry(&user(AUTHOR), Uuid::from_u128(1))
        .await
        .unwrap_err();

    assert_eq!(total.total_minutes, 15);
    assert!(matches!(again, TimeTrackingError::NotFound("time entry")));
    assert_eq!(
        event_kinds(&harness.events),
        vec![("logged", 45), ("logged", 60), ("deleted", 15)]
    );
}

// The rollout gate

#[tokio::test]
async fn with_the_rollout_off_every_write_is_refused_and_reads_still_answer() {
    let harness = harness_with(false);
    let author = user(AUTHOR);
    harness.repo.put_timer(
        AUTHOR,
        RunningTimer {
            id: Uuid::from_u128(0x71),
            task_id: TASK.to_string(),
            started_at: noon(),
        },
    );

    let refusals = [
        harness
            .service
            .log_entry(&edit_receipt(AUTHOR, TASK), typed(1, 45))
            .await
            .map(drop),
        harness
            .service
            .update_entry(&author, Uuid::from_u128(1), TimeEntryChanges::default())
            .await
            .map(drop),
        harness
            .service
            .delete_entry(&author, Uuid::from_u128(1))
            .await
            .map(drop),
        harness
            .service
            .start_timer(&edit_receipt(AUTHOR, OTHER_TASK), StartTimer::default())
            .await
            .map(drop),
        harness
            .service
            .stop_timer(
                &author,
                StopTimer {
                    timer_id: Uuid::from_u128(0x71),
                    time_zone: None,
                    ending: TimerEnding::Now,
                },
            )
            .await
            .map(drop),
        harness
            .service
            .discard_timer(&author, Uuid::from_u128(0x71))
            .await,
    ];

    for refusal in refusals {
        assert!(matches!(
            refusal,
            Err(TimeTrackingError::NotFound("time tracking"))
        ));
    }
    assert_eq!(harness.repo.entry_count(), 0);
    assert!(harness.repo.stored_timer(AUTHOR).is_some());
    assert!(harness.events.published().is_empty());
    assert!(
        harness
            .service
            .list_entries(&view_receipt(VIEWER, TASK), TimeEntryPageRequest::default())
            .await
            .is_ok()
    );
    assert!(
        harness
            .service
            .timer(&author)
            .await
            .unwrap()
            .timer
            .is_some()
    );
}

// Timers

#[tokio::test]
async fn a_started_timer_is_read_back_with_the_server_clock() {
    let harness = harness();

    let started = harness
        .service
        .start_timer(&edit_receipt(AUTHOR, TASK), StartTimer::default())
        .await
        .unwrap();
    harness.clock.advance(TimeDelta::minutes(5));
    let state = harness.service.timer(&user(AUTHOR)).await.unwrap();

    assert_eq!(started.stopped, None);
    assert_eq!(started.timer.started_at, noon());
    assert_eq!(state.timer, Some(started.timer));
    assert_eq!(state.server_now, noon() + TimeDelta::minutes(5));
}

#[tokio::test]
async fn starting_on_another_task_stops_and_saves_the_running_timer_in_the_same_call() {
    let harness = harness();
    let first = harness
        .service
        .start_timer(&edit_receipt(AUTHOR, TASK), StartTimer::default())
        .await
        .unwrap();
    harness.clock.advance(TimeDelta::minutes(42));

    let second = harness
        .service
        .start_timer(&edit_receipt(AUTHOR, OTHER_TASK), StartTimer::default())
        .await
        .unwrap();

    let stopped = second.stopped.expect("the first timer's entry");
    assert_eq!(stopped.entry.id, first.timer.id);
    assert_eq!(stopped.entry.task_id, TASK);
    assert_eq!(stopped.entry.minutes, 42);
    assert_eq!(stopped.entry.source, TimeEntrySource::Timer);
    assert_eq!(stopped.total_minutes, 42);
    assert_eq!(harness.repo.stored_timer(AUTHOR), Some(second.timer));
    assert_eq!(event_kinds(&harness.events), vec![("logged", 42)]);
}

#[tokio::test]
async fn a_switch_away_from_a_timer_past_the_limit_waits_for_the_persons_answer() {
    let harness = harness();
    let first = harness
        .service
        .start_timer(&edit_receipt(AUTHOR, TASK), StartTimer::default())
        .await
        .unwrap();
    harness.clock.advance(TimeDelta::hours(9));

    let error = harness
        .service
        .start_timer(&edit_receipt(AUTHOR, OTHER_TASK), StartTimer::default())
        .await
        .unwrap_err();

    assert!(matches!(error, TimeTrackingError::TimerOverLimit(timer) if timer == first.timer));
    assert_eq!(harness.repo.stored_timer(AUTHOR), Some(first.timer));
    assert_eq!(harness.repo.entry_count(), 0);
}

#[tokio::test]
async fn a_replayed_start_returns_the_running_timer() {
    let harness = harness();
    let start = StartTimer {
        id: Some(Uuid::from_u128(0x71)),
        ..StartTimer::default()
    };
    let first = harness
        .service
        .start_timer(&edit_receipt(AUTHOR, TASK), start.clone())
        .await
        .unwrap();
    harness.clock.advance(TimeDelta::minutes(3));

    let replay = harness
        .service
        .start_timer(&edit_receipt(AUTHOR, TASK), start)
        .await
        .unwrap();

    assert_eq!(replay, first);
    assert_eq!(harness.repo.entry_count(), 0);
}

#[tokio::test]
async fn a_start_rereads_the_timer_another_device_changed_in_between() {
    let harness = harness();
    harness.repo.change_timer_before_next_starts(2);

    let started = harness
        .service
        .start_timer(&edit_receipt(AUTHOR, TASK), StartTimer::default())
        .await
        .unwrap();

    assert_eq!(harness.repo.stored_timer(AUTHOR), Some(started.timer));
}

#[tokio::test]
async fn a_start_that_keeps_losing_the_race_gives_up_with_a_conflict() {
    let harness = harness();
    harness.repo.change_timer_before_next_starts(WRITE_ATTEMPTS);

    let error = harness
        .service
        .start_timer(&edit_receipt(AUTHOR, TASK), StartTimer::default())
        .await
        .unwrap_err();

    assert!(matches!(error, TimeTrackingError::Conflict(_)));
}

#[tokio::test]
async fn a_timer_cannot_start_on_a_trashed_task() {
    let harness = harness();
    harness.repo.trash(TASK);

    let error = harness
        .service
        .start_timer(&edit_receipt(AUTHOR, TASK), StartTimer::default())
        .await
        .unwrap_err();

    assert!(matches!(error, TimeTrackingError::NotFound("task")));
}

async fn running_timer(harness: &Harness, ran_for: TimeDelta) -> RunningTimer {
    let started = harness
        .service
        .start_timer(&edit_receipt(AUTHOR, TASK), StartTimer::default())
        .await
        .unwrap();
    harness.clock.advance(ran_for);
    started.timer
}

fn stop(timer: &RunningTimer, ending: TimerEnding) -> StopTimer {
    StopTimer {
        timer_id: timer.id,
        time_zone: None,
        ending,
    }
}

#[tokio::test]
async fn stopping_saves_the_entry_and_a_replayed_stop_returns_the_same_entry() {
    let harness = harness();
    let timer = running_timer(&harness, TimeDelta::minutes(50)).await;

    let stopped = harness
        .service
        .stop_timer(&user(AUTHOR), stop(&timer, TimerEnding::Now))
        .await
        .unwrap();
    harness.clock.advance(TimeDelta::minutes(30));
    let replay = harness
        .service
        .stop_timer(&user(AUTHOR), stop(&timer, TimerEnding::Now))
        .await
        .unwrap();

    let logged = stopped.logged.expect("the saved entry");
    assert_eq!(logged.entry.id, timer.id);
    assert_eq!(logged.entry.minutes, 50);
    assert_eq!(replay.logged, Some(logged));
    assert_eq!(harness.repo.stored_timer(AUTHOR), None);
    assert_eq!(event_kinds(&harness.events), vec![("logged", 50)]);
}

#[tokio::test]
async fn a_timer_past_the_limit_is_refused_then_stopped_by_each_resolution() {
    let resolutions = [
        (TimerEnding::LogAll, 9 * 60),
        (TimerEnding::At(noon() + TimeDelta::hours(2)), 120),
    ];
    for (ending, minutes) in resolutions {
        let harness = harness();
        let timer = running_timer(&harness, TimeDelta::hours(9)).await;

        let refused = harness
            .service
            .stop_timer(&user(AUTHOR), stop(&timer, TimerEnding::Now))
            .await
            .unwrap_err();
        let resolved = harness
            .service
            .stop_timer(&user(AUTHOR), stop(&timer, ending))
            .await
            .unwrap();

        assert!(matches!(refused, TimeTrackingError::TimerOverLimit(over) if over == timer));
        assert_eq!(
            resolved.logged.map(|logged| logged.entry.minutes),
            Some(minutes)
        );
    }
}

#[tokio::test]
async fn a_timer_past_the_limit_can_be_discarded_instead() {
    let harness = harness();
    let timer = running_timer(&harness, TimeDelta::hours(9)).await;

    harness
        .service
        .discard_timer(&user(AUTHOR), timer.id)
        .await
        .unwrap();
    let late_stop = harness
        .service
        .stop_timer(&user(AUTHOR), stop(&timer, TimerEnding::Now))
        .await
        .unwrap();

    assert_eq!(late_stop.logged, None);
    assert_eq!(harness.repo.stored_timer(AUTHOR), None);
    assert_eq!(harness.repo.entry_count(), 0);
    assert!(harness.events.published().is_empty());
}

#[tokio::test]
async fn a_person_cannot_stop_or_discard_someone_elses_timer() {
    let harness = harness();
    let timer = running_timer(&harness, TimeDelta::minutes(10)).await;

    let stopped = harness
        .service
        .stop_timer(&user(EDITOR), stop(&timer, TimerEnding::Now))
        .await
        .unwrap();
    harness
        .service
        .discard_timer(&user(EDITOR), timer.id)
        .await
        .unwrap();

    assert_eq!(stopped.logged, None);
    assert_eq!(harness.repo.stored_timer(AUTHOR), Some(timer));
}

#[tokio::test]
async fn a_timer_on_a_trashed_task_still_stops_and_saves() {
    let harness = harness();
    let timer = running_timer(&harness, TimeDelta::minutes(20)).await;
    harness.repo.trash(TASK);

    let stopped = harness
        .service
        .stop_timer(&user(AUTHOR), stop(&timer, TimerEnding::Now))
        .await
        .unwrap();

    assert_eq!(stopped.logged.map(|logged| logged.entry.minutes), Some(20));
}

#[tokio::test]
async fn undo_restarts_the_first_timer_at_its_original_start() {
    let harness = harness();
    let first = running_timer(&harness, TimeDelta::minutes(30)).await;

    let restarted = harness
        .service
        .start_timer(
            &edit_receipt(AUTHOR, OTHER_TASK),
            StartTimer {
                started_at: Some(first.started_at),
                ..StartTimer::default()
            },
        )
        .await
        .unwrap();
    let too_early = harness
        .service
        .start_timer(
            &edit_receipt(AUTHOR, TASK),
            StartTimer {
                started_at: Some(noon() - TimeDelta::hours(25)),
                ..StartTimer::default()
            },
        )
        .await
        .unwrap_err();

    assert_eq!(restarted.timer.started_at, first.started_at);
    assert!(matches!(too_early, TimeTrackingError::InvalidInput(_)));
}

// The person's other sessions

fn entries_of(task_id: &str) -> TimeTrackingChange {
    TimeTrackingChange {
        timer: false,
        task_id: Some(task_id.to_string()),
    }
}

fn timer_with(saved_on: Option<&str>) -> TimeTrackingChange {
    TimeTrackingChange {
        timer: true,
        task_id: saved_on.map(str::to_string),
    }
}

#[tokio::test]
async fn each_entry_change_tells_the_authors_sessions_which_task_to_read_again() {
    let harness = harness();
    let author = user(AUTHOR);
    log(&harness, AUTHOR, 1, 45).await;
    harness
        .service
        .update_entry(
            &author,
            Uuid::from_u128(1),
            TimeEntryChanges {
                minutes: Some(60),
                ..TimeEntryChanges::default()
            },
        )
        .await
        .unwrap();
    harness
        .service
        .delete_entry(&author, Uuid::from_u128(1))
        .await
        .unwrap();

    assert_eq!(
        harness.updates.sent(),
        vec![
            (AUTHOR.to_string(), entries_of(TASK)),
            (AUTHOR.to_string(), entries_of(TASK)),
            (AUTHOR.to_string(), entries_of(TASK)),
        ]
    );
}

#[tokio::test]
async fn timer_changes_name_the_task_whose_entries_they_saved() {
    let harness = harness();
    let author = user(AUTHOR);
    harness
        .service
        .start_timer(&edit_receipt(AUTHOR, TASK), StartTimer::default())
        .await
        .unwrap();
    harness.clock.advance(TimeDelta::minutes(20));
    let switched = harness
        .service
        .start_timer(&edit_receipt(AUTHOR, OTHER_TASK), StartTimer::default())
        .await
        .unwrap();
    harness.clock.advance(TimeDelta::minutes(10));
    harness
        .service
        .stop_timer(&author, stop(&switched.timer, TimerEnding::Now))
        .await
        .unwrap();
    let restarted = harness
        .service
        .start_timer(&edit_receipt(AUTHOR, TASK), StartTimer::default())
        .await
        .unwrap();
    harness
        .service
        .discard_timer(&author, restarted.timer.id)
        .await
        .unwrap();

    assert_eq!(
        harness.updates.sent(),
        vec![
            (AUTHOR.to_string(), timer_with(None)),
            (AUTHOR.to_string(), timer_with(Some(TASK))),
            (AUTHOR.to_string(), timer_with(Some(OTHER_TASK))),
            (AUTHOR.to_string(), timer_with(None)),
            (AUTHOR.to_string(), timer_with(None)),
        ]
    );
}

#[tokio::test]
async fn replays_and_refusals_tell_no_session() {
    let harness = harness();
    let author = user(AUTHOR);
    log(&harness, AUTHOR, 1, 45).await;
    let started = harness
        .service
        .start_timer(&edit_receipt(AUTHOR, TASK), StartTimer::default())
        .await
        .unwrap();
    harness
        .service
        .stop_timer(&author, stop(&started.timer, TimerEnding::Now))
        .await
        .unwrap();
    let sent_before = harness.updates.sent().len();

    log(&harness, AUTHOR, 1, 45).await;
    harness
        .service
        .stop_timer(&author, stop(&started.timer, TimerEnding::Now))
        .await
        .unwrap();
    let refused = harness
        .service
        .delete_entry(&user(EDITOR), Uuid::from_u128(1))
        .await;

    assert!(matches!(refused, Err(TimeTrackingError::NotAuthor)));
    assert_eq!(harness.updates.sent().len(), sent_before);
}

#[tokio::test]
async fn nothing_is_sent_while_the_rollout_is_off() {
    let harness = harness_with(false);

    let refused = harness
        .service
        .log_entry(&edit_receipt(AUTHOR, TASK), typed(1, 45))
        .await;

    assert!(refused.is_err());
    assert!(harness.updates.sent().is_empty());
}
