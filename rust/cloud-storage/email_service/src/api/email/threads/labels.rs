use crate::api::context::ApiContext;
use crate::api::email::messages::labels::{
    UpdateLabelBatchResponse, add_label_to_messages, remove_label_from_messages,
};
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::{Extension, Json};
use model::response::ErrorResponse;
use model::user::UserContext;
use models_email::service;
use models_email::service::link::Link;
use sqlx::types::Uuid;
use strum_macros::AsRefStr;
use thiserror::Error;
use utoipa::ToSchema;

#[derive(Debug, Error, AsRefStr)]
pub enum UpdateThreadLabelError {
    #[error("Label not found")]
    LabelNotFound,

    #[error("No messages found for thread")]
    ThreadEmpty,

    #[error("Internal error")]
    InternalError(#[from] anyhow::Error),
}

impl IntoResponse for UpdateThreadLabelError {
    fn into_response(self) -> Response {
        let status_code = match &self {
            UpdateThreadLabelError::LabelNotFound => StatusCode::BAD_REQUEST,
            UpdateThreadLabelError::ThreadEmpty => StatusCode::NOT_FOUND,
            UpdateThreadLabelError::InternalError(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };

        (
            status_code,
            Json(ErrorResponse {
                message: self.to_string().as_str(),
            }),
        )
            .into_response()
    }
}

#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema)]
pub struct UpdateThreadLabelRequest {
    pub label_id: Uuid,
    pub value: bool,
}

/// Add or remove a label from all messages in a thread
#[utoipa::path(
    patch,
    tag = "Threads",
    path = "/email/threads/{id}/labels",
    operation_id = "add_remove_thread_label",
    request_body = UpdateThreadLabelRequest,
    params(
        ("id" = Uuid, Path, description = "Thread ID."),
    ),
    responses(
            (status = 200, body=UpdateLabelBatchResponse),
            (status = 400, body=ErrorResponse),
            (status = 401, body=ErrorResponse),
            (status = 404, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, user_context, gmail_token, body), fields(user_id=user_context.user_id, fusionauth_user_id=user_context.fusion_user_id), err)]
pub async fn handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    gmail_token: Extension<String>,
    link: Extension<Link>,
    Path(thread_id): Path<Uuid>,
    Json(body): Json<UpdateThreadLabelRequest>,
) -> Result<Json<UpdateLabelBatchResponse>, UpdateThreadLabelError> {
    let label = email_db_client::labels::get::fetch_label_by_id(&ctx.db, body.label_id, link.id)
        .await?
        .ok_or(UpdateThreadLabelError::LabelNotFound)?;

    let db_messages =
        email_db_client::messages::get_simple_messages::get_simple_messages_for_thread(
            &ctx.db, thread_id, link.id,
        )
        .await?;

    if db_messages.is_empty() {
        return Err(UpdateThreadLabelError::ThreadEmpty);
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
        .await?
    } else {
        remove_label_from_messages(
            &ctx.db,
            gmail_access_token,
            &ctx.gmail_client,
            db_messages,
            label.provider_label_id.as_str(),
        )
        .await?
    };

    // need to update flags on message object for certain labels
    if label.provider_label_id.as_str() == service::label::system_labels::UNREAD {
        email_db_client::messages::update::update_message_read_status_batch(
            &ctx.db,
            successful_ids.clone(),
            &user_context.fusion_user_id,
            !body.value,
        )
        .await?;
    } else if label.provider_label_id.as_str() == service::label::system_labels::STARRED {
        email_db_client::messages::update::update_message_starred_status_batch(
            &ctx.db,
            successful_ids.clone(),
            &user_context.fusion_user_id,
            body.value,
        )
        .await?;
    }

    Ok(Json(UpdateLabelBatchResponse {
        successful_ids,
        failed_ids,
        missing_ids: vec![],
    }))
}
