use chrono::{DateTime, TimeDelta, Utc};
use strum::IntoEnumIterator;

use super::*;

/// Minutes after a run's start.
fn t(minutes: i64) -> DateTime<Utc> {
    DateTime::from_timestamp(1_800_000_000, 0).expect("a valid time") + TimeDelta::minutes(minutes)
}

fn waiting(since: i64) -> RunState {
    RunState::Waiting { since: t(since) }
}

fn stopping(since: i64) -> RunState {
    RunState::Stopping { since: t(since) }
}

fn cancelling(since: i64) -> RunState {
    RunState::Cancelling { since: t(since) }
}

fn observed(observation: Observation) -> RunEvent {
    RunEvent::Observed(observation)
}

fn every_event() -> Vec<RunEvent> {
    let mut events = vec![
        RunEvent::Started,
        RunEvent::StartUncertain,
        RunEvent::StartRefused,
        RunEvent::Cancel,
    ];
    events.extend(Observation::iter().map(RunEvent::Observed));
    events
}

/// One of each state, with the `since`s the cases use.
fn every_state() -> Vec<RunState> {
    RunStateName::iter()
        .map(|name| RunState::stored(name, t(20)))
        .collect()
}

fn to(state: RunState) -> Result<Step, Refused> {
    Ok(Step {
        to: state,
        effect: None,
    })
}

fn with(state: RunState, effect: RunEffect) -> Result<Step, Refused> {
    Ok(Step {
        to: state,
        effect: Some(effect),
    })
}

struct Case {
    from: RunState,
    event: RunEvent,
    at: i64,
    expected: Result<Step, Refused>,
}

fn case(from: RunState, event: RunEvent, at: i64, expected: Result<Step, Refused>) -> Case {
    Case {
        from,
        event,
        at,
        expected,
    }
}

