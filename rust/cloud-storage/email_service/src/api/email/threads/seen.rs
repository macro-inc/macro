use crate::api::context::ApiContext;
use crate::api::email::messages::labels::remove_label_from_messages;
use anyhow::Context;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::{Extension, Json};
use model::response::{EmptyResponse, ErrorResponse};
use model::user::UserContext;
use models_email::email::service;
use models_email::service::link::Link;
use sqlx::types::Uuid;
use strum_macros::AsRefStr;
use thiserror::Error;

#[derive(Debug, Error, AsRefStr)]
pub enum SeenThreadError {
    #[error("Thread not found")]
    ThreadNotFound,

    #[error("Database query error")]
    QueryError(#[from] anyhow::Error),
}

impl IntoResponse for SeenThreadError {
    fn into_response(self) -> Response {
        let status_code = match &self {
            SeenThreadError::ThreadNotFound => StatusCode::NOT_FOUND,
            SeenThreadError::QueryError(_) => StatusCode::INTERNAL_SERVER_ERROR,
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
    let messages = email_db_client::messages::get_simple_messages::get_simple_messages_for_thread(
        &ctx.db, thread_id, link.id,
    )
    .await
    .context("Failed to fetch messages from database")?;

    if messages.is_empty() {
        return Err(SeenThreadError::ThreadNotFound);
    }

    // update viewed_at value in user_history table for thread
    email_db_client::user_history::upsert_user_history(&ctx.db, link.id, thread_id)
        .await
        .context("Failed to upsert user history")?;

    let gmail_access_token = gmail_token.as_str();

    // remove UNREAD label from thread's messages that are currently unread
    let (successful_ids, failed_ids) = remove_label_from_messages(
        &ctx.db,
        gmail_access_token,
        &ctx.gmail_client,
        messages.iter().filter(|m| !m.is_read).cloned().collect(),
        service::label::system_labels::UNREAD,
    )
    .await
    .context("Failed to remove label from messages")?;

    if !failed_ids.is_empty() {
        tracing::warn!(
            "unable to mark messages as read in seen_handler: {:?}",
            failed_ids
        );
    }

    // only need to update read statuses if there were unread messages that got marked as read
    if !successful_ids.is_empty() {
        // update is_read in threads table
        email_db_client::threads::update::update_thread_read_status(
            &ctx.db, thread_id, link.id, true,
        )
        .await
        .context("Failed to update thread read status")?;

        // update is_read in messages table
        email_db_client::messages::update::update_message_read_status_batch(
            &ctx.db,
            successful_ids.clone(),
            &user_context.fusion_user_id,
            true,
        )
        .await
        .context("Failed to update message read status")?;
    }

    Ok((StatusCode::OK, Json(EmptyResponse::default())).into_response())
}
