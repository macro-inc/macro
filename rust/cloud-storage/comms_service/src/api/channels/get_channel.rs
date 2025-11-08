use crate::api::{
    context::AppState,
    extractors::{ChannelId, ChannelMember, ChannelName, ChannelParticipants, ParticipantAccess},
};
use anyhow::Result;
use axum::{
    Json,
    extract::{Query, State},
    http::StatusCode,
};
use axum_extra::extract::Cached;
use comms_db_client::{
    activity::get_activity::get_activity_for_channel,
    attachments::get_attachments::get_attachments,
    channels::get_channel::get_channel,
    messages::get_messages::get_messages,
    model::{Activity, Attachment, CountedReaction, Message},
    reactions::{get_reactions::get_messages_reactions, group_reactions_by_message},
};
use futures::try_join;
use model::comms::{Channel, ChannelParticipant};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use utoipa::ToSchema;

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct GetChannelResponse {
    /// information about the channel
    pub channel: Channel,
    /// list of participants
    pub participants: Vec<ChannelParticipant>,
    /// messages
    pub messages: Vec<Message>,
    /// reactions grouped by message
    pub reactions: HashMap<String, Vec<CountedReaction>>,
    /// the last activity for the given user on this channel
    pub activity: Option<Activity>,
    /// Attachments that are linked to messages in this channel
    pub attachments: Vec<Attachment>,
    /// What kind of access the user has to the channel
    /// almost always this should be [Access(ParticipantType)]
    pub access: ParticipantAccess,
}

#[derive(Debug, Deserialize)]
pub struct GetChannelQuery {
    pub since: Option<chrono::DateTime<chrono::Utc>>,
    pub limit: Option<i64>,
}

#[utoipa::path(
        get,
        path = "/channels/{channel_id}",
        tag = "channels",
        operation_id = "get_channel",
        params(
            ("channel_id" = String, Path, description = "id of the channel"),
            ("since" = Option<String>, Query, description = "ISO8601 timestamp to fetch messages since"),
            ("limit" = Option<i64>, Query, description = "Maximum number of messages to fetch")
        ),
        responses(
            (status = 200, body=GetChannelResponse),
            (status = 401, body=String),
            (status = 404, body=String),
            (status = 500, body=String),
        )
    )]
#[tracing::instrument(skip(app_state, participants))]
pub async fn get_channel_handler(
    State(app_state): State<AppState>,
    ChannelId(channel_id): ChannelId,
    ChannelParticipants(participants): ChannelParticipants,
    ChannelMember(channel_member): ChannelMember,
    ChannelName(channel_name): ChannelName,
    Cached(access): Cached<ParticipantAccess>,
    Query(query): Query<GetChannelQuery>,
) -> Result<(StatusCode, Json<GetChannelResponse>), (StatusCode, String)> {
    let db = &app_state.db;

    let (mut channel, messages, activity, attachments) = try_join!(
        get_channel(db, &channel_id),
        get_messages(db, &channel_id, query.since, query.limit),
        get_activity_for_channel(db, &channel_id, &channel_member.context.user_id),
        get_attachments(db, &channel_id),
    )
    .map_err(|err| {
        tracing::error!(error=?err, "unable to get channel data");
        (StatusCode::INTERNAL_SERVER_ERROR, err.to_string())
    })?;

    let reactions = get_messages_reactions(db, messages.iter().map(|m| m.id).collect())
        .await
        .map_err(|err| {
            tracing::error!("unable to get reactions: {:?}", err);
            (StatusCode::INTERNAL_SERVER_ERROR, err.to_string())
        })?;

    let reactions = group_reactions_by_message(reactions);

    channel.name = Some(channel_name);

    return Ok((
        StatusCode::OK,
        Json(GetChannelResponse {
            channel,
            participants,
            messages,
            reactions,
            activity,
            attachments,
            access: access.clone(),
        }),
    ));
}
