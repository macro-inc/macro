use crate::api::{context::AppState, extractors::ChannelName};
use crate::notification as comms_notification;
use crate::{
    api::extractors::{ChannelId, ChannelMember, ChannelParticipants, ChannelTypeExtractor},
    service::{
        self,
        sender::notify::{self, AttachmentUpdate},
    },
};
use anyhow::Result;
use axum::{
    Json,
    extract::{self, State},
    http::StatusCode,
};
use axum_extra::extract::Cached;
use comms_db_client::model::Message;
use comms_db_client::{
    activity::upsert_activity::upsert_activity,
    channels::updated_at,
    messages::{add_attachments, create_message, create_message_mentions},
    model::{ActivityType, NewAttachment, SimpleMention},
};
use model::comms::ChannelParticipant;
use model::document_storage_service_internal::UpdateChannelSharePermissionRequest;
use model_notifications::CommonChannelMetadata;
use serde::{Deserialize, Serialize};
use std::time::Instant;
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct PostMessageRequest {
    pub content: String,
    pub mentions: Vec<SimpleMention>,
    pub thread_id: Option<Uuid>,
    pub attachments: Vec<NewAttachment>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct PostMessageResponse {
    pub id: String,
}

#[utoipa::path(
        post,
        tag = "channels",
        operation_id = "post_message",
        path = "/channels/{channel_id}/message",
        params(
            ("channel_id" = String, Path, description = "id of the channel")
        ),
        responses(
            (status = 201, body=PostMessageResponse),
            (status = 401, body=String),
            (status = 404, body=String),
            (status = 500, body=String),
        )
    )]
