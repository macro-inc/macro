#[cfg(test)]
mod test;

use crate::domain::models::{
    Activity, ActivityType, AttachmentChannelReference, AttachmentEntityReference,
    AttachmentGenericReference, ChannelAttachment, ChannelAttachmentType, ChannelParticipant,
    ChannelType, CountedReaction, CreateEntityMentionOptions, MessageAttachment, ParticipantRole,
    Sender,
};
pub use crate::domain::models::{
    AddParticipantsRequest, ChannelJoinCodeResponse, ChannelPreview, ChannelPreviewData,
    CreateChannelRequest, CreateChannelResponse, CreateEntityMentionRequest,
    CreateEntityMentionResponse, DeleteEntityMentionResponse, GetBatchChannelPreviewRequest,
    GetBatchChannelPreviewResponse, GetOrCreateChannelResponse, GetOrCreateDmRequest,
    GetOrCreatePrivateRequest, PatchChannelRequest, RemoveParticipantsRequest, WithChannelId,
};
use crate::domain::ports::{ChannelMessagesErr, ChannelMutationErr, ChannelService};
use axum::{
    Json, Router,
    extract::{FromRef, Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{delete, get, patch, post},
};
use chrono::{DateTime, Utc};
use entity_access::{
    domain::{
        models::{
            AccessError, AccessLevel, AdminParticipantRole, EntityAccessReceipt, EntityType,
            MemberParticipantRole, OwnerParticipantRole, RequiredPermission, ViewOnly,
        },
        ports::EntityAccessService,
    },
    inbound::axum_extractors::ChannelAccessLevelExtractor,
};
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOrInternal,
};
use macro_user_id::user_id::MacroUserIdStr;
use model_error_response::ErrorResponse;
use models_pagination::{
    CreatedAt, CursorOptionExt, CursorWithValAndFilter, PaginatedOpaqueCursor, TypeEraseCursor,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

/// State for the channels router.
pub struct ChannelsRouterState<S, Svc, Auth> {
    service: Arc<S>,
    access_service: Arc<Svc>,
    authorization_state: MacroAuthorizationState<Auth>,
}

impl<S, Svc, Auth> Clone for ChannelsRouterState<S, Svc, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            access_service: self.access_service.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<S: ChannelService, Svc: EntityAccessService, Auth> ChannelsRouterState<S, Svc, Auth> {
    /// Create a router state wrapping the channel service, entity access service, and authorization state.
    pub fn new(
        service: S,
        access_service: Svc,
        authorization_state: MacroAuthorizationState<Auth>,
    ) -> Self {
        Self {
            service: Arc::new(service),
            access_service: Arc::new(access_service),
            authorization_state,
        }
    }

    /// Create a router state from an already-shared channel service.
    ///
    /// Used when the channel service must also be shared with other components
    /// (such as the bot trigger dispatcher) that post messages through it.
    pub fn from_arc(
        service: Arc<S>,
        access_service: Svc,
        authorization_state: MacroAuthorizationState<Auth>,
    ) -> Self {
        Self {
            service,
            access_service: Arc::new(access_service),
            authorization_state,
        }
    }
}

impl<S, Svc, Auth> FromRef<ChannelsRouterState<S, Svc, Auth>> for Arc<Svc> {
    fn from_ref(state: &ChannelsRouterState<S, Svc, Auth>) -> Self {
        state.access_service.clone()
    }
}

impl<S, Svc, Auth> FromRef<ChannelsRouterState<S, Svc, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &ChannelsRouterState<S, Svc, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

fn channel_id_from_receipt<T: RequiredPermission>(
    receipt: &EntityAccessReceipt<T>,
) -> Result<Uuid, ChannelsHandlerErr> {
    Uuid::parse_str(&receipt.entity().entity_id)
        .map_err(|_| ChannelsHandlerErr::BadRequest("Invalid channel_id"))
}

fn user_actor_from_receipt<T: RequiredPermission>(
    receipt: &EntityAccessReceipt<T>,
) -> Result<Sender, ChannelsHandlerErr> {
    receipt
        .get_authenticated_user()
        .cloned()
        .map(Sender::new_from_user)
        .map_err(|_| ChannelsHandlerErr::BadRequest("authenticated user required"))
}

/// Query parameters for channel attachments.
#[derive(Debug, Default, Deserialize)]
pub struct Params {
    /// Page size. Clamped to [1, 100], defaults to 50.
    #[serde(default)]
    limit: Option<u16>,
    /// Filter attachments by type: `static` for images/videos, `dss` for documents.
    #[serde(default)]
    attachment_type: Option<ChannelAttachmentType>,
}

/// Path params for the attachment-references endpoint.
#[derive(Debug, Deserialize)]
pub struct AttachmentReferencesPath {
    /// Type of the attachment entity.
    entity_type: String,
    /// Id of the attachment entity.
    entity_id: String,
}

/// Build the channel mutation router.
pub fn channel_mutation_router<S, Svc, Auth>() -> Router<ChannelsRouterState<S, Svc, Auth>>
where
    S: ChannelService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    Router::new()
        .route("/", post(create_channel_handler::<S, Svc, Auth>))
        .route(
            "/get_or_create_dm",
            post(get_or_create_dm_handler::<S, Svc, Auth>),
        )
        .route(
            "/get_or_create_private",
            post(get_or_create_private_handler::<S, Svc, Auth>),
        )
        .route("/mentions", post(create_mention_handler::<S, Svc, Auth>))
        .route(
            "/mentions/{mention_id}",
            delete(delete_mention_handler::<S, Svc, Auth>),
        )
        .route(
            "/{channel_id}",
            patch(patch_channel_handler::<S, Svc, Auth>),
        )
        .route(
            "/{channel_id}",
            delete(delete_channel_handler::<S, Svc, Auth>),
        )
        .route(
            "/{channel_id}/join",
            post(join_channel_handler::<S, Svc, Auth>),
        )
        .route(
            "/join/{join_code}",
            post(join_channel_by_code_handler::<S, Svc, Auth>),
        )
        .route(
            "/{channel_id}/leave",
            post(leave_channel_handler::<S, Svc, Auth>),
        )
        .route(
            "/{channel_id}/participants",
            post(add_participants_handler::<S, Svc, Auth>),
        )
        .route(
            "/{channel_id}/participants",
            delete(remove_participants_handler::<S, Svc, Auth>),
        )
}

