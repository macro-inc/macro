use std::time::Duration;

use super::*;

#[test]
fn rate_limits_use_queue_routing_policy() {
    let provider_rate_limit = EmailApiError::RateLimited {
        retry_after: Some(Duration::from_secs(30)),
        origin: email_api_client::domain::models::RateLimitOrigin::Provider,
    };

    assert_eq!(error_policy(&provider_rate_limit), ErrorPolicy::RateLimited);
    assert_eq!(rate_limit_route(false), RateLimitRoute::EnqueueRetry);
    assert_eq!(
        rate_limit_route(true),
        RateLimitRoute::RetryAfterVisibilityTimeout
    );
    assert!(matches!(
        processing_error(provider_rate_limit.clone(), false),
        ProcessingError::NonRetryable(DetailedError {
            reason: FailureReason::GmailApiRateLimited,
            ..
        })
    ));
    assert!(matches!(
        processing_error(provider_rate_limit, true),
        ProcessingError::Retryable(DetailedError {
            reason: FailureReason::GmailApiRateLimited,
            ..
        })
    ));
}

#[test]
fn transient_failures_are_retried() {
    let error = EmailApiError::Transient {
        message: "provider unavailable".to_string(),
    };

    assert_eq!(error_policy(&error), ErrorPolicy::Retry);
    assert!(matches!(
        processing_error(error, true),
        ProcessingError::Retryable(DetailedError {
            reason: FailureReason::GmailApiFailed,
            ..
        })
    ));
}

#[test]
fn modify_message_labels_permanent_failures_are_terminal_and_require_revert() {
    let error = EmailApiError::Permanent {
        message: "invalid label mutation".to_string(),
    };

    assert!(is_permanent_mutation_error(&error));
    assert!(matches!(
        processing_error(error, false),
        ProcessingError::NonRetryable(DetailedError {
            reason: FailureReason::GmailApiFailed,
            ..
        })
    ));
}

#[test]
fn not_found_is_success_for_delete_label() {
    assert!(is_delete_label_success(&EmailApiError::NotFound));
    assert!(!is_delete_label_success(&EmailApiError::Forbidden));
}

#[test]
fn modify_message_labels_rate_limited_and_transient_failures_do_not_revert() {
    assert!(!is_permanent_mutation_error(&EmailApiError::RateLimited {
        retry_after: None,
        origin: email_api_client::domain::models::RateLimitOrigin::Provider,
    }));
    assert!(!is_permanent_mutation_error(&EmailApiError::Transient {
        message: "timeout".to_string(),
    }));
}
