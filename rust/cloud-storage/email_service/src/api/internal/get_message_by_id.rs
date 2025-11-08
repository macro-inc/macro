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

/// Internal endpoint to get an email message by ID.
#[tracing::instrument(skip(ctx))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    Path(PathParams { id }): Path<PathParams>,
) -> Result<Response, Response> {
    let message = email_db_client::messages::get_parsed::get_parsed_message_by_id(&ctx.db, &id)
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

#[tracing::instrument(skip(ctx))]
pub async fn get_message_by_id_batch_handler(
    State(ctx): State<ApiContext>,
    Json(ids): Json<Vec<Uuid>>,
) -> Result<Response, Response> {
    let messages =
        email_db_client::messages::get_parsed::get_parsed_messages_by_id_batch(&ctx.db, &ids)
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

    if messages.len() == ids.len() {
        Ok(Json(messages).into_response())
    } else if !messages.is_empty() {
        let missing_ids: Vec<Uuid> = ids
            .iter()
            .filter(|id| !messages.iter().any(|m| m.db_id == **id))
            .cloned()
            .collect();

        tracing::warn!(
            missing_ids = ?missing_ids,
            "some ids not found in database"
        );

        Ok(Json(messages).into_response())
    } else {
        tracing::warn!("no messages found in database");
        Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                message: "messages not found",
            }),
        )
            .into_response())
    }
}
