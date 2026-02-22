#[cfg(test)]
mod test;

use crate::domain::models::{
    ChannelAttachment, ChannelMessage, ChannelParticipant, CountedReaction, MessageAttachment,
    MessagePageDirection, ParticipantRole, ThreadInfo, ThreadReply,
};
use crate::domain::ports::{
    ChannelAccessCheck, ChannelMessagesErr, ChannelMessagesPage, ChannelMessagesQueryResult,
    ChannelMessagesService,
};
use axum::{
    Json, Router,
    extract::{FromRequestParts, Path, Query, State},
    http::{StatusCode, request::Parts},
    response::IntoResponse,
    routing::get,
};
use chrono::{DateTime, Utc};
use model_error_response::ErrorResponse;
use model_user::axum_extractor::MacroUserExtractor;
use models_pagination::{
    Base64Str, BidirectionalCursor, BidirectionalCursorExtractor, CreatedAt, Cursor,
    CursorExtractor, CursorVal, PaginatedOpaqueCursor, Query as PaginationQuery, TypeEraseCursor,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

/// State for the channels router.
pub struct ChannelsRouterState<S, A> {
    service: Arc<S>,
    access: Arc<A>,
}

impl<S, A> Clone for ChannelsRouterState<S, A> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            access: self.access.clone(),
        }
    }
}

impl<S: ChannelMessagesService, A: ChannelAccessCheck> ChannelsRouterState<S, A> {
    /// Create a new router state wrapping the service and access checker.
    pub fn new(service: S, access: A) -> Self {
        Self {
            service: Arc::new(service),
            access: Arc::new(access),
        }
    }
}

/// Verified channel member. Rejects the request if the authenticated user is not an active
/// participant in the channel identified by the `:channel_id` path parameter.
pub struct ChannelMember {
    /// The channel id from the path.
    pub channel_id: Uuid,
}

/// Rejection returned by the [`ChannelMember`] extractor.
#[derive(Debug)]
pub enum ChannelMemberRejection {
    /// The user is not authenticated.
    Unauthenticated,
    /// The `:channel_id` path parameter is missing or invalid.
    InvalidPath,
    /// The user is not a member of the channel.
    Forbidden,
    /// A database or internal error occurred.
    Internal,
}

impl IntoResponse for ChannelMemberRejection {
    fn into_response(self) -> axum::response::Response {
        let (status, message) = match self {
            Self::Unauthenticated => (StatusCode::UNAUTHORIZED, "Unauthorized"),
            Self::InvalidPath => (StatusCode::BAD_REQUEST, "Invalid channel_id"),
            Self::Forbidden => (StatusCode::FORBIDDEN, "Not a channel member"),
            Self::Internal => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "An internal server error occurred",
            ),
        };
        (status, Json(ErrorResponse { message })).into_response()
    }
}

#[axum::async_trait]
impl<S, A> FromRequestParts<ChannelsRouterState<S, A>> for ChannelMember
where
    S: ChannelMessagesService,
    A: ChannelAccessCheck,
{
    type Rejection = ChannelMemberRejection;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &ChannelsRouterState<S, A>,
    ) -> Result<Self, Self::Rejection> {
        let user = MacroUserExtractor::from_request_parts(parts, state)
            .await
            .map_err(|_| ChannelMemberRejection::Unauthenticated)?;

        let Path(channel_id) = Path::<Uuid>::from_request_parts(parts, state)
            .await
            .map_err(|_| ChannelMemberRejection::InvalidPath)?;

        let is_member = state
            .access
            .is_channel_member(channel_id, &user.user_context.user_id)
            .await
            .map_err(|_| ChannelMemberRejection::Internal)?;

        if !is_member {
            return Err(ChannelMemberRejection::Forbidden);
        }

        Ok(ChannelMember { channel_id })
    }
}

/// Query parameters for the messages endpoint.
#[derive(Debug, Default, Deserialize)]
pub struct Params {
    /// Page size. Clamped to [1, 100], defaults to 50.
    #[serde(default)]
    limit: Option<u16>,
    /// When set, return a centered window of messages around this message id
    /// instead of cursor-paginated results.
    #[serde(default)]
    load_around_message_id: Option<Uuid>,
}

fn parse_messages_query(
    cursor: BidirectionalCursorExtractor<Uuid, CreatedAt, ()>,
) -> (
    PaginationQuery<Uuid, CreatedAt, ()>,
    MessagePageDirection,
    bool,
) {
    match cursor {
        BidirectionalCursorExtractor::Some(BidirectionalCursor::Next(cursor)) => (
            PaginationQuery::Cursor(cursor),
            MessagePageDirection::Older,
            true,
        ),
        BidirectionalCursorExtractor::Some(BidirectionalCursor::Previous(cursor)) => (
            PaginationQuery::Cursor(cursor),
            MessagePageDirection::Newer,
            true,
        ),
        BidirectionalCursorExtractor::None => (
            PaginationQuery::Sort(CreatedAt, ()),
            MessagePageDirection::Older,
            false,
        ),
    }
}

