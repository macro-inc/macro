use crate::api::context::ApiContext;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::{Extension, Json};
use email::domain::events::{EmailMacroEvent, MessageSendCancelledMetadata, SendCancelReason};
use email_service::pubsub::publish_email_event;
use macro_user_id::user_id::MacroUserIdStr;
use model::response::ErrorResponse;
use model::user::UserContext;
use models_email::service::link::Link;
use strum_macros::AsRefStr;
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Error, AsRefStr)]
pub enum DeleteScheduledError {
    #[error("Scheduled message not found")]
    NotFound,

    #[error("Message has already been sent")]
    AlreadySent,

    #[error("Failed to delete scheduled message")]
    QueryError(#[from] anyhow::Error),

    #[error("Database error")]
    DatabaseError(#[from] sqlx::Error),
}

impl IntoResponse for DeleteScheduledError {
    fn into_response(self) -> Response {
        let status_code = match &self {
            DeleteScheduledError::NotFound => StatusCode::NOT_FOUND,
            DeleteScheduledError::AlreadySent => StatusCode::BAD_REQUEST,
            DeleteScheduledError::QueryError(_) | DeleteScheduledError::DatabaseError(_) => {
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

/// Remove the scheduled send from a draft.
#[utoipa::path(
    delete,
    tag = "Draft Scheduling",
    path = "/email/drafts/scheduled/{message_id}",
    operation_id = "delete_scheduled_draft",
    params(
        ("message_id" = Uuid, Path, description = "The ID of the draft")
    ),
    responses(
        (status = 204, description = "Scheduled send deleted successfully"),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, user_context), err)]
pub async fn handler(
    State(ctx): State<ApiContext>,
    link: Extension<Link>,
    user_context: Extension<UserContext>,
    Path(message_id): Path<Uuid>,
) -> Result<StatusCode, DeleteScheduledError> {
    let mut tx = ctx.db.begin().await?;

    // Check if the scheduled message exists and hasn't been sent
    let scheduled_message = email_db_client::messages::scheduled::get::get_scheduled_message(
        &mut *tx, link.id, message_id,
    )
    .await?
    .ok_or(DeleteScheduledError::NotFound)?;

    if scheduled_message.sent || scheduled_message.processing {
        return Err(DeleteScheduledError::AlreadySent);
    }

    email_db_client::messages::scheduled::delete::delete_scheduled_message(
        &mut *tx, link.id, message_id,
    )
    .await?;

    // if we undo send for a message, turn it back into a draft
    email_db_client::messages::update::update_message_draft_status(
        &mut tx, message_id, link.id, true,
    )
    .await?;

    tx.commit().await?;

    // Best-effort event: resolve the draft's thread for the payload.
    let thread_db_id = email_db_client::messages::get_simple_messages::get_simple_message(
        &ctx.db,
        &message_id,
        &link.fusionauth_user_id,
    )
    .await
    .inspect_err(
        |e| tracing::warn!(error=?e, %message_id, "skipping message_send_cancelled event: draft lookup failed"),
    )
    .ok()
    .flatten()
    .map(|m| m.thread_db_id);
    if let Some(thread_id) = thread_db_id {
        publish_email_event(
            ctx.macro_event_broker.as_ref(),
            &EmailMacroEvent::message_send_cancelled(MessageSendCancelledMetadata {
                link_id: link.id,
                owner: link.macro_id.clone(),
                actor: MacroUserIdStr::try_from(user_context.user_id.clone()).ok(),
                message_id,
                thread_id,
                reason: SendCancelReason::Undo,
            }),
        )
        .await;
    }

    Ok(StatusCode::NO_CONTENT)
}
