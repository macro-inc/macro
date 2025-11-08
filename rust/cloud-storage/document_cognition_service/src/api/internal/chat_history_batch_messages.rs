use axum::Json;
use axum::extract::State;
use macro_db_client::insight::chat_insight_context::get_chat_history_for_messages;
use model::chat::ChatHistory;
use models_dcs::api::ChatHistoryBatchMessagesRequest;
use sqlx::PgPool;

#[tracing::instrument(skip(db))]
pub async fn get_chat_history_batch_messages_handler(
    State(db): State<PgPool>,
    Json(request): Json<ChatHistoryBatchMessagesRequest>,
) -> Result<Json<ChatHistory>, axum::http::StatusCode> {
    let chat_history = get_chat_history_for_messages(&db, &request.message_ids)
        .await
        .map_err(|e| {
            tracing::error!(
                error = %e,
                message_ids = ?request.message_ids,
                "Failed to get chat history for messages"
            );
            axum::http::StatusCode::INTERNAL_SERVER_ERROR
        })?;

    Ok(Json(chat_history))
}
