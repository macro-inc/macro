use crate::domain::models::{
    ChannelMessage, CountedReaction, MessageAttachment, ThreadInfo, ThreadReply,
};
use crate::domain::ports::{ChannelMessagesErr, ChannelMessagesService};
use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::get,
};
use chrono::{DateTime, Utc};
use model_error_response::ErrorResponse;
use model_user::axum_extractor::MacroUserExtractor;
use models_pagination::{CreatedAt, CursorExtractor, PaginatedOpaqueCursor, TypeEraseCursor};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

/// State for the channels router.
pub struct ChannelsRouterState<S> {
    service: Arc<S>,
}

impl<S> Clone for ChannelsRouterState<S> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
        }
    }
}

impl<S: ChannelMessagesService> ChannelsRouterState<S> {
    /// Create a new router state wrapping the service.
    pub fn new(service: S) -> Self {
        Self {
            service: Arc::new(service),
        }
    }
}

/// Query parameters for the messages endpoint.
#[derive(Debug, Default, Deserialize)]
pub struct Params {
    /// Page size. Clamped to [1, 100], defaults to 50.
    #[serde(default)]
    limit: Option<u16>,
}

/// Create the channels router.
pub fn channels_router<S, T>(state: ChannelsRouterState<S>) -> Router<T>
where
    S: ChannelMessagesService,
    T: Send + Sync,
{
    Router::new()
        .route(
            "/{channel_id}/messages",
            get(get_channel_messages_handler::<S>),
        )
        .with_state(state)
}

/// Handler for `GET /channels/:channel_id/messages`.
#[utoipa::path(
    get,
    operation_id = "get_channel_messages",
    path = "/channels/{channel_id}/messages",
    params(
        ("channel_id" = Uuid, Path, description = "Channel ID"),
        ("limit" = Option<u16>, Query, description = "Page size (1-100, default 50)"),
        ("cursor" = Option<String>, Query, description = "Base64 encoded cursor value"),
    ),
    responses(
        (status = 200, body = ApiChannelMessagesPage),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
async fn get_channel_messages_handler<S: ChannelMessagesService>(
    State(state): State<ChannelsRouterState<S>>,
    MacroUserExtractor { .. }: MacroUserExtractor,
    Path(channel_id): Path<Uuid>,
    Query(params): Query<Params>,
    cursor: CursorExtractor<Uuid, CreatedAt, ()>,
) -> Result<Json<PaginatedOpaqueCursor<ApiChannelMessage>>, ChannelsHandlerErr> {
    let limit = params.limit.unwrap_or(50);
    let query = cursor.into_query(CreatedAt, ());

    let page = state
        .service
        .get_channel_messages(channel_id, query, limit)
        .await?;

    Ok(Json(page.type_erase().map(ApiChannelMessage::from)))
}

// -- API response types --

/// Paginated response of channel messages.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct ApiChannelMessagesPage {
    /// Messages on this page.
    items: Vec<ApiChannelMessage>,
    /// Cursor for the next page, null if no more pages.
    next_cursor: Option<String>,
}

/// A top-level channel message with thread info.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct ApiChannelMessage {
    /// Message id.
    id: Uuid,
    /// Channel id.
    channel_id: Uuid,
    /// Sender user id.
    sender_id: String,
    /// Message content.
    content: String,
    /// When the message was created.
    created_at: DateTime<Utc>,
    /// When the message was last updated.
    updated_at: DateTime<Utc>,
    /// When the message was edited.
    edited_at: Option<DateTime<Utc>>,
    /// When the message was soft-deleted.
    deleted_at: Option<DateTime<Utc>>,
    /// Thread metadata and preview.
    thread: ApiThreadInfo,
    /// Reactions on this message.
    reactions: Vec<ApiCountedReaction>,
    /// Attachments on this message.
    attachments: Vec<ApiMessageAttachment>,
}

impl From<ChannelMessage> for ApiChannelMessage {
    fn from(m: ChannelMessage) -> Self {
        Self {
            id: m.id,
            channel_id: m.channel_id,
            sender_id: m.sender_id,
            content: m.content,
            created_at: m.created_at,
            updated_at: m.updated_at,
            edited_at: m.edited_at,
            deleted_at: m.deleted_at,
            thread: ApiThreadInfo::from(m.thread),
            reactions: m
                .reactions
                .into_iter()
                .map(ApiCountedReaction::from)
                .collect(),
            attachments: m
                .attachments
                .into_iter()
                .map(ApiMessageAttachment::from)
                .collect(),
        }
    }
}

/// Thread metadata and preview replies.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct ApiThreadInfo {
    /// Total reply count.
    reply_count: i64,
    /// Timestamp of the latest reply.
    latest_reply_at: Option<DateTime<Utc>>,
    /// Last N replies for thread preview.
    preview: Vec<ApiThreadReply>,
}

impl From<ThreadInfo> for ApiThreadInfo {
    fn from(t: ThreadInfo) -> Self {
        Self {
            reply_count: t.reply_count,
            latest_reply_at: t.latest_reply_at,
            preview: t.preview.into_iter().map(ApiThreadReply::from).collect(),
        }
    }
}

/// A thread reply shown in preview.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct ApiThreadReply {
    /// Reply id.
    id: Uuid,
    /// Sender user id.
    sender_id: String,
    /// Reply content.
    content: String,
    /// When the reply was created.
    created_at: DateTime<Utc>,
    /// When the reply was last updated.
    updated_at: DateTime<Utc>,
    /// When the reply was edited.
    edited_at: Option<DateTime<Utc>>,
    /// Reactions on this reply.
    reactions: Vec<ApiCountedReaction>,
    /// Attachments on this reply.
    attachments: Vec<ApiMessageAttachment>,
}

impl From<ThreadReply> for ApiThreadReply {
    fn from(r: ThreadReply) -> Self {
        Self {
            id: r.id,
            sender_id: r.sender_id,
            content: r.content,
            created_at: r.created_at,
            updated_at: r.updated_at,
            edited_at: r.edited_at,
            reactions: r
                .reactions
                .into_iter()
                .map(ApiCountedReaction::from)
                .collect(),
            attachments: r
                .attachments
                .into_iter()
                .map(ApiMessageAttachment::from)
                .collect(),
        }
    }
}

/// A reaction with emoji and user list.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct ApiCountedReaction {
    /// The emoji string.
    emoji: String,
    /// User ids who added this reaction.
    users: Vec<String>,
}

impl From<CountedReaction> for ApiCountedReaction {
    fn from(r: CountedReaction) -> Self {
        Self {
            emoji: r.emoji,
            users: r.users,
        }
    }
}

/// An attachment on a message.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct ApiMessageAttachment {
    /// Attachment id.
    id: Uuid,
    /// Type of entity.
    entity_type: String,
    /// Entity id.
    entity_id: String,
    /// When the attachment was created.
    created_at: DateTime<Utc>,
}

impl From<MessageAttachment> for ApiMessageAttachment {
    fn from(a: MessageAttachment) -> Self {
        Self {
            id: a.id,
            entity_type: a.entity_type,
            entity_id: a.entity_id,
            created_at: a.created_at,
        }
    }
}

// -- Error types --

/// Errors from the channels handler.
#[derive(Debug, thiserror::Error)]
pub enum ChannelsHandlerErr {
    /// Internal server error.
    #[error("An internal server error occurred")]
    Internal(#[from] ChannelMessagesErr),
}

impl IntoResponse for ChannelsHandlerErr {
    fn into_response(self) -> axum::response::Response {
        tracing::error!(error=?self, "channels handler error");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                message: "An internal server error occurred",
            }),
        )
            .into_response()
    }
}