/// Create the channels router.
pub fn channels_router<S, Svc, Auth, T>(state: ChannelsRouterState<S, Svc, Auth>) -> Router<T>
where
    S: ChannelService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
    T: Send + Sync,
{
    channel_mutation_router::<S, Svc, Auth>()
        .route("/{channel_id}", get(get_channel_handler::<S, Svc, Auth>))
        .route(
            "/{channel_id}/join-link",
            get(get_channel_join_link_handler::<S, Svc, Auth>),
        )
        .route(
            "/{channel_id}/attachments",
            get(get_channel_attachments_handler::<S, Svc, Auth>),
        )
        .route(
            "/{channel_id}/participants",
            get(get_channel_participants_handler::<S, Svc, Auth>),
        )
        .route(
            "/preview",
            post(get_batch_channel_preview_handler::<S, Svc, Auth>),
        )
        .route(
            "/attachments/{entity_type}/{entity_id}/references",
            get(get_attachment_references_handler::<S, Svc, Auth>),
        )
        .route(
            "/activity",
            get(get_activity_handler::<S, Svc, Auth>).post(post_activity_handler::<S, Svc, Auth>),
        )
        .with_state(state)
}

/// Handler for `POST /channels`.
#[utoipa::path(
    post,
    tag = "channels",
    operation_id = "create_channel",
    path = "/channels",
    request_body = CreateChannelRequest,
    responses(
        (status = 200, body = CreateChannelResponse),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn create_channel_handler<
    S: ChannelService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<ChannelsRouterState<S, Svc, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Json(req): Json<CreateChannelRequest>,
) -> Result<(StatusCode, Json<CreateChannelResponse>), ChannelsHandlerErr> {
    let user = &user.authorization.user;
    let res = state
        .service
        .create_channel(
            Sender::new_from_user(user.macro_user_id.clone()),
            user.user_context.organization_id.map(i64::from),
            req,
        )
        .await?;
    Ok((StatusCode::OK, Json(res)))
}

