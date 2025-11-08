use axum::{
    extract::{Path, State},
    response::{IntoResponse, Json, Response},
};
use reqwest::StatusCode;
use serde::Deserialize;

use crate::api::context::AppState;

#[derive(Deserialize)]
pub struct Params {
    pub item_id: String,
    pub item_type: String,
}

#[tracing::instrument(skip(ctx))]
pub async fn handler(
    State(ctx): State<AppState>,
    Path(Params { item_id, item_type }): Path<Params>,
) -> Result<Response, Response> {
    tracing::trace!("getting channel mentions for item");

    let channel_ids =
        comms_db_client::mentions::get_channel_mentions_by_item(&ctx.db, &item_id, &item_type)
            .await
            .map_err(|e| {
                tracing::error!(error=?e, "unable to get channel mentions");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "failed to get channel mentions".to_string(),
                )
                    .into_response()
            })?;

    Ok((StatusCode::OK, Json(channel_ids)).into_response())
}
