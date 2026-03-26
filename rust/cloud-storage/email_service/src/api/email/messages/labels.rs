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
use models_email::service::link::Link;
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
#[tracing::instrument(skip(ctx, user_context, gmail_token, body), fields(user_id=user_context.user_id, fusionauth_user_id=user_context.fusion_user_id))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    gmail_token: Extension<String>,
    link: Extension<Link>,
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

    // Build provider message tuples for Gmail API calls (drafts have no provider_id)
    let provider_message_tuples: Vec<(Uuid, String)> = db_messages
        .iter()
        .filter_map(|m| {
            m.provider_id
                .as_ref()
                .filter(|pid| !pid.is_empty())
                .map(|pid| (m.db_id, pid.clone()))
        })
        .collect();

    // Sync to Gmail in the background. If Gmail fails, revert the DB changes for failed messages.
    if !provider_message_tuples.is_empty() {
        let db_clone = ctx.db.clone();
        let gmail_client_clone = ctx.gmail_client.clone();
        let gmail_access_token = gmail_token.as_str().to_string();
        let provider_label_id_clone = provider_label_id.clone();
        let link_id = link.id;
        let fusion_user_id = user_context.fusion_user_id.clone();

        let (labels_to_add, labels_to_remove) = if is_adding {
            (vec![provider_label_id.clone()], Vec::new())
        } else {
            (Vec::new(), vec![provider_label_id.clone()])
        };

        tokio::spawn(async move {
            let (_success_ids, failed_ids) = gmail_client_clone
                .batch_modify_labels(
                    &gmail_access_token,
                    provider_message_tuples,
                    labels_to_add,
                    labels_to_remove,
                )
                .await;

            if failed_ids.is_empty() {
                return;
            }

            tracing::error!(
                failed_ids = ?failed_ids,
                "Gmail API failed to modify labels for some messages, reverting database changes"
            );

            let mut revert_tx = match db_clone.begin().await {
                Ok(tx) => tx,
                Err(e) => {
                    tracing::error!(error=?e, "Failed to begin transaction for reversion");
                    return;
                }
            };

            let revert_result = async {
                // Revert label changes for failed messages
                if is_adding {
                    email_db_client::labels::delete::delete_message_labels_batch(
                        &mut *revert_tx,
                        &failed_ids,
                        &provider_label_id_clone,
                        link_id,
                    )
                    .await
                    .context("Failed to revert adding labels")?;
                } else {
                    email_db_client::labels::insert::insert_message_labels_batch(
                        &mut *revert_tx,
                        &failed_ids,
                        &provider_label_id_clone,
                        link_id,
                    )
                    .await
                    .context("Failed to revert removing labels")?;
                }

                // Revert special flag changes for failed messages
                if provider_label_id_clone.as_str() == service::label::system_labels::UNREAD {
                    email_db_client::messages::update::update_message_read_status_batch(
                        &mut *revert_tx,
                        failed_ids.clone(),
                        &fusion_user_id,
                        is_adding, // revert: if we set read=true (!is_adding), set it back to false (is_adding)
                    )
                    .await
                    .context("Failed to revert message read status")?;
                } else if provider_label_id_clone.as_str() == service::label::system_labels::STARRED
                {
                    email_db_client::messages::update::update_message_starred_status_batch(
                        &mut *revert_tx,
                        failed_ids.clone(),
                        &fusion_user_id,
                        !is_adding, // revert: opposite of what we set
                    )
                    .await
                    .context("Failed to revert message starred status")?;
                }

                anyhow::Ok(())
            }
            .await;

            match revert_result {
                Ok(_) => {
                    if let Err(e) = revert_tx.commit().await {
                        tracing::error!(error=?e, "Unable to commit transaction for revert");
                    } else {
                        tracing::info!(
                            "Successfully reverted database changes after Gmail API failure"
                        );
                    }
                }
                Err(e) => {
                    tracing::error!(error=?e, "Revert failed, rolling back");
                    if let Err(rollback_err) = revert_tx.rollback().await {
                        tracing::error!(error=?rollback_err, "Failed to rollback revert transaction");
                    }
                }
            }
        });
    }

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
