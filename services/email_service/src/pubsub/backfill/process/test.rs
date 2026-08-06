use super::*;
use std::cell::Cell;

#[tokio::test]
async fn throttled_message_stops_before_context_and_gmail_work() {
    let job_fetch_started = Cell::new(false);
    let link_fetch_started = Cell::new(false);
    let token_fetch_started = Cell::new(false);
    let gmail_message_fetch_started = Cell::new(false);

    let result = dispatch_backfill_message(
        async {
            Err(ProcessingError::Retryable(DetailedError {
                reason: FailureReason::GmailApiRateLimited,
                source: anyhow::anyhow!("Gmail API rate limit exceeded"),
            }))
        },
        async {
            job_fetch_started.set(true);
            link_fetch_started.set(true);
            token_fetch_started.set(true);
            gmail_message_fetch_started.set(true);
            Ok(())
        },
    )
    .await;

    assert!(matches!(
        result,
        Err(ProcessingError::Retryable(DetailedError {
            reason: FailureReason::GmailApiRateLimited,
            ..
        }))
    ));
    assert!(!job_fetch_started.get());
    assert!(!link_fetch_started.get());
    assert!(!token_fetch_started.get());
    assert!(!gmail_message_fetch_started.get());
}
