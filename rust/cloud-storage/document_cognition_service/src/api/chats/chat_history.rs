use axum::extract::{Extension, Path, State};
use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use macro_db_client::insight::chat_insight_context::get_chat_history;
use macro_middleware::cloud_storage::ensure_access::chat::ChatAccessLevelExtractor;
use model::chat::ChatHistory;
use model::user::UserContext;
use models_permissions::share_permission::access_level::ViewAccessLevel;
use sqlx::PgPool;

/// Retrieves chat history for a specific chat ID
#[utoipa::path(
    get,
    path = "/chats/history/{chat_id}",
    params(
        ("chat_id" = String, Path, description = "Chat ID to retrieve history for")
    ),
    responses(
        (status = 200, body = ChatHistory),
        (status = 404, body = String, description = "Chat not found"),
        (status = 500, body = String, description = "Internal server error")
    )
)]
#[tracing::instrument(skip(db, user_context), fields(user_id=?user_context.user_id, chat_id=?chat_id))]
pub async fn get_chat_history_handler(
    _access: ChatAccessLevelExtractor<ViewAccessLevel>,
    State(db): State<PgPool>,
    Extension(user_context): Extension<UserContext>,
    Path(chat_id): Path<String>,
) -> Result<Json<ChatHistory>, Response> {
    // Note: Access control is handled by middleware for external routes
    // Internal routes trust the caller has proper access

    let chat_history = get_chat_history(&db, &chat_id).await.map_err(|err| {
        tracing::error!(
            user_id = ?user_context.user_id,
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
