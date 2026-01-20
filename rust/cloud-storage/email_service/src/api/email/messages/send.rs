use crate::api::context::ApiContext;
use crate::api::email::drafts::create::{CreateDraftError, process_message_to_send};
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::{Extension, Json};
use chrono::Duration;
use model::response::ErrorResponse;
use model::user::UserContext;
use models_email::email::service::message;
use models_email::service::link::Link;
use models_email::service::pubsub::ScheduledPubsubMessage;
use sqlx::types::chrono::Utc;
use strum_macros::AsRefStr;
use thiserror::Error;
use utoipa::ToSchema;
#[derive(Debug, Error, AsRefStr)]
pub enum SendMessageError {
    #[error("Failed to create draft: {0}")]
    DraftError(#[from] CreateDraftError),

    #[error("Failed to enqueue scheduled message: {0}")]
    EnqueueError(#[from] anyhow::Error),

    #[error("Draft ID not found after creation")]
    MissingDraftId,
}

impl IntoResponse for SendMessageError {
    fn into_response(self) -> Response {
        match self {
            SendMessageError::DraftError(e) => e.into_response(),
            SendMessageError::EnqueueError(_) | SendMessageError::MissingDraftId => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "Internal server error",
                }),
            )
                .into_response(),
        }
    }
}

/// The request passed to send a message
#[derive(Debug, serde::Serialize, serde::Deserialize, ToSchema)]
pub struct SendMessageRequest {
    pub message: message::MessageToSend,
}

#[derive(Debug, serde::Serialize, serde::Deserialize, ToSchema)]
pub struct SendMessageResponse {
    pub message: message::MessageToSend,
}

/// Send an email message.
#[utoipa::path(
    post,
    tag = "Messages",
    path = "/email/messages",
    operation_id = "send_message",
    request_body = SendMessageRequest,

    responses(
            (status = 201, body=SendMessageResponse),
            (status = 400, body=ErrorResponse),
            (status = 401, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, user_context, request_body), fields(user_id=user_context.user_id, fusionauth_user_id=user_context.fusion_user_id), err)]
pub async fn send_handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    link: Extension<Link>,
    Json(request_body): Json<SendMessageRequest>,
) -> Result<Response, SendMessageError> {
    let undo_delay_secs = ctx.config.sent_undo_delay_secs;
    let send_time = Utc::now() + Duration::seconds(undo_delay_secs as i64);

    let draft =
        process_message_to_send(&ctx.db, &link, request_body.message, Some(send_time), false)
            .await?;

    let message_db_id = draft.db_id.ok_or(SendMessageError::MissingDraftId)?;

    let scheduled_message = ScheduledPubsubMessage {
        link_id: link.id,
        message_id: message_db_id,
    };

    // small delay to give user more time to undo send
    let delay_seconds = undo_delay_secs as i32 + 2;

    ctx.sqs_client
        .enqueue_email_scheduled_message(scheduled_message, Some(delay_seconds))
        .await?;

    Ok((
        StatusCode::CREATED,
        Json(SendMessageResponse { message: draft }),
    )
        .into_response())
}