/// Handler for `POST /channels/get_or_create_dm`.
#[utoipa::path(
    post,
    tag = "channels",
    operation_id = "get_or_create_dm",
    path = "/channels/get_or_create_dm",
    request_body = GetOrCreateDmRequest,
    responses(
        (status = 200, body = GetOrCreateChannelResponse),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn get_or_create_dm_handler<
    S: ChannelService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<ChannelsRouterState<S, Svc, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Json(req): Json<GetOrCreateDmRequest>,
) -> Result<(StatusCode, Json<GetOrCreateChannelResponse>), ChannelsHandlerErr> {
    let user = &user.authorization.user;
    let res = state
        .service
        .get_or_create_dm(Sender::new_from_user(user.macro_user_id.clone()), req)
        .await?;
    Ok((StatusCode::OK, Json(res)))
}

/// Handler for `POST /channels/get_or_create_private`.
#[utoipa::path(
    post,
    tag = "channels",
    operation_id = "get_or_create_private",
    path = "/channels/get_or_create_private",
    request_body = GetOrCreatePrivateRequest,
    responses(
        (status = 200, body = GetOrCreateChannelResponse),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn get_or_create_private_handler<
    S: ChannelService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<ChannelsRouterState<S, Svc, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Json(req): Json<GetOrCreatePrivateRequest>,
) -> Result<(StatusCode, Json<GetOrCreateChannelResponse>), ChannelsHandlerErr> {
    let user = &user.authorization.user;
    let res = state
        .service
        .get_or_create_private(Sender::new_from_user(user.macro_user_id.clone()), req)
        .await?;
    Ok((StatusCode::OK, Json(res)))
}

/// Handler for `PATCH /channels/{channel_id}`.
#[utoipa::path(
    patch,
    tag = "channels",
    operation_id = "patch_channel",
    path = "/channels/{channel_id}",
    params(
        ("channel_id" = Uuid, Path, description = "Channel ID")
    ),
    request_body = PatchChannelRequest,
    responses(
        (status = 200, body = String),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn patch_channel_handler<
    S: ChannelService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<ChannelsRouterState<S, Svc, Auth>>,
    access: ChannelAccessLevelExtractor<AdminParticipantRole, Svc, Auth>,
    Json(req): Json<PatchChannelRequest>,
) -> Result<(StatusCode, String), ChannelsHandlerErr> {
    let channel_id = channel_id_from_receipt(&access.entity_access_receipt)?;
    let actor = user_actor_from_receipt(&access.entity_access_receipt)?;
    state.service.patch_channel(actor, channel_id, req).await?;
    Ok((StatusCode::OK, "patched channel".to_string()))
}

/// Handler for `DELETE /channels/{channel_id}`.
#[utoipa::path(
    delete,
    tag = "channels",
    operation_id = "delete_channel",
    path = "/channels/{channel_id}",
    params(
        ("channel_id" = Uuid, Path, description = "Channel ID")
    ),
    responses(
        (status = 200, body = String),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn delete_channel_handler<
    S: ChannelService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<ChannelsRouterState<S, Svc, Auth>>,
    access: ChannelAccessLevelExtractor<OwnerParticipantRole, Svc, Auth>,
) -> Result<(StatusCode, String), ChannelsHandlerErr> {
    let channel_id = channel_id_from_receipt(&access.entity_access_receipt)?;
    let actor = user_actor_from_receipt(&access.entity_access_receipt)?;
    state.service.delete_channel(actor, channel_id).await?;
    Ok((StatusCode::OK, "channel successfully deleted".to_string()))
}

/// Handler for `POST /channels/{channel_id}/participants`.
#[utoipa::path(
    post,
    tag = "channels",
    operation_id = "add_participants",
    path = "/channels/{channel_id}/participants",
    params(
        ("channel_id" = Uuid, Path, description = "Channel ID")
    ),
    request_body = AddParticipantsRequest,
    responses(
        (status = 200),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn add_participants_handler<
    S: ChannelService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<ChannelsRouterState<S, Svc, Auth>>,
    access: ChannelAccessLevelExtractor<MemberParticipantRole, Svc, Auth>,
    Json(req): Json<AddParticipantsRequest>,
) -> Result<StatusCode, ChannelsHandlerErr> {
    let channel_id = channel_id_from_receipt(&access.entity_access_receipt)?;
    let actor = user_actor_from_receipt(&access.entity_access_receipt)?;
    state
        .service
        .add_participants(actor, channel_id, req)
        .await?;
    Ok(StatusCode::OK)
}

