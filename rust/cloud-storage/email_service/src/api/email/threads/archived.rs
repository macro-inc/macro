use crate::api::context::ApiContext;
use anyhow::Context;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::{Extension, Json};
use email_db_client::threads::update::update_inbox_visible_status;
use model::response::{EmptyResponse, ErrorResponse};
use model::user::UserContext;
use models_email::service::label::system_labels;
use models_email::service::message::Message;
use sqlx::types::Uuid;
use strum_macros::AsRefStr;
use thiserror::Error;
use utoipa::ToSchema;

#[derive(Debug, Error, AsRefStr)]
pub enum ArchiveThreadError {
    #[error("Thread not found")]
    ThreadNotFound,

    #[error("Database error")]
    DatabaseError(#[from] anyhow::Error),

    #[error("Transaction error")]
    TransactionError(#[from] sqlx::Error),
}

impl IntoResponse for ArchiveThreadError {
    fn into_response(self) -> Response {
        let status_code = match &self {
            ArchiveThreadError::ThreadNotFound => StatusCode::NOT_FOUND,
            ArchiveThreadError::DatabaseError(_) | ArchiveThreadError::TransactionError(_) => {
                StatusCode::INTERNAL_SERVER_ERROR
            }
        };

        if status_code.is_server_error() {
            tracing::error!(
                nested_error = ?self,
                error_type = "ArchiveThreadError",
                variant = self.as_ref(),
                "Internal server error");
        }

        (status_code, self.to_string()).into_response()
    }
}

#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema)]
pub struct ArchiveThreadRequest {
    pub value: bool,
}

/// Change the archived status of a thread.
#[utoipa::path(
    patch,
    tag = "Threads",
    path = "/email/threads/{id}/archived",
    operation_id = "archive_thread",
    request_body = ArchiveThreadRequest,
    responses(
            (status = 200, body=EmptyResponse),
            (status = 401, body=ErrorResponse),
            (status = 404, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, user_context, body), fields(user_id=user_context.user_id, fusionauth_user_id=user_context.fusion_user_id), err)]
pub async fn archived_handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    Path(thread_id): Path<Uuid>,
    Json(body): Json<ArchiveThreadRequest>,
) -> Result<Response, ArchiveThreadError> {
    let is_archiving = body.value;

    // Resolve the inbox from the thread itself, scoped to the caller's own and
    // delegated inboxes.
    let link = email_db_client::links::get::fetch_owned_link_for_thread(
        &ctx.db,
        &user_context.user_id,
        thread_id,
    )
    .await?
    .ok_or(ArchiveThreadError::ThreadNotFound)?;

    let thread =
        email_db_client::threads::get::get_thread_by_id_and_link_id(&ctx.db, thread_id, link.id)
            .await?
            .ok_or(ArchiveThreadError::ThreadNotFound)?;

    let update_visibility = thread.inbox_visible == is_archiving;

    // get messages with label info
    let messages =
        email_db_client::messages::get::fetch_messages_with_labels(&ctx.db, thread_id, link.id)
            .await?;

    let mut message_db_ids = Vec::new();

    // if we are archiving the thread, any messages with the INBOX label are affected. and vice versa
    let has_inbox_label = |m: &Message| {
        m.labels
            .iter()
            .any(|l| l.provider_label_id == system_labels::INBOX)
    };

    // Collect affected messages
    let affected_messages: Vec<&Message> = messages
        .iter()
        .filter(|m| has_inbox_label(m) == is_archiving)
        .collect();

    for m in &affected_messages {
        message_db_ids.push(m.db_id);
    }

    // Early return if no messages need to be updated
    if message_db_ids.is_empty() && !update_visibility {
        tracing::debug!("No messages need label changes for thread {}", thread_id);
        return Ok((StatusCode::OK, Json(EmptyResponse::default())).into_response());
    }

    let mut tx = ctx.db.begin().await?;

    // attempt to update in database
    let transaction_result = async {
        if update_visibility {
            update_inbox_visible_status(&mut tx, thread_id, link.id, !is_archiving)
                .await
                .context("Failed to update thread inbox_visible status")?;
        }

        if !message_db_ids.is_empty() {
            if is_archiving {
                email_db_client::labels::delete::delete_message_labels_batch(
                    &mut *tx,
                    &message_db_ids,
                    system_labels::INBOX,
                    link.id,
                )
                .await
                .context("Failed to remove 'INBOX' label from messages")?;
            } else {
                email_db_client::labels::insert::insert_message_labels_batch(
                    &mut *tx,
                    &message_db_ids,
                    system_labels::INBOX,
                    link.id,
                )
                .await
                .context("Failed to add 'INBOX' label to messages")?;
            }
        }

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
                tracing::error!(error = ?rollback_err, "Failed to rollback transaction!");
            }
            return Err(ArchiveThreadError::DatabaseError(e));
        }
    }

    // Enqueue one gmail_ops message per provider message
    let (labels_to_add, labels_to_remove) = if is_archiving {
        (Vec::new(), vec![system_labels::INBOX.to_string()])
    } else {
        (vec![system_labels::INBOX.to_string()], Vec::new())
    };

    let gmail_ops_messages: Vec<_> = affected_messages
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
                                    labels_to_add: labels_to_add.clone(),
                                    labels_to_remove: labels_to_remove.clone(),
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
            tracing::error!(error=?e, "Failed to enqueue gmail ops notifications batch for archived");
        })
        .ok();

    Ok((StatusCode::OK, Json(EmptyResponse::default())).into_response())
}
