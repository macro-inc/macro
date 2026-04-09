use crate::api::channels::create_channel::to_lowercase;
use crate::api::context::{AppState, ChannelImpl};
use crate::api::extractors::{
    ChannelId, ChannelMember, ChannelName, ChannelParticipants, ChannelTypeExtractor,
};
use crate::channel_permissions;
use crate::notification as comms_notification;
use anyhow::Result;
use axum::extract::Json;
use axum::{extract::State, http::StatusCode};
use axum_extra::extract::Cached;
use comms_db_client::participants::add_participant::{AddParticipantOptions, add_participant};
use doppleganger::Mirror;
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use model_notifications::CommonChannelMetadata;
use models_comms::channel::ChannelType;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Deserialize, Serialize, ToSchema, Debug)]
pub struct AddParticipantsRequest {
    participants: Vec<String>,
}

#[utoipa::path(
    post,
    tag = "channels",
    operation_id = "add_participants",
    description = "adds a list of participants to the channel, user must be a participant",
    path = "/comms/channels/{channel_id}/participants",
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
#[tracing::instrument(skip(ctx, channel_participants))]
#[axum::debug_handler]
pub async fn handler(
    State(ctx): State<AppState>,
    Cached(ChannelMember(channel_member)): Cached<ChannelMember>,
    Cached(ChannelName(channel_name, ..)): Cached<ChannelName<ChannelImpl>>,
    Cached(ChannelTypeExtractor(channel_type)): Cached<ChannelTypeExtractor>,
    Cached(ChannelParticipants(channel_participants)): Cached<ChannelParticipants>,
    Cached(ChannelId(channel_id)): Cached<ChannelId>,
    req: Json<AddParticipantsRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    if let ChannelType::DirectMessage = channel_type {
        tracing::error!("cannot add/remove participants from direct message channels");
        return Err((
            StatusCode::BAD_REQUEST,
            "cannot add/remove participants from direct message channels".to_string(),
        ));
    }

    let invited_by_user_id = MacroUserIdStr::parse_from_str(&channel_member.context.user_id)
        .map_err(|_e| (StatusCode::BAD_REQUEST, "Invalid macro user id".to_string()))?
        .into_owned();

    let participants = to_lowercase(&req.participants);

    for participant in participants.iter() {
        add_participant(
            &ctx.db,
            AddParticipantOptions {
                channel_id: &channel_id,
                user_id: participant.as_str(),
                participant_role: Some(model::comms::ParticipantRole::Member),
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
    }

    let start = std::time::Instant::now();
    channel_permissions::add_permissions_for_channel_users(
        &ctx.db,
        &channel_id.to_string(),
        &participants,
    )
    .await
    .map_err(|e| {
        tracing::error!(error=?e, "unable to add permissions for channel items");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "unable to add permissions for channel items".to_string(),
        )
    })?;
    tracing::info!(elapsed=?start.elapsed(), "added user channel permissions");

    // There should always be participants, but better safe than sorry
    let metadata = CommonChannelMetadata {
        channel_type: model_notifications::ChannelType::mirror(channel_type),
        channel_name: channel_name.clone(),
    };

    let sender_profile_picture_url =
        comms_notification::get_sender_profile_picture_url(&ctx.db, &invited_by_user_id).await;

    let parsed_recipients: Vec<_> = participants
        .iter()
        .filter_map(|id| MacroUserIdStr::parse_from_str(id).ok())
        .collect();

    let parsed_ids: Vec<_> = parsed_recipients.iter().map(|u| u.0.clone()).collect();

    let existing_user_ids: std::collections::HashSet<String> =
        macro_db_client::user::get_all::get_existing_users(&ctx.db, &parsed_ids)
            .await
            .inspect_err(|e| {
                tracing::error!(error=?e, "unable to get existing users for invite");
            })
            .unwrap_or_default()
            .into_iter()
            .collect();

    comms_notification::dispatch_notifications_for_invite(
        &*ctx.notification_ingress_service,
        &channel_id,
        &invited_by_user_id,
        parsed_recipients,
        existing_user_ids,
        sender_profile_picture_url,
        metadata,
    )
    .await
    .inspect_err(|e| {
        tracing::error!(error=?e, "unable to send channel invite notification");
    })
    .ok();

    if matches!(channel_type, ChannelType::Private) && !channel_participants.is_empty() {
        // Contacts: add participants to social graph
        let channel_participants: Vec<String> = channel_participants
            .iter()
            .map(|p| p.user_id.to_string())
            .collect();
        let sqs_client = &ctx.sqs_client;
        sqs_client
            .enqueue_contacts_add_participants(
                participants.clone(),
                channel_participants,
                &channel_id.to_string(),
            )
            .await
            .map_err(|e| {
                tracing::error!(error=?e, "unable to create 'add participant' SQS message");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "unable to create 'add participant' SQS message".to_string(),
                )
            })?;
    }

    Ok(StatusCode::OK)
}