/// Handler for `DELETE /channels/{channel_id}/participants`.
#[utoipa::path(
    delete,
    tag = "channels",
    operation_id = "remove_participants",
    path = "/channels/{channel_id}/participants",
    params(
        ("channel_id" = Uuid, Path, description = "Channel ID")
    ),
    request_body = RemoveParticipantsRequest,
    responses(
        (status = 200),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn remove_participants_handler<
    S: ChannelService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<ChannelsRouterState<S, Svc, Auth>>,
    access: ChannelAccessLevelExtractor<MemberParticipantRole, Svc, Auth>,
    Json(req): Json<RemoveParticipantsRequest>,
) -> Result<StatusCode, ChannelsHandlerErr> {
    let channel_id = channel_id_from_receipt(&access.entity_access_receipt)?;
    let actor = user_actor_from_receipt(&access.entity_access_receipt)?;
    state
        .service
        .remove_participants(actor, channel_id, req)
        .await?;
    Ok(StatusCode::OK)
}

/// Handler for `GET /channels/{channel_id}/join-link`.
#[utoipa::path(
    get,
    tag = "channels",
    operation_id = "get_channel_join_link",
    path = "/channels/{channel_id}/join-link",
    params(
        ("channel_id" = Uuid, Path, description = "Channel ID")
    ),
    responses(
        (status = 200, body = ChannelJoinCodeResponse),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn get_channel_join_link_handler<
    S: ChannelService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<ChannelsRouterState<S, Svc, Auth>>,
    access: ChannelAccessLevelExtractor<MemberParticipantRole, Svc, Auth>,
) -> Result<Json<ChannelJoinCodeResponse>, ChannelsHandlerErr> {
    let channel_id = channel_id_from_receipt(&access.entity_access_receipt)?;
    let response = state.service.get_channel_join_code(channel_id).await?;
    Ok(Json(response))
}

/// Handler for `POST /channels/join/{join_code}`.
#[utoipa::path(
    post,
    tag = "channels",
    operation_id = "join_channel_by_code",
    path = "/channels/join/{join_code}",
    params(
        ("join_code" = Uuid, Path, description = "Channel join code")
    ),
    responses(
        (status = 200),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn join_channel_by_code_handler<
    S: ChannelService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<ChannelsRouterState<S, Svc, Auth>>,
    Path(join_code): Path<Uuid>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
) -> Result<StatusCode, ChannelsHandlerErr> {
    let user = &user.authorization.user;
    state
        .service
        .join_channel_by_code(Sender::new_from_user(user.macro_user_id.clone()), join_code)
        .await?;
    Ok(StatusCode::OK)
}

/// Handler for `POST /channels/{channel_id}/join`.
#[utoipa::path(
    post,
    tag = "channels",
    operation_id = "join_channel",
    path = "/channels/{channel_id}/join",
    params(
        ("channel_id" = Uuid, Path, description = "Channel ID")
    ),
    responses(
        (status = 200),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn join_channel_handler<
    S: ChannelService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<ChannelsRouterState<S, Svc, Auth>>,
    access: ChannelAccessLevelExtractor<ViewOnly, Svc, Auth>,
) -> Result<StatusCode, ChannelsHandlerErr> {
    let channel_id = channel_id_from_receipt(&access.entity_access_receipt)?;
    let actor = user_actor_from_receipt(&access.entity_access_receipt)?;
    state.service.join_channel(actor, channel_id).await?;

    Ok(StatusCode::OK)
}

/// Handler for `POST /channels/{channel_id}/leave`.
#[utoipa::path(
    post,
    tag = "channels",
    operation_id = "leave_channel",
    path = "/channels/{channel_id}/leave",
    params(
        ("channel_id" = Uuid, Path, description = "Channel ID")
    ),
    responses(
        (status = 200),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn leave_channel_handler<
    S: ChannelService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<ChannelsRouterState<S, Svc, Auth>>,
    access: ChannelAccessLevelExtractor<MemberParticipantRole, Svc, Auth>,
) -> Result<StatusCode, ChannelsHandlerErr> {
    let channel_id = channel_id_from_receipt(&access.entity_access_receipt)?;
    let actor = user_actor_from_receipt(&access.entity_access_receipt)?;
    state.service.leave_channel(actor, channel_id).await?;
    Ok(StatusCode::OK)
}

