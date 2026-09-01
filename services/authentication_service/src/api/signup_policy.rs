#[cfg(test)]
mod test;

use authentication_service::service::signup_policy::SignupOrigin;
use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use model::response::ErrorResponse;
use serde_json::{Value, json};

const SHARED_MAILBOX_GRANT_PURPOSE: &str = "shared_mailbox_grant";
const SIGNUP_FORBIDDEN_MESSAGE: &str = "signup is not allowed";

/// Build the trusted FusionAuth user metadata for internally-created shared mailbox users.
pub(crate) fn shared_mailbox_grant_user_data() -> Value {
    json!({
        "macro": {
            "userPurpose": SHARED_MAILBOX_GRANT_PURPOSE,
        },
    })
}

/// Decode FusionAuth user metadata into the signup origin used by the service policy.
pub(crate) fn signup_origin_from_fusionauth_user_data(
    email: impl Into<String>,
    data: Option<&Value>,
) -> SignupOrigin {
    match data {
        Some(value) if value == &shared_mailbox_grant_user_data() => SignupOrigin::SharedMailbox,
        _ => SignupOrigin::Public {
            email: email.into(),
        },
    }
}

/// Map an expected signup-policy rejection to a generic API response.
pub(crate) fn signup_forbidden_response() -> Response {
    (
        StatusCode::FORBIDDEN,
        Json(ErrorResponse {
            message: SIGNUP_FORBIDDEN_MESSAGE.into(),
        }),
    )
        .into_response()
}
