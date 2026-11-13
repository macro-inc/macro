use chrono::TimeZone as _;
use strum::IntoEnumIterator as _;

use super::*;

use GenerationEvent as Event;
use GenerationStatus as Status;

/// The table, written out: every pair not listed is refused.
const TABLE: [(Status, Event, Status); 5] = [
    (Status::Generating, Event::AllFinished, Status::Ready),
    (Status::Generating, Event::SomeFinished, Status::Partial),
    (Status::Generating, Event::NoneFinished, Status::Failed),
    (Status::Generating, Event::ProcessStopped, Status::Cancelled),
    (
        Status::Generating,
        Event::HeartbeatLost,
        Status::Interrupted,
    ),
];

/// Every (status, event) pair is either in the table or refused, and
/// nothing leaves a final status.
#[test]
fn every_status_takes_every_event_or_refuses_it() {
    for status in Status::iter() {
        for event in Event::iter() {
            let listed = TABLE
                .iter()
                .find(|(from, on, _)| *from == status && *on == event)
                .map(|(_, _, to)| *to);
            match listed {
                Some(to) => assert_eq!(status.on(event), Ok(to), "{status:?} on {event:?}"),
                None => assert_eq!(
                    status.on(event),
                    Err(GenerationRefused {
                        from: status,
                        event
                    }),
                    "{status:?} on {event:?}"
                ),
            }
        }
    }
}

/// Storage's guards and targets come from the table.
#[test]
fn each_event_leaves_only_running_generations_for_one_status() {
    for event in Event::iter() {
        assert_eq!(event.sources(), [Status::Generating], "{event:?}");
        for source in event.sources() {
            assert_eq!(source.on(event), Ok(event.entered()), "{event:?}");
        }
    }
}

/// Only a generation cut short may start again; nothing final runs.
#[test]
fn only_cut_short_generations_retry() {
    for status in Status::iter() {
        assert_eq!(
            status.retryable(),
            matches!(status, Status::Cancelled | Status::Interrupted),
            "{status:?}"
        );
        assert_eq!(status.is_running(), status == Status::Generating);
    }
}

fn result(finished: bool, changed: bool) -> SessionResult {
    SessionResult { finished, changed }
}

/// Ready needs every session finished; a session that changed something
/// makes a run partial, not failed; stopping before any finished cancels it.
#[test]
fn a_generation_ends_by_what_its_sessions_finished_and_changed() {
    let cases = [
        (vec![result(true, false)], false, Event::AllFinished),
        (
            vec![result(true, true), result(true, false)],
            true,
            Event::AllFinished,
        ),
        (
            vec![result(true, false), result(false, false)],
            false,
            Event::SomeFinished,
        ),
        (
            vec![result(false, true), result(false, false)],
            false,
            Event::SomeFinished,
        ),
        (
            vec![result(false, false), result(false, false)],
            false,
            Event::NoneFinished,
        ),
        (vec![result(false, false)], true, Event::ProcessStopped),
        (vec![result(false, true)], true, Event::ProcessStopped),
        (
            vec![result(true, false), result(false, false)],
            true,
            Event::SomeFinished,
        ),
        (Vec::new(), false, Event::NoneFinished),
    ];
    for (sessions, stopping, event) in cases {
        assert_eq!(
            conclude(&sessions, stopping),
            event,
            "{sessions:?} {stopping}"
        );
    }
}

fn at(hour: u32, minute: u32) -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 11, 13, hour, minute, 0).unwrap()
}

fn past(status: Status, attempt: u8, started_at: DateTime<Utc>) -> Option<PastRun> {
    Some(PastRun {
        status,
        attempt,
        started_at,
    })
}