async fn require_document_edit_access<Svc: EntityAccessService>(
    access_service: &Svc,
    actor: &MacroUserIdStr<'static>,
    source_entity_type: &str,
    source_entity_id: &str,
) -> Result<(), ChannelsHandlerErr> {
    if source_entity_type != "document" {
        return Err(ChannelsHandlerErr::BadRequest("invalid source entity type"));
    }
    access_service
        .check_access(
            Some(actor),
            source_entity_id,
            EntityType::Document,
            AccessLevel::Edit,
        )
        .await
        .map(|_| ())
        .map_err(map_access_error)
}

fn map_access_error(err: AccessError) -> ChannelsHandlerErr {
    match err {
        AccessError::Unauthorized => ChannelsHandlerErr::Unauthorized("unauthorized"),
        AccessError::UnauthorizedWithMessage(msg) => ChannelsHandlerErr::Unauthorized(msg),
        AccessError::BadRequest(msg) => ChannelsHandlerErr::BadRequest(msg),
        AccessError::NotFound(msg) => ChannelsHandlerErr::NotFound(msg),
        AccessError::Unavailable(report) | AccessError::Internal(report) => {
            tracing::error!(error=?report, "entity access error");
            ChannelsHandlerErr::Internal(ChannelMessagesErr::Repo(anyhow::Error::from(report)))
        }
    }
}

/// Handler for `POST /channels/mentions`.
#[utoipa::path(
    post,
    tag = "channels",
    operation_id = "create_entity_mention",
    path = "/channels/mentions",
    request_body = CreateEntityMentionRequest,
    responses(
        (status = 201, body = CreateEntityMentionResponse),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn create_mention_handler<
    S: ChannelService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<ChannelsRouterState<S, Svc, Auth>>,
    macro_user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Json(req): Json<CreateEntityMentionRequest>,
) -> Result<(StatusCode, Json<CreateEntityMentionResponse>), ChannelsHandlerErr> {
    let macro_user = &macro_user.authorization.user;
    require_document_edit_access(
        state.access_service.as_ref(),
        &macro_user.macro_user_id,
        &req.source_entity_type,
        &req.source_entity_id,
    )
    .await?;

    let mention = state
        .service
        .create_entity_mention(CreateEntityMentionOptions {
            source_entity_type: req.source_entity_type,
            source_entity_id: req.source_entity_id,
            entity_type: req.entity_type,
            entity_id: req.entity_id,
            user_id: Some(macro_user.user_context.user_id.clone()),
        })
        .await?;

    Ok((
        StatusCode::CREATED,
        Json(CreateEntityMentionResponse {
            id: mention.id.to_string(),
            source_entity_type: mention.source_entity_type,
            source_entity_id: mention.source_entity_id,
            entity_type: mention.entity_type,
            entity_id: mention.entity_id,
            user_id: mention.user_id,
            created_at: mention.created_at,
        }),
    ))
}

/// Handler for `DELETE /channels/mentions/{mention_id}`.
#[utoipa::path(
    delete,
    tag = "channels",
    operation_id = "delete_entity_mention",
    path = "/channels/mentions/{mention_id}",
    params(
        ("mention_id" = Uuid, Path, description = "Entity mention id"),
    ),
    responses(
        (status = 200, body = DeleteEntityMentionResponse),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn delete_mention_handler<
    S: ChannelService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<ChannelsRouterState<S, Svc, Auth>>,
    macro_user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Path(mention_id): Path<Uuid>,
) -> Result<(StatusCode, Json<DeleteEntityMentionResponse>), ChannelsHandlerErr> {
    let macro_user = &macro_user.authorization.user;
    let mention = state
        .service
        .get_entity_mention(mention_id)
        .await?
        .ok_or(ChannelsHandlerErr::NotFound("entity mention not found"))?;

    require_document_edit_access(
        state.access_service.as_ref(),
        &macro_user.macro_user_id,
        &mention.source_entity_type,
        &mention.source_entity_id,
    )
    .await?;

    let deleted = state.service.delete_entity_mention(mention_id).await?;
    if !deleted {
        return Err(ChannelsHandlerErr::NotFound("entity mention not found"));
    }

    Ok((
        StatusCode::OK,
        Json(DeleteEntityMentionResponse { deleted }),
    ))
}

