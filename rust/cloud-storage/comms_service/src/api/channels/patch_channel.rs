use crate::api::{
    context::AppState,
    extractors::{ChannelId, ChannelOwner, ChannelTypeExtractor},
};
use anyhow::Result;
use axum::{Json, extract::State, http::StatusCode};
use axum_extra::extract::Cached;
use comms_db_client::channels::patch_channel::{self, PatchChannelOptions};
use model::comms::ChannelType;

#[utoipa::path(
        patch,
        tag = "channels",
        operation_id = "patch_channel",
        path = "/channels/{channel_id}",
        params(
            ("channel_id" = String, Path, description = "id of the channel"),
        ),
        responses(
            (status = 200, body=String),
            (status = 500, body=String),
        )
    )]
#[tracing::instrument(skip(ctx))]
pub async fn patch_channel_handler(
    State(ctx): State<AppState>,
    ChannelOwner(channel_owner): ChannelOwner,
    Cached(ChannelId(channel_id)): Cached<ChannelId>,
    Cached(ChannelTypeExtractor(channel_type)): Cached<ChannelTypeExtractor>,
    Json(req): Json<PatchChannelOptions>,
) -> Result<(StatusCode, String), (StatusCode, String)> {
    if channel_type == ChannelType::DirectMessage && req.channel_name.is_some() {
        return Err((
            StatusCode::BAD_REQUEST,
            "cannot change channel_name for direct message channels".to_string(),
        ));
    }

    patch_channel::patch_channel(&ctx.db, &channel_id, &channel_owner.context.user_id, req)
        .await
        .map_err(|e| {
            tracing::error!("error patching channel: {e}");

            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "error patching channel".to_string(),
            )
        })?;

    Ok((StatusCode::OK, "patched channel".to_string()))
}
