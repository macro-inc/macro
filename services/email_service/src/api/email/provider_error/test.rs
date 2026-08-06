use std::time::Duration;

use super::*;

#[test]
fn maps_provider_errors_to_api_statuses() {
    let cases = [
        (
            EmailApiError::RateLimited {
                retry_after: Some(Duration::from_secs(10)),
            },
            StatusCode::TOO_MANY_REQUESTS,
        ),
        (EmailApiError::AuthRequired, StatusCode::UNAUTHORIZED),
        (EmailApiError::Forbidden, StatusCode::FORBIDDEN),
        (EmailApiError::NotFound, StatusCode::NOT_FOUND),
        (EmailApiError::Conflict, StatusCode::CONFLICT),
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
