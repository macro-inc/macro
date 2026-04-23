use crate::{
    api::{
        context::AppState,
        extractors::{ChannelId, ChannelParticipants, MessageId, MessageSender},
    },
    service::{
        self,
        sender::notify::{self, AttachmentData, WithNonce},
    },
};
use anyhow::Result;
use axum::{
    extract::{self, Path, State},
    http::StatusCode,
};
use axum_extra::extract::Cached;
use comms_db_client::{
    activity::upsert_activity::upsert_activity,
    messages::add_attachments,
    messages::patch_message::{patch_message, patch_message_attachments},
    model::{ActivityType, NewAttachment},
};
use macro_user_id::cowlike::CowLike;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct PatchMessageRequest {
    pub content: Option<String>,
    pub attachment_ids_to_delete: Option<Vec<String>>,
    pub attachments_to_add: Option<Vec<NewAttachment>>,
    pub nonce: Option<String>,
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
        path = "/comms/channels/{channel_id}/message/{message_id}",
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

    let attachment_ids_to_delete = req.attachment_ids_to_delete.clone().unwrap_or_default();
    let attachments_to_add = req.attachments_to_add.clone().unwrap_or_default();
    let attachments_changed =
        !attachment_ids_to_delete.is_empty() || !attachments_to_add.is_empty();

    if attachments_changed {
        patch_message_attachments_state(
            &app_state,
            attachment_ids_to_delete,
            attachments_to_add,
            message_id,
            channel_id,
            &message_sender.user_id,
            req.nonce.as_deref(),
        )
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
        let participants: Vec<_> = if let Some(thread_id) = message.thread_id.as_ref() {
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
            participants.iter().map(|p| p.user_id.copied()).collect()
        };
        notify::notify_message(
            &app_state,
            WithNonce {
                data: &message,
                nonce: req.nonce.as_deref(),
            },
            &participants,
        )
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
            &params.message_id,
        );
    }

    if attachments_changed && req.content.is_none() {
        upsert_activity(
            &app_state.db,
            &message_sender.user_id,
            &channel_id,
            &ActivityType::Interact,
        )
        .await
        .inspect_err(|err| {
            tracing::error!(error=?err, "unable to upsert activity for message attachment patch");
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

#[tracing::instrument(skip(ctx, attachment_ids_to_delete, attachments, user_id), err(Debug))]
async fn patch_message_attachments_state(
    ctx: &AppState,
    attachment_ids_to_delete: Vec<String>,
    attachments: Vec<NewAttachment>,
    message_id: Uuid,
    channel_id: Uuid,
    user_id: &str,
    nonce: Option<&str>,
) -> Result<(), (StatusCode, String)> {
    let attachment_uuids = attachment_ids_to_delete
        .iter()
        .map(|id| Uuid::parse_str(id))
        .collect::<Result<Vec<Uuid>, _>>()
        .map_err(|err| {
            tracing::error!(error=?err, "unable to parse attachment ids");
            (StatusCode::BAD_REQUEST, err.to_string())
        })?;

    let existing_attachments =
        comms_db_client::attachments::get_attachments::get_attachments_by_message_id(
            &ctx.db, message_id,
        )
        .await
        .map_err(|err| {
            tracing::error!(error=?err, "unable to fetch attachments");
            (StatusCode::INTERNAL_SERVER_ERROR, err.to_string())
        })?;

    let attachments_to_delete = existing_attachments
        .iter()
        .filter(|a| attachment_uuids.contains(&a.id))
        .cloned()
        .collect::<Vec<_>>();

    if attachments_to_delete.len() != attachment_uuids.len() {
        tracing::error!(attachment_ids=?attachment_uuids, "some attachments were not found");
    }

    let fetched_attachment_ids: Vec<Uuid> = attachments_to_delete.iter().map(|a| a.id).collect();
    let fetched_attachments_entity_ids: Vec<String> = attachments_to_delete
        .iter()
        .map(|a| a.entity_id.clone())
        .collect();

    if !fetched_attachment_ids.is_empty() {
        comms_db_client::attachments::delete_attachments::delete_attachments_by_ids(
            &ctx.db,
            fetched_attachment_ids,
        )
        .await
        .map_err(|err| {
            tracing::error!(error=?err, "unable to delete attachments");
            (StatusCode::INTERNAL_SERVER_ERROR, err.to_string())
        })?;

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
    }

    if !attachments.is_empty() {
        add_attachments::add_attachments_to_message(
            &ctx.db,
            &message_id,
            &channel_id,
            attachments.clone(),
        )
        .await
        .map_err(|err| {
            tracing::error!(error=?err, "unable to add attachments to message");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "unable to add attachments to message".to_string(),
            )
        })?;
    }

    let items_to_share: Vec<(String, String)> = attachments
        .iter()
        .filter(|a| a.entity_type != "user")
        .map(|a| (a.entity_id.clone(), a.entity_type.clone()))
        .collect();

    if !items_to_share.is_empty() {
        let channel_id_str = channel_id.to_string();
        let user_id = user_id.to_owned();
        let db = ctx.db.clone();
        let entity_access_service = ctx.entity_access_service.clone();
        tokio::spawn(async move {
            super::post_message::update_channel_share_permissions_for_items(
                &db,
                &*entity_access_service,
                &user_id,
                &channel_id_str,
                items_to_share,
            )
            .await;
        });
    }

    let all_attachments =
        comms_db_client::attachments::get_attachments::get_attachments_by_message_id(
            &ctx.db, message_id,
        )
        .await
        .map_err(|err| {
            tracing::error!(error=?err, "unable to fetch attachments after patch");
            (StatusCode::INTERNAL_SERVER_ERROR, err.to_string())
        })?;

    notify::notify_attachments(
        ctx,
        WithNonce {
            data: AttachmentData {
                channel_id: &channel_id,
                message_id: &message_id,
                attachments: &all_attachments,
            },
            nonce,
        },
    )
    .await
    .map_err(|err| {
        tracing::error!(error=?err, "unable to notify attachments");
        (StatusCode::INTERNAL_SERVER_ERROR, err.to_string())
    })?;

    patch_message_attachments(&ctx.db, message_id, all_attachments)
        .await
        .map_err(|err| {
            tracing::error!(error=?err, "unable to patch message attachments");
            (StatusCode::INTERNAL_SERVER_ERROR, err.to_string())
        })?;

    Ok(())
}