/// Every (state, event) pair, at the times that change its answer.
fn cases() -> Vec<Case> {
    use Observation::*;
    use RunEffect::*;
    use RunState::{Cancelled, Failed, Finished, Running, Starting};

    let mut cases = vec![
        // Starting: the start's own result.
        case(Starting, RunEvent::Started, 1, to(Running)),
        case(Starting, RunEvent::StartUncertain, 1, to(Starting)),
        case(Starting, RunEvent::StartRefused, 1, to(Failed)),
        case(Starting, RunEvent::Cancel, 1, to(cancelling(1))),
        // Starting: what its session is found doing.
        case(Starting, observed(AwaitingPrompt), 9, to(Starting)),
        case(Starting, observed(AwaitingPrompt), 10, with(Failed, Delete)),
        case(Starting, observed(Working), 1, to(Running)),
        case(Starting, observed(Working), 60, with(stopping(60), Stop)),
        case(Starting, observed(Paused), 1, to(waiting(1))),
        case(Starting, observed(Paused), 60, with(stopping(60), Stop)),
        case(Starting, observed(Observation::Finished), 1, with(Finished, ReadProduced)),
        case(Starting, observed(Observation::Failed), 1, to(Failed)),
        case(Starting, observed(Gone), 9, to(Starting)),
        case(Starting, observed(Gone), 10, to(Failed)),
        case(Starting, observed(Unreadable), 59, to(Starting)),
        case(Starting, observed(Unreadable), 60, with(Failed, Delete)),
        // Running.
        case(Running, RunEvent::Started, 1, Err(Refused::AlreadyStarted)),
        case(Running, RunEvent::StartUncertain, 1, Err(Refused::AlreadyStarted)),
        case(Running, RunEvent::StartRefused, 1, Err(Refused::AlreadyStarted)),
        case(Running, RunEvent::Cancel, 30, to(cancelling(30))),
        case(Running, observed(AwaitingPrompt), 9, to(Running)),
        case(Running, observed(AwaitingPrompt), 10, with(Failed, Delete)),
        case(Running, observed(Working), 59, to(Running)),
        case(Running, observed(Working), 60, with(stopping(60), Stop)),
        case(Running, observed(Paused), 20, to(waiting(20))),
        case(Running, observed(Paused), 60, with(stopping(60), Stop)),
        case(Running, observed(Observation::Finished), 30, with(Finished, ReadProduced)),
        case(Running, observed(Observation::Failed), 30, to(Failed)),
        case(Running, observed(Gone), 1, to(Failed)),
        case(Running, observed(Unreadable), 59, to(Running)),
        case(Running, observed(Unreadable), 60, with(Failed, Delete)),
        // Waiting, since minute 20: its window runs from then, not the start.
        case(waiting(20), RunEvent::Started, 25, Err(Refused::AlreadyStarted)),
        case(waiting(20), RunEvent::StartUncertain, 25, Err(Refused::AlreadyStarted)),
        case(waiting(20), RunEvent::StartRefused, 25, Err(Refused::AlreadyStarted)),
        case(waiting(20), RunEvent::Cancel, 25, to(cancelling(25))),
        case(waiting(2), observed(AwaitingPrompt), 5, to(waiting(2))),
        case(waiting(20), observed(AwaitingPrompt), 25, with(Failed, Delete)),
        case(waiting(20), observed(Working), 25, to(Running)),
        case(waiting(20), observed(Working), 60, with(stopping(60), Stop)),
        case(waiting(20), observed(Paused), 29, to(waiting(20))),
        case(waiting(20), observed(Paused), 30, with(stopping(30), Stop)),
        case(waiting(55), observed(Paused), 59, to(waiting(55))),
        case(waiting(55), observed(Paused), 60, with(stopping(60), Stop)),
        case(waiting(20), observed(Observation::Finished), 25, with(Finished, ReadProduced)),
        case(waiting(20), observed(Observation::Failed), 25, to(Failed)),
        case(waiting(20), observed(Gone), 25, to(Failed)),
        case(waiting(20), observed(Unreadable), 59, to(waiting(20))),
        case(waiting(20), observed(Unreadable), 60, with(Failed, Delete)),
        // Stopping (over its time) since minute 60: settles failed.
        case(stopping(60), RunEvent::Started, 61, with(stopping(60), Stop)),
        case(stopping(60), RunEvent::StartUncertain, 61, to(stopping(60))),
        case(stopping(60), RunEvent::StartRefused, 61, to(Failed)),
        case(stopping(60), RunEvent::Cancel, 61, to(cancelling(60))),
        case(stopping(60), observed(Observation::Finished), 61, with(Finished, ReadProduced)),
        case(stopping(60), observed(Observation::Failed), 61, to(Failed)),
        case(stopping(60), observed(Gone), 61, to(Failed)),
        // Cancelling since minute 30: settles cancelled.
        case(cancelling(30), RunEvent::Started, 31, with(cancelling(30), Stop)),
        case(cancelling(30), RunEvent::StartUncertain, 31, to(cancelling(30))),
        case(cancelling(30), RunEvent::StartRefused, 31, to(Cancelled)),
        case(cancelling(30), RunEvent::Cancel, 31, to(cancelling(30))),
        case(cancelling(30), observed(Observation::Finished), 31, with(Finished, ReadProduced)),
        case(cancelling(30), observed(Observation::Failed), 31, to(Cancelled)),
        case(cancelling(30), observed(Gone), 31, to(Cancelled)),
    ];
    // A stopped session that may still be going is asked again to stop until
    // its grace runs out, then deleted.
    for observation in [AwaitingPrompt, Working, Paused, Unreadable] {
        cases.extend([
            case(stopping(60), observed(observation), 64, with(stopping(60), Stop)),
            case(stopping(60), observed(observation), 65, with(Failed, Delete)),
            case(cancelling(30), observed(observation), 34, with(cancelling(30), Stop)),
            case(cancelling(30), observed(observation), 35, with(Cancelled, Delete)),
        ]);
    }
    for settled in [Finished, Failed, Cancelled] {
        for event in every_event() {
            cases.push(case(settled, event, 1, Err(Refused::Settled)));
            cases.push(case(settled, event, 600, Err(Refused::Settled)));
        }
    }
    cases
}

