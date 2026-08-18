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

/// Pins the full `EmailApiError` → `ProcessingError` policy table for
/// inbox_sync operations (the non-rate-limit path of `handle_operation_error`
/// and the retry-worker rate-limit branch both route through
/// `processing_error`), mirroring the backfill policy test's coverage.
#[test]
fn processing_error_policy_covers_every_variant() {
    let cases: Vec<(EmailApiError, bool, FailureReason)> = vec![
        (
            EmailApiError::RateLimited {
                retry_after: Some(Duration::from_secs(5)),
                origin: RateLimitOrigin::Provider,
            },
            true,
            FailureReason::GmailApiRateLimited,
        ),
        (
            EmailApiError::RateLimited {
                retry_after: None,
                origin: RateLimitOrigin::Local,
            },
            true,
            FailureReason::GmailApiRateLimited,
        ),
        (
            EmailApiError::AuthRequired,
            false,
            FailureReason::AccessTokenFetchFailed,
        ),
        (
            EmailApiError::Forbidden,
            false,
            FailureReason::GmailApiFailed,
        ),
        (
            EmailApiError::NotFound,
            false,
            FailureReason::GmailApiFailed,
        ),
        (
            EmailApiError::Conflict,
            false,
            FailureReason::GmailApiFailed,
        ),
        (
            EmailApiError::OutdatedCursor,
            false,
            FailureReason::OutdatedHistoryId,
        ),
        (
            EmailApiError::Transient {
                message: "blip".to_string(),
            },
            true,
            FailureReason::GmailApiFailed,
        ),
        (
            EmailApiError::Permanent {
                message: "broken".to_string(),
            },
            false,
            FailureReason::GmailApiFailed,
        ),
    ];

    for (error, expect_retryable, expect_reason) in cases {
        let description = format!("{error:?}");
        match processing_error(error) {
            ProcessingError::Retryable(detail) => {
                assert!(expect_retryable, "{description} must not be retryable");
                assert_eq!(detail.reason, expect_reason, "{description}");
            }
            ProcessingError::NonRetryable(detail) => {
                assert!(!expect_retryable, "{description} must be retryable");
                assert_eq!(detail.reason, expect_reason, "{description}");
            }
        }
    }
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
