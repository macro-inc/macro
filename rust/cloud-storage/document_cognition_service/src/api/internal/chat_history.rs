use axum::Json;
use axum::extract::{Path, State};
use macro_db_client::insight::chat_insight_context::get_chat_history;
use model::chat::ChatHistory;
use sqlx::PgPool;

#[tracing::instrument(skip(db))]
pub async fn get_chat_history_handler(
    State(db): State<PgPool>,
    Path(chat_id): Path<String>,
) -> Result<Json<ChatHistory>, axum::http::StatusCode> {
    let chat_history = get_chat_history(&db, &chat_id).await.map_err(|e| {
        tracing::error!(error = %e, chat_id = %chat_id, "Failed to get chat history");
        axum::http::StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok(Json(chat_history))
}
