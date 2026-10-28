#[cfg(test)]
mod test;

use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use model::response::ErrorResponse;

const SIGNUP_FORBIDDEN_MESSAGE: &str = "signup is not allowed";

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
