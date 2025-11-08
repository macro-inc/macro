use crate::api::context::ApiContext;
use anyhow::Context;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::{Extension, Json};
use email_db_client::threads::update::update_inbox_visible_status;
use model::response::{EmptyResponse, ErrorResponse};
use model::user::UserContext;
use models_email::email::service::link::Link;
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
#[tracing::instrument(skip(ctx, user_context, link, gmail_token, body), fields(user_id=user_context.user_id, fusionauth_user_id=user_context.fusion_user_id))]
pub async fn archived_handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    link: Extension<Link>,
    gmail_token: Extension<String>,
    Path(thread_id): Path<Uuid>,
    Json(body): Json<ArchiveThreadRequest>,
) -> Result<Response, ArchiveThreadError> {
    let gmail_access_token = gmail_token.as_str();
    let is_archiving = body.value;

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
    let mut message_provider_ids = Vec::new();

    // if we are archiving the thread, any messages with the INBOX label are affected. and vice versa
    let has_inbox_label = |m: &Message| {
        m.labels
            .iter()
            .any(|l| l.provider_label_id == system_labels::INBOX)
    };

    for m in messages.iter() {
        if has_inbox_label(m) == is_archiving {
            message_db_ids.push(m.db_id.unwrap());
            // should always exist
            message_provider_ids.push(m.provider_id.clone().unwrap_or_default());
        }
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

    // async send requests to gmail async. if they fail, revert db changes we made earlier. we make
    // the calls async at Teo's request because they are slow and doing it sync causes this endpoint
    // to take >300ms

    let db_clone = ctx.db.clone();
    let gmail_client_clone = ctx.gmail_client.clone();
    let gmail_access_token_clone = gmail_access_token.to_string();
    let thread_id_clone = thread_id;
    let link_id_clone = link.id;
    let message_db_ids_clone = message_db_ids.clone();

    let (labels_to_add, labels_to_remove) = if is_archiving {
        (Vec::new(), vec![system_labels::INBOX.to_string()])
    } else {
        (vec![system_labels::INBOX.to_string()], Vec::new())
    };

    let message_tuples = message_db_ids
        .into_iter()
        .zip(message_provider_ids)
        .collect();

    tokio::spawn(async move {
        let (success_ids, failed_ids) = gmail_client_clone
            .batch_modify_labels(
                &gmail_access_token_clone,
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
                update_inbox_visible_status(
                    &mut revert_tx,
                    thread_id_clone,
                    link_id_clone,
                    is_archiving,
                )
                .await
                .context("Failed to revert thread inbox_visible status")?;

                if !is_archiving {
                    email_db_client::labels::delete::delete_message_labels_batch(
                        &mut *revert_tx,
                        &message_db_ids_clone,
                        system_labels::INBOX,
                        link_id_clone,
                    )
                    .await
                    .context("Failed to revert removing 'INBOX' label from messages")?;
                } else {
                    email_db_client::labels::insert::insert_message_labels_batch(
                        &mut *revert_tx,
                        &message_db_ids_clone,
                        system_labels::INBOX,
                        link_id_clone,
                    )
                    .await
                    .context("Failed to revert adding 'INBOX' label to messages")?;
                }

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
                        tracing::error!(error = ?rollback_err, "Failed to rollback revert transaction!");
                    }
                }
            }
        }
    });

    Ok((StatusCode::OK, Json(EmptyResponse::default())).into_response())
}
