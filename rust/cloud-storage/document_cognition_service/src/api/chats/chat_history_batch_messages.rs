use axum::extract::{Extension, State};
use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use macro_db_client::{
    chat::get_chat_ids_for_messages, insight::chat_insight_context::get_chat_history_for_messages,
    share_permission::access_level::chat::get_highest_access_level_for_chats,
};
use model::chat::ChatHistory;
use model::user::UserContext;
use models_dcs::api::ChatHistoryBatchMessagesRequest;
use sqlx::PgPool;

/// Retrieves chat history for multiple message IDs
#[utoipa::path(
    post,
    path = "/chats/history_batch_messages",
    request_body = ChatHistoryBatchMessagesRequest,
    responses(
        (status = 200, body = ChatHistory),
        (status = 403, body = String, description = "Access denied to chat"),
        (status = 404, body = String, description = "Messages not found"),
        (status = 500, body = String, description = "Internal server error")
    )
)]
#[tracing::instrument(skip(db, user_context), fields(user_id=?user_context.user_id))]
pub async fn get_chat_history_batch_messages_handler(
    State(db): State<PgPool>,
    Extension(user_context): Extension<UserContext>,
    Json(request): Json<ChatHistoryBatchMessagesRequest>,
) -> Result<Json<ChatHistory>, Response> {
    // Get all unique chat IDs and check access to each
    let chat_ids = get_chat_ids_for_messages(&db, &request.message_ids)
        .await
        .map_err(|err| {
            tracing::error!(
                error = %err,
                user_id = %user_context.user_id,
                message_count = request.message_ids.len(),
                "Failed to get chat IDs for messages"
            );
            let error_message = if request.message_ids.is_empty() {
                "No message IDs provided"
            } else {
                "Messages not found"
            };
            (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({"error": error_message})),
            )
                .into_response()
        })?;

    // Check access to all chats in a single database query
    let chat_ids_vec: Vec<String> = chat_ids.into_iter().collect();
    let access_levels =
        get_highest_access_level_for_chats(&db, &chat_ids_vec, &user_context.user_id)
            .await
            .map_err(|err| {
                tracing::error!(
                    error = %err,
                    user_id = %user_context.user_id,
                    chat_count = chat_ids_vec.len(),
                    "Failed to check chat access for batch"
                );
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({
                        "error": "Failed to check chat access"
                    })),
                )
                    .into_response()
            })?;

    // Check that user has access to all chats
    for chat_id in &chat_ids_vec {
        let access_level = access_levels.get(chat_id).copied().flatten();

        // Require at least View access to read messages from this chat
        if access_level.is_none() {
            tracing::warn!(
                user_id = %user_context.user_id,
                chat_id = %chat_id,
                "User does not have access to chat containing requested messages"
            );
            return Err((
                StatusCode::FORBIDDEN,
                Json(serde_json::json!({
                    "error": "Access denied to chat"
                })),
            )
                .into_response());
        }
    }

    let chat_history = get_chat_history_for_messages(&db, &request.message_ids)
        .await
        .map_err(|err| {
            tracing::error!(
                error = %err,
                user_id = %user_context.user_id,
                message_count = request.message_ids.len(),
                "Failed to get chat history for messages"
            );
            let error_message = if err.to_string().contains("no rows returned") {
                "Chat history not found"
            } else {
                "Failed to retrieve chat history"
            };
            (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({"error": error_message})),
            )
                .into_response()
        })?;

    Ok(Json(chat_history))
}
