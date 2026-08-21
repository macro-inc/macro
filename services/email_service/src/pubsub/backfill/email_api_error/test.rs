use std::time::Duration;

use super::*;

fn assert_mapping(error: EmailApiError, retryable: bool, reason: FailureReason) {
    let mapped = map_email_api_error(error, "backfill provider operation failed");
    let detail = match mapped {
        ProcessingError::Retryable(detail) if retryable => detail,
        ProcessingError::NonRetryable(detail) if !retryable => detail,
        other => panic!("unexpected retry classification: {other:?}"),
    };

    assert_eq!(detail.reason, reason);
    assert!(
        detail
            .source
            .to_string()
            .contains("backfill provider operation failed")
    );
}

#[test]
fn maps_rate_limits_to_retryable_rate_limit_failures() {
    assert_mapping(
        EmailApiError::RateLimited {
            retry_after: Some(Duration::from_secs(5)),
            origin: email_api_client::domain::models::RateLimitOrigin::Provider,
        },
        true,
        FailureReason::GmailApiRateLimited,
    );
}

#[test]
fn maps_transient_provider_failures_to_retryable_api_failures() {
    assert_mapping(
        EmailApiError::Transient {
            message: "provider unavailable".to_string(),
        },
        true,
        FailureReason::GmailApiFailed,
    );
}

#[test]
fn maps_auth_failures_to_terminal_token_failures() {
    assert_mapping(
        EmailApiError::AuthRequired,
        false,
        FailureReason::AccessTokenFetchFailed,
    );
}

#[test]
fn maps_outdated_cursors_to_terminal_history_failures() {
    assert_mapping(
        EmailApiError::OutdatedCursor,
        false,
        FailureReason::OutdatedHistoryId,
    );
}

#[test]
fn maps_deterministic_provider_failures_to_terminal_api_failures() {
    for error in [
        EmailApiError::Forbidden,
        EmailApiError::NotFound,
        EmailApiError::Conflict,
        EmailApiError::Permanent {
            message: "invalid response".to_string(),
        },
    ] {
        assert_mapping(error, false, FailureReason::GmailApiFailed);
    }
}
