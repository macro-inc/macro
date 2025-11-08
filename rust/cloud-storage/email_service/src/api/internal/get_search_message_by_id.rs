use crate::api::ApiContext;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use model::response::ErrorResponse;
use sqlx::types::Uuid;

#[derive(serde::Serialize, serde::Deserialize, Debug)]
pub struct PathParams {
    pub id: Uuid,
}

/// Internal endpoint to get an email message by ID. Uses a
// different response object than get_message_by_thread_id
#[tracing::instrument(skip(ctx))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    Path(PathParams { id }): Path<PathParams>,
) -> Result<Response, Response> {
    let message =
        email_db_client::messages::get_parsed_search::get_parsed_search_message_by_id(&ctx.db, &id)
            .await
            .map_err(|e| {
                tracing::error!(error=?e, "unable to get message ids for thread");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        message: "internal server error",
                    }),
                )
                    .into_response()
            })?;

    if let Some(message) = message {
        Ok(Json(message).into_response())
    } else {
        Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                message: "message not found",
            }),
        )
            .into_response())
    }
}
