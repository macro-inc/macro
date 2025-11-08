use crate::api::channels::create_channel::to_lowercase;
use crate::api::context::AppState;
use crate::api::extractors::{
    ChannelAdmin, ChannelId, ChannelName, ChannelParticipants, ChannelTypeExtractor,
};
use crate::notification as comms_notification;
use anyhow::Result;
use axum::extract::Json;
use axum::{extract::State, http::StatusCode};
use axum_extra::extract::Cached;
use comms_db_client::participants::add_participant::{AddParticipantOptions, add_participant};
use model::comms::{ChannelType, ParticipantRole};
use model::document_storage_service_internal::UpdateUserChannelPermissionsRequest;
use model_notifications::CommonChannelMetadata;
use models_permissions::share_permission::channel_share_permission::UpdateOperation;
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
    description = "adds a list of participants to the channel, user must be an owner or an admin",
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
#[tracing::instrument(skip(ctx, channel_participants))]
pub async fn handler(
    State(ctx): State<AppState>,
    Cached(ChannelAdmin(channel_admin)): Cached<ChannelAdmin>,
    Cached(ChannelName(channel_name)): Cached<ChannelName>,
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

    let participants = to_lowercase(&req.participants);

    for participant in participants.iter() {
        add_participant(
            &ctx.db,
            AddParticipantOptions {
                channel_id: &channel_id,
                user_id: participant.as_str(),
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
    }

    let start = std::time::Instant::now();
    ctx.document_storage_service_client
        .update_user_channel_permissions(UpdateUserChannelPermissionsRequest {
            user_ids: participants.clone(),
            channel_id: channel_id.to_string(),
            operation: UpdateOperation::Add,
        })
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "unable to add permissions for channel items");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "unable to remove participant from channel".to_string(),
            )
        })?;
    tracing::info!(elapsed=?start.elapsed(), "added user channel permissions");

    // There should always be participants, but better safe than sorry
    if !participants.is_empty() {
        let metadata = CommonChannelMetadata {
            channel_type,
            channel_name: channel_name.clone(),
        };
        comms_notification::dispatch_notifications_for_invite(
            &ctx,
            &channel_id,
            channel_admin.context.user_id.as_str(),
            req.participants.clone(),
            metadata.clone(),
        )
        .await
        .inspect_err(|e| {
            tracing::error!(error=?e, "unable to send channel invite notification");
        })
        .ok();

        if channel_type == ChannelType::Private && !channel_participants.is_empty() {
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
    }

    Ok(StatusCode::OK)
}
