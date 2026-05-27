#[cfg(test)]
mod test;

pub use crate::domain::models::{
    AddParticipantsRequest, CreateChannelRequest, CreateChannelResponse, DeleteMessageQuery,
    GetOrCreateChannelResponse, GetOrCreateDmRequest, GetOrCreatePrivateRequest,
    PatchChannelRequest, PatchMessageRequest, PostMessageRequest, PostMessageResponse,
    PostReactionRequest, PostTypingRequest, RemoveParticipantsRequest,
};
use crate::domain::models::{
    ChannelAttachment, ChannelAttachmentType, ChannelMessage, ChannelMessageKind,
    ChannelParticipant, CountedReaction, MessageAttachment, MessagePageDirection, ParticipantRole,
    ResolvedChannelMessage, ThreadInfo, ThreadReply,
};
pub use crate::domain::models::{ChannelMessageFilters, NotificationFilters};
use crate::domain::ports::{
    ChannelMessagesErr, ChannelMessagesPage, ChannelMessagesQueryResult, ChannelMutationErr,
    ChannelService,
};
use axum::{
    Json, Router,
    extract::{Extension, FromRef, Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{delete, get, patch, post},
};
use chrono::{DateTime, Utc};
use entity_access::{
    domain::{
        models::{
            AdminParticipantRole, EntityAccessReceipt, EntityPermission, MemberParticipantRole,
            OwnerParticipantRole, RequiredPermission,
        },
        ports::EntityAccessService,
    },
    inbound::axum_extractors::ChannelAccessLevelExtractor,
};
use macro_user_id::user_id::MacroUserIdStr;
use model_error_response::ErrorResponse;
use model_user::UserContext;
use models_pagination::{
    Base64Str, BidirectionalCursor, CreatedAt, Cursor, CursorOptionExt, CursorVal,
    CursorWithValAndFilter, PaginatedOpaqueCursor, Query as PaginationQuery, TypeEraseCursor,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

/// State for the channels router.
pub struct ChannelsRouterState<S, Svc> {
    service: Arc<S>,
    access_service: Arc<Svc>,
}

impl<S, Svc> Clone for ChannelsRouterState<S, Svc> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            access_service: self.access_service.clone(),
        }
    }
}

impl<S: ChannelService, Svc: EntityAccessService> ChannelsRouterState<S, Svc> {
    /// Create a router state wrapping the channel service and entity access service.
    pub fn new(service: S, access_service: Svc) -> Self {
        Self {
            service: Arc::new(service),
            access_service: Arc::new(access_service),
        }
    }
}

impl<S, Svc> FromRef<ChannelsRouterState<S, Svc>> for Arc<Svc> {
    fn from_ref(state: &ChannelsRouterState<S, Svc>) -> Self {
        state.access_service.clone()
    }
}

fn channel_id_from_receipt<T: RequiredPermission>(
    receipt: &EntityAccessReceipt<T>,
) -> Result<Uuid, ChannelsHandlerErr> {
    Uuid::parse_str(&receipt.entity().entity_id)
        .map_err(|_| ChannelsHandlerErr::BadRequest("Invalid channel_id"))
}

fn notification_user_id_from_receipt<T: RequiredPermission>(
    receipt: &EntityAccessReceipt<T>,
    filters: &ChannelMessageFilters,
) -> Result<Option<MacroUserIdStr<'static>>, ChannelsHandlerErr> {
    if filters.notification_filters.is_empty() {
        return Ok(None);
    }

    let user = receipt.get_authenticated_user().map_err(|_| {
        ChannelsHandlerErr::BadRequest("notification filters require authenticated user")
    })?;
    Ok(Some(user.clone()))
}

fn actor_from_receipt<T: RequiredPermission>(
    receipt: &EntityAccessReceipt<T>,
) -> Result<MacroUserIdStr<'static>, ChannelsHandlerErr> {
    receipt
        .get_authenticated_user()
        .cloned()
        .map_err(|_| ChannelsHandlerErr::BadRequest("authenticated user required"))
}

