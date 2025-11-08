use axum::Json;
use axum::extract::State;
use axum::response::Response;
use axum::{extract::Path, http::StatusCode, response::IntoResponse};
use macro_db_client::dcs::get_chat_notification_users::get_chat_notification_users;
use model::response::GenericErrorResponse;
use sqlx::PgPool;

#[derive(serde::Deserialize)]
pub struct Params {
    pub chat_id: String,
}

/// Gets all users that need to be notified for a chat
/// Returns an list of strings that are the user ids to be notified
#[utoipa::path(
        get,
        path = "/internal/notifications/chat/{chat_id}",
        operation_id = "get_chat_notification_users",
        params(
            ("chat_id" = String, Path, description = "Chat id")
        ),
        responses(
            (status = 200, body=Vec<String>),
            (status = 401, body=GenericErrorResponse),
            (status = 500, body=GenericErrorResponse),
        )
    )]
#[tracing::instrument(skip(db))]
pub async fn handler(
    State(db): State<PgPool>,
    Path(Params { chat_id }): Path<Params>,
) -> Result<Response, Response> {
    let users = get_chat_notification_users(&db, &chat_id)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, chat_id = %chat_id, "Failed to get chat notification users");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(GenericErrorResponse {
                    error: true,
                    message: "unable to get chat notification users".to_string(),
                }),
            )
                .into_response()
        })?;

    Ok((StatusCode::OK, Json(users)).into_response())
}
