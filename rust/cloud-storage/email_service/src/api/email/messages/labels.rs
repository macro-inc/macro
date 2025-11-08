use crate::api::context::ApiContext;
use crate::api::email::messages::BATCH_UPDATE_MESSAGE_LIMIT;
use anyhow::anyhow;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::{Extension, Json};
use futures::{StreamExt, stream};
use gmail_client::GmailClient;
use model::response::ErrorResponse;
use model::user::UserContext;
use models_email::email::service::message::SimpleMessage;
use models_email::service;
use models_email::service::link::Link;
use sqlx::PgPool;
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
                .as_str(),
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
                    message: "unable to fetch label from db",
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
                    message: "label not found",
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
                message: "unable to fetch messages from db",
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

    let gmail_access_token = gmail_token.as_str();

    let (successful_ids, failed_ids) = if body.value {
        add_label_to_messages(
            &ctx.db,
            gmail_access_token,
            &ctx.gmail_client,
            db_messages,
            label.provider_label_id.as_str(),
        )
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "unable to add label to messages");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "unable to add label to messages",
                }),
            )
                .into_response()
        })?
    } else {
        remove_label_from_messages(
            &ctx.db,
            gmail_access_token,
            &ctx.gmail_client,
            db_messages,
            label.provider_label_id.as_str(),
        )
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "unable to remove label from messages");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "unable to remove label from messages",
                }),
            )
                .into_response()
        })?
    };

    // need to update flags on message object for certain labels
    if label.provider_label_id.as_str() == service::label::system_labels::UNREAD {
        email_db_client::messages::update::update_message_read_status_batch(
            &ctx.db,
            successful_ids.clone(),
            &user_context.fusion_user_id,
            !body.value,
        )
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "unable to update message read status");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "unable to update message read status",
                }),
            )
                .into_response()
        })?;
    } else if label.provider_label_id.as_str() == service::label::system_labels::STARRED {
        email_db_client::messages::update::update_message_starred_status_batch(
            &ctx.db,
            successful_ids.clone(),
            &user_context.fusion_user_id,
            body.value,
        )
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "unable to update message starred status");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "unable to update message starred status",
                }),
            )
                .into_response()
        })?;
    }

    Ok((
        StatusCode::OK,
        Json(UpdateLabelBatchResponse {
            successful_ids,
            failed_ids,
            missing_ids,
        }),
    )
        .into_response())
}

// add a given label to a batch of messages in gmail and db
pub async fn add_label_to_messages(
    db: &PgPool,
    gmail_access_token: &str,
    gmail_client: &GmailClient,
    messages: Vec<SimpleMessage>,
    provider_label_id: &str,
) -> anyhow::Result<(Vec<Uuid>, Vec<Uuid>)> {
    if messages.is_empty() {
        return Ok((vec![], vec![]));
    }

    if provider_label_id.is_empty() {
        return Err(anyhow!("Provider label ID cannot be empty"));
    }

    // First clone for the Gmail API operations
    let api_provider_label_id = provider_label_id.to_string();

    // Second clone for the database operations
    let db_provider_label_id = provider_label_id.to_string();

    // Use into_iter() on a clone of messages to avoid lifetime issues
    let label_tasks = messages.clone().into_iter().map(move |message| {
        let gmail_client = gmail_client.clone();
        let gmail_access_token = gmail_access_token.to_string();
        let provider_label_id = api_provider_label_id.clone();

        async move {
            let labels_to_add = vec![provider_label_id.clone()];
            let labels_to_remove = vec![];

            // First update in Gmail
            let gmail_result = gmail_client
                .modify_message_labels(
                    &gmail_access_token,
                    &message.provider_id.clone().unwrap_or_default(),
                    &labels_to_add,
                    &labels_to_remove,
                )
                .await;

            if let Err(e) = gmail_result {
                tracing::error!(
                    error = ?e,
                    message_id = %message.db_id,
                    provider_id = %message.provider_id.unwrap_or_default(),
                    "Failed to modify labels in Gmail"
                );
                return (message.db_id, Err(e));
            }

            (message.db_id, Ok(()))
        }
    });

    // Process tasks with limited concurrency
    const MAX_CONCURRENT: usize = 10;
    let results = stream::iter(label_tasks)
        .buffer_unordered(MAX_CONCURRENT)
        .collect::<Vec<_>>()
        .await;

    // Separate successful and failed messages
    let mut successful_msg_ids = Vec::new();
    let mut failed_msg_ids = Vec::new();

    for (msg_id, result) in results {
        match result {
            Ok(_) => successful_msg_ids.push(msg_id),
            Err(_) => failed_msg_ids.push(msg_id),
        }
    }

    // If there are any successful messages, update the database in bulk
    if !successful_msg_ids.is_empty() {
        let link_id = messages.first().map(|m| m.link_id).unwrap_or_default();

        // Use bulk insert function to add labels in database
        match email_db_client::labels::insert::insert_message_labels_batch(
            db,
            &successful_msg_ids,
            &db_provider_label_id,
            link_id,
        )
        .await
        {
            Ok(_) => {}
            Err(e) => {
                tracing::error!(
                    error = ?e,
                    message_ids = successful_msg_ids.iter().map(|id| id.to_string()).collect::<Vec<_>>().join(", "),
                    provider_label_id = %db_provider_label_id,
                    "Failed to add label to messages in database"
                );
                // Move all messages to failed if database update fails
                failed_msg_ids.extend(successful_msg_ids.clone());
                successful_msg_ids.clear();
            }
        }
    }

    successful_msg_ids.sort();
    failed_msg_ids.sort();

    Ok((successful_msg_ids, failed_msg_ids))
}

