use axum::{
    extract::{Path, Query, State},
    response::{IntoResponse, Json, Response},
};
use model::response::ErrorResponse;
use reqwest::StatusCode;
use serde::Deserialize;

use crate::api::context::AppState;

#[derive(Deserialize)]
pub struct Params {
    pub user_id: String,
}

#[derive(Deserialize, Debug)]
pub struct QueryParams {
    pub org_id: Option<i64>,
}

#[tracing::instrument(skip(ctx))]
pub async fn handler(
    State(ctx): State<AppState>,
    Path(Params { user_id }): Path<Params>,
    Query(params): Query<QueryParams>,
) -> Result<Response, Response> {
    tracing::info!("get_user_channel_ids");

    let user_channel_ids = comms_db_client::channels::get_channels::get_user_channel_ids(
        &ctx.db,
        &user_id,
        params.org_id,
    )
    .await
    .map_err(|e| {
        tracing::error!(error=?e, "unable to get user channel ids");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                message: &e.to_string(),
            }),
        )
            .into_response()
    })?;

    Ok((StatusCode::OK, Json(user_channel_ids)).into_response())
}
