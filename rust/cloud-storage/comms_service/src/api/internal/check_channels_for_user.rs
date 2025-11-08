use axum::{
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};

use crate::api::context::AppState;
use model::comms::CheckChannelsForUserRequest;

#[tracing::instrument(skip(ctx))]
pub async fn handler(
    State(ctx): State<AppState>,
    req: extract::Json<CheckChannelsForUserRequest>,
) -> Result<Response, Response> {
    tracing::trace!("checking channels for user");

    if req.channel_ids.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "no channel ids").into_response());
    }

    let result = comms_db_client::channels::get_channels::check_channels_for_user(
        &ctx.db,
        &req.user_id,
        &req.channel_ids,
    )
    .await
    .map_err(|e| {
        tracing::error!(error=?e, "unable to check channels for user");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "unable to check channels for user",
        )
            .into_response()
    })?;

    Ok((StatusCode::OK, Json(result)).into_response())
}
