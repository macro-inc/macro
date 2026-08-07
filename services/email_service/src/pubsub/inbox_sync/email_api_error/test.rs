use std::time::Duration;

use super::*;

#[test]
fn primary_worker_routes_rate_limits_to_retry_queue() {
    assert_eq!(rate_limit_route(false), RateLimitRoute::EnqueueRetry);
}

#[test]
fn retry_worker_uses_visibility_timeout_for_rate_limits() {
    assert_eq!(
        rate_limit_route(true),
        RateLimitRoute::RetryAfterVisibilityTimeout
    );
}

#[test]
fn gmail_message_local_rate_refusal_is_non_retryable() {
    let error = handle_gmail_message_error(EmailApiError::RateLimited {
        retry_after: Some(Duration::from_secs(10)),
        origin: RateLimitOrigin::Local,
    });

    assert!(matches!(
        error,
        ProcessingError::NonRetryable(DetailedError {
            reason: FailureReason::GmailApiRateLimited,
            ..
        })
    ));
}

#[test]
fn gmail_message_provider_429_is_retried() {
    let error = handle_gmail_message_error(EmailApiError::RateLimited {
        retry_after: Some(Duration::from_secs(10)),
        origin: RateLimitOrigin::Provider,
    });

    assert!(matches!(
        error,
        ProcessingError::Retryable(DetailedError {
            reason: FailureReason::GmailApiRateLimited,
            ..
        })
    ));
}

#[test]
fn outdated_cursor_is_a_terminal_history_failure() {
    let error = handle_gmail_message_error(EmailApiError::OutdatedCursor);

    assert!(matches!(
        error,
        ProcessingError::NonRetryable(DetailedError {
            reason: FailureReason::OutdatedHistoryId,
            ..
        })
    ));
}
