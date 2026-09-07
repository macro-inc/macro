use crate::domain::{api::MessageServiceApi, models::*, ports::*};
use axum::{
    Json, Router,
    extract::{FromRef, Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
};
use entity_access::domain::{
    models::{EntityAccessReceipt, EntityType, RequiredPermission},
    ports::EntityAccessService,
};
use macro_authorization::{
    AnyPrincipal, MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

/// Composition state for shared messages.
pub struct MessagesRouterState<A, Auth> {
    /// Shared message domain service.
    pub service: Arc<dyn MessageServiceApi>,
    /// Existing parent access boundary.
    pub access: Arc<A>,
    /// Authentication state.
    pub authorization: MacroAuthorizationState<Auth>,
}

impl<A, Auth> Clone for MessagesRouterState<A, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            access: self.access.clone(),
            authorization: self.authorization.clone(),
        }
    }
}

impl<A, Auth> FromRef<MessagesRouterState<A, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &MessagesRouterState<A, Auth>) -> Self {
        state.authorization.clone()
    }
}

/// Routes mounted at `/messages` by the service composition root.
pub fn router<A, Auth, S>(state: MessagesRouterState<A, Auth>) -> Router<S>
where
    A: EntityAccessService,
    Auth: MacroAuthorizationService + Send + Sync + 'static,
    S: Clone + Send + Sync + 'static,
{
    Router::new()
        .route(
            "/{parent_type}/{parent_id}",
            get(list::<A, Auth>).post(create::<A, Auth>),
        )
        .route(
            "/{parent_type}/{parent_id}/items/{id}",
            get(get_message::<A, Auth>)
                .patch(edit::<A, Auth>)
                .delete(delete_message::<A, Auth>),
        )
        .route(
            "/{parent_type}/{parent_id}/items/{id}/reactions",
            post(react::<A, Auth>),
        )
        .route(
            "/{parent_type}/{parent_id}/threads/{id}",
            get(get_thread::<A, Auth>)
                .patch(resolve::<A, Auth>)
                .delete(delete_thread::<A, Auth>),
        )
        .route(
            "/{parent_type}/{parent_id}/threads/{id}/typing",
            post(typing::<A, Auth>),
        )
        .route(
            "/{parent_type}/{parent_id}/legacy/{legacy_id}",
            get(legacy::<A, Auth>),
        )
        .route(
            "/{parent_type}/{parent_id}/references",
            get(referenced_threads::<A, Auth>),
        )
        .with_state(state)
}

/// Parent path shared by every operation.
#[derive(Debug, Deserialize)]
pub struct ParentPath {
    /// Parent entity type.
    pub parent_type: String,
    /// Parent entity id.
    pub parent_id: String,
    /// Message or root id for item routes.
    pub id: Option<Uuid>,
    /// Historical numeric id for link resolution.
    pub legacy_id: Option<i64>,
}

/// HTTP failure mapping; business decisions are made by the domain service.
pub struct MessageHttpError(MessageError);
impl From<MessageError> for MessageHttpError {
    fn from(value: MessageError) -> Self {
        Self(value)
    }
}
impl IntoResponse for MessageHttpError {
    fn into_response(self) -> Response {
        let (status, message) = match self.0 {
            MessageError::NotFound => (StatusCode::NOT_FOUND, "message or parent not found"),
            MessageError::Forbidden => (StatusCode::FORBIDDEN, "forbidden"),
            MessageError::Invalid(message) => (StatusCode::BAD_REQUEST, message),
            MessageError::Repository(error) => {
                tracing::error!(error=?error, "message request failed");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "message operation failed",
                )
            }
        };
        (status, Json(serde_json::json!({ "message": message }))).into_response()
    }
}

async fn receipt<P: RequiredPermission, A: EntityAccessService, Auth: MacroAuthorizationService>(
    access: &A,
    user: &MacroAuthorizationExtractor<Auth, AnyPrincipal>,
    path: &ParentPath,
) -> Result<EntityAccessReceipt<P>, MessageHttpError> {
    let parent = MessageParent::parse(&path.parent_type, &path.parent_id)
        .map_err(|_| MessageError::Invalid("invalid message parent"))?;
    let kind = match parent {
        MessageParent::Channel(_) => EntityType::Channel,
        MessageParent::Document(_) => EntityType::Document,
    };
    entity_access::inbound::axum_extractors::principal_entity_access_receipt::<P>(
        access,
        &user.authorization,
        &path.parent_id,
        kind,
    )
    .await
    .map_err(|error| match error {
        entity_access::domain::models::AccessError::Unavailable(error)
        | entity_access::domain::models::AccessError::Internal(error) => {
            MessageError::Repository(error).into()
        }
        _ => MessageError::Forbidden.into(),
    })
}

