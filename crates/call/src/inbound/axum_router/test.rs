use axum::http::StatusCode;
use axum::response::IntoResponse;

use crate::domain::models::CallError;

#[test]
fn maps_domain_errors_to_status_codes() {
    let cases = [
        (
            CallError::NotFound("call".to_string()),
            StatusCode::NOT_FOUND,
        ),
        (CallError::NotInCall, StatusCode::BAD_REQUEST),
        (
            CallError::AlreadyInCall("channel".to_string()),
            StatusCode::CONFLICT,
        ),
        (CallError::Auth, StatusCode::UNAUTHORIZED),
        (
            CallError::InvalidRequest("view only".to_string()),
            StatusCode::BAD_REQUEST,
        ),
        // Team sharing by anyone but the call's creator.
        (
            CallError::Forbidden("not the creator".to_string()),
            StatusCode::FORBIDDEN,
        ),
        // Stale team-share facts: reload and retry.
        (
            CallError::Conflict("stale".to_string()),
            StatusCode::CONFLICT,
        ),
        (
            CallError::Internal(anyhow::anyhow!("boom")),
            StatusCode::INTERNAL_SERVER_ERROR,
        ),
    ];

    for (error, status) in cases {
        let description = format!("{error:?}");
        assert_eq!(error.into_response().status(), status, "{description}");
    }
}
