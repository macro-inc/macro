use axum::extract::{Path, State};
use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use macro_db_client::chat_history::get_chat_history;
use model::chat::ChatHistory;
use sqlx::PgPool;

/// Internal endpoint to retrieve chat history for a specific chat ID
#[tracing::instrument(skip(db), fields(chat_id=?chat_id))]
pub async fn get_chat_history_handler(
    State(db): State<PgPool>,
    Path(chat_id): Path<String>,
) -> Result<Json<ChatHistory>, Response> {
    let chat_history = get_chat_history(&db, &chat_id).await.map_err(|err| {
        tracing::error!(
            chat_id = %chat_id,
            error = %err,
            "Failed to get chat history"
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