fn path_id(path: &ParentPath) -> Result<Uuid, MessageHttpError> {
    path.id
        .ok_or_else(|| MessageError::Invalid("message id required").into())
}

/// Timeline cursor parameters.
#[derive(Debug, Default, Deserialize, utoipa::IntoParams)]
pub struct PageQuery {
    /// Maximum number of roots.
    pub limit: Option<u16>,
    /// Last root's creation timestamp.
    pub created_at: Option<chrono::DateTime<chrono::Utc>>,
    /// Last root's UUID.
    pub cursor_id: Option<Uuid>,
}

#[utoipa::path(operation_id = "entity_message_list", get, path = "/messages/{parent_type}/{parent_id}", params(("parent_type" = String, Path), ("parent_id" = String, Path), PageQuery), responses((status = 200, body = ThreadPage)))]
/// List a parent's discussions.
pub async fn list<A, Auth>(
    State(state): State<MessagesRouterState<A, Auth>>,
    user: MacroAuthorizationExtractor<Auth, AnyPrincipal>,
    Path(path): Path<ParentPath>,
    Query(query): Query<PageQuery>,
) -> Result<Json<ThreadPage>, MessageHttpError>
where
    A: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let cursor = match (query.created_at, query.cursor_id) {
        (Some(created_at), Some(id)) => Some(MessageCursor { created_at, id }),
        (None, None) => None,
        _ => return Err(MessageError::Invalid("both cursor fields are required").into()),
    };
    Ok(Json(
        state
            .service
            .list(
                receipt(state.access.as_ref(), &user, &path).await?,
                cursor,
                query.limit.unwrap_or(50),
            )
            .await?,
    ))
}

#[utoipa::path(operation_id = "entity_message_create", post, path = "/messages/{parent_type}/{parent_id}", params(("parent_type" = String, Path), ("parent_id" = String, Path)), request_body = PostMessage, responses((status = 200, body = Message)))]
/// Create a root message or reply.
pub async fn create<A, Auth>(
    State(state): State<MessagesRouterState<A, Auth>>,
    user: MacroAuthorizationExtractor<Auth, AnyPrincipal>,
    Path(path): Path<ParentPath>,
    Json(input): Json<PostMessage>,
) -> Result<Json<Message>, MessageHttpError>
where
    A: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    Ok(Json(
        state
            .service
            .post(receipt(state.access.as_ref(), &user, &path).await?, input)
            .await?,
    ))
}

#[utoipa::path(operation_id = "entity_message_get_message", get, path = "/messages/{parent_type}/{parent_id}/items/{id}", params(("parent_type" = String, Path), ("parent_id" = String, Path), ("id" = Uuid, Path)), responses((status = 200, body = Message)))]
/// Resolve a message within its parent.
pub async fn get_message<A, Auth>(
    State(state): State<MessagesRouterState<A, Auth>>,
    user: MacroAuthorizationExtractor<Auth, AnyPrincipal>,
    Path(path): Path<ParentPath>,
) -> Result<Json<Message>, MessageHttpError>
where
    A: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    Ok(Json(
        state
            .service
            .get(
                receipt(state.access.as_ref(), &user, &path).await?,
                path_id(&path)?,
            )
            .await?,
    ))
}

#[utoipa::path(operation_id = "entity_message_edit", patch, path = "/messages/{parent_type}/{parent_id}/items/{id}", params(("parent_type" = String, Path), ("parent_id" = String, Path), ("id" = Uuid, Path)), request_body = EditMessage, responses((status = 200, body = Message)))]
/// Edit an owned message.
pub async fn edit<A, Auth>(
    State(state): State<MessagesRouterState<A, Auth>>,
    user: MacroAuthorizationExtractor<Auth, AnyPrincipal>,
    Path(path): Path<ParentPath>,
    Json(input): Json<EditMessage>,
) -> Result<Json<Message>, MessageHttpError>
where
    A: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    Ok(Json(
        state
            .service
            .edit(
                receipt(state.access.as_ref(), &user, &path).await?,
                path_id(&path)?,
                input,
            )
            .await?,
    ))
}

