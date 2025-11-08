use axum::{
    extract::{Path, State},
    response::{IntoResponse, Json, Response},
};
use model::response::ErrorResponse;
use reqwest::StatusCode;
use serde::Deserialize;
use uuid::Uuid;

use crate::api::context::AppState;

#[derive(Deserialize)]
pub struct Params {
    pub channel_id: Uuid,
    pub message_id: Uuid,
}

#[tracing::instrument(skip(ctx))]
pub async fn handler(
    State(ctx): State<AppState>,
    Path(Params {
        channel_id,
        message_id,
    }): Path<Params>,
) -> Result<Response, Response> {
    tracing::info!("get_channel_message");

    let channel_message_response =
        comms_db_client::messages::get_channel_message::get_channel_message_by_id(
            &ctx.db,
            &channel_id,
            &message_id,
        )
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "unable to get channel message");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: &e.to_string(),
                }),
            )
                .into_response()
        })?;

    Ok((StatusCode::OK, Json(channel_message_response)).into_response())
}
