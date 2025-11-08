use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use model::response::ErrorResponse;

/// User IDs are expected to be in the format "macro|email@example.com"
/// Returns the email or an error if the email is invalid
#[tracing::instrument(level = "debug")]
pub fn email_from_user_id(user_id: &str) -> anyhow::Result<String> {
    let email = user_id
        .split_once('|')
        .map(|(_, email)| email.to_string())
        .ok_or_else(|| anyhow::anyhow!("invalid user id format"))?;

    if email.is_empty() {
        return Err(anyhow::anyhow!("empty email in user id"));
    }

    Ok(email)
}

/// Extracts email from a user ID and handles error conversion to a Response
///
/// This is a helper function to avoid repeating the same error handling pattern
/// when extracting an email from a user ID in request handlers.
#[tracing::instrument(level = "debug")]
pub fn extract_email_with_response(user_id: &str) -> Result<String, Response> {
    email_from_user_id(user_id).map_err(|e| {
        tracing::error!(error=?e, "unable to get email from user id");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                message: "unable to get email from user id",
            }),
        )
            .into_response()
    })
}
