//! Axum router builders and HTTP handlers for the chat API.

use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{FromRef, Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{delete, get, post, put},
};
use entity_access::domain::models::{EditAccessLevel, OwnerAccessLevel, ViewAccessLevel};
use entity_access::domain::ports::EntityAccessService;
use entity_access::inbound::axum_extractors::ChatAccessLevelExtractor;
use model::response::StringIDResponse;
use model_user::axum_extractor::MacroUserExtractor;
use models_permissions::share_permission::SharePermissionV2;
use serde::Deserialize;
use utoipa::ToSchema;

use crate::domain::models::{ChatErr, CreateChatArgs, GetChatResponse, PatchChatArgs};
use crate::domain::ports::ChatService;

/// Shared state for the chat router, wrapping a [`ChatService`] implementation
/// and an [`EntityAccessService`] for authorization.
pub struct ChatRouterState<S, Svc> {
    inner: Arc<S>,
    access_service: Arc<Svc>,
}

impl<S, Svc> Clone for ChatRouterState<S, Svc> {
    fn clone(&self) -> Self {
        Self {
            inner: Arc::clone(&self.inner),
            access_service: Arc::clone(&self.access_service),
        }
    }
}

impl<S, Svc> FromRef<ChatRouterState<S, Svc>> for Arc<Svc> {
    fn from_ref(state: &ChatRouterState<S, Svc>) -> Self {
        state.access_service.clone()
    }
}

impl<S: ChatService, Svc: EntityAccessService> ChatRouterState<S, Svc> {
    /// Create a new [`ChatRouterState`] from a service and access service.
    pub fn new(service: S, access_service: Svc) -> Self {
        Self {
            inner: Arc::new(service),
            access_service: Arc::new(access_service),
        }
    }
}

/// Build the router for the `POST /` create-chat route.
///
/// This is separated so that DCS can apply different middleware
/// (e.g. `ensure_user_exists` + quota checks) without `ensure_chat_exists`.
pub fn chat_create_router<S: ChatService, Svc: EntityAccessService, T: Send + Sync + 'static>(
    state: ChatRouterState<S, Svc>,
) -> Router<T> {
    Router::new()
        .route("/", post(create_chat_handler::<S, Svc>))
        .with_state(state)
}

/// Build the router for all `/{chat_id}` routes.
///
/// These routes require `ensure_chat_exists` middleware to populate
/// `ChatBasic` in extensions before the [`ChatAccessLevelExtractor`] runs.
pub fn chat_id_router<S: ChatService, Svc: EntityAccessService, T: Send + Sync + 'static>(
    state: ChatRouterState<S, Svc>,
) -> Router<T> {
    Router::new()
        .route(
            "/{chat_id}",
            get(get_chat_handler::<S, Svc>)
                .delete(delete_chat_handler::<S, Svc>)
                .patch(patch_chat_handler::<S, Svc>),
        )
        .route(
            "/{chat_id}/permanent",
            delete(permanently_delete_chat_handler::<S, Svc>),
        )
        .route("/{chat_id}/copy", post(copy_chat_handler::<S, Svc>))
        .route(
            "/{chat_id}/revert_delete",
            put(revert_delete_handler::<S, Svc>),
        )
        .route(
            "/{chat_id}/permissions",
            get(get_chat_permissions_handler::<S, Svc>),
        )
        .with_state(state)
}

/// HTTP error type for chat handlers, mapped from [`ChatErr`].
#[derive(Debug)]
pub enum ChatHandlerErr {
    /// Something went wrong internally.
    Internal,
    /// The requested resource was not found.
    NotFound,
    /// The request was bad
    BadRequest(String),
}

impl From<ChatErr> for ChatHandlerErr {
    fn from(err: ChatErr) -> Self {
        match err {
            ChatErr::BadRequest(e) => ChatHandlerErr::BadRequest(e),
            ChatErr::NotFound => ChatHandlerErr::NotFound,
            ChatErr::Unknown(e) => {
                tracing::error!(error=?e, "chat handler error");
                ChatHandlerErr::Internal
            }
        }
    }
}

impl IntoResponse for ChatHandlerErr {
    fn into_response(self) -> axum::response::Response {
        let (status, msg) = match self {
            ChatHandlerErr::Internal => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Internal server error".to_string(),
            ),
            ChatHandlerErr::NotFound => (StatusCode::NOT_FOUND, "Not found".to_string()),
            ChatHandlerErr::BadRequest(e) => (StatusCode::BAD_REQUEST, e),
        };

        (status, msg).into_response()
    }
}

/// Request body for creating a chat.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateChatRequest {
    /// Optional name for the chat.
    pub name: Option<String>,
    /// Optional project to associate the chat with.
    pub project_id: Option<String>,
}