/// Handler for `GET /channels/{channel_id}/messages`.
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
pub async fn get_channel_attachments_handler<
    S: ChannelService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<ChannelsRouterState<S, Svc, Auth>>,
    access: ChannelAccessLevelExtractor<MemberParticipantRole, Svc, Auth>,
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

/// Channel detail: metadata and active participants.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct ApiChannelDetail {
    /// Channel id.
    channel_id: Uuid,
    /// Channel type.
    channel_type: ChannelType,
    /// Resolved display name from the viewer's perspective.
    channel_name: String,
    /// Active participants.
    participants: Vec<ApiChannelParticipant>,
}

/// Handler for `GET /channels/{channel_id}`.
#[utoipa::path(
    get,
    operation_id = "get_channel",
    path = "/channels/{channel_id}",
    params(
        ("channel_id" = Uuid, Path, description = "Channel ID"),
    ),
    responses(
        (status = 200, body = ApiChannelDetail),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all, fields(channel_id = tracing::field::Empty))]
pub async fn get_channel_handler<
    S: ChannelService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<ChannelsRouterState<S, Svc, Auth>>,
    access: ChannelAccessLevelExtractor<MemberParticipantRole, Svc, Auth>,
) -> Result<Json<ApiChannelDetail>, ChannelsHandlerErr> {
    let channel_id = channel_id_from_receipt(&access.entity_access_receipt)?;
    tracing::Span::current().record("channel_id", tracing::field::display(channel_id));
    let viewer = access
        .entity_access_receipt
        .get_authenticated_user()
        .cloned()
        .map_err(|_| ChannelsHandlerErr::BadRequest("authenticated user required"))?;

    let metadata = state
        .service
        .get_channel_metadata(channel_id, viewer)
        .await?;
    let participants = state.service.get_channel_participants(channel_id).await?;

    Ok(Json(ApiChannelDetail {
        channel_id,
        channel_type: metadata.channel_type,
        channel_name: metadata.channel_name,
        participants: participants
            .into_iter()
            .map(ApiChannelParticipant::from)
            .collect(),
    }))
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
pub async fn get_channel_participants_handler<
    S: ChannelService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<ChannelsRouterState<S, Svc, Auth>>,
    access: ChannelAccessLevelExtractor<MemberParticipantRole, Svc, Auth>,
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

/// Handler for `POST /channels/preview`.
#[utoipa::path(
    post,
    tag = "channels",
    operation_id = "get_batch_channel_preview",
    path = "/channels/preview",
    request_body = GetBatchChannelPreviewRequest,
    responses(
        (status = 200, body = GetBatchChannelPreviewResponse),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn get_batch_channel_preview_handler<
    S: ChannelService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<ChannelsRouterState<S, Svc, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Json(req): Json<GetBatchChannelPreviewRequest>,
) -> Result<Json<GetBatchChannelPreviewResponse>, ChannelsHandlerErr> {
    let user = &user.authorization.user;
    let org_id = user.user_context.organization_id.map(i64::from);
    let previews = state
        .service
        .batch_get_channel_previews(user.macro_user_id.clone(), org_id, req.channel_ids)
        .await?;
    Ok(Json(GetBatchChannelPreviewResponse { previews }))
}

/// Handler for `GET /channels/attachments/{entity_type}/{entity_id}/references`.
#[utoipa::path(
    get,
    operation_id = "get_attachment_references",
    path = "/channels/attachments/{entity_type}/{entity_id}/references",
    params(
        ("entity_type" = String, Path, description = "Type of the attachment entity"),
        ("entity_id" = String, Path, description = "Id of the attachment entity"),
    ),
    responses(
        (status = 200, body = GetAttachmentReferencesResponse),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(
    err,
    skip_all,
    fields(
        entity_type = tracing::field::Empty,
        entity_id = tracing::field::Empty,
    )
)]
pub async fn get_attachment_references_handler<
    S: ChannelService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<ChannelsRouterState<S, Svc, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Path(path): Path<AttachmentReferencesPath>,
) -> Result<Json<GetAttachmentReferencesResponse>, ChannelsHandlerErr> {
    let user = &user.authorization.user;
    let span = tracing::Span::current();
    span.record("entity_type", tracing::field::display(&path.entity_type));
    span.record("entity_id", tracing::field::display(&path.entity_id));

    let references = state
        .service
        .get_attachment_references(
            path.entity_type,
            path.entity_id,
            user.macro_user_id.to_string(),
        )
        .await?;

    Ok(Json(GetAttachmentReferencesResponse {
        references: references
            .into_iter()
            .map(ApiAttachmentEntityReference::from)
            .collect(),
    }))
}

