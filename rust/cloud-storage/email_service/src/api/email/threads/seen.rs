use crate::api::context::ApiContext;
use anyhow::Context;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::{Extension, Json};
use model::response::{EmptyResponse, ErrorResponse};
use model::user::UserContext;
use models_email::service::label::system_labels;
use models_email::service::link::Link;
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
#[tracing::instrument(skip(ctx, user_context, gmail_token))]
pub async fn seen_handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    link: Extension<Link>,
    gmail_token: Extension<String>,
    Path(PathParams { id: thread_id }): Path<PathParams>,
) -> Result<Response, SeenThreadError> {
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

    let message_db_ids: Vec<Uuid> = unread_messages.iter().map(|m| m.db_id.unwrap()).collect();
    let message_provider_ids: Vec<String> = unread_messages
        .iter()
        .map(|m| m.provider_id.clone().unwrap_or_default())
        .collect();

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

    // async send requests to gmail. if they fail, revert db changes.
    let db_clone = ctx.db.clone();
    let gmail_client_clone = ctx.gmail_client.clone();
    let gmail_access_token = gmail_token.as_str().to_string();
    let thread_id_clone = thread_id;
    let link_id_clone = link.id;
    let message_db_ids_clone = message_db_ids.clone();
    let fusion_user_id = user_context.fusion_user_id.clone();

    tokio::spawn(async move {
        let message_tuples = message_db_ids_clone
            .iter()
            .zip(message_provider_ids)
            .map(|(id, provider_id)| (*id, provider_id))
            .collect();

        let labels_to_add = Vec::new();
        let labels_to_remove = vec![system_labels::UNREAD.to_string()];

        let (success_ids, failed_ids) = gmail_client_clone
            .batch_modify_labels(
                &gmail_access_token,
                message_tuples,
                labels_to_add,
                labels_to_remove,
            )
            .await;

        if !failed_ids.is_empty() {
            tracing::error!(
                failed_ids = ?failed_ids,
                success_ids = ?success_ids,
                "Gmail API failed to modify labels for some messages, reverting database changes"
            );

            let mut revert_tx = match db_clone.begin().await {
                Ok(tx) => tx,
                Err(e) => {
                    tracing::error!(error = ?e, "Failed to begin transaction for reversion");
                    return;
                }
            };

            // revert the changes we made in the previous transaction
            let revert_result = async {
                // Revert thread read status to unread
                email_db_client::threads::update::update_thread_read_status(
                    &mut *revert_tx,
                    thread_id_clone,
                    link_id_clone,
                    false,
                )
                .await
                .context("Failed to revert thread read status")?;

                // Revert messages read status to unread
                email_db_client::messages::update::update_message_read_status_batch(
                    &mut *revert_tx,
                    message_db_ids_clone.clone(),
                    &fusion_user_id,
                    false,
                )
                .await
                .context("Failed to revert message read status")?;

                // Revert: Add UNREAD label back to messages
                email_db_client::labels::insert::insert_message_labels_batch(
                    &mut *revert_tx,
                    &message_db_ids_clone,
                    system_labels::UNREAD,
                    link_id_clone,
                )
                .await
                .context("Failed to revert adding 'UNREAD' label to messages")?;

                anyhow::Ok(())
            }
            .await;

            match revert_result {
                Ok(_) => {
                    if let Err(e) = revert_tx.commit().await {
                        tracing::error!(error = ?e, "Unable to commit transaction for revert");
                    } else {
                        tracing::info!(
                            "Successfully reverted database changes after Gmail API failure"
                        );
                    }
                }
                Err(e) => {
                    tracing::error!(error = ?e, "Revert failed for thread {}, rolling back", thread_id_clone);
                    if let Err(rollback_err) = revert_tx.rollback().await {
                        tracing::error!(error = ?rollback_err, "Failed to rollback revert transaction");
                    }
                }
            }
        }
    });

    Ok((StatusCode::OK, Json(EmptyResponse::default())).into_response())
}
