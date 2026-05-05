use std::collections::HashSet;

use crate::api::context::AppState;
use crate::api::extractors::{ChannelId, ChannelParticipants, ChannelTypeExtractor};
use anyhow::Result;
use axum::{
    extract::{Extension, State},
    http::StatusCode,
};
use axum_extra::extract::Cached;
use comms_db_client::participants::add_participant::{AddParticipantOptions, add_participant};
use contacts::domain::ports::ContactsIngress;
use macro_user_id::user_id::MacroUserIdStr;
use model::comms::ParticipantRole;
use model::user::UserContext;

#[utoipa::path(
    post,
    tag = "channels",
    operation_id = "join_channel",
    description = "allows a user to attempt to join a channel",
    path = "/comms/channels/{channel_id}/join",
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
    skip(ctx),
    fields(user_id=?user_ctx.user_id)
)]
pub async fn join_channel_handler(
    State(ctx): State<AppState>,
    Cached(ChannelTypeExtractor(channel_type)): Cached<ChannelTypeExtractor>,
    Cached(ChannelParticipants(channel_participants)): Cached<ChannelParticipants>,
    Cached(ChannelId(channel_id)): Cached<ChannelId>,
    user_ctx: Extension<UserContext>,
) -> Result<StatusCode, (StatusCode, String)> {
    if let models_comms::channel::ChannelType::DirectMessage = channel_type {
        tracing::error!("user tried to join a direct message channel");
        return Err((
            StatusCode::BAD_REQUEST,
            "cannot join direct message channel".to_string(),
        ));
    }

    add_participant(
        &ctx.db,
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

    if !matches!(
        channel_type,
        models_comms::channel::ChannelType::DirectMessage
            | models_comms::channel::ChannelType::Organization
    ) && !channel_participants.is_empty()
    {
        let joiner = MacroUserIdStr::try_from(user_ctx.user_id.clone()).map_err(|e| {
            tracing::error!(error=?e, "invalid user id for contacts");
            (StatusCode::BAD_REQUEST, "invalid user id".to_string())
        })?;

        let mut contacts_users: HashSet<MacroUserIdStr<'static>> = channel_participants
            .iter()
            .map(|p| p.user_id.to_string())
            .map(MacroUserIdStr::try_from)
            .collect::<Result<_, _>>()
            .map_err(|e| {
                tracing::error!(error=?e, "invalid user id for contacts");
                (StatusCode::BAD_REQUEST, "invalid user id".to_string())
            })?;
        contacts_users.insert(joiner);

        ctx.contacts_ingress
            .enqueue_contacts(contacts_users)
            .await
            .inspect_err(|e| {
                tracing::error!(error=?e, "unable to create 'join channel' contacts message");
            })
            .ok();
    }

    Ok(StatusCode::OK)
}
