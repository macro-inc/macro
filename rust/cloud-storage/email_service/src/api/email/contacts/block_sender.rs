use crate::api::context::ApiContext;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::{Extension, Json};
use gmail_client::{Filter, GmailError};
use model::response::ErrorResponse;
use strum_macros::AsRefStr;
use thiserror::Error;
use utoipa::ToSchema;

#[derive(Debug, Error, AsRefStr)]
pub enum BlockSenderError {
    #[error("Validation error: {0}")]
    Validation(String),

    #[error("Sender is already blocked")]
    AlreadyBlocked,

    #[error("Insufficient Gmail permissions. Please re-authenticate to grant the required scope.")]
    Forbidden,

    #[error("Gmail API error: {0}")]
    GmailError(String),

    #[error("Internal error")]
    InternalError(#[from] anyhow::Error),
}

impl IntoResponse for BlockSenderError {
    fn into_response(self) -> Response {
        let status_code = match &self {
            BlockSenderError::Validation(_) => StatusCode::BAD_REQUEST,
            BlockSenderError::AlreadyBlocked => StatusCode::CONFLICT,
            BlockSenderError::Forbidden => StatusCode::FORBIDDEN,
            BlockSenderError::GmailError(_) | BlockSenderError::InternalError(_) => {
                StatusCode::INTERNAL_SERVER_ERROR
            }
        };

        (
            status_code,
            Json(ErrorResponse {
                message: self.to_string().into(),
            }),
        )
            .into_response()
    }
}

impl From<GmailError> for BlockSenderError {
    fn from(e: GmailError) -> Self {
        match e {
            GmailError::Conflict(_) => BlockSenderError::AlreadyBlocked,
            GmailError::Forbidden => BlockSenderError::Forbidden,
            _ => BlockSenderError::GmailError(e.to_string()),
        }
    }
}

/// Request to block a sender.
#[derive(Debug, serde::Serialize, serde::Deserialize, ToSchema)]
pub struct BlockSenderRequest {
    /// The email address of the sender to block.
    pub email_address: String,
}

/// Response after blocking a sender.
#[derive(Debug, serde::Serialize, serde::Deserialize, ToSchema)]
pub struct BlockSenderResponse {
    /// The ID of the filter created in Gmail.
    pub filter_id: String,
}

/// Block a sender by creating a Gmail filter that sends their emails to trash.
#[utoipa::path(
    post,
    tag = "Contacts",
    path = "/email/contacts/block",
    operation_id = "block_sender",
    request_body = BlockSenderRequest,
    responses(
        (status = 201, body = BlockSenderResponse),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 409, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, gmail_token), err)]
pub async fn handler(
    State(ctx): State<ApiContext>,
    gmail_token: Extension<String>,
    Json(req): Json<BlockSenderRequest>,
) -> Result<(StatusCode, Json<BlockSenderResponse>), BlockSenderError> {
    validate_email(&req.email_address)?;

    // Check if sender is already blocked
    let existing_filter = ctx
        .gmail_client
        .find_block_filter_for_sender(&gmail_token, &req.email_address)
        .await?;

    if existing_filter.is_some() {
        return Err(BlockSenderError::AlreadyBlocked);
    }

    // Create the block filter
    let filter: Filter = ctx
        .gmail_client
        .block_sender(&gmail_token, &req.email_address)
        .await?;

    let filter_id = filter.id.unwrap_or_default();

    Ok((StatusCode::CREATED, Json(BlockSenderResponse { filter_id })))
}

fn validate_email(email: &str) -> Result<(), BlockSenderError> {
    if email.trim().is_empty() {
        return Err(BlockSenderError::Validation(
            "Email address cannot be empty".to_string(),
        ));
    }
    if !email.contains('@') {
        return Err(BlockSenderError::Validation(
            "Invalid email address format".to_string(),
        ));
    }
    if email.len() > 254 {
        return Err(BlockSenderError::Validation(
            "Email address is too long".to_string(),
        ));
    }
    Ok(())
}