fn role_from_receipt<T: RequiredPermission>(
    receipt: &EntityAccessReceipt<T>,
) -> Result<ParticipantRole, ChannelsHandlerErr> {
    match receipt.entity_permission() {
        EntityPermission::ChannelRole { role } => Ok(match role {
            entity_access::domain::models::ParticipantRole::Owner => ParticipantRole::Owner,
            entity_access::domain::models::ParticipantRole::Admin => ParticipantRole::Admin,
            entity_access::domain::models::ParticipantRole::Member => ParticipantRole::Member,
        }),
        _ => Err(ChannelsHandlerErr::BadRequest("channel role required")),
    }
}

fn actor_from_user_context(
    user_context: &UserContext,
) -> Result<MacroUserIdStr<'static>, ChannelsHandlerErr> {
    MacroUserIdStr::try_from(user_context.user_id.clone())
        .map_err(|_| ChannelsHandlerErr::BadRequest("invalid user id"))
}

const MAX_MESSAGE_ID_FILTERS: usize = 100;

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
    /// Filter attachments by type: `static` for images/videos, `dss` for documents.
    #[serde(default)]
    attachment_type: Option<ChannelAttachmentType>,
}

/// Path params for thread replies endpoint.
#[derive(Debug, Deserialize)]
pub struct ThreadRepliesPath {
    /// Channel ID from path.
    channel_id: Uuid,
    /// Message ID from path.
    message_id: Uuid,
}

/// Path params for channel-level endpoints.
#[derive(Debug, Deserialize)]
pub struct ChannelPath {
    /// Channel ID from path.
    channel_id: Uuid,
}

