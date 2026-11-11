//! Axum router builders and HTTP handlers for the chat API.

use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{FromRef, Path, State},
    http::StatusCode,
    routing::{delete, get, put},
};
use entity_access::domain::models::{EditAccessLevel, OwnerAccessLevel, ViewAccessLevel};
use entity_access::domain::ports::EntityAccessService;
use entity_access::inbound::axum_extractors::ChatAccessLevelExtractor;
use entity_registry::NonUserOwners;
use macro_authorization::{MacroAuthorizationService, MacroAuthorizationState};
use models_permissions::share_permission::SharePermissionV2;
use roles_and_permissions::domain::port::UserRolesAndPermissionsService;
use serde::Deserialize;
use utoipa::ToSchema;

use crate::domain::models::{GetChatResponse, PatchChatArgs, Result};
use crate::domain::ports::ChatService;
use crate::inbound::http::extractors::UserPermissionsState;

/// Shared state for the chat router, wrapping a [`ChatService`] implementation,
/// an [`EntityAccessService`] for entity authorization, a
/// [`MacroAuthorizationService`] for caller authentication, a
/// [`UserRolesAndPermissionsService`] for model-entitlement lookups, and the
/// [`NonUserOwners`] gate deciding whether a team bot with no acting user may
/// own the chats it creates.
pub struct ChatRouterState<S, Svc, Auth, P> {
    inner: Arc<S>,
    access_service: Arc<Svc>,
    authorization_state: MacroAuthorizationState<Auth>,
    permissions_state: UserPermissionsState<P>,
    non_user_owners: NonUserOwners,
}

impl<S, Svc, Auth, P> Clone for ChatRouterState<S, Svc, Auth, P> {
    fn clone(&self) -> Self {
        Self {
            inner: Arc::clone(&self.inner),
            access_service: Arc::clone(&self.access_service),
            authorization_state: self.authorization_state.clone(),
            permissions_state: self.permissions_state.clone(),
            non_user_owners: self.non_user_owners,
        }
    }
}

impl<S, Svc, Auth, P> FromRef<ChatRouterState<S, Svc, Auth, P>> for Arc<Svc> {
    fn from_ref(state: &ChatRouterState<S, Svc, Auth, P>) -> Self {
        state.access_service.clone()
    }
}

impl<S, Svc, Auth, P> FromRef<ChatRouterState<S, Svc, Auth, P>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &ChatRouterState<S, Svc, Auth, P>) -> Self {
        state.authorization_state.clone()
    }
}

impl<S, Svc, Auth, P> FromRef<ChatRouterState<S, Svc, Auth, P>> for UserPermissionsState<P> {
    fn from_ref(state: &ChatRouterState<S, Svc, Auth, P>) -> Self {
        state.permissions_state.clone()
    }
}

impl<S, Svc, Auth, P> FromRef<ChatRouterState<S, Svc, Auth, P>> for NonUserOwners {
    fn from_ref(state: &ChatRouterState<S, Svc, Auth, P>) -> Self {
        state.non_user_owners
    }
}

impl<
    S: ChatService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
    P: UserRolesAndPermissionsService,
> ChatRouterState<S, Svc, Auth, P>
{
    /// Create a new [`ChatRouterState`] from a service, access service,
    /// authorization state, roles-and-permissions service, and the gate for
    /// chats owned by a team bot.
    pub fn new(
        service: S,
        access_service: Svc,
        authorization_state: MacroAuthorizationState<Auth>,
        permissions_service: Arc<P>,
        non_user_owners: NonUserOwners,
    ) -> Self {
        Self {
            inner: Arc::new(service),
            access_service: Arc::new(access_service),
            authorization_state,
            permissions_state: UserPermissionsState(permissions_service),
            non_user_owners,
        }
    }
}

/// Build the router for the read-only `GET /{chat_id}` view route.
///
/// Separated from [`chat_id_router`] so callers can apply
/// `ensure_chat_exists` without also requiring a real authenticated user:
/// the [`ChatAccessLevelExtractor`] already grants `ViewAccessLevel` to
/// anonymous callers when the chat has public-link view sharing enabled,
/// so gating this route on authentication would 401 legitimate public-link
/// viewers before the extractor ever runs.
pub fn chat_view_router<
    S: ChatService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
    P: UserRolesAndPermissionsService,
    T: Send + Sync + 'static,
