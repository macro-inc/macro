use crate::api::context::ApiContext;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::{Extension, Json};
use model::response::ErrorResponse;
use models_email::service::link::Link;
use strum_macros::AsRefStr;
use thiserror::Error;
use utoipa::ToSchema;

#[derive(Debug, Error, AsRefStr)]
pub enum BlockSenderError {
    #[error("Validation error: {0}")]
    Validation(String),

    #[error("Failed to enqueue block sender operation")]
    EnqueueFailed,

    #[error("Internal error")]
    InternalError(#[from] anyhow::Error),
}

impl IntoResponse for BlockSenderError {
    fn into_response(self) -> Response {
        let status_code = match &self {
            BlockSenderError::Validation(_) => StatusCode::BAD_REQUEST,
            BlockSenderError::EnqueueFailed | BlockSenderError::InternalError(_) => {
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

/// Request to block a sender.
#[derive(Debug, serde::Serialize, serde::Deserialize, ToSchema)]
pub struct BlockSenderRequest {
    /// The email address of the sender to block.
    pub email_address: String,
}

/// Block a sender by creating a Gmail filter that sends their emails to trash.
/// The actual Gmail API call is performed asynchronously by the gmail_ops worker.
#[utoipa::path(
    post,
    tag = "Contacts",
    path = "/email/contacts/block",
    operation_id = "block_sender",
    request_body = BlockSenderRequest,
    responses(
        (status = 200),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, link, req), fields(link_id = %link.id), err)]
pub async fn handler(
    State(ctx): State<ApiContext>,
    link: Extension<Link>,
    Json(req): Json<BlockSenderRequest>,
) -> Result<StatusCode, BlockSenderError> {
    validate_email(&req.email_address)?;

    ctx.sqs_client
        .enqueue_gmail_ops_notification(models_email::gmail::gmail_ops::GmailOpsPubsubMessage {
            link_id: link.id,
            operation: models_email::gmail::gmail_ops::GmailOpsOperation::BlockSender(
                models_email::gmail::gmail_ops::BlockSenderPayload {
                    email_address: req.email_address,
                },
            ),
        })
        .await
        .inspect_err(|e| tracing::error!(error = ?e, "Failed to enqueue block sender operation"))
        .map_err(|_| BlockSenderError::EnqueueFailed)?;

    Ok(StatusCode::OK)
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
