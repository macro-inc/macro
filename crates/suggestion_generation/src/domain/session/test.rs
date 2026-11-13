use strum::IntoEnumIterator as _;

use super::*;

use CleanupEvent as Event;

/// The table, written out: every pair not listed is refused.
const TABLE: [(Cleanup, Event, Cleanup); 4] = [
    (Cleanup::Open, Event::Ended, Cleanup::Stopping),
    (Cleanup::Stopping, Event::Deleted, Cleanup::Deleted),
    (Cleanup::Stopping, Event::DeleteFailed, Cleanup::Stopping),
    (Cleanup::Stopping, Event::GaveUp, Cleanup::Abandoned),
];

/// Every (state, event) pair is either in the table or refused: a session
/// is deleted only once ended, ends once, and nothing leaves deleted or
/// abandoned.
#[test]
fn every_cleanup_state_takes_every_event_or_refuses_it() {
    for state in Cleanup::iter() {
        for event in Event::iter() {
            let listed = TABLE
                .iter()
                .find(|(from, on, _)| *from == state && *on == event)
                .map(|(_, _, to)| *to);
            match listed {
                Some(to) => assert_eq!(state.on(event), Ok(to), "{state:?} on {event:?}"),
                None => assert_eq!(
                    state.on(event),
                    Err(CleanupRefused { from: state, event }),
                    "{state:?} on {event:?}"
                ),
            }
        }
    }
}

/// Storage's guards and targets come from the table.
#[test]
fn each_cleanup_event_has_its_sources_and_one_target() {
    for event in Event::iter() {
        let sources = event.sources();
        assert!(!sources.is_empty(), "{event:?}");
        for source in sources {
            assert_eq!(source.on(event), Ok(event.entered()), "{event:?}");
        }
    }
    assert_eq!(Event::Ended.sources(), [Cleanup::Open]);
    assert_eq!(Event::Deleted.sources(), [Cleanup::Stopping]);
}

/// Tools only while open; the generation scope until deleted.
#[test]
fn tools_stop_at_the_end_and_the_scope_at_deletion() {
    for state in Cleanup::iter() {
        assert_eq!(state.takes_tools(), state == Cleanup::Open, "{state:?}");
        assert_eq!(
            state.undeleted(),
            matches!(state, Cleanup::Open | Cleanup::Stopping),
            "{state:?}"
        );
    }
}

/// A delete is retried until the last attempt, then given up.
#[test]
fn a_failing_delete_is_given_up_after_its_last_attempt() {
    for attempts in 0..MAX_CLEANUP_ATTEMPTS - 1 {
        assert_eq!(Event::delete_failed(attempts), Event::DeleteFailed);
    }
    assert_eq!(
        Event::delete_failed(MAX_CLEANUP_ATTEMPTS - 1),
        Event::GaveUp
    );
    assert_eq!(Event::delete_failed(u8::MAX), Event::GaveUp);
    // Only failed deletes count toward giving up.
    for event in Event::iter() {
        assert_eq!(
            event.counts_attempt(),
            matches!(event, Event::DeleteFailed | Event::GaveUp),
            "{event:?}"
        );
    }
}

/// Only a turn that ended on its own counts as finished; a failed one, or
/// one waiting for an approval or an answer, ends at once as failed; the
/// rest keep waiting.
#[test]
fn every_status_read_ends_the_turn_or_waits() {
    use RoutineActionStatus as Status;
    assert_eq!(
        poll(&Status::Succeeded),
        Poll::Ended(SessionEnding::Finished, None)
    );
    for (reason, name) in [
        (RoutineFailureReason::Cancelled, "cancelled"),
        (RoutineFailureReason::Refusal, "refusal"),
        (RoutineFailureReason::MaxTokens, "max_tokens"),
        (RoutineFailureReason::MaxTurnRequests, "max_turn_requests"),
        (RoutineFailureReason::RuntimeError, "runtime_error"),
        (RoutineFailureReason::UnknownStopReason, "unknown_stop_reason"),
    ] {
        assert_eq!(
            poll(&Status::Failed(reason)),
            Poll::Ended(SessionEnding::Failed, Some(name))
        );
    }
    assert_eq!(
        poll(&Status::Pending(RoutinePendingReason::Permission)),
        Poll::Ended(SessionEnding::Failed, Some("permission"))
    );
    assert_eq!(
        poll(&Status::Pending(RoutinePendingReason::Elicitation)),
        Poll::Ended(SessionEnding::Failed, Some("elicitation"))
    );
    for reason in [
        RoutinePendingReason::AwaitingPrompt,
        RoutinePendingReason::Running,
        RoutinePendingReason::Disconnected,
    ] {
        assert_eq!(poll(&Status::Pending(reason)), Poll::Waiting, "{reason:?}");
    }
}

/// Cleanup stops every turn that may still run before deleting it.
#[test]
fn only_a_finished_turn_is_deleted_without_stopping() {
    for ending in SessionEnding::iter() {
        assert_eq!(
            ending.turn_may_run(),
            ending != SessionEnding::Finished,
            "{ending:?}"
        );
    }
}

/// Each kind's work counts by its own measure.
#[test]
fn work_counts_by_kind() {
    assert!(!Work::FeedChanges(0).any());
    assert!(Work::FeedChanges(3).any());
    assert_eq!(Work::RoutinesSuggested(2).count(), 2);
}