/// Remove a label from multiple messages in gmail and in db concurrently
pub async fn remove_label_from_messages(
    db: &PgPool,
    gmail_access_token: &str,
    gmail_client: &GmailClient,
    messages: Vec<SimpleMessage>,
    provider_label_id: &str,
) -> anyhow::Result<(Vec<Uuid>, Vec<Uuid>)> {
    if messages.is_empty() {
        return Ok((vec![], vec![]));
    }

    if provider_label_id.is_empty() {
        return Err(anyhow!("Provider label ID cannot be empty"));
    }

    // First clone for the Gmail API operations
    let api_provider_label_id = provider_label_id.to_string();

    // Second clone for the database operations
    let db_provider_label_id = provider_label_id.to_string();

    // Use into_iter() on a clone of messages to avoid lifetime issues
    let label_tasks = messages.clone().into_iter().map(move |message| {
        let gmail_client = gmail_client.clone();
        let gmail_access_token = gmail_access_token.to_string();
        let provider_label_id = api_provider_label_id.clone();

        async move {
            let labels_to_add = vec![];
            let labels_to_remove = vec![provider_label_id.clone()];

            // Update in Gmail - remove the label
            let gmail_result = gmail_client
                .modify_message_labels(
                    &gmail_access_token,
                    &message.provider_id.clone().unwrap_or_default(),
                    &labels_to_add,
                    &labels_to_remove,
                )
                .await;

            if let Err(e) = gmail_result {
                tracing::error!(
                    error = ?e,
                    message_id = %message.db_id,
                    provider_id = %message.provider_id.unwrap_or_default(),
                    "Failed to remove label in Gmail"
                );
                return (message.db_id, Err(e));
            }

            (message.db_id, Ok(()))
        }
    });

    // Process tasks with limited concurrency
    const MAX_CONCURRENT: usize = 10;
    let results = stream::iter(label_tasks)
        .buffer_unordered(MAX_CONCURRENT)
        .collect::<Vec<_>>()
        .await;

    // Separate successful and failed messages
    let mut successful_msg_ids = Vec::new();
    let mut failed_msg_ids = Vec::new();

    for (msg_id, result) in results {
        match result {
            Ok(_) => successful_msg_ids.push(msg_id),
            Err(_) => failed_msg_ids.push(msg_id),
        }
    }

    // If there are any successful messages, update the database in bulk
    if !successful_msg_ids.is_empty() {
        let link_id = messages.first().map(|m| m.link_id).unwrap_or_default();

        // Use bulk delete function to remove labels from database
        match email_db_client::labels::delete::delete_message_labels_batch(
            db,
            &successful_msg_ids,
            &db_provider_label_id,
            link_id,
        )
        .await
        {
            Ok(_) => {}
            Err(e) => {
                tracing::error!(
                    error = ?e,
                    message_ids = successful_msg_ids.iter().map(|id| id.to_string()).collect::<Vec<_>>().join(", "),
                    provider_label_id = %db_provider_label_id,
                    "Failed to remove label from messages in database"
                );
                // Move all messages to failed if database update fails
                failed_msg_ids.extend(successful_msg_ids.clone());
                successful_msg_ids.clear();
            }
        }
    }

    successful_msg_ids.sort();
    failed_msg_ids.sort();

    Ok((successful_msg_ids, failed_msg_ids))
}
