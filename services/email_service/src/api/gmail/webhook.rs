use crate::api::context::ApiContext;
use axum::extract::State;
use axum::http::HeaderMap;
use axum::{
    extract,
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use email::domain::mailbox::gmail_push::{GmailPushError, PushAuthenticationError};
use model::response::ErrorResponse;
use models_email::gmail::inbox_sync::GmailInboxSyncPayload;

/// webhook that GCP hits when there are changes to a user's inbox. we authenticate the message then
/// queue it onto our own sqs queue and handle it in pubsub/gmail/process.rs.
pub(crate) async fn webhook_handler(
    State(ctx): State<ApiContext>,
    headers: HeaderMap,
    extract::Json(req): extract::Json<GmailInboxSyncPayload>,
) -> Result<Response, Response> {
    let authorization = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok());
    ctx.gmail_push
        .receive(
            &req.message.data.email_address,
            req.message.data.history_id,
            authorization,
        )
        .await
        .map_err(error_response)?;

    Ok(Json(StatusCode::ACCEPTED).into_response())
}

fn error_response(error: GmailPushError) -> Response {
    let (status, message) = match error {
        GmailPushError::Authentication(PushAuthenticationError::PublicKeysUnavailable) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            "unable to get google public keys",
        ),
        GmailPushError::Authentication(PushAuthenticationError::MissingBearerToken) => (
            StatusCode::UNAUTHORIZED,
            "Missing Authorization bearer token",
        ),
        GmailPushError::Authentication(PushAuthenticationError::RefreshFailed) => (
            StatusCode::UNAUTHORIZED,
            "Authentication failed and couldn't refresh verification keys",
        ),
        GmailPushError::Authentication(PushAuthenticationError::InvalidToken) => {
            (StatusCode::UNAUTHORIZED, "Invalid authentication token")
        }
        GmailPushError::InboxLookupFailed | GmailPushError::EnqueueFailed => (
            StatusCode::INTERNAL_SERVER_ERROR,
            "unable to enqueue gmail notification",
        ),
    };
    (
        status,
        Json(ErrorResponse {
            message: message.into(),
        }),
    )
        .into_response()
}