/// Mutation nonce echoed to realtime listeners.
#[derive(Debug, Default, Deserialize, utoipa::IntoParams)]
pub struct NonceQuery {
    /// Client nonce.
    pub nonce: Option<String>,
}

#[utoipa::path(operation_id = "entity_message_delete_message", delete, path = "/messages/{parent_type}/{parent_id}/items/{id}", params(("parent_type" = String, Path), ("parent_id" = String, Path), ("id" = Uuid, Path), NonceQuery), responses((status = 200, body = Message)))]
/// Tombstone one message while preserving replies.
pub async fn delete_message<A, Auth>(
    State(state): State<MessagesRouterState<A, Auth>>,
    user: MacroAuthorizationExtractor<Auth, AnyPrincipal>,
    Path(path): Path<ParentPath>,
    Query(query): Query<NonceQuery>,
) -> Result<Json<Message>, MessageHttpError>
where
    A: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    Ok(Json(
        state
            .service
            .delete(
                receipt(state.access.as_ref(), &user, &path).await?,
                path_id(&path)?,
                query.nonce,
            )
            .await?,
    ))
}

/// Reaction mutation for the authenticated user.
#[derive(Debug, Serialize, Deserialize, utoipa::ToSchema)]
pub struct ReactionInput {
    /// Emoji.
    pub emoji: String,
    /// Add when true, remove when false.
    pub add: bool,
    /// Client nonce.
    pub nonce: Option<String>,
}

#[utoipa::path(operation_id = "entity_message_react", post, path = "/messages/{parent_type}/{parent_id}/items/{id}/reactions", params(("parent_type" = String, Path), ("parent_id" = String, Path), ("id" = Uuid, Path)), request_body = ReactionInput, responses((status = 200, body = Message)))]
/// Change the caller's reaction.
pub async fn react<A, Auth>(
    State(state): State<MessagesRouterState<A, Auth>>,
    user: MacroAuthorizationExtractor<Auth, AnyPrincipal>,
    Path(path): Path<ParentPath>,
    Json(input): Json<ReactionInput>,
) -> Result<Json<Message>, MessageHttpError>
where
    A: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    Ok(Json(
        state
            .service
            .react(
                receipt(state.access.as_ref(), &user, &path).await?,
                path_id(&path)?,
                input.emoji,
                input.add,
                input.nonce,
            )
            .await?,
    ))
}

#[utoipa::path(operation_id = "entity_message_get_thread", get, path = "/messages/{parent_type}/{parent_id}/threads/{id}", params(("parent_type" = String, Path), ("parent_id" = String, Path), ("id" = Uuid, Path)), responses((status = 200, body = MessageThread)))]
/// Open a specific discussion from a link or annotation.
pub async fn get_thread<A, Auth>(
    State(state): State<MessagesRouterState<A, Auth>>,
    user: MacroAuthorizationExtractor<Auth, AnyPrincipal>,
    Path(path): Path<ParentPath>,
) -> Result<Json<MessageThread>, MessageHttpError>
where
    A: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    Ok(Json(
        state
            .service
            .get_thread(
                receipt(state.access.as_ref(), &user, &path).await?,
                path_id(&path)?,
            )
            .await?,
    ))
}

/// Transient typing update.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct TypingInput {
    /// Whether the caller is typing.
    pub active: bool,
    /// Client mutation nonce.
    pub nonce: Option<String>,
}

#[utoipa::path(operation_id = "entity_message_typing", post, path = "/messages/{parent_type}/{parent_id}/threads/{id}/typing", params(("parent_type" = String, Path), ("parent_id" = String, Path), ("id" = Uuid, Path)), request_body = TypingInput, responses((status = 204)))]
/// Broadcast typing within an authorized discussion.
pub async fn typing<A, Auth>(
    State(state): State<MessagesRouterState<A, Auth>>,
    user: MacroAuthorizationExtractor<Auth, AnyPrincipal>,
    Path(path): Path<ParentPath>,
    Json(input): Json<TypingInput>,
) -> Result<StatusCode, MessageHttpError>
where
    A: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    state
        .service
        .typing(
            receipt(state.access.as_ref(), &user, &path).await?,
            path_id(&path)?,
            input.active,
            input.nonce,
        )
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Discussion resolution mutation.
#[derive(Debug, Serialize, Deserialize, utoipa::ToSchema)]
pub struct ResolveInput {
    /// Target resolved state.
    pub resolved: bool,
    /// Client nonce.
    pub nonce: Option<String>,
}

