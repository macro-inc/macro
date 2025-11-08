use crate::api::context::AppState;
use axum::{
    extract::{Path, State},
    response::{IntoResponse, Json, Response},
};
use reqwest::StatusCode;
use uuid::Uuid;

#[derive(serde::Serialize, serde::Deserialize, Debug)]
pub struct PathParams {
    pub channel_id: Uuid,
}

#[tracing::instrument(skip(ctx))]
pub async fn handler(
    State(ctx): State<AppState>,
    Path(PathParams { channel_id }): Path<PathParams>,
) -> Result<Response, Response> {
    tracing::trace!("getting participants for channel");

    let participants =
        comms_db_client::participants::get_participants::get_participants(&ctx.db, &channel_id)
            .await
            .map_err(|e| {
                tracing::error!(error=?e, "unable to get channel participants");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "failed to get channel participants".to_string(),
                )
                    .into_response()
            })?;

    Ok((StatusCode::OK, Json(participants)).into_response())
}
