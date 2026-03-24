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
pub enum UnblockSenderError {
    #[error("Validation error: {0}")]
    Validation(String),

    #[error("Sender is not blocked")]
    NotBlocked,

    #[error("Insufficient Gmail permissions. Please re-authenticate to grant the required scope.")]
    Forbidden,

    #[error("Gmail API error: {0}")]
    GmailError(String),

    #[error("Internal error")]
    InternalError(#[from] anyhow::Error),
}

impl IntoResponse for UnblockSenderError {
    fn into_response(self) -> Response {
        let status_code = match &self {
            UnblockSenderError::Validation(_) => StatusCode::BAD_REQUEST,
            UnblockSenderError::NotBlocked => StatusCode::NOT_FOUND,
            UnblockSenderError::Forbidden => StatusCode::FORBIDDEN,
            UnblockSenderError::GmailError(_) | UnblockSenderError::InternalError(_) => {
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

impl From<GmailError> for UnblockSenderError {
    fn from(e: GmailError) -> Self {
        match e {
            GmailError::NotFound(_) => UnblockSenderError::NotBlocked,
            GmailError::Forbidden => UnblockSenderError::Forbidden,
            _ => UnblockSenderError::GmailError(e.to_string()),
        }
    }
}

/// Request to unblock a sender.
#[derive(Debug, serde::Serialize, serde::Deserialize, ToSchema)]
pub struct UnblockSenderRequest {
    /// The email address of the sender to unblock.
    pub email_address: String,
}

/// Unblock a sender by removing their block filter from Gmail.
#[utoipa::path(
    post,
    tag = "Contacts",
    path = "/email/contacts/unblock",
    operation_id = "unblock_sender",
    request_body = UnblockSenderRequest,
    responses(
        (status = 204),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, gmail_token), err)]
pub async fn handler(
    State(ctx): State<ApiContext>,
    gmail_token: Extension<String>,
    Json(req): Json<UnblockSenderRequest>,
) -> Result<impl IntoResponse, UnblockSenderError> {
    validate_email(&req.email_address)?;

    // Check if sender is currently blocked
    let existing_filter = ctx
        .gmail_client
        .find_block_filter_for_sender(&gmail_token, &req.email_address)
        .await?;

    if existing_filter.is_none() {
        return Err(UnblockSenderError::NotBlocked);
    }

    // Unblock the sender
    let was_unblocked = ctx
        .gmail_client
        .unblock_sender(&gmail_token, &req.email_address)
        .await?;

    if !was_unblocked {
        return Err(UnblockSenderError::NotBlocked);
    }

    Ok(StatusCode::NO_CONTENT)
}

fn validate_email(email: &str) -> Result<(), UnblockSenderError> {
    if email.trim().is_empty() {
        return Err(UnblockSenderError::Validation(
            "Email address cannot be empty".to_string(),
        ));
    }
    if !email.contains('@') {
        return Err(UnblockSenderError::Validation(
            "Invalid email address format".to_string(),
        ));
    }
    if email.len() > 254 {
        return Err(UnblockSenderError::Validation(
            "Email address is too long".to_string(),
        ));
    }
    Ok(())
}
