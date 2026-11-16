use super::*;

fn step(id: u128) -> Step {
    Step {
        id: Uuid::from_u128(id),
        delay_days: 1,
        subject: "Subject".to_owned(),
        body: "Body".to_owned(),
        as_reply: false,
    }
}

fn reached(id: u128) -> HistoryRow {
    HistoryRow {
        step_id: Uuid::from_u128(id),
        message_id: Uuid::from_u128(id + 100),
        delivery_message_id: None,
        provider_message_id: None,
        status: StepStatus::Sent,
        scheduled_at: DateTime::UNIX_EPOCH,
        sent_at: Some(DateTime::UNIX_EPOCH),
    }
}

fn next(steps: &[Step], history: &[HistoryRow]) -> Option<u128> {
    next_step(steps, history).map(|(_, step)| step.id.as_u128())
}

#[test]
fn next_step_follows_the_last_reached_step_still_in_the_sequence() {
    let steps = [step(1), step(2), step(3)];
    assert_eq!(next(&steps, &[]), Some(1));
    assert_eq!(next(&steps, &[reached(1)]), Some(2));
    assert_eq!(next(&steps, &[reached(1), reached(2), reached(3)]), None);
    // Step 2 was removed after it went out: step 1 still anchors the place.
    assert_eq!(
        next(&[step(1), step(3)], &[reached(1), reached(2)]),
        Some(3)
    );
}

#[test]
fn a_rewritten_opener_is_not_sent_to_someone_who_already_got_one() {
    // The owner replaced email 1 (new id 9) while this person waited for email 2.
    assert_eq!(next(&[step(9), step(2)], &[reached(1)]), Some(2));
    // Both emails they had were replaced: the third is next.
    assert_eq!(
        next(&[step(8), step(9), step(3)], &[reached(1), reached(2)]),
        Some(3)
    );
    // Nothing is left past the emails they have had.
    assert_eq!(next(&[step(8), step(9)], &[reached(1), reached(2)]), None);
}