>(
    state: ChatRouterState<S, Svc, Auth, P>,
) -> Router<T> {
    Router::new()
        .route("/{chat_id}", get(get_chat_handler::<S, Svc, Auth, P>))
        .with_state(state)
}

/// Build the router for the remaining, owner/editor-only `/{chat_id}` routes.
///
/// These routes require `ensure_chat_exists` middleware to populate
/// `ChatBasic` in extensions before the [`ChatAccessLevelExtractor`] runs.
pub fn chat_id_router<
    S: ChatService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
    P: UserRolesAndPermissionsService,
    T: Send + Sync + 'static,
>(
    state: ChatRouterState<S, Svc, Auth, P>,
) -> Router<T> {
    Router::new()
        .route(
            "/{chat_id}",
            delete(delete_chat_handler::<S, Svc, Auth, P>)
                .patch(patch_chat_handler::<S, Svc, Auth, P>),
        )
        .route(
            "/{chat_id}/permanent",
            delete(permanently_delete_chat_handler::<S, Svc, Auth, P>),
        )
        .route(
            "/{chat_id}/revert_delete",
            put(revert_delete_handler::<S, Svc, Auth, P>),
        )
        .route(
            "/{chat_id}/permissions",
            get(get_chat_permissions_handler::<S, Svc, Auth, P>),
        )
        .with_state(state)
}

#[utoipa::path(
    get,
    path = "/chats/{chat_id}",
    tag = "chats",
    operation_id = "get_chat",
    params(("chat_id" = String, Path, description = "ID of the chat")),
    responses(
        (status = 200, body = GetChatResponse),
        (status = 401, body = String),
        (status = 404, body = String),
        (status = 500, body = String),
    )
)]
/// Get a chat by ID with messages and web citations.
#[tracing::instrument(skip(state, access), fields(chat_id = %chat_id), err(Debug))]
pub async fn get_chat_handler<
    S: ChatService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
    P: UserRolesAndPermissionsService,
>(
    access: ChatAccessLevelExtractor<ViewAccessLevel, Svc, Auth>,
    State(state): State<ChatRouterState<S, Svc, Auth, P>>,
    Path(chat_id): Path<String>,
) -> Result<Json<GetChatResponse>> {
    let response = state.inner.get_chat(access.entity_access_receipt).await?;

    Ok(Json(response))
}

#[utoipa::path(
    delete,
    path = "/chat/{chat_id}",
    tag = "chats",
    operation_id = "delete_chat",
    params(("chat_id" = String, Path, description = "ID of the chat")),
    responses(
        (status = 200),
        (status = 401, body = String),
        (status = 500, body = String),
    )
)]
/// Soft-delete a chat.
#[tracing::instrument(skip(state, access), fields(chat_id = %chat_id), err(Debug))]
pub async fn delete_chat_handler<
    S: ChatService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
    P: UserRolesAndPermissionsService,
>(
    access: ChatAccessLevelExtractor<OwnerAccessLevel, Svc, Auth>,
    State(state): State<ChatRouterState<S, Svc, Auth, P>>,
    Path(chat_id): Path<String>,
) -> Result<StatusCode> {
    state.inner.delete(access.entity_access_receipt).await?;
    Ok(StatusCode::OK)
}

#[utoipa::path(
    delete,
    path = "/chat/{chat_id}/permanent",
    tag = "chats",
    operation_id = "permanently_delete_chat",
    params(("chat_id" = String, Path, description = "ID of the chat")),
    responses(
        (status = 200),
        (status = 401, body = String),
        (status = 500, body = String),
    )
)]
/// Permanently delete a chat and all associated data.
#[tracing::instrument(skip(state, access), fields(chat_id = %chat_id), err(Debug))]
pub async fn permanently_delete_chat_handler<
    S: ChatService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
    P: UserRolesAndPermissionsService,
