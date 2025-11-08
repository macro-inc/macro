use crate::api::context::ApiContext;
use anyhow::Context;
use axum::{
    Extension, Json,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use macro_middleware::cloud_storage::ensure_access::chat::ChatAccessLevelExtractor;
use model::{chat::ChatBasic, response::EmptyResponse, user::UserContext};
use models_permissions::share_permission::access_level::OwnerAccessLevel;
use sqs_client::search::{SearchQueueMessage, chat::RemoveChatMessage};

#[derive(serde::Deserialize)]
pub struct Params {
    pub chat_id: String,
}

/// Deletes a particular chat by its id.
/// Soft deletes the chat.
#[utoipa::path(
        delete,
        path = "/chats/{chat_id}",
        responses(
            (status = 200, body=EmptyResponse),
            (status = 401, body=String),
            (status = 404, body=String),
            (status = 500, body=String),
        ),
        params(
            ("chat_id" = String, Path, description = "Chat id"))
    )]
#[tracing::instrument(skip(state, user_context, _access), fields(user_id=?user_context.user_id))]
pub async fn delete_chat_handler(
    _access: ChatAccessLevelExtractor<OwnerAccessLevel>,
    State(state): State<ApiContext>,
    user_context: Extension<UserContext>,
    Path(Params { chat_id }): Path<Params>,
    chat: Extension<ChatBasic>,
) -> Result<Response, Response> {
    // soft delete
    if let Err(err) = macro_db_client::chat::delete::soft_delete_chat(&state.db, &chat_id)
        .await
        .context("soft deleting chat")
    {
        tracing::error!(
            error = %err,
            chat_id = %chat_id,
            user_id = %user_context.user_id,
            "unable to mark chat for delete"
        );
        let status_code = StatusCode::INTERNAL_SERVER_ERROR;
        return Err((status_code, "unable to mark for delete").into_response());
    }

    macro_project_utils::update_project_modified(
        &state.db,
        &state.macro_notify_client,
        macro_project_utils::ProjectModifiedArgs {
            project_id: chat.project_id.clone(),
            old_project_id: None,
            user_id: user_context.user_id.clone(),
        },
    )
    .await;

    Ok((StatusCode::OK, Json(EmptyResponse::default())).into_response())
}

/// Permanently deletes a chat.
#[utoipa::path(
        delete,
        operation_id = "permanently_delete_chat",
        path = "/chats/{chat_id}/permanent",
        responses(
            (status = 200, body=EmptyResponse),
            (status = 401, body=String),
            (status = 404, body=String),
            (status = 500, body=String),
        ),
        params(
            ("chat_id" = String, Path, description = "Chat id"))
    )]
#[tracing::instrument(skip(state, user_context, _access), fields(user_id=?user_context.user_id))]
pub async fn permanently_delete_chat_handler(
    _access: ChatAccessLevelExtractor<OwnerAccessLevel>,
    State(state): State<ApiContext>,
    user_context: Extension<UserContext>,
    Path(Params { chat_id }): Path<Params>,
) -> impl IntoResponse {
    if let Err(e) = macro_db_client::chat::delete::delete_chat(&state.db, &chat_id)
        .await
        .context("permanently deleting chat")
    {
        tracing::error!(
            error = %e,
            chat_id = %chat_id,
            user_id = %user_context.user_id,
            "unable to permanently delete chat"
        );
        return Err((StatusCode::INTERNAL_SERVER_ERROR, "unable to delete chat").into_response());
    }

    if let Err(e) = state
        .sqs_client
        .send_message_to_search_event_queue(SearchQueueMessage::RemoveChatMessage(
            RemoveChatMessage {
                chat_id: chat_id.clone(),
                message_id: None,
            },
        ))
        .await
        .context("enqueuing search remove chat message")
    {
        tracing::error!(
            error = %e,
            chat_id = %chat_id,
            user_id = %user_context.user_id,
            "unable to enqueue search remove chat message"
        );
    }

    Ok((StatusCode::OK, Json(EmptyResponse::default())).into_response())
}
