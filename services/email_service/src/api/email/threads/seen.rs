use crate::api::context::ApiContext;
use anyhow::Context;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::{Extension, Json};
use model::response::{EmptyResponse, ErrorResponse};
use model::user::UserContext;
use models_email::service::label::system_labels;
use models_email::service::message::Message;
use sqlx::types::Uuid;
use strum_macros::AsRefStr;
use thiserror::Error;

#[derive(Debug, Error, AsRefStr)]
pub enum SeenThreadError {
    #[error("Thread not found")]
    ThreadNotFound,

    #[error("Database query error")]
    QueryError(#[from] anyhow::Error),

    #[error("Transaction error")]
    TransactionError(#[from] sqlx::Error),
}

impl IntoResponse for SeenThreadError {
    fn into_response(self) -> Response {
        let status_code = match &self {
            SeenThreadError::ThreadNotFound => StatusCode::NOT_FOUND,
            SeenThreadError::QueryError(_) | SeenThreadError::TransactionError(_) => {
                StatusCode::INTERNAL_SERVER_ERROR
            }
        };

        if status_code.is_server_error() {
            tracing::error!(
                nested_error = ?self,
                error_type = "SeenThreadError",
                variant = self.as_ref(),
                "Internal server error");
        }

        (status_code, self.to_string()).into_response()
    }
}

#[derive(serde::Serialize, serde::Deserialize, Debug)]
pub struct PathParams {
    pub id: Uuid,
}

/// Called by FE when the user has seen a thread.
#[utoipa::path(
    post,
    tag = "Threads",
    path = "/email/threads/{id}/seen",
    operation_id = "thread_seen",
    params(
        ("id" = Uuid, Path, description = "Thread ID."),
    ),
    responses(
            (status = 200, body=EmptyResponse),
            (status = 401, body=ErrorResponse),
            (status = 404, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, user_context), err)]
pub async fn seen_handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    Path(PathParams { id: thread_id }): Path<PathParams>,
) -> Result<Response, SeenThreadError> {
    // Resolve the inbox from the thread itself, scoped to the caller's own and
    // delegated inboxes.
    let link = email_db_client::links::get::fetch_owned_link_for_thread(
        &ctx.db,
        &user_context.user_id,
        thread_id,
    )
    .await
    .context("Failed to resolve inbox for thread")?
    .ok_or(SeenThreadError::ThreadNotFound)?;

    // update viewed_at value in user_history table for thread
    email_db_client::user_history::upsert_user_history(&ctx.db, link.id, thread_id)
        .await
        .context("Failed to upsert user history")?;

    let messages =
        email_db_client::messages::get::fetch_messages_with_labels(&ctx.db, thread_id, link.id)
            .await?;

    if messages.is_empty() {
        return Err(SeenThreadError::ThreadNotFound);
    }

    // Filter for messages that have the UNREAD label
    let unread_messages: Vec<&Message> = messages
        .iter()
        .filter(|m| {
            m.labels
                .iter()
                .any(|l| l.provider_label_id == system_labels::UNREAD)
        })
        .collect();

    if unread_messages.is_empty() {
        // Nothing to mark as read
        return Ok((StatusCode::OK, Json(EmptyResponse::default())).into_response());
    }

    let message_db_ids: Vec<Uuid> = unread_messages.iter().map(|m| m.db_id).collect();

    let mut tx = ctx.db.begin().await?;

    let transaction_result = async {
        // Update thread read status
        email_db_client::threads::update::update_thread_read_status(
            &mut *tx, thread_id, link.id, true,
        )
        .await
        .context("Failed to update thread read status")?;

        // Update messages read status
        email_db_client::messages::update::update_message_read_status_batch(
            &mut *tx,
            message_db_ids.clone(),
            &user_context.fusion_user_id,
            true,
        )
        .await
        .context("Failed to update message read status")?;

        // Remove UNREAD label from messages in DB
        email_db_client::labels::delete::delete_message_labels_batch(
            &mut *tx,
            &message_db_ids,
            system_labels::UNREAD,
            link.id,
        )
        .await
        .context("Failed to remove 'UNREAD' label from messages")?;

        anyhow::Ok(())
    }
    .await;

    match transaction_result {
        Ok(_) => {
            tx.commit().await?;
        }
        Err(e) => {
            tracing::error!(error = ?e, "Transaction failed for thread {}, rolling back.", thread_id);
            if let Err(rollback_err) = tx.rollback().await {
                tracing::error!(error = ?rollback_err, "Failed to rollback transaction");
            }
            return Err(SeenThreadError::QueryError(e));
        }
    }

    // Enqueue gmail ops messages in batch
    let gmail_ops_messages: Vec<_> = unread_messages
        .iter()
        .filter_map(|msg| {
            msg.provider_id
                .as_ref()
                .filter(|pid| !pid.is_empty())
                .map(
                    |pid| models_email::gmail::gmail_ops::GmailOpsPubsubMessage {
                        link_id: link.id,
                        operation:
                            models_email::gmail::gmail_ops::GmailOpsOperation::ModifyMessageLabels(
                                models_email::gmail::gmail_ops::ModifyMessageLabelsPayload {
                                    db_message_id: msg.db_id,
                                    provider_message_id: pid.clone(),
                                    labels_to_add: Vec::new(),
                                    labels_to_remove: vec![system_labels::UNREAD.to_string()],
                                },
                            ),
                    },
                )
        })
        .collect();

    ctx.sqs_client
        .enqueue_gmail_ops_notifications_batch(gmail_ops_messages)
        .await
        .inspect_err(|e| {
            tracing::error!(error=?e, "Failed to enqueue gmail ops notifications batch for seen");
        })
        .ok();

    Ok((StatusCode::OK, Json(EmptyResponse::default())).into_response())
}
