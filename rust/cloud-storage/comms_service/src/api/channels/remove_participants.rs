use crate::api::context::AppState;
use crate::api::extractors::{ChannelAdmin, ChannelId, ChannelTypeExtractor};
use anyhow::Result;
use axum::extract::Json;
use axum::{extract::State, http::StatusCode};
use axum_extra::extract::Cached;
use comms_db_client::participants::remove_participant::{
    RemoveParticipantOptions, remove_participant,
};
use model::comms::ChannelType;
use model::document_storage_service_internal::UpdateUserChannelPermissionsRequest;
use models_permissions::share_permission::channel_share_permission::UpdateOperation;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Deserialize, Serialize, ToSchema, Debug)]
pub struct RemoveParticipantsRequest {
    participants: Vec<String>,
}

#[utoipa::path(
    delete,
    tag = "channels",
    operation_id = "remove_participants",
    description = "removes a list of participants to the channel, user must be an owner or an admin",
    path = "/channels/{channel_id}/participants",
    params(
        ("channel_id" = String, Path, description = "channel id"),
    ),
    responses(
        (status = 200),
        (status = 401, body=String),
        (status = 404, body=String),
        (status = 500, body=String),
    )
)]
#[tracing::instrument(skip(ctx))]
pub async fn handler(
    State(ctx): State<AppState>,
    ChannelAdmin(_channel_admin): ChannelAdmin,
    Cached(ChannelTypeExtractor(channel_type)): Cached<ChannelTypeExtractor>,
    Cached(ChannelId(channel_id)): Cached<ChannelId>,
    req: Json<RemoveParticipantsRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    if let ChannelType::DirectMessage = channel_type {
        tracing::error!("cannot add or remove participants from direct message channel");
        return Err((
            StatusCode::BAD_REQUEST,
            "cannot add or remove participants from direct message channel".to_string(),
        ));
    }

    for participant in req.participants.iter() {
        remove_participant(
            &ctx.db,
            RemoveParticipantOptions {
                channel_id: &channel_id,
                user_id: participant.as_str(),
            },
        )
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "unable to remove participant from channel");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "unable to remove participant from channel".to_string(),
            )
        })?;
    }

    let start = std::time::Instant::now();
    ctx.document_storage_service_client
        .update_user_channel_permissions(UpdateUserChannelPermissionsRequest {
            user_ids: req.participants.clone(),
            channel_id: channel_id.to_string(),
            operation: UpdateOperation::Remove,
        })
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "unable to remove permissions for channel items");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "unable to remove participant from channel".to_string(),
            )
        })?;
    tracing::info!(elapsed=?start.elapsed(), "removed user channel permissions");

    Ok(StatusCode::OK)
}