#[utoipa::path(
    post,
    path = "/chats",
    tag = "chats",
    operation_id = "create_chat",
    responses(
        (status = 200, body = StringIDResponse),
        (status = 401, body = String),
        (status = 500, body = String),
    )
)]
/// Create a new chat.
#[tracing::instrument(skip(state, user, req), fields(user_id = %user.macro_user_id))]
pub async fn create_chat_handler<S: ChatService, Svc: EntityAccessService>(
    State(state): State<ChatRouterState<S, Svc>>,
    user: MacroUserExtractor,
    Json(req): Json<CreateChatRequest>,
) -> Result<Json<StringIDResponse>, ChatHandlerErr> {
    let id = state
        .inner
        .create(
            user.macro_user_id,
            CreateChatArgs {
                name: req.name.unwrap_or_else(|| "New Chat".to_string()),
                project_id: req.project_id,
            },
        )
        .await?;

    Ok(Json(StringIDResponse { id }))
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
#[tracing::instrument(skip(state, access), fields(chat_id = %chat_id))]
pub async fn get_chat_handler<S: ChatService, Svc: EntityAccessService>(
    access: ChatAccessLevelExtractor<ViewAccessLevel, Svc>,
    State(state): State<ChatRouterState<S, Svc>>,
    Path(chat_id): Path<String>,
) -> Result<Json<GetChatResponse>, ChatHandlerErr> {
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
#[tracing::instrument(skip(state, access), fields(chat_id = %chat_id))]
pub async fn delete_chat_handler<S: ChatService, Svc: EntityAccessService>(
    access: ChatAccessLevelExtractor<OwnerAccessLevel, Svc>,
    State(state): State<ChatRouterState<S, Svc>>,
    Path(chat_id): Path<String>,
) -> Result<StatusCode, ChatHandlerErr> {
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
#[tracing::instrument(skip(state, access), fields(chat_id = %chat_id))]
pub async fn permanently_delete_chat_handler<S: ChatService, Svc: EntityAccessService>(
    access: ChatAccessLevelExtractor<OwnerAccessLevel, Svc>,
    State(state): State<ChatRouterState<S, Svc>>,
    Path(chat_id): Path<String>,
) -> Result<StatusCode, ChatHandlerErr> {
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
#[tracing::instrument(skip(state, access, req), fields(chat_id = %chat_id))]
pub async fn patch_chat_handler<S: ChatService, Svc: EntityAccessService>(
    access: ChatAccessLevelExtractor<OwnerAccessLevel, Svc>,
    State(state): State<ChatRouterState<S, Svc>>,
    Path(chat_id): Path<String>,
    Json(req): Json<PatchChatRequest>,
) -> Result<StatusCode, ChatHandlerErr> {
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
    post,
    path = "/chats/{chat_id}/copy",
    tag = "chats",
    operation_id = "copy_chat",
    params(("chat_id" = String, Path, description = "ID of the chat to copy")),
    responses(
        (status = 200, body = StringIDResponse),
        (status = 401, body = String),
        (status = 404, body = String),
        (status = 500, body = String),
    )
)]
/// Copy a chat and its messages into a new chat.
#[tracing::instrument(skip(state, access), fields(chat_id = %chat_id))]
pub async fn copy_chat_handler<S: ChatService, Svc: EntityAccessService>(
    access: ChatAccessLevelExtractor<ViewAccessLevel, Svc>,
    State(state): State<ChatRouterState<S, Svc>>,
    Path(chat_id): Path<String>,
) -> Result<Json<StringIDResponse>, ChatHandlerErr> {
    let id = state.inner.copy_chat(access.entity_access_receipt).await?;
    Ok(Json(StringIDResponse { id }))
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
#[tracing::instrument(skip(state, access), fields(chat_id = %chat_id))]
pub async fn revert_delete_handler<S: ChatService, Svc: EntityAccessService>(
    access: ChatAccessLevelExtractor<OwnerAccessLevel, Svc>,
    State(state): State<ChatRouterState<S, Svc>>,
    Path(chat_id): Path<String>,
) -> Result<StatusCode, ChatHandlerErr> {
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
#[tracing::instrument(skip(state, access), fields(chat_id = %chat_id))]
pub async fn get_chat_permissions_handler<S: ChatService, Svc: EntityAccessService>(
    access: ChatAccessLevelExtractor<EditAccessLevel, Svc>,
    State(state): State<ChatRouterState<S, Svc>>,
    Path(chat_id): Path<String>,
) -> Result<Json<GetChatPermissionsResponse>, ChatHandlerErr> {
    let permissions = state
        .inner
        .get_permissions(access.entity_access_receipt)
        .await?;
    Ok(Json(GetChatPermissionsResponse { permissions }))
}