#[utoipa::path(operation_id = "entity_message_resolve", patch, path = "/messages/{parent_type}/{parent_id}/threads/{id}", params(("parent_type" = String, Path), ("parent_id" = String, Path), ("id" = Uuid, Path)), request_body = ResolveInput, responses((status = 200, body = ThreadState)))]
/// Resolve or reopen a discussion.
pub async fn resolve<A, Auth>(
    State(state): State<MessagesRouterState<A, Auth>>,
    user: MacroAuthorizationExtractor<Auth, AnyPrincipal>,
    Path(path): Path<ParentPath>,
    Json(input): Json<ResolveInput>,
) -> Result<Json<ThreadState>, MessageHttpError>
where
    A: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    Ok(Json(
        state
            .service
            .resolve(
                receipt(state.access.as_ref(), &user, &path).await?,
                path_id(&path)?,
                input.resolved,
                input.nonce,
            )
            .await?,
    ))
}

#[utoipa::path(operation_id = "entity_message_delete_thread", delete, path = "/messages/{parent_type}/{parent_id}/threads/{id}", params(("parent_type" = String, Path), ("parent_id" = String, Path), ("id" = Uuid, Path), NonceQuery), responses((status = 200, body = ThreadState)))]
/// Explicitly remove a discussion.
pub async fn delete_thread<A, Auth>(
    State(state): State<MessagesRouterState<A, Auth>>,
    user: MacroAuthorizationExtractor<Auth, AnyPrincipal>,
    Path(path): Path<ParentPath>,
    Query(query): Query<NonceQuery>,
) -> Result<Json<ThreadState>, MessageHttpError>
where
    A: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    Ok(Json(
        state
            .service
            .delete_thread(
                receipt(state.access.as_ref(), &user, &path).await?,
                path_id(&path)?,
                query.nonce,
            )
            .await?,
    ))
}

/// Historical link kind.
#[derive(Debug, Default, Deserialize, utoipa::IntoParams)]
pub struct LegacyQuery {
    /// Resolve a thread id instead of a comment id.
    #[serde(default)]
    pub thread: bool,
}

#[utoipa::path(operation_id = "entity_message_legacy", get, path = "/messages/{parent_type}/{parent_id}/legacy/{legacy_id}", params(("parent_type" = String, Path), ("parent_id" = String, Path), ("legacy_id" = i64, Path), LegacyQuery), responses((status = 200, body = Message)))]
/// Resolve an old link under current parent permissions.
pub async fn legacy<A, Auth>(
    State(state): State<MessagesRouterState<A, Auth>>,
    user: MacroAuthorizationExtractor<Auth, AnyPrincipal>,
    Path(path): Path<ParentPath>,
    Query(query): Query<LegacyQuery>,
) -> Result<Json<Message>, MessageHttpError>
where
    A: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let id = path
        .legacy_id
        .ok_or(MessageError::Invalid("legacy id required"))?;
    Ok(Json(
        state
            .service
            .resolve_legacy(
                receipt(state.access.as_ref(), &user, &path).await?,
                id,
                query.thread,
            )
            .await?,
    ))
}

/// Read source channel threads mentioning this document under both parents' permissions.
#[utoipa::path(operation_id = "entity_message_references", get, path = "/messages/{parent_type}/{parent_id}/references", params(("parent_type" = String, Path), ("parent_id" = String, Path), PageQuery), responses((status = 200, body = ReferencedThreadPage)))]
pub async fn referenced_threads<A: EntityAccessService, Auth: MacroAuthorizationService>(
    State(state): State<MessagesRouterState<A, Auth>>,
    user: MacroAuthorizationExtractor<Auth, AnyPrincipal>,
    Path(path): Path<ParentPath>,
    Query(query): Query<PageQuery>,
) -> Result<Json<ReferencedThreadPage>, MessageHttpError> {
    let cursor = match (query.created_at, query.cursor_id) {
        (Some(created_at), Some(id)) => Some(MessageCursor { created_at, id }),
        (None, None) => None,
        _ => return Err(MessageError::Invalid("both cursor fields are required").into()),
    };
    Ok(Json(
        state
            .service
            .referenced_threads(
                receipt(state.access.as_ref(), &user, &path).await?,
                cursor,
                query.limit.unwrap_or(50),
            )
            .await?,
    ))
}
