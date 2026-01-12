use axum::extract::State;
use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use macro_db_client::chat_history::get_chat_history_for_messages;
use model::chat::ChatHistory;
use models_dcs::api::ChatHistoryBatchMessagesRequest;
use sqlx::PgPool;

/// Internal endpoint to retrieve chat history for multiple message IDs
#[tracing::instrument(skip(db))]
pub async fn get_chat_history_batch_messages_handler(
    State(db): State<PgPool>,
    Json(request): Json<ChatHistoryBatchMessagesRequest>,
) -> Result<Json<ChatHistory>, Response> {
    let chat_history = get_chat_history_for_messages(&db, &request.message_ids)
        .await
        .map_err(|err| {
            tracing::error!(
                error = %err,
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