/// Admission for each trigger: one running holds every start back; within
/// the trigger's window a final run holds the next back and a cut-short one
/// starts its next attempt, up to the limit; past it a fresh one starts.
#[test]
fn admission_follows_each_triggers_window_and_attempts() {
    use GenerationTrigger::{Manual, Nightly, Onboarding};
    let now = at(12, 0);
    let cases = [
        (Onboarding, true, None, Admission::Running),
        (Onboarding, false, None, Admission::Start { attempt: 1 }),
        (
            Onboarding,
            false,
            past(Status::Ready, 1, at(1, 0) - TimeDelta::days(400)),
            Admission::Done,
        ),
        (
            Onboarding,
            false,
            past(Status::Failed, 1, at(11, 0)),
            Admission::Done,
        ),
        (
            Onboarding,
            false,
            past(Status::Cancelled, 1, at(11, 0)),
            Admission::Start { attempt: 2 },
        ),
        (
            Onboarding,
            false,
            past(Status::Interrupted, 2, at(11, 0)),
            Admission::Start { attempt: 3 },
        ),
        (
            Onboarding,
            false,
            past(Status::Interrupted, 3, at(11, 0)),
            Admission::Done,
        ),
        (
            Onboarding,
            false,
            past(Status::Generating, 1, at(11, 0)),
            Admission::Running,
        ),
        (Nightly, true, None, Admission::Running),
        (
            Nightly,
            false,
            past(Status::Partial, 1, at(2, 0)),
            Admission::Cooldown {
                available_at: at(22, 0),
            },
        ),
        (
            Nightly,
            false,
            past(Status::Ready, 1, now - NIGHTLY_EVERY),
            Admission::Start { attempt: 1 },
        ),
        (
            Nightly,
            false,
            past(Status::Cancelled, 1, at(2, 0)),
            Admission::Start { attempt: 2 },
        ),
        (
            Nightly,
            false,
            past(Status::Cancelled, MAX_ATTEMPTS, at(2, 0)),
            Admission::Cooldown {
                available_at: at(22, 0),
            },
        ),
        (
            Nightly,
            false,
            past(Status::Interrupted, MAX_ATTEMPTS, now - NIGHTLY_EVERY),
            Admission::Start { attempt: 1 },
        ),
        (
            Manual,
            true,
            past(Status::Ready, 1, at(1, 0)),
            Admission::Running,
        ),
        (
            Manual,
            false,
            past(Status::Ready, 1, at(11, 30)),
            Admission::Cooldown {
                available_at: at(12, 30),
            },
        ),
        (
            Manual,
            false,
            past(Status::Failed, 1, at(11, 0)),
            Admission::Start { attempt: 1 },
        ),
        (
            Manual,
            false,
            past(Status::Interrupted, 1, at(11, 50)),
            Admission::Start { attempt: 2 },
        ),
    ];
    for (trigger, running, latest, admission) in cases {
        assert_eq!(
            admit(trigger, running, latest, now),
            admission,
            "{trigger:?} running={running} {latest:?}"
        );
    }
}

/// The overview says what runs, how the last one ended and when the person
/// may ask again.
#[test]
fn the_overview_reads_the_running_and_last_generations() {
    let now = at(12, 0);
    assert_eq!(
        GenerationOverview::new(OverviewFacts::default(), now),
        GenerationOverview {
            state: GenerationState::Idle,
            trigger: None,
            started_at: None,
            last_finished_at: None,
            last_outcome: None,
            regenerate_available_at: None,
        }
    );
    let running = GenerationOverview::new(
        OverviewFacts {
            running: Some((GenerationTrigger::Manual, at(11, 59))),
            last_ended: Some((Status::Partial, at(3, 0))),
            latest_manual: past(Status::Generating, 1, at(11, 59)),
        },
        now,
    );
    assert_eq!(running.state, GenerationState::Running);
    assert_eq!(running.trigger, Some(GenerationTrigger::Manual));
    assert_eq!(running.last_outcome, Some(Status::Partial));
    assert_eq!(running.regenerate_available_at, None);
    let cooling = GenerationOverview::new(
        OverviewFacts {
            running: None,
            last_ended: Some((Status::Ready, at(11, 50))),
            latest_manual: past(Status::Ready, 1, at(11, 40)),
        },
        now,
    );
    assert_eq!(cooling.state, GenerationState::Idle);
    assert_eq!(cooling.regenerate_available_at, Some(at(12, 40)));
    assert_eq!(
        serde_json::to_value(cooling).unwrap(),
        serde_json::json!({
            "state": "idle",
            "lastFinishedAt": "2026-11-13T11:50:00Z",
            "lastOutcome": "ready",
            "regenerateAvailableAt": "2026-11-13T12:40:00Z",
        })
    );
}