>(
    access: ChatAccessLevelExtractor<OwnerAccessLevel, Svc, Auth>,
    State(state): State<ChatRouterState<S, Svc, Auth, P>>,
    Path(chat_id): Path<String>,
) -> Result<StatusCode> {
    state
        .inner
        .permanently_delete(access.entity_access_receipt)
        .await?;
    Ok(StatusCode::OK)
}

/// Request body for patching a chat.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PatchChatRequest {
    /// New name for the chat.
    pub name: Option<String>,
    /// New project ID for the chat. Empty string clears the project.
    pub project_id: Option<String>,
    /// Share permission updates.
    pub share_permission:
        Option<models_permissions::share_permission::UpdateSharePermissionRequestV2>,
}

#[utoipa::path(
    patch,
    path = "/chat/{chat_id}",
    tag = "chats",
    operation_id = "patch_chat",
    params(("chat_id" = String, Path, description = "ID of the chat")),
    responses(
        (status = 200),
        (status = 401, body = String),
        (status = 500, body = String),
    )
)]
/// Patch a chat's name, project, or share permissions.
#[tracing::instrument(skip(state, access, req), fields(chat_id = %chat_id), err(Debug))]
pub async fn patch_chat_handler<
    S: ChatService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
    P: UserRolesAndPermissionsService,
>(
    access: ChatAccessLevelExtractor<OwnerAccessLevel, Svc, Auth>,
    State(state): State<ChatRouterState<S, Svc, Auth, P>>,
    Path(chat_id): Path<String>,
    Json(req): Json<PatchChatRequest>,
) -> Result<StatusCode> {
    state
        .inner
        .patch(
            access.entity_access_receipt,
            PatchChatArgs {
                name: req.name,
                project_id: req.project_id,
                share_permission: req.share_permission,
            },
        )
        .await?;

    Ok(StatusCode::OK)
}

#[utoipa::path(
    put,
    path = "/chats/{chat_id}/revert_delete",
    tag = "chats",
    operation_id = "revert_delete_chat",
    params(("chat_id" = String, Path, description = "ID of the chat to restore")),
    responses(
        (status = 200),
        (status = 401, body = String),
        (status = 500, body = String),
    )
)]
/// Revert a soft-deleted chat.
#[tracing::instrument(skip(state, access), fields(chat_id = %chat_id), err(Debug))]
pub async fn revert_delete_handler<
    S: ChatService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
    P: UserRolesAndPermissionsService,
>(
    access: ChatAccessLevelExtractor<OwnerAccessLevel, Svc, Auth>,
    State(state): State<ChatRouterState<S, Svc, Auth, P>>,
    Path(chat_id): Path<String>,
) -> Result<StatusCode> {
    state
        .inner
        .revert_delete(access.entity_access_receipt)
        .await?;
    Ok(StatusCode::OK)
}

/// Response body for get chat permissions.
#[derive(Debug, serde::Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct GetChatPermissionsResponse {
    /// The share permissions for the chat.
    pub permissions: SharePermissionV2,
}

#[utoipa::path(
    get,
    path = "/chats/{chat_id}/permissions",
    tag = "chats",
    operation_id = "get_chat_permissions",
    params(("chat_id" = String, Path, description = "ID of the chat")),
    responses(
        (status = 200, body = GetChatPermissionsResponse),
        (status = 401, body = String),
        (status = 500, body = String),
    )
)]
/// Get the share permissions for a chat.
#[tracing::instrument(skip(state, access), fields(chat_id = %chat_id), err(Debug))]
pub async fn get_chat_permissions_handler<
    S: ChatService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
    P: UserRolesAndPermissionsService,
>(
    access: ChatAccessLevelExtractor<EditAccessLevel, Svc, Auth>,
    State(state): State<ChatRouterState<S, Svc, Auth, P>>,
    Path(chat_id): Path<String>,
) -> Result<Json<GetChatPermissionsResponse>> {
    let permissions = state
        .inner
        .get_permissions(access.entity_access_receipt)
        .await?;
    Ok(Json(GetChatPermissionsResponse { permissions }))
}