fn cursor_from_first_message(
    page: &ChannelMessagesPage,
    limit: u16,
) -> Option<Cursor<Uuid, CursorVal<CreatedAt>, ()>> {
    page.items.first().map(|first| Cursor {
        id: first.id,
        limit: usize::from(limit),
        val: CursorVal {
            sort_type: CreatedAt,
            last_val: first.created_at,
        },
        filter: (),
    })
}

/// Create the channels router.
pub fn channels_router<S, A, T>(state: ChannelsRouterState<S, A>) -> Router<T>
where
    S: ChannelMessagesService,
    A: ChannelAccessCheck,
    T: Send + Sync,
{
    Router::new()
        .route(
            "/:channel_id/messages",
            get(get_channel_messages_handler::<S, A>),
        )
        .route(
            "/:channel_id/attachments",
            get(get_channel_attachments_handler::<S, A>),
        )
        .route(
            "/:channel_id/participants",
            get(get_channel_participants_handler::<S, A>),
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
        ("cursor" = Option<String>, Query, description = "Base64 encoded cursor value for older messages"),
        ("previous_cursor" = Option<String>, Query, description = "Base64 encoded cursor value for newer messages"),
        ("load_around_message_id" = Option<Uuid>, Query, description = "Return a centered window around this message ID"),
    ),
    responses(
        (status = 200, body = ApiChannelMessagesPage),
        (status = 400, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn get_channel_messages_handler<S: ChannelMessagesService, A: ChannelAccessCheck>(
    State(state): State<ChannelsRouterState<S, A>>,
    member: ChannelMember,
    Query(params): Query<Params>,
    cursor: BidirectionalCursorExtractor<Uuid, CreatedAt, ()>,
) -> Result<Json<ApiChannelMessagesPage>, ChannelsHandlerErr> {
    let limit = params.limit.unwrap_or(50).clamp(1, 100);
    let (query, direction, has_cursor) = parse_messages_query(cursor);

    let (page, has_more_newer) = match params.load_around_message_id {
        Some(message_id) => {
            let page = state
                .service
                .get_channel_messages_around(member.channel_id, message_id, limit)
                .await?;
            (page, false)
        }
        None => {
            let ChannelMessagesQueryResult {
                page,
                has_more_newer,
            } = state
                .service
                .get_channel_messages(member.channel_id, query, direction, limit)
                .await?;
            (page, has_more_newer)
        }
    };

    let previous_cursor = if params.load_around_message_id.is_some() || !has_cursor {
        None
    } else {
        match cursor_from_first_message(&page, limit) {
            Some(first_cursor) => {
                let has_previous = match direction {
                    MessagePageDirection::Older => true,
                    MessagePageDirection::Newer => has_more_newer,
                };

                has_previous.then(|| Base64Str::encode_json(first_cursor).type_erase())
            }
            None => None,
        }
    };

    let page = page.type_erase().map(ApiChannelMessage::from);
    Ok(Json(ApiChannelMessagesPage {
        items: page.items,
        next_cursor: page.next_cursor,
        previous_cursor,
    }))
}

/// Handler for `GET /channels/:channel_id/attachments`.
#[utoipa::path(
    get,
    operation_id = "get_channel_attachments",
    path = "/channels/{channel_id}/attachments",
    params(
        ("channel_id" = Uuid, Path, description = "Channel ID"),
        ("limit" = Option<u16>, Query, description = "Page size (1-100, default 50)"),
        ("cursor" = Option<String>, Query, description = "Base64 encoded cursor value"),
    ),
    responses(
        (status = 200, body = ApiChannelAttachmentsPage),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn get_channel_attachments_handler<S: ChannelMessagesService, A: ChannelAccessCheck>(
    State(state): State<ChannelsRouterState<S, A>>,
    member: ChannelMember,
    Query(params): Query<Params>,
    cursor: CursorExtractor<Uuid, CreatedAt, ()>,
) -> Result<Json<PaginatedOpaqueCursor<ApiChannelAttachment>>, ChannelsHandlerErr> {
    let limit = params.limit.unwrap_or(50);
    let query = cursor.into_query(CreatedAt, ());

    let page = state
        .service
        .get_channel_attachments(member.channel_id, query, limit)
        .await?;

    Ok(Json(page.type_erase().map(ApiChannelAttachment::from)))
}

/// Handler for `GET /channels/:channel_id/participants`.
#[utoipa::path(
    get,
    operation_id = "get_channel_participants",
    path = "/channels/{channel_id}/participants",
    params(
        ("channel_id" = Uuid, Path, description = "Channel ID"),
    ),
    responses(
        (status = 200, body = Vec<ApiChannelParticipant>),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn get_channel_participants_handler<S: ChannelMessagesService, A: ChannelAccessCheck>(
    State(state): State<ChannelsRouterState<S, A>>,
    member: ChannelMember,
) -> Result<Json<Vec<ApiChannelParticipant>>, ChannelsHandlerErr> {
    let participants = state
        .service
        .get_channel_participants(member.channel_id)
        .await?;

    Ok(Json(
        participants
            .into_iter()
            .map(ApiChannelParticipant::from)
            .collect(),
    ))
}

/// Paginated response of channel messages.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct ApiChannelMessagesPage {
    /// Messages on this page.
    items: Vec<ApiChannelMessage>,
    /// Cursor for the next page, null if no more pages.
    next_cursor: Option<String>,
    /// Cursor for the previous page, null if no newer page exists.
    previous_cursor: Option<String>,
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

/// Paginated response of channel attachments.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct ApiChannelAttachmentsPage {
    /// Attachments on this page.
    items: Vec<ApiChannelAttachment>,
    /// Cursor for the next page, null if no more pages.
    next_cursor: Option<String>,
}

/// A channel-level attachment.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct ApiChannelAttachment {
    /// Attachment id.
    id: Uuid,
    /// Channel id.
    channel_id: Uuid,
    /// Message id this attachment belongs to.
    message_id: Uuid,
    /// Type of entity.
    entity_type: String,
    /// Entity id.
    entity_id: String,
    /// Width (for images).
    width: Option<i32>,
    /// Height (for images).
    height: Option<i32>,
    /// When the attachment was created.
    created_at: DateTime<Utc>,
}

impl From<ChannelAttachment> for ApiChannelAttachment {
    fn from(a: ChannelAttachment) -> Self {
        Self {
            id: a.id,
            channel_id: a.channel_id,
            message_id: a.message_id,
            entity_type: a.entity_type,
            entity_id: a.entity_id,
            width: a.width,
            height: a.height,
            created_at: a.created_at,
        }
    }
}

/// Participant role in a channel.
#[derive(Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ApiParticipantRole {
    /// Channel owner.
    Owner,
    /// Channel admin.
    Admin,
    /// Regular member.
    Member,
}

impl From<ParticipantRole> for ApiParticipantRole {
    fn from(r: ParticipantRole) -> Self {
        match r {
            ParticipantRole::Owner => Self::Owner,
            ParticipantRole::Admin => Self::Admin,
            ParticipantRole::Member => Self::Member,
        }
    }
}

/// A channel participant.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct ApiChannelParticipant {
    /// Channel id.
    channel_id: Uuid,
    /// User id.
    user_id: String,
    /// Role in the channel.
    role: ApiParticipantRole,
    /// When the user joined.
    joined_at: DateTime<Utc>,
}

impl From<ChannelParticipant> for ApiChannelParticipant {
    fn from(p: ChannelParticipant) -> Self {
        Self {
            channel_id: p.channel_id,
            user_id: p.user_id,
            role: ApiParticipantRole::from(p.role),
            joined_at: p.joined_at,
        }
    }
}

/// Errors from the channels handler.
#[derive(Debug, thiserror::Error)]
pub enum ChannelsHandlerErr {
    /// Bad request.
    #[error("{0}")]
    BadRequest(&'static str),
    /// Internal server error.
    #[error("An internal server error occurred")]
    Internal(#[from] ChannelMessagesErr),
}

impl IntoResponse for ChannelsHandlerErr {
    fn into_response(self) -> axum::response::Response {
        match self {
            ChannelsHandlerErr::BadRequest(message) => {
                (StatusCode::BAD_REQUEST, Json(ErrorResponse { message })).into_response()
            }
            ChannelsHandlerErr::Internal(err) => match err {
                ChannelMessagesErr::MessageNotFound(id) => {
                    tracing::warn!(message_id=?id, "message not found");
                    (
                        StatusCode::NOT_FOUND,
                        Json(ErrorResponse {
                            message: "Message not found",
                        }),
                    )
                        .into_response()
                }
                ChannelMessagesErr::Repo(repo_err) => {
                    tracing::error!(error=?repo_err, "channels handler error");
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(ErrorResponse {
                            message: "An internal server error occurred",
                        }),
                    )
                        .into_response()
                }
            },
        }
    }
}
