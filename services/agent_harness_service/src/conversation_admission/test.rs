use super::*;
use std::sync::atomic::{AtomicU32, Ordering};

const QUICK: Retries = Retries {
    attempts: 4,
    first_wait: Duration::from_millis(1),
    longest_wait: Duration::from_millis(2),
};

#[tokio::test]
async fn a_refused_message_is_offered_again_until_the_journal_takes_it() {
    let attempts = AtomicU32::new(0);
    let admitted = journal(QUICK, || async {
        if attempts.fetch_add(1, Ordering::SeqCst) < 2 {
            Err("pool timed out")
        } else {
            Ok("journaled")
        }
    })
    .await;
    assert_eq!(admitted, Ok("journaled"));
    assert_eq!(attempts.load(Ordering::SeqCst), 3);
}

#[tokio::test]
async fn a_message_the_journal_keeps_refusing_is_returned_after_the_last_attempt() {
    let attempts = AtomicU32::new(0);
    let admitted: Result<(), _> = journal(QUICK, || async {
        attempts.fetch_add(1, Ordering::SeqCst);
        Err("conversation context stayed busy")
    })
    .await;
    assert_eq!(admitted, Err("conversation context stayed busy"));
    assert_eq!(attempts.load(Ordering::SeqCst), QUICK.attempts);
}
