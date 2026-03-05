//! HTTP handlers and router for the chat API.

#[cfg(test)]
mod test;

use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{FromRef, Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{delete, get, post, put},
};
use entity_access::domain::models::{
    EditAccessLevel, EntityPermission, OwnerAccessLevel, ViewAccessLevel,
};
use entity_access::domain::ports::EntityAccessService;
use entity_access::inbound::axum_extractors::ChatAccessLevelExtractor;
use model::response::StringIDResponse;
use model_user::axum_extractor::MacroUserExtractor;
use models_permissions::share_permission::SharePermissionV2;
use serde::Deserialize;
use thiserror::Error;
use utoipa::ToSchema;

use crate::domain::ports::ChatRepo;
use crate::models::{CopyChatArgs, CreateChatArgs, GetChatResponse, PatchChatArgs};

/// Shared state for the chat router, wrapping a [`ChatRepo`] implementation
/// and an [`EntityAccessService`] for authorization.
pub struct ChatRouterState<R, Svc> {
    inner: Arc<R>,
    access_service: Arc<Svc>,
}

impl<R, Svc> Clone for ChatRouterState<R, Svc> {
    fn clone(&self) -> Self {
        Self {
            inner: Arc::clone(&self.inner),
            access_service: Arc::clone(&self.access_service),
        }
    }
}

impl<R, Svc> FromRef<ChatRouterState<R, Svc>> for Arc<Svc> {
    fn from_ref(state: &ChatRouterState<R, Svc>) -> Self {
        state.access_service.clone()
    }
}

impl<R: ChatRepo, Svc: EntityAccessService> ChatRouterState<R, Svc> {
    /// Create a new [`ChatRouterState`] from a repo and access service.
    pub fn new(repo: R, access_service: Svc) -> Self {
        Self {
            inner: Arc::new(repo),
            access_service: Arc::new(access_service),
        }
    }
}

/// Build the router for the `POST /` create-chat route.
///
/// This is separated so that DCS can apply different middleware
/// (e.g. `ensure_user_exists` + quota checks) without `ensure_chat_exists`.
pub fn chat_create_router<R: ChatRepo, Svc: EntityAccessService, T: Send + Sync + 'static>(
    state: ChatRouterState<R, Svc>,
) -> Router<T> {
    Router::new()
        .route("/", post(create_chat_handler::<R, Svc>))
        .with_state(state)
}

/// Build the router for all `/:chat_id` routes.
///
/// These routes require `ensure_chat_exists` middleware to populate
/// `ChatBasic` in extensions before the [`ChatAccessLevelExtractor`] runs.
pub fn chat_id_router<R: ChatRepo, Svc: EntityAccessService, T: Send + Sync + 'static>(
    state: ChatRouterState<R, Svc>,
) -> Router<T> {
    Router::new()
        .route(
            "/:chat_id",
            get(get_chat_handler::<R, Svc>)
                .delete(delete_chat_handler::<R, Svc>)
                .patch(patch_chat_handler::<R, Svc>),
        )
        .route(
            "/:chat_id/permanent",
            delete(permanently_delete_chat_handler::<R, Svc>),
        )
        .route("/:chat_id/copy", post(copy_chat_handler::<R, Svc>))
        .route(
            "/:chat_id/revert_delete",
            put(revert_delete_handler::<R, Svc>),
        )
        .route(
            "/:chat_id/permissions",
            get(get_chat_permissions_handler::<R, Svc>),
        )
        .with_state(state)
}

/// Error type for chat handlers.
#[derive(Debug, Error)]
pub enum ChatErr {
    /// Something went wrong internally.
    #[error("Internal server error")]
    Internal,
    /// The requested resource was not found.
    #[error("Not found")]
    NotFound,
}