/// Handler for `GET /channels/activity`.
#[utoipa::path(
    get,
    tag = "channels",
    operation_id = "get_activity",
    path = "/channels/activity",
    responses(
        (status = 200, body = Vec<ApiActivity>),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn get_activity_handler<
    S: ChannelService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<ChannelsRouterState<S, Svc, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
) -> Result<Json<Vec<ApiActivity>>, ChannelsHandlerErr> {
    let user = &user.authorization.user;
    let activities = state
        .service
        .get_activities(user.macro_user_id.to_string())
        .await?;
    Ok(Json(
        activities.into_iter().map(ApiActivity::from).collect(),
    ))
}

/// Handler for `POST /channels/activity`.
#[utoipa::path(
    post,
    tag = "channels",
    operation_id = "post_activity",
    path = "/channels/activity",
    request_body = PostActivityRequest,
    responses(
        (status = 200, body = ApiActivity),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn post_activity_handler<
    S: ChannelService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<ChannelsRouterState<S, Svc, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Json(req): Json<PostActivityRequest>,
) -> Result<(StatusCode, Json<ApiActivity>), ChannelsHandlerErr> {
    let user = &user.authorization.user;
    let channel_id = Uuid::parse_str(&req.channel_id)
        .map_err(|_| ChannelsHandlerErr::BadRequest("Invalid channel_id"))?;
    let access = state
        .access_service
        .generate_entity_access_receipt::<MemberParticipantRole>(
            &user.macro_user_id,
            user.user_context.organization_id.map(i64::from),
            &channel_id.to_string(),
            EntityType::Channel,
        )
        .await
        .map_err(map_access_error)?;
    let activity = state
        .service
        .post_activity(access, req.activity_type)
        .await?;
    Ok((StatusCode::OK, Json(ApiActivity::from(activity))))
}

/// Request body for `POST /channels/activity`.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct PostActivityRequest {
    /// Channel id to record activity for.
    pub channel_id: String,
    /// The kind of activity to record.
    pub activity_type: ActivityType,
}

/// A user's activity (view/interaction) within a channel.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct ApiActivity {
    /// Activity id.
    id: Uuid,
    /// User id.
    user_id: String,
    /// Channel id.
    channel_id: Uuid,
    /// When the activity row was created.
    created_at: DateTime<Utc>,
    /// When the activity row was last updated.
    updated_at: DateTime<Utc>,
    /// The last time the user viewed the channel.
    viewed_at: Option<DateTime<Utc>>,
    /// The last time the user interacted with the channel.
    interacted_at: Option<DateTime<Utc>>,
}

impl From<Activity> for ApiActivity {
    fn from(a: Activity) -> Self {
        Self {
            id: a.id,
            user_id: a.user_id,
            channel_id: a.channel_id,
            created_at: a.created_at,
            updated_at: a.updated_at,
            viewed_at: a.viewed_at,
            interacted_at: a.interacted_at,
        }
    }
}

/// Public sender identity for channel messages.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct ApiMessageSender {
    /// Sender type.
    #[serde(rename = "type")]
    sender_type: ApiMessageSenderType,
    /// Sender id without the storage namespace prefix.
    id: String,
    /// Display name for bot senders.
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
    /// Avatar URL for bot senders.
    #[serde(skip_serializing_if = "Option::is_none")]
    avatar_url: Option<String>,
    /// For an agent (bot) message, the id of the user who triggered it.
    #[serde(skip_serializing_if = "Option::is_none")]
    triggered_by: Option<String>,
}