#[test]
fn every_state_and_event_steps_as_the_table_says() {
    for Case {
        from,
        event,
        at,
        expected,
    } in cases()
    {
        assert_eq!(
            from.on(event, t(0), t(at)),
            expected,
            "{from:?} on {event:?} at minute {at}"
        );
    }
}

#[test]
fn the_table_covers_every_state_and_event() {
    let cases = cases();
    for state in RunStateName::iter() {
        for event in every_event() {
            assert!(
                cases
                    .iter()
                    .any(|case| case.from.name() == state && case.event == event),
                "no case for {state:?} on {event:?}"
            );
        }
    }
}

/// Every state, event and minute from the start to well past every window.
fn sweep() -> impl Iterator<Item = (RunState, RunEvent, DateTime<Utc>, Result<Step, Refused>)> {
    every_state().into_iter().flat_map(|state| {
        every_event().into_iter().flat_map(move |event| {
            (0..=130).map(move |minute| {
                let now = t(minute);
                (state, event, now, state.on(event, t(0), now))
            })
        })
    })
}

#[test]
fn a_settled_run_never_moves() {
    for (state, event, now, step) in sweep() {
        assert_eq!(
            step.is_err_and(|refused| refused == Refused::Settled),
            state.is_settled(),
            "{state:?} on {event:?} at {now}"
        );
    }
}

#[test]
fn a_run_that_may_still_be_going_settles_only_once_its_session_is_deleted() {
    for (state, event, now, step) in sweep() {
        let Ok(step) = step else { continue };
        let may_be_going = matches!(
            event,
            RunEvent::Observed(
                Observation::AwaitingPrompt
                    | Observation::Working
                    | Observation::Paused
                    | Observation::Unreadable
            )
        );
        if may_be_going && step.to.is_settled() {
            assert_eq!(
                step.effect,
                Some(RunEffect::Delete),
                "{state:?} on {event:?} at {now}"
            );
        }
    }
}

#[test]
fn each_effect_goes_with_the_state_it_leads_to() {
    for (state, event, now, step) in sweep() {
        let Ok(step) = step else { continue };
        let context = format!("{state:?} on {event:?} at {now}");
        match step.effect {
            Some(RunEffect::ReadProduced) => assert_eq!(step.to, RunState::Finished, "{context}"),
            Some(RunEffect::Delete) => assert!(step.to.is_settled(), "{context}"),
            Some(RunEffect::Stop) => assert!(
                matches!(
                    step.to,
                    RunState::Stopping { .. } | RunState::Cancelling { .. }
                ),
                "{context}"
            ),
            None => assert_ne!(step.to, RunState::Finished, "{context}"),
        }
    }
}

#[test]
fn only_its_session_finishing_finishes_a_run() {
    for (state, event, now, step) in sweep() {
        let Ok(step) = step else { continue };
        assert_eq!(
            step.to == RunState::Finished,
            event == observed(Observation::Finished),
            "{state:?} on {event:?} at {now}"
        );
    }
}

#[test]
fn a_cancelled_run_stays_cancelled_unless_it_finished_first() {
    for (state, event, now, step) in sweep() {
        let (RunState::Cancelling { .. }, Ok(step)) = (state, step) else {
            continue;
        };
        assert!(
            matches!(
                step.to,
                RunState::Cancelling { .. } | RunState::Cancelled | RunState::Finished
            ),
            "{state:?} on {event:?} at {now}"
        );
    }
}

#[test]
fn a_cancel_keeps_the_stop_already_asked_for() {
    assert_eq!(
        stopping(60).on(RunEvent::Cancel, t(0), t(64)),
        to(cancelling(60))
    );
    assert_eq!(
        cancelling(60).on(observed(Observation::Working), t(0), t(65)),
        with(RunState::Cancelled, RunEffect::Delete)
    );
}

#[test]
fn a_run_is_stopped_at_its_maximum_time_however_it_is_going() {
    let started = t(0);
    let limit = started + MAX_RUN_TIME;
    for state in [RunState::Starting, RunState::Running, waiting(55)] {
        for observation in [Observation::Working, Observation::Paused] {
            let before = state.on(observed(observation), started, limit - TimeDelta::seconds(1));
            assert!(
                before.is_ok_and(|step| step.effect != Some(RunEffect::Stop)),
                "{state:?} {observation:?}"
            );
            assert_eq!(
                state.on(observed(observation), started, limit),
                with(RunState::Stopping { since: limit }, RunEffect::Stop),
                "{state:?} {observation:?}"
            );
        }
    }
}

