use std::time::Duration;

use email_api_client::domain::models::RateLimitOrigin;

use super::*;

#[test]
fn maps_provider_errors_to_api_statuses() {
    let cases = [
        (
            EmailApiError::RateLimited {
                retry_after: Some(Duration::from_secs(10)),
                origin: RateLimitOrigin::Provider { concurrency: false },
            },
            StatusCode::TOO_MANY_REQUESTS,
        ),
        (EmailApiError::AuthRequired, StatusCode::UNAUTHORIZED),
        (EmailApiError::Forbidden, StatusCode::FORBIDDEN),
        (EmailApiError::NotFound, StatusCode::NOT_FOUND),
        (EmailApiError::Conflict, StatusCode::CONFLICT),
        (
            EmailApiError::SendRejected {
                message: "message exceeds provider size limit".to_string(),
            },
            StatusCode::BAD_REQUEST,
        ),
        (
            EmailApiError::Transient {
                message: "provider unavailable".to_string(),
            },
            StatusCode::INTERNAL_SERVER_ERROR,
        ),
        (
            EmailApiError::Permanent {
                message: "invalid provider response".to_string(),
            },
            StatusCode::INTERNAL_SERVER_ERROR,
        ),
    ];

    for (error, expected_status) in cases {
        assert_eq!(provider_error_status(&error), expected_status);
    }
}

#[test]
fn maps_outdated_cursor_to_conflict() {
    assert_eq!(
        provider_error_status(&EmailApiError::OutdatedCursor),
        StatusCode::CONFLICT
    );
}

#[test]
fn rate_limited_responses_carry_a_retry_after_header_when_known() {
    let headers = provider_error_headers(&EmailApiError::RateLimited {
        retry_after: Some(Duration::from_secs(42)),
        origin: RateLimitOrigin::Provider { concurrency: false },
    });
    assert_eq!(
        headers.get(RETRY_AFTER).and_then(|v| v.to_str().ok()),
        Some("42")
    );

    let headers = provider_error_headers(&EmailApiError::RateLimited {
        retry_after: Some(Duration::from_millis(950)),
        origin: RateLimitOrigin::Local,
    });
    assert_eq!(
        headers.get(RETRY_AFTER).and_then(|v| v.to_str().ok()),
        Some("1"),
        "a sub-second wait must not tell clients to retry immediately"
    );

    assert!(
        provider_error_headers(&EmailApiError::RateLimited {
            retry_after: None,
            origin: RateLimitOrigin::Provider { concurrency: false },
        })
        .is_empty()
    );
    assert!(provider_error_headers(&EmailApiError::NotFound).is_empty());
}
