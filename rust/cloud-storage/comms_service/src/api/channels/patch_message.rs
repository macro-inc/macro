use crate::{
    api::{
        context::AppState,
        extractors::{ChannelId, ChannelParticipants, MessageId, MessageSender},
    },
    service::{self, sender::notify},
};
use anyhow::Result;
use axum::{
    extract::{self, Path, State},
    http::StatusCode,
};
use axum_extra::extract::Cached;
use comms_db_client::{
    activity::upsert_activity::upsert_activity,
    messages::patch_message::{patch_message, patch_message_attachments},
    model::ActivityType,
};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct PatchMessageRequest {
    pub content: Option<String>,
    pub attachment_ids_to_delete: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct PatchMessageParams {
    pub channel_id: String,
    pub message_id: String,
}

#[utoipa::path(
        patch,
        tag = "channels",
        operation_id = "patch_message",
        path = "/channels/{channel_id}/message/{message_id}",
        params(
            ("channel_id" = String, Path, description = "id of the channel"),
            ("message_id" = String, Path, description = "id of the message")
        ),
        responses(
            (status = 201, body=String),
            (status = 401, body=String),
            (status = 404, body=String),
            (status = 500, body=String),
        )
    )]
#[tracing::instrument(skip(app_state, participants))]
pub async fn patch_message_handler(
    State(app_state): State<AppState>,
    Cached(MessageSender(message_sender)): Cached<MessageSender>,
    Cached(ChannelId(channel_id)): Cached<ChannelId>,
    Cached(MessageId(message_id)): Cached<MessageId>,
    Cached(ChannelParticipants(participants)): Cached<ChannelParticipants>,
    Path(params): Path<PatchMessageParams>,
    extract::Json(req): extract::Json<PatchMessageRequest>,
) -> Result<(StatusCode, String), (StatusCode, String)> {
    tracing::info!("patch_message");

    if let Some(attachment_ids) = &req.attachment_ids_to_delete
        && !attachment_ids.is_empty()
    {
        delete_message_attachments(&app_state, attachment_ids.clone(), message_id, channel_id)
            .await?;
    }

    if let Some(content) = &req.content {
        let message = patch_message(&app_state.db, message_id, content)
            .await
            .map_err(|e| {
                tracing::error!(error=?e, "unable to patch message");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "unable to patch message".to_string(),
                )
            })?;

        let participants = participants;
        let participants: Vec<String> = if let Some(thread_id) = message.thread_id.as_ref() {
            comms_db_client::participants::get_participants::get_channel_participants_for_thread_id(
                &app_state.db,
                thread_id,
            )
            .await
            .map_err(|e| {
                tracing::error!(error=?e, "unable to get participants for thread");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Unable to get participants for thread".to_string(),
                )
            })?
        } else {
            participants.iter().map(|p| p.user_id.clone()).collect()
        };
        notify::notify_message(&app_state, message, &participants)
            .await
            .map_err(|e| {
                tracing::error!(error=?e, "unable to notify message");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "failed to deliver message".to_string(),
                )
            })?;

        upsert_activity(
            &app_state.db,
            &message_sender.user_id,
            &channel_id,
            &ActivityType::Interact,
        )
        .await
        .inspect_err(|err| {
            tracing::error!(error=?err, "unable to upsert activity for message");
        })
        .ok();

        service::search::send_channel_message_to_search_extractor_queue(
            &app_state.sqs_client,
            channel_id,
            params.message_id,
        );
    }

    Ok((StatusCode::OK, "message sent".to_string()))
}

#[tracing::instrument(skip(ctx))]
async fn delete_message_attachments(
    ctx: &AppState,
    attachment_ids: Vec<String>,
    message_id: Uuid,
    channel_id: Uuid,
) -> Result<(), (StatusCode, String)> {
    // Parse string IDs into UUIDs
    let attachment_uuids = attachment_ids
        .iter()
        .map(|id| Uuid::parse_str(id))
        .collect::<Result<Vec<Uuid>, _>>()
        .map_err(|err| {
            tracing::error!(error=?err, "unable to parse attachment ids");
            (StatusCode::BAD_REQUEST, err.to_string())
        })?;

    // Get all attachments for the message
    let attachments = comms_db_client::attachments::get_attachments::get_attachments_by_message_id(
        &ctx.db, message_id,
    )
    .await
    .map_err(|err| {
        tracing::error!(error=?err, "unable to fetch attachments");
        (StatusCode::INTERNAL_SERVER_ERROR, err.to_string())
    })?;

    // Filter attachments to only include those that are being deleted
    let attachments_to_delete = attachments
        .iter()
        .filter(|a| attachment_uuids.contains(&a.id))
        .cloned()
        .collect::<Vec<_>>();

    let remaining_attachments = attachments
        .iter()
        .filter(|a| !attachment_uuids.contains(&a.id))
        .cloned()
        .collect::<Vec<_>>();

    // If attachment_id is not in the list of attachments to delete, we need to log an error
    if attachments_to_delete.len() != attachment_uuids.len() {
        tracing::error!("some attachments were not found: {:?}", attachment_uuids);
    }

    // Extract validated attachment IDs
    let fetched_attachment_ids: Vec<Uuid> = attachments_to_delete.iter().map(|a| a.id).collect();
    let fetched_attachments_entity_ids: Vec<String> = attachments_to_delete
        .iter()
        .map(|a| a.entity_id.clone())
        .collect();

    // Delete attachments from database
    comms_db_client::attachments::delete_attachments::delete_attachments_by_ids(
        &ctx.db,
        fetched_attachment_ids,
    )
    .await
    .map_err(|err| {
        tracing::error!(error=?err, "unable to delete attachments");
        (StatusCode::INTERNAL_SERVER_ERROR, err.to_string())
    })?;

    // Remove entity mentions for attachments being removed from message
    comms_db_client::entity_mentions::delete_entity_mentions_by_entity(
        &ctx.db,
        fetched_attachments_entity_ids,
        message_id.to_string(),
    )
    .await
    .map_err(|err| {
        tracing::error!(error=?err, "unable to delete entity mentions");
        (StatusCode::INTERNAL_SERVER_ERROR, err.to_string())
    })?;

    // TODO: delete from sfs it's a static file attachment (image)

    // Notify about the remaining attachments
    let attachment_update = notify::AttachmentUpdate {
        channel_id,
        message_id,
        attachments: remaining_attachments.clone(),
    };
    notify::notify_attachments(ctx, attachment_update)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "unable to notify attachments");
            (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
        })?;

    patch_message_attachments(&ctx.db, message_id, remaining_attachments)
        .await
        .map_err(|err| {
            tracing::error!(error=?err, "unable to patch message attachments");
            (StatusCode::INTERNAL_SERVER_ERROR, err.to_string())
        })?;

    Ok(())
}