#[test]
fn a_run_resuming_from_waiting_starts_a_fresh_window_next_time() {
    let started = t(0);
    let resumed = waiting(5)
        .on(observed(Observation::Working), started, t(12))
        .expect("a waiting run resumes");
    assert_eq!(resumed.to, RunState::Running);
    let paused = resumed
        .to
        .on(observed(Observation::Paused), started, t(30))
        .expect("a running run pauses");
    assert_eq!(paused.to, waiting(30));
    assert_eq!(
        paused.to.on(observed(Observation::Paused), started, t(39)),
        to(waiting(30))
    );
}

#[test]
fn the_stored_state_round_trips() {
    for name in RunStateName::iter() {
        let state = RunState::stored(name, t(7));
        assert_eq!(state.name(), name);
        assert_eq!(state.is_settled(), name.is_settled());
        let stored: RunStateName = name.as_ref().parse().expect("its own name parses");
        assert_eq!(stored, name);
        let since = state.since_or(t(9));
        let timed = matches!(
            name,
            RunStateName::Waiting | RunStateName::Stopping | RunStateName::Cancelling
        );
        assert_eq!(since, if timed { t(7) } else { t(9) }, "{name:?}");
    }
}

#[test]
fn a_step_moves_a_run_when_its_state_or_since_changes() {
    let stay = Step {
        to: waiting(5),
        effect: None,
    };
    assert!(!stay.moves_from(waiting(5)));
    assert!(stay.moves_from(waiting(4)));
    assert!(stay.moves_from(RunState::Running));
}

/// A cancel is written inside the closing suggestion's own write, so it never
/// asks for anything to be done first.
#[test]
fn a_cancel_needs_nothing_done_first() {
    for (_, event, _, step) in sweep() {
        if event == RunEvent::Cancel
            && let Ok(step) = step
        {
            assert_eq!(step.effect, None);
        }
    }
}

#[test]
fn a_session_read_is_one_observation() {
    use super::super::model::{SessionReadError, SessionState};
    for (read, expected) in [
        (Ok(SessionState::AwaitingPrompt), Observation::AwaitingPrompt),
        (Ok(SessionState::Running), Observation::Working),
        (Ok(SessionState::Disconnected), Observation::Paused),
        (Ok(SessionState::NeedsApproval), Observation::Paused),
        (Ok(SessionState::NeedsInput), Observation::Paused),
        (Ok(SessionState::Finished), Observation::Finished),
        (Ok(SessionState::Failed), Observation::Failed),
        (Err(SessionReadError::Missing), Observation::Gone),
        (
            Err(SessionReadError::Unreadable(rootcause::report!("down"))),
            Observation::Unreadable,
        ),
    ] {
        assert_eq!(Observation::of_read(&read), expected, "{read:?}");
    }
}

/// An event about the run's own turn says how it went; anything else about
/// its session takes a read, except its deletion.
#[test]
fn a_session_event_speaks_for_a_run_only_about_its_own_turn() {
    let action = Uuid::now_v7();
    let other = Uuid::now_v7();
    for (news, expected) in [
        (
            SessionNews::TurnEnded {
                action,
                finished: true,
            },
            Some(Observation::Finished),
        ),
        (
            SessionNews::TurnEnded {
                action,
                finished: false,
            },
            Some(Observation::Failed),
        ),
        (
            SessionNews::TurnEnded {
                action: other,
                finished: true,
            },
            None,
        ),
        (
            SessionNews::WaitingForInput { action },
            Some(Observation::Paused),
        ),
        (SessionNews::WaitingForInput { action: other }, None),
        (SessionNews::Changed, None),
        (SessionNews::Deleted, Some(Observation::Gone)),
    ] {
        assert_eq!(news.about_run(action), expected, "{news:?}");
    }
}
