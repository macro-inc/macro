use crate::api::context::ApiContext;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::{Extension, Json};
use gmail_client::GmailError;
use model::response::ErrorResponse;
use strum_macros::AsRefStr;
use thiserror::Error;
use utoipa::IntoParams;

#[derive(Debug, Error, AsRefStr)]
pub enum UnblockSenderError {
    #[error("Validation error: {0}")]
    Validation(String),

    #[error("Sender is not blocked")]
    NotBlocked,

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
            _ => UnblockSenderError::GmailError(e.to_string()),
        }
    }
}

#[derive(serde::Serialize, serde::Deserialize, Debug, IntoParams)]
pub struct PathParams {
    /// The email address of the sender to unblock.
    pub email_address: String,
}

/// Unblock a sender by removing their block filter from Gmail.
#[utoipa::path(
    delete,
    tag = "Contacts",
    path = "/email/contacts/block/{email_address}",
    operation_id = "unblock_sender",
    params(PathParams),
    responses(
        (status = 204),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, gmail_token), err)]
pub async fn handler(
    State(ctx): State<ApiContext>,
    gmail_token: Extension<String>,
    Path(PathParams { email_address }): Path<PathParams>,
) -> Result<impl IntoResponse, UnblockSenderError> {
    validate_email(&email_address)?;

    // Check if sender is currently blocked
    let existing_filter = ctx
        .gmail_client
        .find_block_filter_for_sender(&gmail_token, &email_address)
        .await?;

    if existing_filter.is_none() {
        return Err(UnblockSenderError::NotBlocked);
    }

    // Unblock the sender
    let was_unblocked = ctx
        .gmail_client
        .unblock_sender(&gmail_token, &email_address)
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
