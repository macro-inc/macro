use crate::api::context::ApiContext;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::{Extension, Json};
use gmail_client::GmailError;
use model::response::ErrorResponse;
use strum_macros::AsRefStr;
use thiserror::Error;
use utoipa::ToSchema;

#[derive(Debug, Error, AsRefStr)]
pub enum ListBlockedError {
    #[error("Gmail API error: {0}")]
    GmailError(String),

    #[error("Internal error")]
    InternalError(#[from] anyhow::Error),
}

impl IntoResponse for ListBlockedError {
    fn into_response(self) -> Response {
        let status_code = match &self {
            ListBlockedError::GmailError(_) | ListBlockedError::InternalError(_) => {
                StatusCode::INTERNAL_SERVER_ERROR
            }
        };

        (
            status_code,
            Json(ErrorResponse {
                message: self.to_string().as_str(),
            }),
        )
            .into_response()
    }
}

impl From<GmailError> for ListBlockedError {
    fn from(e: GmailError) -> Self {
        ListBlockedError::GmailError(e.to_string())
    }
}

/// Response containing list of blocked email addresses.
#[derive(Debug, serde::Serialize, serde::Deserialize, ToSchema)]
pub struct ListBlockedResponse {
    /// List of email addresses that are currently blocked.
    pub blocked_emails: Vec<String>,
}

/// List all blocked senders for the authenticated user.
#[utoipa::path(
    get,
    tag = "Contacts",
    path = "/email/contacts/blocked",
    operation_id = "list_blocked_senders",
    responses(
        (status = 200, body = ListBlockedResponse),
        (status = 401, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, gmail_token), err)]
pub async fn handler(
    State(ctx): State<ApiContext>,
    gmail_token: Extension<String>,
) -> Result<Json<ListBlockedResponse>, ListBlockedError> {
    let blocked_emails = ctx.gmail_client.list_blocked_senders(&gmail_token).await?;

    Ok(Json(ListBlockedResponse { blocked_emails }))
}
