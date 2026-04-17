use crate::api::context::ChannelImpl;
use crate::api::{context::AppState, extractors::ChannelName};
use crate::channel_permissions;
use crate::notification as comms_notification;
use crate::service::sender::notify::WithNonce;
use crate::{
    api::extractors::{ChannelId, ChannelMember, ChannelParticipants, ChannelTypeExtractor},
    service::{
        self,
        sender::notify::{self, AttachmentData},
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
use doppleganger::Mirror;
use macro_user_id::cowlike::CowLike;
use model::comms::ChannelParticipant;
use model_notifications::CommonChannelMetadata;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::time::Instant;
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct PostMessageRequest {
    pub content: String,
    pub mentions: Vec<SimpleMention>,
    pub thread_id: Option<Uuid>,
    pub attachments: Vec<NewAttachment>,
    pub nonce: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct PostMessageResponse {
    pub id: String,
    pub nonce: Option<String>,
}

#[utoipa::path(
        post,
        tag = "channels",
        operation_id = "post_message",
        path = "/comms/channels/{channel_id}/message",
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
    Cached(ChannelName(channel_name, ..)): Cached<ChannelName<ChannelImpl>>,
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

    // Update channel share permissions for attachments and mentions
    let items_to_share: Vec<(String, String)> = req
        .attachments
        .iter()
        .filter(|a| a.entity_type != "user")
        .map(|a| (a.entity_id.clone(), a.entity_type.clone()))
        .chain(
            req.mentions
                .iter()
                .filter(|m| m.entity_type != "user")
                .map(|m| (m.entity_id.clone(), m.entity_type.clone())),
        )
        .collect();

    if !items_to_share.is_empty() {
        let channel_id_str = channel_id.to_string();
        let user_id = message.sender_id.clone();
        let db = ctx.db.clone();
        let entity_access_service = ctx.entity_access_service.clone();
        tokio::spawn(async move {
            update_channel_share_permissions_for_items(
                &db,
                &*entity_access_service,
                user_id.0.as_ref(),
                &channel_id_str,
                items_to_share,
            )
            .await;
        });
    }

    let participants: Vec<_> = channel_participants
        .iter()
        .map(|p| p.user_id.copied())
        .collect();

    let start_time = Instant::now();
    notify::notify_message(
        &ctx,
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
            WithNonce {
                data: AttachmentData {
                    channel_id: &channel_id,
                    message_id: &message.id,
                    attachments: &attachments,
                },
                nonce: req.nonce.as_deref(),
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
            channel_type: model_notifications::ChannelType::mirror(channel_type),
            channel_name: channel_name.clone(),
        },
        <Vec<model::comms::ChannelParticipant>>::mirror(channel_participants),
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
            nonce: req.nonce.clone(),
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

/// Updates channel share permissions for a list of items shared in a message.
async fn update_channel_share_permissions_for_items(
    db: &PgPool,
    entity_access_service: &impl entity_access::domain::ports::EntityAccessService,
    user_id: &str,
    channel_id: &str,
    items: Vec<(String, String)>,
) {
    tracing::trace!(items=?items, "updating channel share permissions for items");
    for (item_id, item_type) in items {
        if let Err(e) = channel_permissions::update_channel_share_permission(
            db,
            entity_access_service,
            user_id,
            channel_id,
            &item_id,
            &item_type,
        )
        .await
        {
            tracing::error!(error=?e, "unable to update channel share permission");
        }
    }
}
