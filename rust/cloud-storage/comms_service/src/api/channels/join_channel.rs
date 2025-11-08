use crate::api::extractors::{ChannelId, ChannelTypeExtractor};
use anyhow::Result;
use axum::{
    extract::{Extension, State},
    http::StatusCode,
};
use axum_extra::extract::Cached;
use comms_db_client::participants::add_participant::{AddParticipantOptions, add_participant};
use model::comms::{ChannelType, ParticipantRole};
use model::user::UserContext;
use sqlx::PgPool;

#[utoipa::path(
    post,
    tag = "channels",
    operation_id = "join_channel",
    description = "allows a user to attempt to join a channel",
    path = "/channels/{channel_id}/join",
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
#[tracing::instrument(
    skip(db),
    fields(user_id=?user_ctx.user_id)
)]
pub async fn join_channel_handler(
    State(db): State<PgPool>,
    Cached(ChannelTypeExtractor(channel_type)): Cached<ChannelTypeExtractor>,
    Cached(ChannelId(channel_id)): Cached<ChannelId>,
    user_ctx: Extension<UserContext>,
) -> Result<StatusCode, (StatusCode, String)> {
    if let ChannelType::DirectMessage = channel_type {
        tracing::error!("user tried to join a direct message channel");
        return Err((
            StatusCode::BAD_REQUEST,
            "cannot join direct message channel".to_string(),
        ));
    }

    add_participant(
        &db,
        AddParticipantOptions {
            channel_id: &channel_id,
            user_id: &user_ctx.user_id,
            participant_role: Some(ParticipantRole::Member),
        },
    )
    .await
    .map_err(|e| {
        tracing::error!(error=?e, "unable to add participant to channel");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "unable to add participant to channel".to_string(),
        )
    })?;

    Ok(StatusCode::OK)
}