#[tracing::instrument(skip(ctx, channel_participants))]
pub async fn post_message_handler(
    State(ctx): State<AppState>,
    ChannelMember(channel_member): ChannelMember,
    Cached(ChannelParticipants(channel_participants)): Cached<ChannelParticipants>,
    Cached(ChannelName(channel_name)): Cached<ChannelName>,
    Cached(ChannelId(channel_id)): Cached<ChannelId>,
    Cached(ChannelTypeExtractor(channel_type)): Cached<ChannelTypeExtractor>,
    extract::Json(req): extract::Json<PostMessageRequest>,
) -> Result<(StatusCode, Json<PostMessageResponse>), (StatusCode, String)> {
    let mut connection = ctx.db.acquire().await.map_err(|e| {
        tracing::error!(error=?e, "unable to acquire connection");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "unable to acquire connection".to_string(),
        )
    })?;

    let message = create_message::create_message(
        &mut *connection,
        create_message::CreateMessageOptions {
            channel_id,
            sender_id: channel_member.context.user_id.clone(),
            content: req.content.clone(),
            thread_id: req.thread_id,
        },
    )
    .await
    .map_err(|e| {
        tracing::error!(error=?e, "unable to create message");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "unable to create message".to_string(),
        )
    })?;

    updated_at::updated_at(&mut *connection, &message.channel_id)
        .await
        .inspect_err(|e| {
            tracing::error!(error=?e, "unable to update channel updated_at");
        })
        .ok();

    create_message_mentions::create_message_mentions(
        &mut *connection,
        create_message_mentions::CreateMessageMentionOptions {
            message_id: message.id,
            mentions: req.mentions.clone(),
        },
    )
    .await
    .map_err(|e| {
        tracing::error!(error=?e, "unable to create mentions");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "unable to create mentions".to_string(),
        )
    })
    .ok();

    // TODO: start -- the following two blocks are duplicated and cope, I don't want to fix in my current pr
    // but either myself or someone else needs to fix this - @synoet

    // If there are attachments we need to update channel share permissions through DSS
    if !req.attachments.is_empty() {
        let document_storage_service_client = ctx.document_storage_service_client.clone();
        let channel_id: uuid::Uuid = channel_id;
        let attachments = req.attachments.clone();
        let user_id = message.sender_id.clone();
        let db = ctx.db.clone();
        tokio::spawn(async move {
            tracing::trace!(attachments=?attachments, "updating channel share permissions for attachments");
            let channel_info = match comms_db_client::channels::get_channel_info::get_channel_info(
                &db,
                &channel_id,
            )
            .await
            {
                Ok(info) => info,
                Err(e) => {
                    tracing::error!(error=?e, "unable to get channel info");
                    return;
                }
            };

            for attachment in attachments {
                if attachment.entity_type == "user" {
                    continue;
                }
                document_storage_service_client
                    .update_channel_share_permission(UpdateChannelSharePermissionRequest {
                        user_id: user_id.clone(),
                        channel_id: channel_id.to_string().clone(),
                        item_id: attachment.entity_id,
                        item_type: attachment.entity_type,
                        channel_type: channel_info.channel_type.to_string(),
                    })
                    .await
                    .unwrap_or_else(|e| {
                        tracing::error!("unable to update channel share permission: {e}");
                    });
            }
        });
    }

    // If there are mentions we need to update channel share permissions through DSS
    if !req.mentions.is_empty() {
        let document_storage_service_client = ctx.document_storage_service_client.clone();
        let channel_id: uuid::Uuid = channel_id;
        let mentions = req.mentions.clone();
        let user_id = message.sender_id.clone();
        let db = ctx.db.clone();
        tokio::spawn(async move {
            tracing::trace!(mentions=?mentions, "updating channel share permissions for mentions");
            let channel_info = match comms_db_client::channels::get_channel_info::get_channel_info(
                &db,
                &channel_id,
            )
            .await
            {
                Ok(info) => info,
                Err(e) => {
                    tracing::error!(error=?e, "unable to get channel info");
                    return;
                }
            };
            for mention in mentions {
                if mention.entity_type == "user" {
                    continue;
                }
                document_storage_service_client
                    .update_channel_share_permission(UpdateChannelSharePermissionRequest {
                        user_id: user_id.clone(),
                        channel_id: channel_id.to_string().clone(),
                        item_id: mention.entity_id,
                        item_type: mention.entity_type,
                        channel_type: channel_info.channel_type.to_string(),
                    })
                    .await
                    .unwrap_or_else(|e| {
                        tracing::error!("unable to update channel share permission: {e}");
                    });
            }
        });
    }

    // TODO: -- end

    let participants: Vec<String> = channel_participants
        .clone()
        .iter()
        .map(|p| p.user_id.clone())
        .collect();

    let start_time = Instant::now();
    notify::notify_message(&ctx, message.clone(), &participants)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "unable to notify message");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "failed to deliver message".to_string(),
            )
        })?;
    tracing::debug!("message notification took {:?}ms", start_time.elapsed());

    let start_time = Instant::now();
    upsert_activity(
        &ctx.db,
        &channel_member.context.user_id,
        &channel_id,
        &ActivityType::Interact,
    )
    .await
    .inspect_err(|err| {
        tracing::error!(error=?err, "unable to upsert activity for message");
    })
    .ok();
    tracing::debug!("activity upsert took {:?}ms", start_time.elapsed());

    let start_time = Instant::now();
    let maybe_attachments = add_attachments::add_attachments_to_message(
        &ctx.db,
        &message.id,
        &channel_id,
        req.attachments,
    )
    .await
    .map_err(|err| {
        tracing::error!(error=?err, "unable to add attachments to message");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "unable to add attachments to message".to_string(),
        )
    })
    .ok();
    tracing::debug!("attachments upsert took {:?}ms", start_time.elapsed());

    if let Some(attachments) = maybe_attachments.filter(|attachments| !attachments.is_empty()) {
        let start_time = Instant::now();
        notify::notify_attachments(
            &ctx,
            AttachmentUpdate {
                channel_id,
                message_id: message.id,
                attachments,
            },
        )
        .await
        .map_err(|err| {
            tracing::error!(error=?err, "failed to notify about attachment");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "failed to deliver message".to_string(),
            )
        })?;
        tracing::debug!("attachment notification took {:?}ms", start_time.elapsed());
    }

    dispatch_notification_task(
        &ctx,
        channel_id,
        CommonChannelMetadata {
            channel_type,
            channel_name: channel_name.clone(),
        },
        channel_participants.clone(),
        message.clone(),
        req.mentions.clone(),
    );

    service::search::send_channel_message_to_search_extractor_queue(
        &ctx.sqs_client,
        channel_id,
        message.id,
    );

    Ok((
        StatusCode::OK,
        Json(PostMessageResponse {
            id: message.id.to_string(),
        }),
    ))
}

pub fn dispatch_notification_task(
    ctx: &AppState,
    channel_id: Uuid,
    channel_metadata: CommonChannelMetadata,
    participants: Vec<ChannelParticipant>,
    message: Message,
    mentions: Vec<SimpleMention>,
) {
    // Safe to clone, context conains a bunch of Arcs
    let api_context = ctx.clone();

    tokio::spawn(async move {
        if let Err(e) = comms_notification::dispatch_notifications_for_message(
            &api_context,
            &channel_id,
            channel_metadata,
            participants,
            message,
            mentions,
        )
        .await
        {
            tracing::error!(error = ?e, "Failed to dispatch notifications");
        }
    });
}
