use super::*;
use crate::inbound::kafka_consumer::attempts::{Diagnosis, Handled};

fn exhausted(failure: Failure) -> Attempted {
    Err(Exhausted {
        error: "failed".to_owned(),
        diagnosis: Diagnosis {
            failure,
            failed_items: 0,
        },
        attempts: 1,
    })
}

#[test]
fn an_applied_replay_is_finished() {
    let (record, done) = conclude_replay(Ok((Handled::Indexed, 1)), 1);

    assert_eq!(record.outcome, EventOutcome::Indexed);
    assert_eq!(done, ReplayDone::Finished);
}

#[test]
fn a_replay_whose_source_is_still_missing_ends_without_the_dead_letter_queue() {
    for receive_count in [1, REPLAY_MAX_RECEIVES] {
        let (record, done) = conclude_replay(exhausted(Failure::SourceMissing), receive_count);

        assert_eq!(record.outcome, EventOutcome::SourceMissing);
        assert_eq!(record.failure, Some(Failure::SourceMissing));
        assert_eq!(done, ReplayDone::Finished);
    }
}

#[test]
fn a_failed_replay_is_delivered_again_and_lost_only_on_its_last_delivery() {
    let (first, first_done) = conclude_replay(exhausted(Failure::Overloaded), 1);
    let (last, last_done) = conclude_replay(exhausted(Failure::Overloaded), REPLAY_MAX_RECEIVES);

    assert_eq!(
        (first.outcome, first_done),
        (EventOutcome::Failed, ReplayDone::Redeliver)
    );
    assert_eq!(
        (last.outcome, last_done),
        (EventOutcome::Dropped, ReplayDone::Redeliver)
    );
    assert_eq!(last.failure, Some(Failure::Overloaded));
}

#[test]
fn a_replay_is_read_from_its_original_record() {
    let replay = ReplayBrokerEvent {
        event_id: "event-1".to_owned(),
        topic: "macro.chats".to_owned(),
        partition: 0,
        offset: 1,
        key: "chat-1".to_owned(),
        payload: "not json".to_owned(),
        produced_at_ms: None,
        attempts: 3,
        failure: "error".to_owned(),
        traceparent: None,
    };

    let record = ReplayRecord(&replay);

    assert_eq!(MessageParts::key(&record), Some("chat-1"));
    assert_eq!(MessageParts::topic(&record), "macro.chats");
    assert!(decode(&replay).is_err(), "a payload that is not an event");
}