impl IntoResponse for ChatErr {
    fn into_response(self) -> axum::response::Response {
        let status = match self {
            ChatErr::Internal => StatusCode::INTERNAL_SERVER_ERROR,
            ChatErr::NotFound => StatusCode::NOT_FOUND,
        };
        (status, self.to_string()).into_response()
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
pub async fn create_chat_handler<R: ChatRepo, Svc: EntityAccessService>(
    State(state): State<ChatRouterState<R, Svc>>,
    user: MacroUserExtractor,
    Json(req): Json<CreateChatRequest>,
) -> Result<Json<StringIDResponse>, ChatErr> {
    let id = state
        .inner
        .create(
            user.macro_user_id,
            CreateChatArgs {
                name: req.name.unwrap_or_else(|| "New Chat".to_string()),
                project_id: req.project_id,
            },
        )
        .await
        .inspect_err(|e| tracing::error!(error=?e, "failed to create chat"))
        .map_err(|_| ChatErr::Internal)?;

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
pub async fn get_chat_handler<R: ChatRepo, Svc: EntityAccessService>(
    access: ChatAccessLevelExtractor<ViewAccessLevel, Svc>,
    State(state): State<ChatRouterState<R, Svc>>,
    Path(chat_id): Path<String>,
) -> Result<Json<GetChatResponse>, ChatErr> {
    let chat = state
        .inner
        .get_chat(&chat_id)
        .await
        .inspect_err(|e| tracing::error!(error=?e, "failed to get chat"))
        .map_err(|e| {
            if e.to_string()
                .contains("no rows returned by a query that expected to return at least one row")
            {
                ChatErr::NotFound
            } else {
                ChatErr::Internal
            }
        })?;

    let user_access_level = match access.entity_access_receipt.entity_permission() {
        EntityPermission::AccessLevel { access_level } => *access_level,
        _ => unreachable!("chat permissions are always access levels"),
    };

    Ok(Json(GetChatResponse {
        chat,
        user_access_level,
    }))
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
#[tracing::instrument(skip(state, _access), fields(chat_id = %chat_id))]
pub async fn delete_chat_handler<R: ChatRepo, Svc: EntityAccessService>(
    _access: ChatAccessLevelExtractor<OwnerAccessLevel, Svc>,
    State(state): State<ChatRouterState<R, Svc>>,
    Path(chat_id): Path<String>,
) -> Result<StatusCode, ChatErr> {
    state
        .inner
        .delete(&chat_id)
        .await
        .inspect_err(|e| tracing::error!(error=?e, "failed to delete chat"))
        .map_err(|_| ChatErr::Internal)?;

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
#[tracing::instrument(skip(state, _access), fields(chat_id = %chat_id))]
pub async fn permanently_delete_chat_handler<R: ChatRepo, Svc: EntityAccessService>(
    _access: ChatAccessLevelExtractor<OwnerAccessLevel, Svc>,
    State(state): State<ChatRouterState<R, Svc>>,
    Path(chat_id): Path<String>,
) -> Result<StatusCode, ChatErr> {
    state
        .inner
        .permanently_delete(&chat_id)
        .await
        .inspect_err(|e| tracing::error!(error=?e, "failed to permanently delete chat"))
        .map_err(|_| ChatErr::Internal)?;

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
pub async fn patch_chat_handler<R: ChatRepo, Svc: EntityAccessService>(
    access: ChatAccessLevelExtractor<OwnerAccessLevel, Svc>,
    State(state): State<ChatRouterState<R, Svc>>,
    Path(chat_id): Path<String>,
    Json(req): Json<PatchChatRequest>,
) -> Result<StatusCode, ChatErr> {
    let user_id = match access.entity_access_receipt.auth() {
        entity_access::domain::models::EntityAccessAuth::Authenticated(id) => {
            macro_user_id::user_id::MacroUserIdStr(id.clone())
        }
        _ => return Err(ChatErr::Internal),
    };

    state
        .inner
        .patch(
            user_id,
            &chat_id,
            PatchChatArgs {
                name: req.name,
                project_id: req.project_id,
                share_permission: req.share_permission,
            },
        )
        .await
        .inspect_err(|e| tracing::error!(error=?e, "failed to patch chat"))
        .map_err(|_| ChatErr::Internal)?;

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
#[tracing::instrument(skip(state, _access, user), fields(user_id = %user.macro_user_id, chat_id = %chat_id))]
pub async fn copy_chat_handler<R: ChatRepo, Svc: EntityAccessService>(
    _access: ChatAccessLevelExtractor<ViewAccessLevel, Svc>,
    State(state): State<ChatRouterState<R, Svc>>,
    user: MacroUserExtractor,
    Path(chat_id): Path<String>,
) -> Result<Json<StringIDResponse>, ChatErr> {
    let chat = state
        .inner
        .get_metadata(&chat_id)
        .await
        .inspect_err(|e| tracing::error!(error=?e, "failed to get chat for copy"))
        .map_err(|e| {
            if e.to_string()
                .contains("no rows returned by a query that expected to return at least one row")
            {
                ChatErr::NotFound
            } else {
                ChatErr::Internal
            }
        })?;

    let id = state
        .inner
        .copy_chat(
            user.macro_user_id,
            &chat_id,
            CopyChatArgs {
                name: format!("{} Copy", chat.name),
                project_id: None,
            },
        )
        .await
        .inspect_err(|e| tracing::error!(error=?e, "failed to copy chat"))
        .map_err(|_| ChatErr::Internal)?;

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
#[tracing::instrument(skip(state, _access), fields(chat_id = %chat_id))]
pub async fn revert_delete_handler<R: ChatRepo, Svc: EntityAccessService>(
    _access: ChatAccessLevelExtractor<OwnerAccessLevel, Svc>,
    State(state): State<ChatRouterState<R, Svc>>,
    Path(chat_id): Path<String>,
) -> Result<StatusCode, ChatErr> {
    let chat = state
        .inner
        .get_metadata(&chat_id)
        .await
        .inspect_err(|e| tracing::error!(error=?e, "failed to get chat for revert"))
        .map_err(|_| ChatErr::Internal)?;

    state
        .inner
        .revert_delete(&chat_id, chat.project_id.as_deref())
        .await
        .inspect_err(|e| tracing::error!(error=?e, "failed to revert delete chat"))
        .map_err(|_| ChatErr::Internal)?;

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
#[tracing::instrument(skip(state, _access), fields(chat_id = %chat_id))]
pub async fn get_chat_permissions_handler<R: ChatRepo, Svc: EntityAccessService>(
    _access: ChatAccessLevelExtractor<EditAccessLevel, Svc>,
    State(state): State<ChatRouterState<R, Svc>>,
    Path(chat_id): Path<String>,
) -> Result<Json<GetChatPermissionsResponse>, ChatErr> {
    let permissions = state
        .inner
        .get_permissions(&chat_id)
        .await
        .inspect_err(|e| tracing::error!(error=?e, "failed to get chat permissions"))
        .map_err(|_| ChatErr::Internal)?;

    Ok(Json(GetChatPermissionsResponse { permissions }))
}
