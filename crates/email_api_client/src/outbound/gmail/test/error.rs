use std::time::Duration;

use gmail_client::GmailApiHttpError;
use http::StatusCode;

use crate::domain::models::{EmailApiError, RateLimitOrigin};
use crate::outbound::gmail::{
    GmailApiClientRepository, map_contacts_error, map_gmail_error, map_history_error,
    map_watch_error,
};

fn http_error(
    status: StatusCode,
    body: impl Into<String>,
    retry_after: Option<Duration>,
) -> GmailApiHttpError {
    GmailApiHttpError::Http {
        status,
        body: body.into(),
        retry_after,
    }
}

#[test]
fn maps_provider_statuses_centrally() {
    assert_eq!(
        map_gmail_error(http_error(StatusCode::UNAUTHORIZED, "auth", None)),
        EmailApiError::AuthRequired
    );
    assert_eq!(
        map_gmail_error(http_error(StatusCode::FORBIDDEN, "scope", None)),
        EmailApiError::Forbidden
    );
    assert_eq!(
        map_gmail_error(http_error(StatusCode::NOT_FOUND, "missing", None)),
        EmailApiError::NotFound
    );
    assert_eq!(
        map_gmail_error(http_error(StatusCode::CONFLICT, "conflict", None)),
        EmailApiError::Conflict
    );

    let retry_after = Duration::from_secs(30);
    assert_eq!(
        map_gmail_error(http_error(
            StatusCode::TOO_MANY_REQUESTS,
            "quota",
            Some(retry_after),
        )),
        EmailApiError::RateLimited {
            retry_after: Some(retry_after),
            origin: RateLimitOrigin::Provider,
        }
    );
}

#[test]
fn quota_403s_are_rate_limited_and_plain_403s_stay_forbidden() {
    assert_eq!(
        map_gmail_error(http_error(
            StatusCode::FORBIDDEN,
            r#"{"error":{"errors":[{"reason":"userRateLimitExceeded"}]}}"#,
            None,
        )),
        EmailApiError::RateLimited {
            retry_after: None,
            origin: RateLimitOrigin::Provider,
        }
    );

    let retry_after = Duration::from_secs(12);
    assert_eq!(
        map_gmail_error(http_error(
            StatusCode::FORBIDDEN,
            r#"{"error":{"errors":[{"reason":"rateLimitExceeded"}]}}"#,
            Some(retry_after),
        )),
        EmailApiError::RateLimited {
            retry_after: Some(retry_after),
            origin: RateLimitOrigin::Provider,
        }
    );

    for reason in ["dailyLimitExceeded", "quotaExceeded"] {
        assert_eq!(
            map_gmail_error(http_error(
                StatusCode::FORBIDDEN,
                format!(r#"{{"error":{{"errors":[{{"reason":"{reason}"}}]}}}}"#),
                None,
            )),
            EmailApiError::RateLimited {
                retry_after: None,
                origin: RateLimitOrigin::Provider,
            },
            "reason {reason} should map to RateLimited",
        );
    }

    assert_eq!(
        map_gmail_error(http_error(
            StatusCode::FORBIDDEN,
            "Request had insufficient authentication scopes.",
            None,
        )),
        EmailApiError::Forbidden
    );
}

#[test]
fn maps_server_errors_as_transient_and_other_http_errors_as_permanent() {
    assert!(matches!(
        map_gmail_error(http_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "try later",
            None,
        )),
        EmailApiError::Transient { message } if message.contains("try later")
    ));
    assert!(matches!(
        map_gmail_error(http_error(StatusCode::BAD_REQUEST, "invalid", None)),
        EmailApiError::Permanent { message } if message.contains("invalid")
    ));
}

#[test]
fn maps_invalid_responses_as_permanent() {
    assert!(matches!(
        map_gmail_error(GmailApiHttpError::InvalidResponse(
            "missing required field".to_string(),
        )),
        EmailApiError::Permanent { message } if message.contains("missing required field")
    ));
}

#[test]
fn history_not_found_is_an_outdated_cursor() {
    assert_eq!(
        map_history_error(http_error(StatusCode::NOT_FOUND, "stale history", None)),
        EmailApiError::OutdatedCursor
    );
    assert_eq!(
        map_history_error(http_error(StatusCode::FORBIDDEN, "scope", None)),
        EmailApiError::Forbidden
    );
}

#[test]
fn expired_contacts_sync_token_is_an_outdated_cursor() {
    assert_eq!(
        map_contacts_error(http_error(
            StatusCode::BAD_REQUEST,
            r#"{"error":{"status":"FAILED_PRECONDITION","details":[{"reason":"EXPIRED_SYNC_TOKEN"}]}}"#,
            None,
        )),
        EmailApiError::OutdatedCursor
    );
    assert!(matches!(
        map_contacts_error(http_error(StatusCode::BAD_REQUEST, "invalid request", None)),
        EmailApiError::Permanent { .. }
    ));
}

#[test]
fn watch_conflict_requires_gmails_status_and_body() {
    assert_eq!(
        map_watch_error(http_error(
            StatusCode::BAD_REQUEST,
            "Only one user push notification client allowed",
            None,
        )),
        EmailApiError::Conflict
    );
    assert!(matches!(
        map_watch_error(http_error(
            StatusCode::BAD_REQUEST,
            "another bad request",
            None,
        )),
        EmailApiError::Permanent { .. }
    ));
    assert_eq!(
        map_watch_error(http_error(StatusCode::CONFLICT, "ordinary conflict", None,)),
        EmailApiError::Conflict
    );
}

#[test]
fn repository_can_be_composed_from_a_topic_and_cloned() {
    let repository = GmailApiClientRepository::from_subscription_topic("projects/p/topics/mail");
    let _clone = repository.clone();
}