fn parse_messages_query(
    cursor: Option<BidirectionalCursor<Uuid, CreatedAt, ()>>,
) -> (
    PaginationQuery<Uuid, CreatedAt, ()>,
    MessagePageDirection,
    bool,
) {
    match cursor {
        Some(BidirectionalCursor::Next(cursor)) => (
            PaginationQuery::Cursor(cursor),
            MessagePageDirection::Older,
            true,
        ),
        Some(BidirectionalCursor::Previous(cursor)) => (
            PaginationQuery::Cursor(cursor),
            MessagePageDirection::Newer,
            true,
        ),
        None => (
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

/// Build the channel mutation router.
pub fn channel_mutation_router<S, Svc>() -> Router<ChannelsRouterState<S, Svc>>
where
    S: ChannelService,
    Svc: EntityAccessService,
{
    Router::new()
        .route("/", post(create_channel_handler::<S, Svc>))
        .route(
            "/get_or_create_dm",
            post(get_or_create_dm_handler::<S, Svc>),
        )
        .route(
            "/get_or_create_private",
            post(get_or_create_private_handler::<S, Svc>),
        )
        .route("/{channel_id}", patch(patch_channel_handler::<S, Svc>))
        .route("/{channel_id}", delete(delete_channel_handler::<S, Svc>))
        .route(
            "/{channel_id}/message",
            post(post_message_handler::<S, Svc>),
        )
        .route("/{channel_id}/typing", post(post_typing_handler::<S, Svc>))
        .route(
            "/{channel_id}/reaction",
            post(post_reaction_handler::<S, Svc>),
        )
        .route(
            "/{channel_id}/message/{message_id}",
            patch(patch_message_handler::<S, Svc>),
        )
        .route(
            "/{channel_id}/message/{message_id}",
            delete(delete_message_handler::<S, Svc>),
        )
        .route("/{channel_id}/join", post(join_channel_handler::<S, Svc>))
        .route("/{channel_id}/leave", post(leave_channel_handler::<S, Svc>))
        .route(
            "/{channel_id}/participants",
            post(add_participants_handler::<S, Svc>),
        )
        .route(
            "/{channel_id}/participants",
            delete(remove_participants_handler::<S, Svc>),
        )
}

/// Create the channels router.
pub fn channels_router<S, Svc, T>(state: ChannelsRouterState<S, Svc>) -> Router<T>
where
    S: ChannelService,
    Svc: EntityAccessService,
    T: Send + Sync,
{
    channel_mutation_router::<S, Svc>()
        .route(
            "/{channel_id}/messages",
            get(get_channel_messages_handler::<S, Svc>)
                .post(post_channel_messages_handler::<S, Svc>),
        )
        .route(
            "/{channel_id}/messages/{message_id}/replies",
            get(get_thread_replies_handler::<S, Svc>),
        )
        .route(
            "/{channel_id}/messages/{message_id}/resolve",
            get(resolve_channel_message_handler::<S, Svc>),
        )
        .route(
            "/{channel_id}/attachments",
            get(get_channel_attachments_handler::<S, Svc>),
        )
        .route(
            "/{channel_id}/participants",
            get(get_channel_participants_handler::<S, Svc>),
        )
        .with_state(state)
}

/// Handler for `POST /channels`.
#[tracing::instrument(err, skip_all)]
pub async fn create_channel_handler<S: ChannelService, Svc: EntityAccessService>(
    State(state): State<ChannelsRouterState<S, Svc>>,
    Extension(user_context): Extension<UserContext>,
    Json(req): Json<CreateChannelRequest>,
) -> Result<(StatusCode, Json<CreateChannelResponse>), ChannelsHandlerErr> {
    let actor = actor_from_user_context(&user_context)?;
    let res = state
        .service
        .create_channel(actor, user_context.organization_id.map(i64::from), req)
        .await?;
    Ok((StatusCode::OK, Json(res)))
}

/// Handler for `POST /channels/get_or_create_dm`.
#[tracing::instrument(err, skip_all)]
pub async fn get_or_create_dm_handler<S: ChannelService, Svc: EntityAccessService>(
    State(state): State<ChannelsRouterState<S, Svc>>,
    Extension(user_context): Extension<UserContext>,
    Json(req): Json<GetOrCreateDmRequest>,
) -> Result<(StatusCode, Json<GetOrCreateChannelResponse>), ChannelsHandlerErr> {
    let actor = actor_from_user_context(&user_context)?;
    let res = state.service.get_or_create_dm(actor, req).await?;
    Ok((StatusCode::OK, Json(res)))
}

/// Handler for `POST /channels/get_or_create_private`.
#[tracing::instrument(err, skip_all)]
pub async fn get_or_create_private_handler<S: ChannelService, Svc: EntityAccessService>(
    State(state): State<ChannelsRouterState<S, Svc>>,
    Extension(user_context): Extension<UserContext>,
    Json(req): Json<GetOrCreatePrivateRequest>,
) -> Result<(StatusCode, Json<GetOrCreateChannelResponse>), ChannelsHandlerErr> {
    let actor = actor_from_user_context(&user_context)?;
    let res = state.service.get_or_create_private(actor, req).await?;
    Ok((StatusCode::OK, Json(res)))
}

/// Handler for `PATCH /channels/{channel_id}`.
#[tracing::instrument(err, skip_all)]
pub async fn patch_channel_handler<S: ChannelService, Svc: EntityAccessService>(
    State(state): State<ChannelsRouterState<S, Svc>>,
    access: ChannelAccessLevelExtractor<AdminParticipantRole, Svc>,
    Json(req): Json<PatchChannelRequest>,
) -> Result<(StatusCode, String), ChannelsHandlerErr> {
    let channel_id = channel_id_from_receipt(&access.entity_access_receipt)?;
    let actor = actor_from_receipt(&access.entity_access_receipt)?;
    state.service.patch_channel(actor, channel_id, req).await?;
    Ok((StatusCode::OK, "patched channel".to_string()))
}

/// Handler for `DELETE /channels/{channel_id}`.
#[tracing::instrument(err, skip_all)]
pub async fn delete_channel_handler<S: ChannelService, Svc: EntityAccessService>(
    State(state): State<ChannelsRouterState<S, Svc>>,
    access: ChannelAccessLevelExtractor<OwnerParticipantRole, Svc>,
) -> Result<(StatusCode, String), ChannelsHandlerErr> {
    let channel_id = channel_id_from_receipt(&access.entity_access_receipt)?;
    let actor = actor_from_receipt(&access.entity_access_receipt)?;
    state.service.delete_channel(actor, channel_id).await?;
    Ok((StatusCode::OK, "channel successfully deleted".to_string()))
}

/// Handler for `POST /channels/{channel_id}/message`.
#[tracing::instrument(err, skip_all)]
pub async fn post_message_handler<S: ChannelService, Svc: EntityAccessService>(
    State(state): State<ChannelsRouterState<S, Svc>>,
    access: ChannelAccessLevelExtractor<MemberParticipantRole, Svc>,
    Json(req): Json<PostMessageRequest>,
) -> Result<(StatusCode, Json<PostMessageResponse>), ChannelsHandlerErr> {
    let channel_id = channel_id_from_receipt(&access.entity_access_receipt)?;
    let actor = actor_from_receipt(&access.entity_access_receipt)?;
    let res = state.service.post_message(actor, channel_id, req).await?;
    Ok((StatusCode::OK, Json(res)))
}

/// Handler for `PATCH /channels/{channel_id}/message/{message_id}`.
#[tracing::instrument(err, skip_all)]
pub async fn patch_message_handler<S: ChannelService, Svc: EntityAccessService>(
    State(state): State<ChannelsRouterState<S, Svc>>,
    access: ChannelAccessLevelExtractor<MemberParticipantRole, Svc>,
    Path(path): Path<ThreadRepliesPath>,
    Json(req): Json<PatchMessageRequest>,
) -> Result<(StatusCode, String), ChannelsHandlerErr> {
    let actor = actor_from_receipt(&access.entity_access_receipt)?;
    let role = role_from_receipt(&access.entity_access_receipt)?;
    state
        .service
        .patch_message(actor, role, path.channel_id, path.message_id, req)
        .await?;
    Ok((StatusCode::OK, "message sent".to_string()))
}

/// Handler for `DELETE /channels/{channel_id}/message/{message_id}`.
#[tracing::instrument(err, skip_all)]
pub async fn delete_message_handler<S: ChannelService, Svc: EntityAccessService>(
    State(state): State<ChannelsRouterState<S, Svc>>,
    access: ChannelAccessLevelExtractor<MemberParticipantRole, Svc>,
    Path(path): Path<ThreadRepliesPath>,
    Query(query): Query<DeleteMessageQuery>,
) -> Result<(StatusCode, String), ChannelsHandlerErr> {
    let actor = actor_from_receipt(&access.entity_access_receipt)?;
    let role = role_from_receipt(&access.entity_access_receipt)?;
    state
        .service
        .delete_message(actor, role, path.channel_id, path.message_id, query)
        .await?;
    Ok((StatusCode::OK, "message sent".to_string()))
}

/// Handler for `POST /channels/{channel_id}/reaction`.
#[tracing::instrument(err, skip_all)]
pub async fn post_reaction_handler<S: ChannelService, Svc: EntityAccessService>(
    State(state): State<ChannelsRouterState<S, Svc>>,
    access: ChannelAccessLevelExtractor<MemberParticipantRole, Svc>,
    Json(req): Json<PostReactionRequest>,
) -> Result<(StatusCode, String), ChannelsHandlerErr> {
    let channel_id = channel_id_from_receipt(&access.entity_access_receipt)?;
    let actor = actor_from_receipt(&access.entity_access_receipt)?;
    state.service.post_reaction(actor, channel_id, req).await?;
    Ok((StatusCode::OK, "Reaction added".to_string()))
}

/// Handler for `POST /channels/{channel_id}/typing`.
#[tracing::instrument(err, skip_all)]
pub async fn post_typing_handler<S: ChannelService, Svc: EntityAccessService>(
    State(state): State<ChannelsRouterState<S, Svc>>,
    access: ChannelAccessLevelExtractor<MemberParticipantRole, Svc>,
    Json(req): Json<PostTypingRequest>,
) -> Result<(StatusCode, String), ChannelsHandlerErr> {
    let channel_id = channel_id_from_receipt(&access.entity_access_receipt)?;
    let actor = actor_from_receipt(&access.entity_access_receipt)?;
    state.service.post_typing(actor, channel_id, req).await?;
    Ok((StatusCode::OK, "message sent".to_string()))
}

/// Handler for `POST /channels/{channel_id}/participants`.
#[tracing::instrument(err, skip_all)]
pub async fn add_participants_handler<S: ChannelService, Svc: EntityAccessService>(
    State(state): State<ChannelsRouterState<S, Svc>>,
    access: ChannelAccessLevelExtractor<MemberParticipantRole, Svc>,
    Json(req): Json<AddParticipantsRequest>,
) -> Result<StatusCode, ChannelsHandlerErr> {
    let channel_id = channel_id_from_receipt(&access.entity_access_receipt)?;
    let actor = actor_from_receipt(&access.entity_access_receipt)?;
    state
        .service
        .add_participants(actor, channel_id, req)
        .await?;
    Ok(StatusCode::OK)
}

/// Handler for `DELETE /channels/{channel_id}/participants`.
#[tracing::instrument(err, skip_all)]
pub async fn remove_participants_handler<S: ChannelService, Svc: EntityAccessService>(
    State(state): State<ChannelsRouterState<S, Svc>>,
    access: ChannelAccessLevelExtractor<MemberParticipantRole, Svc>,
    Json(req): Json<RemoveParticipantsRequest>,
) -> Result<StatusCode, ChannelsHandlerErr> {
    let channel_id = channel_id_from_receipt(&access.entity_access_receipt)?;
    state.service.remove_participants(channel_id, req).await?;
    Ok(StatusCode::OK)
}

/// Handler for `POST /channels/{channel_id}/join`.
#[tracing::instrument(err, skip_all)]
pub async fn join_channel_handler<S: ChannelService, Svc: EntityAccessService>(
    State(state): State<ChannelsRouterState<S, Svc>>,
    Path(path): Path<ChannelPath>,
    Extension(user_context): Extension<UserContext>,
) -> Result<StatusCode, ChannelsHandlerErr> {
    let channel_id = path.channel_id;
    let actor = actor_from_user_context(&user_context)?;
    state.service.join_channel(actor, channel_id).await?;
    Ok(StatusCode::OK)
}

/// Handler for `POST /channels/{channel_id}/leave`.
#[tracing::instrument(err, skip_all)]
pub async fn leave_channel_handler<S: ChannelService, Svc: EntityAccessService>(
    State(state): State<ChannelsRouterState<S, Svc>>,
    access: ChannelAccessLevelExtractor<MemberParticipantRole, Svc>,
) -> Result<StatusCode, ChannelsHandlerErr> {
    let channel_id = channel_id_from_receipt(&access.entity_access_receipt)?;
    let actor = actor_from_receipt(&access.entity_access_receipt)?;
    state.service.leave_channel(actor, channel_id).await?;
    Ok(StatusCode::OK)
}

/// Handler for `GET /channels/{channel_id}/messages`.
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
        (status = 401, body = ErrorResponse),
        (status = 400, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(
    err,
    skip_all,
    fields(
        channel_id = tracing::field::Empty,
        limit = tracing::field::Empty,
        page_direction = tracing::field::Empty,
        has_cursor = tracing::field::Empty,
        load_around_message_id = tracing::field::Empty
    )
)]
pub async fn get_channel_messages_handler<S: ChannelService, Svc: EntityAccessService>(
    State(state): State<ChannelsRouterState<S, Svc>>,
    access: ChannelAccessLevelExtractor<MemberParticipantRole, Svc>,
    Query(params): Query<Params>,
    cursor: Option<BidirectionalCursor<Uuid, CreatedAt, ()>>,
) -> Result<Json<ApiChannelMessagesPage>, ChannelsHandlerErr> {
    let channel_id = channel_id_from_receipt(&access.entity_access_receipt)?;
    let filters = ChannelMessageFilters::default();
    channel_messages_response(&state, params, cursor, channel_id, &filters, None).await
}

/// Handler for `POST /channels/{channel_id}/messages`.
#[utoipa::path(
    post,
    operation_id = "post_channel_messages",
    path = "/channels/{channel_id}/messages",
    params(
        ("channel_id" = Uuid, Path, description = "Channel ID"),
        ("limit" = Option<u16>, Query, description = "Page size (1-100, default 50)"),
        ("cursor" = Option<String>, Query, description = "Base64 encoded cursor value for older messages"),
        ("previous_cursor" = Option<String>, Query, description = "Base64 encoded cursor value for newer messages"),
        ("load_around_message_id" = Option<Uuid>, Query, description = "Return a centered window around this message ID"),
    ),
    request_body = ChannelMessageFilters,
    responses(
        (status = 200, body = ApiChannelMessagesPage),
        (status = 401, body = ErrorResponse),
        (status = 400, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(
    err,
    skip_all,
    fields(
        channel_id = tracing::field::Empty,
        limit = tracing::field::Empty,
        page_direction = tracing::field::Empty,
        has_cursor = tracing::field::Empty,
        load_around_message_id = tracing::field::Empty
    )
)]
pub async fn post_channel_messages_handler<S: ChannelService, Svc: EntityAccessService>(
    State(state): State<ChannelsRouterState<S, Svc>>,
    access: ChannelAccessLevelExtractor<MemberParticipantRole, Svc>,
    Query(params): Query<Params>,
    cursor: Option<BidirectionalCursor<Uuid, CreatedAt, ()>>,
    Json(filters): Json<ChannelMessageFilters>,
) -> Result<Json<ApiChannelMessagesPage>, ChannelsHandlerErr> {
    let channel_id = channel_id_from_receipt(&access.entity_access_receipt)?;
    if filters.message_ids.len() > MAX_MESSAGE_ID_FILTERS {
        return Err(ChannelsHandlerErr::BadRequest("too many message_ids"));
    }
    let notification_user_id =
        notification_user_id_from_receipt(&access.entity_access_receipt, &filters)?;
    channel_messages_response(
        &state,
        params,
        cursor,
        channel_id,
        &filters,
        notification_user_id,
    )
    .await
}

async fn channel_messages_response<S: ChannelService, Svc>(
    state: &ChannelsRouterState<S, Svc>,
    params: Params,
    cursor: Option<BidirectionalCursor<Uuid, CreatedAt, ()>>,
    channel_id: Uuid,
    filters: &ChannelMessageFilters,
    notification_user_id: Option<MacroUserIdStr<'static>>,
) -> Result<Json<ApiChannelMessagesPage>, ChannelsHandlerErr> {
    let limit = params.limit.unwrap_or(50).clamp(1, 100);
    let (query, direction, has_cursor) = parse_messages_query(cursor);

    let span = tracing::Span::current();
    span.record("channel_id", tracing::field::display(channel_id));
    span.record("limit", limit);
    span.record("page_direction", tracing::field::debug(&direction));
    span.record("has_cursor", has_cursor);
    span.record(
        "load_around_message_id",
        tracing::field::debug(&params.load_around_message_id),
    );

    let (page, has_more_newer) = match params.load_around_message_id {
        Some(message_id) => {
            let ChannelMessagesQueryResult {
                page,
                has_more_newer,
            } = state
                .service
                .get_channel_messages_around(channel_id, message_id, limit)
                .await?;
            (page, has_more_newer)
        }
        None => {
            let ChannelMessagesQueryResult {
                page,
                has_more_newer,
            } = state
                .service
                .get_channel_messages(
                    channel_id,
                    query,
                    direction,
                    limit,
                    filters,
                    notification_user_id,
                )
                .await?;
            (page, has_more_newer)
        }
    };

    let has_newer_page = match params.load_around_message_id {
        Some(_) => has_more_newer,
        None => match direction {
            MessagePageDirection::Older => has_cursor,
            MessagePageDirection::Newer => has_more_newer,
        },
    };
    let previous_cursor = if has_newer_page {
        cursor_from_first_message(&page, limit)
            .map(|first_cursor| Base64Str::encode_json(first_cursor).type_erase())
    } else {
        None
    };

    let page = page.type_erase().map(ApiChannelMessage::from);
    Ok(Json(ApiChannelMessagesPage {
        items: page.items,
        next_cursor: page.next_cursor,
        previous_cursor,
    }))
}

/// Handler for `GET /channels/{channel_id}/messages/{message_id}/replies`.
#[utoipa::path(
    get,
    operation_id = "get_thread_replies",
    path = "/channels/{channel_id}/messages/{message_id}/replies",
    params(
        ("channel_id" = Uuid, Path, description = "Channel ID"),
        ("message_id" = Uuid, Path, description = "Message ID (thread parent or reply id)")
    ),
    responses(
        (status = 200, body = Vec<ApiThreadReply>),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(
    err,
    skip_all,
    fields(channel_id = tracing::field::Empty, message_id = tracing::field::Empty)
)]
pub async fn get_thread_replies_handler<S: ChannelService, Svc: EntityAccessService>(
    State(state): State<ChannelsRouterState<S, Svc>>,
    _access: ChannelAccessLevelExtractor<MemberParticipantRole, Svc>,
    Path(path): Path<ThreadRepliesPath>,
) -> Result<Json<Vec<ApiThreadReply>>, ChannelsHandlerErr> {
    let channel_id = path.channel_id;
    let message_id = path.message_id;
    let span = tracing::Span::current();
    span.record("channel_id", tracing::field::display(channel_id));
    span.record("message_id", tracing::field::display(message_id));

    let replies = state
        .service
        .get_thread_replies(channel_id, message_id)
        .await?;

    Ok(Json(
        replies.into_iter().map(ApiThreadReply::from).collect(),
    ))
}

/// Handler for `GET /channels/{channel_id}/messages/{message_id}/resolve`.
#[utoipa::path(
    get,
    operation_id = "resolve_channel_message",
    path = "/channels/{channel_id}/messages/{message_id}/resolve",
    params(
        ("channel_id" = Uuid, Path, description = "Channel ID"),
        ("message_id" = Uuid, Path, description = "Message ID to resolve")
    ),
    responses(
        (status = 200, body = ApiResolvedChannelMessage),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(
    err,
    skip_all,
    fields(channel_id = tracing::field::Empty, message_id = tracing::field::Empty)
)]
pub async fn resolve_channel_message_handler<S: ChannelService, Svc: EntityAccessService>(
    State(state): State<ChannelsRouterState<S, Svc>>,
    _access: ChannelAccessLevelExtractor<MemberParticipantRole, Svc>,
    Path(path): Path<ThreadRepliesPath>,
) -> Result<Json<ApiResolvedChannelMessage>, ChannelsHandlerErr> {
    let channel_id = path.channel_id;
    let message_id = path.message_id;
    let span = tracing::Span::current();
    span.record("channel_id", tracing::field::display(channel_id));
    span.record("message_id", tracing::field::display(message_id));

    let resolved = state
        .service
        .resolve_message(channel_id, message_id)
        .await?;

    Ok(Json(ApiResolvedChannelMessage::from(resolved)))
}

/// Handler for `GET /channels/{channel_id}/attachments`.
#[utoipa::path(
    get,
    operation_id = "get_channel_attachments",
    path = "/channels/{channel_id}/attachments",
    params(
        ("channel_id" = Uuid, Path, description = "Channel ID"),
        ("limit" = Option<u16>, Query, description = "Page size (1-500, default 50)"),
        ("cursor" = Option<String>, Query, description = "Base64 encoded cursor value"),
        ("attachment_type" = Option<String>, Query, description = "Filter by type: 'static' for images/videos, 'dss' for documents"),
    ),
    responses(
        (status = 200, body = ApiChannelAttachmentsPage),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(
    err,
    skip_all,
    fields(
        channel_id = tracing::field::Empty,
        limit = tracing::field::Empty,
        has_cursor = tracing::field::Empty,
        attachment_type = tracing::field::Empty
    )
)]
pub async fn get_channel_attachments_handler<S: ChannelService, Svc: EntityAccessService>(
    State(state): State<ChannelsRouterState<S, Svc>>,
    access: ChannelAccessLevelExtractor<MemberParticipantRole, Svc>,
    Query(params): Query<Params>,
    cursor: Option<CursorWithValAndFilter<Uuid, CreatedAt, ()>>,
) -> Result<Json<PaginatedOpaqueCursor<ApiChannelAttachment>>, ChannelsHandlerErr> {
    let limit = params.limit.unwrap_or(50);
    let has_cursor = cursor.is_some();
    let query = cursor.into_query(CreatedAt, ());
    let channel_id = channel_id_from_receipt(&access.entity_access_receipt)?;
    let span = tracing::Span::current();
    span.record("channel_id", tracing::field::display(channel_id));
    span.record("limit", limit);
    span.record("has_cursor", has_cursor);
    span.record(
        "attachment_type",
        tracing::field::debug(&params.attachment_type),
    );

    let page = state
        .service
        .get_channel_attachments(channel_id, query, limit, params.attachment_type)
        .await?;

    Ok(Json(page.type_erase().map(ApiChannelAttachment::from)))
}

/// Handler for `GET /channels/{channel_id}/participants`.
#[utoipa::path(
    get,
    operation_id = "get_channel_participants",
    path = "/channels/{channel_id}/participants",
    params(
        ("channel_id" = Uuid, Path, description = "Channel ID"),
    ),
    responses(
        (status = 200, body = Vec<ApiChannelParticipant>),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all, fields(channel_id = tracing::field::Empty))]
pub async fn get_channel_participants_handler<S: ChannelService, Svc: EntityAccessService>(
    State(state): State<ChannelsRouterState<S, Svc>>,
    access: ChannelAccessLevelExtractor<MemberParticipantRole, Svc>,
) -> Result<Json<Vec<ApiChannelParticipant>>, ChannelsHandlerErr> {
    let channel_id = channel_id_from_receipt(&access.entity_access_receipt)?;
    tracing::Span::current().record("channel_id", tracing::field::display(channel_id));
    let participants = state.service.get_channel_participants(channel_id).await?;

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

/// Position of a message in the channel/thread model.
#[derive(Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub enum ApiChannelMessageKind {
    /// A top-level channel message.
    TopLevelMessage,
    /// A reply inside a message thread.
    ThreadReply,
}

impl From<ChannelMessageKind> for ApiChannelMessageKind {
    fn from(kind: ChannelMessageKind) -> Self {
        match kind {
            ChannelMessageKind::TopLevelMessage => Self::TopLevelMessage,
            ChannelMessageKind::ThreadReply => Self::ThreadReply,
        }
    }
}

/// Resolution metadata for any channel message id.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct ApiResolvedChannelMessage {
    /// The requested message id.
    message_id: Uuid,
    /// Channel this message belongs to.
    channel_id: Uuid,
    /// Whether the message is top-level or a thread reply.
    kind: ApiChannelMessageKind,
    /// The top-level parent/thread id. Equals message_id for top-level messages.
    thread_id: Uuid,
    /// When the requested message was created.
    created_at: DateTime<Utc>,
}

impl From<ResolvedChannelMessage> for ApiResolvedChannelMessage {
    fn from(message: ResolvedChannelMessage) -> Self {
        Self {
            message_id: message.message_id,
            channel_id: message.channel_id,
            kind: ApiChannelMessageKind::from(message.kind),
            thread_id: message.thread_id,
            created_at: message.created_at,
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
    /// Width (for images).
    width: Option<i32>,
    /// Height (for images).
    height: Option<i32>,
    /// When the attachment was created.
    created_at: DateTime<Utc>,
}

impl From<MessageAttachment> for ApiMessageAttachment {
    fn from(a: MessageAttachment) -> Self {
        Self {
            id: a.id,
            entity_type: a.entity_type,
            entity_id: a.entity_id,
            width: a.width,
            height: a.height,
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
    /// The user who sent the message containing this attachment.
    sender_id: String,
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
            sender_id: a.sender_id,
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
    /// Mutation error.
    #[error(transparent)]
    Mutation(#[from] ChannelMutationErr),
}

impl IntoResponse for ChannelsHandlerErr {
    fn into_response(self) -> axum::response::Response {
        match self {
            ChannelsHandlerErr::BadRequest(message) => (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    message: message.into(),
                }),
            )
                .into_response(),
            ChannelsHandlerErr::Mutation(err) => {
                let status = match &err {
                    ChannelMutationErr::BadRequest(_) => StatusCode::BAD_REQUEST,
                    ChannelMutationErr::Unauthorized(_) => StatusCode::UNAUTHORIZED,
                    ChannelMutationErr::NotFound(_) => StatusCode::NOT_FOUND,
                    ChannelMutationErr::Repo(_)
                    | ChannelMutationErr::Gateway(_)
                    | ChannelMutationErr::Notification(_)
                    | ChannelMutationErr::Contacts(_) => StatusCode::INTERNAL_SERVER_ERROR,
                };
                if status == StatusCode::INTERNAL_SERVER_ERROR {
                    tracing::error!(error=?err, "channel mutation error");
                }
                (
                    status,
                    Json(ErrorResponse {
                        message: err.to_string().into(),
                    }),
                )
                    .into_response()
            }
            ChannelsHandlerErr::Internal(err) => match err {
                ChannelMessagesErr::MessageNotFound(id) => {
                    tracing::warn!(message_id=?id, "message not found");
                    (
                        StatusCode::NOT_FOUND,
                        Json(ErrorResponse {
                            message: "Message not found".into(),
                        }),
                    )
                        .into_response()
                }
                ChannelMessagesErr::Repo(repo_err) => {
                    tracing::error!(error=?repo_err, "channels handler error");
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(ErrorResponse {
                            message: "An internal server error occurred".into(),
                        }),
                    )
                        .into_response()
                }
            },
        }
    }
}
