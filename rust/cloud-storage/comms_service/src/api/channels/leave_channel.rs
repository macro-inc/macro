use crate::api::{
    context::AppState,
    extractors::{ChannelId, ChannelMember, ChannelParticipants, ChannelTypeExtractor},
};
use anyhow::Result;
use axum::{extract::State, http::StatusCode};
use axum_extra::extract::Cached;
use comms_db_client::participants::remove_participant::{
    RemoveParticipantOptions, remove_participant,
};
use model::comms::ChannelType;

#[utoipa::path(
    post,
    tag = "channels",
    operation_id = "leave_channel",
    description = "allows a user to attempt to leave a channel",
    path = "/channels/{channel_id}/leave",
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
pub async fn leave_channel_handler(
    State(ctx): State<AppState>,
    Cached(ChannelTypeExtractor(channel_type)): Cached<ChannelTypeExtractor>,
    Cached(ChannelId(channel_id)): Cached<ChannelId>,
    Cached(ChannelParticipants(participants)): Cached<ChannelParticipants>,
    Cached(ChannelMember(channel_member)): Cached<ChannelMember>,
) -> Result<StatusCode, (StatusCode, String)> {
    match (channel_type, participants.len()) {
        (ChannelType::Organization, _) => {
            tracing::warn!("user tried to leave organization channel");
            return Err((
                StatusCode::BAD_REQUEST,
                "cannot leave organization channel".to_string(),
            ));
        }
        (ChannelType::Private, 2) | (ChannelType::DirectMessage, _) => {
            tracing::warn!("user tried to leave private channel with only 2 participants");
            return Err((
                StatusCode::BAD_REQUEST,
                "cannot leave channel with only 2 participants".to_string(),
            ));
        }
        _ => {}
    };

    remove_participant(
        &ctx.db,
        RemoveParticipantOptions {
            channel_id: &channel_id,
            user_id: &channel_member.context.user_id,
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

    Ok(StatusCode::OK)
}
