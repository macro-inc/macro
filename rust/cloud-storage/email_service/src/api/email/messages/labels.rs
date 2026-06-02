use crate::api::context::ApiContext;
use crate::api::email::messages::BATCH_UPDATE_MESSAGE_LIMIT;
use anyhow::Context;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::{Extension, Json};
use model::response::ErrorResponse;
use model::user::UserContext;
use models_email::service;
use sqlx::types::Uuid;
use utoipa::ToSchema;

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
#[tracing::instrument(skip(ctx, user_context, body), fields(user_id=user_context.user_id, fusionauth_user_id=user_context.fusion_user_id))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
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

    // Resolve the inbox from the batch's messages (scoped to the caller's own
    // inboxes); a single label op targets messages in one inbox.
    let link = email_db_client::links::get::fetch_owned_link_for_message(
        &ctx.db,
        &user_context.fusion_user_id,
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
        &user_context.fusion_user_id,
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

    let transaction_result = async {
        if !message_db_ids.is_empty() {
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
                    &user_context.fusion_user_id,
                    !is_adding,
                )
                .await
                .context("Failed to update message read status")?;
            } else if provider_label_id.as_str() == service::label::system_labels::STARRED {
                email_db_client::messages::update::update_message_starred_status_batch(
                    &mut *tx,
                    message_db_ids.clone(),
                    &user_context.fusion_user_id,
                    is_adding,
                )
                .await
                .context("Failed to update message starred status")?;
            }
        }

        anyhow::Ok(())
    }
    .await;

    match transaction_result {
        Ok(_) => {
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
    }

    // Enqueue gmail ops messages in batch (drafts have no provider_id, skip them)
    let (labels_to_add, labels_to_remove) = if is_adding {
        (vec![provider_label_id.clone()], Vec::new())
    } else {
        (Vec::new(), vec![provider_label_id.clone()])
    };

    let gmail_ops_messages: Vec<_> = db_messages
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
            tracing::error!(error=?e, "Failed to enqueue gmail ops notifications batch");
        })
        .ok();

    Ok((
        StatusCode::OK,
        Json(UpdateLabelBatchResponse {
            successful_ids: message_db_ids,
            failed_ids: vec![],
            missing_ids,
        }),
    )
        .into_response())
}
