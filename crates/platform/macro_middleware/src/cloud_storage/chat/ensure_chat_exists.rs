use crate::error_handler::error_handler;
use axum::{
    extract::{Path, Request, State},
    http::StatusCode,
    middleware::Next,
    response::Response,
};
use model::chat::ChatBasic;
use serde::Deserialize;
use sqlx::{PgPool, Pool, Postgres};

#[derive(Deserialize)]
pub struct Params {
    pub chat_id: String,
}

/// Finds the requested chat and returns the basic chat information to be used in the
/// request context
#[tracing::instrument(skip(db))]
pub(in crate::cloud_storage::chat) async fn get_basic_chat(
    db: &Pool<Postgres>,
    chat_id: &str,
) -> Result<ChatBasic, (StatusCode, String)> {
    let result: ChatBasic = macro_db_client::chat::get_basic_chat(db, chat_id)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "failed to get chat");
            if e.to_string()
                .contains("no rows returned by a query that expected to return at least one row")
            {
                return (
                    StatusCode::NOT_FOUND,
                    format!("chat with id \"{}\" was not found", chat_id),
                );
            }
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "unknown error occurred".to_string(),
            )
        })?;

    Ok(result)
}

/// Validates the chat exists and inserts ChatBasic into req context
#[axum::debug_middleware]
pub async fn handler(
    State(db): State<PgPool>,
    Path(Params { chat_id }): Path<Params>,
    mut req: Request,
    next: Next,
) -> Result<Response, Response> {
    let chat = get_basic_chat(&db, &chat_id)
        .await
        .map_err(|(status_code, msg)| error_handler(&msg, status_code))?;

    req.extensions_mut().insert(chat);
    Ok(next.run(req).await)
}
