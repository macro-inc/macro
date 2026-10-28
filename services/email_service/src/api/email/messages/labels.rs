use crate::api::context::{ApiContext, AuthorizationService};
use crate::api::email::messages::BATCH_UPDATE_MESSAGE_LIMIT;
use crate::pubsub::publish_email_event;
use anyhow::Context;
use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use email::domain::events::{EmailEventOrigin, EmailMacroEvent, LabelRef};
use email::domain::ports::EmailMessageEnqueuer;
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use model::response::ErrorResponse;
use models_email::service;
use sqlx::types::Uuid;
use utoipa::ToSchema;

#[cfg(test)]
mod test;

#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema)]
pub struct UpdateLabelBatchRequest {
    pub message_ids: Vec<Uuid>,
    pub label_id: Uuid,
    pub value: bool,
}

// Response body for updating a flag for a batch of messages.
#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema)]
pub struct UpdateLabelBatchResponse {
    pub successful_ids: Vec<Uuid>,
    pub failed_ids: Vec<Uuid>,
    pub missing_ids: Vec<Uuid>,
}

/// Add or remove a label from a batch of messages
#[utoipa::path(
    patch,
    tag = "Messages",
    path = "/email/messages/labels",
    operation_id = "add_remove_label",
    request_body = UpdateLabelBatchRequest,
    responses(
            (status = 200, body=UpdateLabelBatchResponse),
            (status = 400, body=ErrorResponse),
            (status = 401, body=ErrorResponse),
            (status = 404, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, authorization, body), fields(user_id=authorization.authorization.user.user_context.user_id, fusionauth_user_id=authorization.authorization.user.user_context.fusion_user_id))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    authorization: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    Json(body): Json<UpdateLabelBatchRequest>,
) -> Result<Response, Response> {
    if body.message_ids.is_empty() || body.message_ids.len() > BATCH_UPDATE_MESSAGE_LIMIT {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                message: format!(
                    "Must include between 1 and {BATCH_UPDATE_MESSAGE_LIMIT} message IDs in request"
                )
                .into(),
            }),
        )
            .into_response());
    }

    // Resolve the inbox from the batch's messages (scoped to the caller's own and
    // delegated inboxes); a single label op targets messages in one inbox.
    let link = email_db_client::links::get::fetch_owned_link_for_message(
        &ctx.db,
        &authorization.authorization.user.user_context.user_id,
        body.message_ids[0],
    )
    .await
    .map_err(|e| {
        tracing::error!(error=?e, "unable to resolve inbox for messages");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                message: "unable to resolve inbox for messages".into(),
            }),
        )
            .into_response()
    })?
    .ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                message: "message not found".into(),
            }),
        )
            .into_response()
    })?;

    let label = email_db_client::labels::get::fetch_label_by_id(&ctx.db, body.label_id, link.id)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "unable to fetch label from db");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "unable to fetch label from db".into(),
                }),
            )
                .into_response()
        })?;

    let label = match label {
        Some(label) => label,
        None => {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    message: "label not found".into(),
                }),
            )
                .into_response());
        }
    };

    let db_messages = email_db_client::messages::get_simple_messages::get_simple_messages_batch(
        &ctx.db,
        &body.message_ids,
        &authorization.authorization.user.user_context.fusion_user_id,
    )
    .await
    .map_err(|e| {
        tracing::error!(error=?e, "unable to fetch messages from db");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                message: "unable to fetch messages from db".into(),
            }),
        )
            .into_response()
    })?;

    let missing_ids: Vec<Uuid> = body
        .message_ids
        .iter()
        .filter(|&id| !db_messages.iter().any(|msg| msg.db_id == *id))
        .cloned()
        .collect();

    if !missing_ids.is_empty() {
        tracing::warn!(message_ids=?missing_ids, "unable to find messages in db");
    }

    let message_db_ids: Vec<Uuid> = db_messages.iter().map(|m| m.db_id).collect();
    let mut thread_ids: Vec<Uuid> = db_messages.iter().map(|m| m.thread_db_id).collect();
    thread_ids.sort_unstable();
    thread_ids.dedup();
    let pending_write_id = macro_uuid::generate_uuid_v7();
    let provider_label_id = label.provider_label_id.clone();
    let is_adding = body.value;

    // Optimistic DB update: update the database first, then sync to Gmail in the background
    let mut tx = ctx.db.begin().await.map_err(|e| {
        tracing::error!(error=?e, "unable to begin transaction");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                message: "unable to begin transaction".into(),
            }),
        )
            .into_response()
    })?;

    // The changed messages Gmail knows about; drafts have no provider_id.
    let transaction_result: anyhow::Result<Vec<(Uuid, String)>> = async {
        if message_db_ids.is_empty() {
            return Ok(Vec::new());
        }
        email_db_client::labels::pending_writes::lock_thread_label_writes(&mut tx, &thread_ids)
            .await
            .context("Failed to lock the messages' threads")?;
        let changed_ids = email_db_client::labels::get::messages_changing_label(
            &mut *tx,
            link.id,
            &message_db_ids,
            &provider_label_id,
            is_adding,
        )
        .await
        .context("Failed to read which messages change")?;
        let provider_messages: Vec<(Uuid, String)> = db_messages
            .iter()
            .filter(|msg| changed_ids.contains(&msg.db_id))
            .filter_map(|msg| {
                msg.provider_id
                    .as_ref()
                    .filter(|pid| !pid.is_empty())
                    .map(|pid| (msg.db_id, pid.clone()))
            })
            .collect();
        let provider_message_ids: Vec<Uuid> = provider_messages.iter().map(|(id, _)| *id).collect();
        email_db_client::labels::pending_writes::mark_pending_label_writes(
            &mut *tx,
            link.id,
            &provider_message_ids,
            &provider_label_id,
            is_adding,
            pending_write_id,
        )
        .await
        .context("Failed to mark pending label writes")?;

        if is_adding {
            email_db_client::labels::insert::insert_message_labels_batch(
                &mut *tx,
                &message_db_ids,
                &provider_label_id,
                link.id,
            )
            .await
            .context("Failed to add label to messages in database")?;
        } else {
            email_db_client::labels::delete::delete_message_labels_batch(
                &mut *tx,
                &message_db_ids,
                &provider_label_id,
                link.id,
            )
            .await
            .context("Failed to remove label from messages in database")?;
        }

        if provider_label_id.as_str() == service::label::system_labels::UNREAD {
            email_db_client::messages::update::update_message_read_status_batch(
                &mut *tx,
                message_db_ids.clone(),
                link.id,
                !is_adding,
            )
            .await
            .context("Failed to update message read status")?;
        } else if provider_label_id.as_str() == service::label::system_labels::STARRED {
            email_db_client::messages::update::update_message_starred_status_batch(
                &mut *tx,
                message_db_ids.clone(),
                link.id,
                is_adding,
            )
            .await
            .context("Failed to update message starred status")?;
        }

        for thread_id in &thread_ids {
            email_db_client::threads::update::update_thread_metadata(&mut tx, *thread_id, link.id)
                .await
                .context("Failed to update thread state")?;
        }

        Ok(provider_messages)
    }
    .await;

    let provider_messages = match transaction_result {
        Ok(provider_messages) => {
            tx.commit().await.map_err(|e| {
                tracing::error!(error=?e, "unable to commit transaction");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        message: "unable to commit transaction".into(),
                    }),
                )
                    .into_response()
            })?;
            provider_messages
        }
        Err(e) => {
            tracing::error!(error=?e, "Transaction failed, rolling back");
            if let Err(rollback_err) = tx.rollback().await {
                tracing::error!(error=?rollback_err, "Failed to rollback transaction");
            }
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "unable to update labels in database".into(),
                }),
            )
                .into_response());
        }
    };

    // Publish semantic macro.email events, rolled up to one per affected
    // thread (the batch may span several threads in the same inbox).
    let actor = Some(link.macro_id.clone());
    for thread_id in &thread_ids {
        let event = EmailMacroEvent::thread_label_change(
            link.id,
            link.macro_id.clone(),
            actor.clone(),
            *thread_id,
            LabelRef {
                label_id: label.id,
                provider_label_id: provider_label_id.clone(),
                name: label.name.clone(),
            },
            is_adding,
            EmailEventOrigin::UserAction,
        );
        if let Some(event) = event {
            publish_email_event(ctx.macro_event_broker.as_ref(), &event);
        }
    }

    // One label write for the whole batch
    let (labels_to_add, labels_to_remove) = if is_adding {
        (vec![provider_label_id.clone()], Vec::new())
    } else {
        (Vec::new(), vec![provider_label_id.clone()])
    };
    let provider_message_ids: Vec<Uuid> = provider_messages.iter().map(|(id, _)| *id).collect();

    let mut failed_ids = Vec::new();
    if !provider_messages.is_empty()
        && ctx
            .sqs_client
            .enqueue_gmail_ops_modify_labels_batch(
                link.id,
                provider_messages,
                labels_to_add,
                labels_to_remove,
                pending_write_id,
            )
            .await
            .inspect_err(|e| {
                tracing::error!(error=?e, "Failed to enqueue gmail ops label write");
            })
            .is_err()
    {
        // Gmail never learns about this change.
        failed_ids = undo_unsent_write(
            &ctx.db,
            link.id,
            &thread_ids,
            &provider_message_ids,
            pending_write_id,
        )
        .await?;
    }

    Ok((
        StatusCode::OK,
        Json(UpdateLabelBatchResponse {
            successful_ids: message_db_ids
                .into_iter()
                .filter(|id| !failed_ids.contains(id))
                .collect(),
            failed_ids,
            missing_ids,
        }),
    )
        .into_response())
}

