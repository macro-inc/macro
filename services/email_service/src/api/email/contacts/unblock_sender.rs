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
pub enum UnblockSenderError {
    #[error("Validation error: {0}")]
    Validation(String),

    #[error("Failed to enqueue unblock sender operation")]
    EnqueueFailed,

    #[error("Internal error")]
    InternalError(#[from] anyhow::Error),
}

impl IntoResponse for UnblockSenderError {
    fn into_response(self) -> Response {
        let status_code = match &self {
            UnblockSenderError::Validation(_) => StatusCode::BAD_REQUEST,
            UnblockSenderError::EnqueueFailed | UnblockSenderError::InternalError(_) => {
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

/// Request to unblock a sender.
#[derive(Debug, serde::Serialize, serde::Deserialize, ToSchema)]
pub struct UnblockSenderRequest {
    /// The email address of the sender to unblock.
    pub email_address: String,
}

/// Unblock a sender by removing their block filter from Gmail.
/// The actual Gmail API call is performed asynchronously by the gmail_ops worker.
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
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, link, req), fields(link_id = %link.id), err)]
pub async fn handler(
    State(ctx): State<ApiContext>,
    link: Extension<Link>,
    Json(req): Json<UnblockSenderRequest>,
) -> Result<StatusCode, UnblockSenderError> {
    validate_email(&req.email_address)?;

    ctx.sqs_client
        .enqueue_gmail_ops_notification(models_email::gmail::gmail_ops::GmailOpsPubsubMessage {
            link_id: link.id,
            operation: models_email::gmail::gmail_ops::GmailOpsOperation::UnblockSender(
                models_email::gmail::gmail_ops::UnblockSenderPayload {
                    email_address: req.email_address,
                },
            ),
        })
        .await
        .inspect_err(|e| tracing::error!(error = ?e, "Failed to enqueue unblock sender operation"))
        .map_err(|_| UnblockSenderError::EnqueueFailed)?;

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