/// Public sender type.
#[derive(Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ApiMessageSenderType {
    /// Macro user sender.
    User,
    /// Bot sender.
    Bot,
}

/// Response from the attachment-references endpoint.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct GetAttachmentReferencesResponse {
    /// References to the requested entity, newest-first.
    pub references: Vec<ApiAttachmentEntityReference>,
}

/// An attachment reference, tagged by source kind.
#[derive(Debug, Serialize, utoipa::ToSchema)]
#[serde(tag = "reference_type", rename_all = "snake_case")]
pub enum ApiAttachmentEntityReference {
    /// Referenced from a channel message.
    Channel(ApiAttachmentChannelReference),
    /// Referenced from any non-message source entity.
    Generic(ApiAttachmentGenericReference),
}

impl From<AttachmentEntityReference> for ApiAttachmentEntityReference {
    fn from(reference: AttachmentEntityReference) -> Self {
        match reference {
            AttachmentEntityReference::Channel(c) => {
                Self::Channel(ApiAttachmentChannelReference::from(c))
            }
            AttachmentEntityReference::Generic(g) => {
                Self::Generic(ApiAttachmentGenericReference::from(g))
            }
        }
    }
}

/// A reference to an attachment entity from a channel message.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct ApiAttachmentChannelReference {
    /// Channel that contains the message.
    pub channel_id: Uuid,
    /// Optional channel name (DMs do not have a name).
    pub channel_name: Option<String>,
    /// Message that contains the attachment reference.
    pub message_id: Uuid,
    /// If the message belongs to a thread this is the parent id.
    pub thread_id: Option<Uuid>,
    /// Sender of the message.
    pub sender_id: String,
    /// Full message content (might be used for preview/snippet).
    pub message_content: String,
    /// When the message itself was created.
    pub message_created_at: DateTime<Utc>,
    /// When the attachment row was created.
    pub attachment_created_at: DateTime<Utc>,
}

impl From<AttachmentChannelReference> for ApiAttachmentChannelReference {
    fn from(r: AttachmentChannelReference) -> Self {
        Self {
            channel_id: r.channel_id,
            channel_name: r.channel_name,
            message_id: r.message_id,
            thread_id: r.thread_id,
            sender_id: r.sender_id,
            message_content: r.message_content,
            message_created_at: r.message_created_at,
            attachment_created_at: r.attachment_created_at,
        }
    }
}

/// A reference to an attachment entity from a non-message source.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct ApiAttachmentGenericReference {
    /// Type of the source entity (e.g., "document", "chat", etc.).
    pub source_entity_type: String,
    /// ID of the source entity.
    pub source_entity_id: String,
    /// Type of the referenced entity.
    pub entity_type: String,
    /// ID of the referenced entity.
    pub entity_id: String,
    /// User who created this reference (optional for non-user sources).
    pub user_id: Option<String>,
    /// When this reference was created.
    pub created_at: DateTime<Utc>,
}

impl From<AttachmentGenericReference> for ApiAttachmentGenericReference {
    fn from(r: AttachmentGenericReference) -> Self {
        Self {
            source_entity_type: r.source_entity_type,
            source_entity_id: r.source_entity_id,
            entity_type: r.entity_type,
            entity_id: r.entity_id,
            user_id: r.user_id,
            created_at: r.created_at,
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
    /// Unauthorized.
    #[error("{0}")]
    Unauthorized(&'static str),
    /// Not found.
    #[error("{0}")]
    NotFound(&'static str),
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
            ChannelsHandlerErr::Unauthorized(message) => (
                StatusCode::UNAUTHORIZED,
                Json(ErrorResponse {
                    message: message.into(),
                }),
            )
                .into_response(),
            ChannelsHandlerErr::NotFound(message) => (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    message: message.into(),
                }),
            )
                .into_response(),
            ChannelsHandlerErr::Mutation(err) => {
                let status = match &err {
                    ChannelMutationErr::BadRequest(_) => StatusCode::BAD_REQUEST,
                    ChannelMutationErr::Unauthorized(_) => StatusCode::UNAUTHORIZED,
                    ChannelMutationErr::Forbidden(_) => StatusCode::FORBIDDEN,
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