/// Undoes a write that could not be queued and returns the messages put back,
/// which the response lists as failed. If that fails too, the change stays in
/// the database without ever reaching Gmail, so the request fails rather than
/// reporting success.
async fn undo_unsent_write(
    db: &sqlx::PgPool,
    link_id: Uuid,
    thread_ids: &[Uuid],
    message_ids: &[Uuid],
    write_id: Uuid,
) -> Result<Vec<Uuid>, Response> {
    revert_unsent_write(db, link_id, thread_ids, message_ids, write_id)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "Failed to revert label write after enqueue failure");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "unable to queue the label change".into(),
                }),
            )
                .into_response()
        })
}

/// Puts the labels of a write Gmail will never receive back in the state
/// Gmail will end up with, and derives the threads' state again, holding the
/// threads' label-write lock. Returns the messages put back.
async fn revert_unsent_write(
    db: &sqlx::PgPool,
    link_id: Uuid,
    thread_ids: &[Uuid],
    message_ids: &[Uuid],
    write_id: Uuid,
) -> anyhow::Result<Vec<Uuid>> {
    let mut tx = db.begin().await?;
    email_db_client::labels::pending_writes::lock_thread_label_writes(&mut tx, thread_ids).await?;
    let restored = email_db_client::labels::pending_writes::abandon_pending_label_writes(
        &mut tx,
        link_id,
        message_ids,
        write_id,
    )
    .await?;
    for thread_id in thread_ids {
        email_db_client::threads::update::update_thread_metadata(&mut tx, *thread_id, link_id)
            .await?;
    }
    tx.commit().await?;
    Ok(restored)
}
