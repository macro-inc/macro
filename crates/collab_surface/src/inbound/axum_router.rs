//! Axum router for collab-surface endpoints.

use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{FromRef, Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{delete, get, post, put},
};
use entity_access::domain::{
    models::{AccessError, AnyEntityPermission, EntityAccessReceipt},
    ports::EntityAccessService,
};
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOrInternal,
};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::{Entity, EntityType};
use model_error_response::ErrorResponse;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::domain::models::{CollabSurface, CollabSurfaceError, SurfaceState};
use crate::domain::ports::CollabSurfaceService;

/// Router state for collab-surface endpoints.
pub struct CollabSurfaceRouterState<S, Eas, Auth> {
    service: Arc<S>,
    entity_access_service: Arc<Eas>,
    authorization_state: MacroAuthorizationState<Auth>,
}

impl<S, Eas, Auth> Clone for CollabSurfaceRouterState<S, Eas, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            entity_access_service: self.entity_access_service.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<S, Eas, Auth> CollabSurfaceRouterState<S, Eas, Auth>
where
    S: CollabSurfaceService,
    Eas: EntityAccessService,
{
    /// Create router state from shared service references and authorization state.
    pub fn new(
        service: Arc<S>,
        entity_access_service: Arc<Eas>,
        authorization_state: MacroAuthorizationState<Auth>,
    ) -> Self {
        Self {
            service,
            entity_access_service,
            authorization_state,
        }
    }
}

impl<S, Eas, Auth> FromRef<CollabSurfaceRouterState<S, Eas, Auth>> for Arc<Eas> {
    fn from_ref(state: &CollabSurfaceRouterState<S, Eas, Auth>) -> Self {
        state.entity_access_service.clone()
    }
}

impl<S, Eas, Auth> FromRef<CollabSurfaceRouterState<S, Eas, Auth>>
    for MacroAuthorizationState<Auth>
{
    fn from_ref(state: &CollabSurfaceRouterState<S, Eas, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// Build the collab-surfaces router.
///
/// Routes:
/// - `PUT /{id}` — idempotently ensure a surface exists (load-or-create).
/// - `GET /{id}` — fetch a surface.
/// - `POST /{id}/token` — mint a sync-service connection token.
/// - `DELETE /{id}` — soft-delete a surface.
pub fn collab_surface_router<S, Eas, Auth, T>(
    state: CollabSurfaceRouterState<S, Eas, Auth>,
) -> Router<T>
where
    S: CollabSurfaceService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
    T: Send + Sync + 'static,
{
    Router::new()
        .route("/{id}", put(ensure_surface_handler::<S, Eas, Auth>))
        .route("/{id}", get(get_surface_handler::<S, Eas, Auth>))
        .route("/{id}/token", post(mint_token_handler::<S, Eas, Auth>))
        .route("/{id}", delete(delete_surface_handler::<S, Eas, Auth>))
        .with_state(state)
}

/// Parent entity types a surface may attach to in v1.
///
/// `ChannelMessage` is deliberately absent: it has no access resolution in
/// `entity_access` — a message-scoped surface attaches to its channel instead
/// (the `Call → Channel` precedent). The rest are excluded until they have a
/// surface story.
const SUPPORTED_PARENT_TYPES: &[EntityType] = &[
    EntityType::Document,
    EntityType::Channel,
    EntityType::Project,
    EntityType::Chat,
    EntityType::EmailThread,
    EntityType::Call,
];

/// Request body for ensuring a collab surface.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct EnsureCollabSurfaceRequest {
    /// Type of the parent entity access derives from.
    #[schema(inline)]
    pub parent_entity_type: EntityType,
    /// Id of the parent entity (a uuid).
    pub parent_entity_id: String,
    /// Markdown to seed the surface with when this ensure creates it. Empty
    /// (or omitted) seeds the canonical blank document. Ignored when the
    /// surface already exists and is ready.
    #[serde(default)]
    pub initial_markdown: String,
}

/// A collab surface, as returned by the API.
#[derive(Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CollabSurfaceResponse {
    /// The surface id — also the sync-service session key.
    pub id: Uuid,
    /// Type of the parent entity.
    #[schema(inline)]
    pub parent_entity_type: EntityType,
    /// Id of the parent entity.
    pub parent_entity_id: String,
    /// Lifecycle state (`ready` for every surface visible via the API).
    pub state: SurfaceState,
}

impl From<CollabSurface> for CollabSurfaceResponse {
    fn from(surface: CollabSurface) -> Self {
        Self {
            id: surface.id,
            parent_entity_type: surface.parent.entity_type,
            parent_entity_id: surface.parent.entity_id.to_string(),
            state: surface.state,
        }
    }
}

/// Response carrying a freshly minted sync-service connection token.
#[derive(Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CollabSurfaceTokenResponse {
    /// The signed JWT to pass to the sync-service websocket connect.
    pub token: String,
}

/// Path params for the single-surface routes.
#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Path)]
pub struct SurfaceIdParams {
    /// The surface id.
    pub id: Uuid,
}

/// Validate a parent entity pair syntactically before touching access control.
fn build_parent(
    entity_type: EntityType,
    entity_id: &str,
) -> Result<Entity<'static>, CollabSurfaceError> {
    if !SUPPORTED_PARENT_TYPES.contains(&entity_type) {
        return Err(CollabSurfaceError::BadRequest(format!(
            "unsupported parent entity type: {entity_type}"
        )));
    }
    let entity_id = entity_id.trim();
    // Stored as uuid, so reject a malformed id here rather than let it surface
    // as an opaque repository error.
    Uuid::parse_str(entity_id)
        .map_err(|_| CollabSurfaceError::BadRequest("parentEntityId must be a uuid".to_string()))?;
    Ok(entity_type.with_entity_string(entity_id.to_string()))
}

/// Mint the receipt that proves the caller may act on `parent`.
///
/// The requirement is [`AnyEntityPermission`], not a leveled one: a channel
/// resolves to `ChannelRole`/`ChannelViewOnly`, which a leveled receipt never
/// matches. The domain service decides what each permission may do.
async fn mint_parent_receipt<Eas: EntityAccessService>(
    entity_access_service: &Eas,
    user_id: &MacroUserIdStr<'_>,
    user_org_id: Option<i64>,
    parent: &Entity<'_>,
) -> Result<EntityAccessReceipt<AnyEntityPermission>, CollabSurfaceError> {
    entity_access_service
        .generate_entity_access_receipt::<AnyEntityPermission>(
            user_id,
            user_org_id,
            parent.entity_id.as_ref(),
            parent.entity_type,
        )
        .await
        .map_err(|e| match e {
            AccessError::Unauthorized | AccessError::UnauthorizedWithMessage(_) => {
                CollabSurfaceError::AccessDenied
            }
            AccessError::NotFound(_) => CollabSurfaceError::ParentNotFound,
            AccessError::BadRequest(msg) => CollabSurfaceError::BadRequest(msg.to_string()),
            other => CollabSurfaceError::Internal(rootcause::Report::new(other).into_dynamic()),
        })
}

/// The caller's identity and org, as the receipt-minting path needs them.
fn caller_identity<Auth: MacroAuthorizationService>(
    user: &MacroAuthorizationExtractor<Auth, UserOrInternal>,
) -> (&MacroUserIdStr<'static>, Option<i64>) {
    (
        &user.authorization.user.macro_user_id,
        // Organization channels grant access by matching org, so the org must
        // be carried through or a member of one reads as a non-participant.
        user.authorization
            .user
            .user_context
            .organization_id
            .map(i64::from),
    )
}

/// Resolve the surface's parent and mint a receipt for it — the shared prelude
/// of every single-surface route.
async fn receipt_for_surface<S, Eas>(
    service: &S,
    entity_access_service: &Eas,
    user_id: &MacroUserIdStr<'_>,
    user_org_id: Option<i64>,
    id: Uuid,
) -> Result<EntityAccessReceipt<AnyEntityPermission>, CollabSurfaceError>
where
    S: CollabSurfaceService,
    Eas: EntityAccessService,
{
    let parent = service.get_parent(id).await?;
    mint_parent_receipt(entity_access_service, user_id, user_org_id, &parent).await
}

/// Idempotently ensure a collab surface exists (load-or-create).
///
/// The id is caller-supplied, so an embedding surface can hold a stable id
/// and blindly ensure it on mount: the first ensure creates and initializes
/// the session, every later one (including concurrent ones) returns the same
/// surface. A soft-deleted id is `410 Gone` and never comes back.
#[utoipa::path(
    put,
    tag = "collab_surfaces",
    operation_id = "ensure_collab_surface",
    path = "/collab_surfaces/{id}",
    params(SurfaceIdParams),
    request_body = EnsureCollabSurfaceRequest,
    responses(
        (status = 200, body = CollabSurfaceResponse),
        (status = 400, body = ErrorResponse),
        (status = 401, description = "Missing or invalid credentials", body = ErrorResponse),
        (status = 403, description = "No access to the parent entity", body = ErrorResponse),
        (status = 404, description = "The parent entity does not exist", body = ErrorResponse),
        (status = 410, description = "The surface id was deleted and cannot be reused", body = ErrorResponse),
        (status = 422, description = "Malformed request body (plain text)"),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn ensure_surface_handler<S, Eas, Auth>(
    State(state): State<CollabSurfaceRouterState<S, Eas, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Path(SurfaceIdParams { id }): Path<SurfaceIdParams>,
    Json(req): Json<EnsureCollabSurfaceRequest>,
) -> Result<Json<CollabSurfaceResponse>, CollabSurfaceError>
where
    S: CollabSurfaceService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let (user_id, user_org_id) = caller_identity(&user);
    let parent = build_parent(req.parent_entity_type, &req.parent_entity_id)?;
    let receipt = mint_parent_receipt(
        state.entity_access_service.as_ref(),
        user_id,
        user_org_id,
        &parent,
    )
    .await?;

    let surface = state
        .service
        .ensure_surface(user_id, receipt, id, req.initial_markdown)
        .await?;
    Ok(Json(surface.into()))
}

/// Fetch a collab surface.
#[utoipa::path(
    get,
    tag = "collab_surfaces",
    operation_id = "get_collab_surface",
    path = "/collab_surfaces/{id}",
    params(SurfaceIdParams),
    responses(
        (status = 200, body = CollabSurfaceResponse),
        (status = 401, description = "Missing or invalid credentials", body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn get_surface_handler<S, Eas, Auth>(
    State(state): State<CollabSurfaceRouterState<S, Eas, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Path(SurfaceIdParams { id }): Path<SurfaceIdParams>,
) -> Result<Json<CollabSurfaceResponse>, CollabSurfaceError>
where
    S: CollabSurfaceService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let (user_id, user_org_id) = caller_identity(&user);
    let receipt = receipt_for_surface(
        state.service.as_ref(),
        state.entity_access_service.as_ref(),
        user_id,
        user_org_id,
        id,
    )
    .await?;
    let surface = state.service.get_surface(user_id, receipt, id).await?;
    Ok(Json(surface.into()))
}

/// Mint a sync-service connection token for a surface.
#[utoipa::path(
    post,
    tag = "collab_surfaces",
    operation_id = "create_collab_surface_token",
    path = "/collab_surfaces/{id}/token",
    params(SurfaceIdParams),
    responses(
        (status = 200, body = CollabSurfaceTokenResponse),
        (status = 401, description = "Missing or invalid credentials", body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn mint_token_handler<S, Eas, Auth>(
    State(state): State<CollabSurfaceRouterState<S, Eas, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Path(SurfaceIdParams { id }): Path<SurfaceIdParams>,
) -> Result<Json<CollabSurfaceTokenResponse>, CollabSurfaceError>
where
    S: CollabSurfaceService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let (user_id, user_org_id) = caller_identity(&user);
    let receipt = receipt_for_surface(
        state.service.as_ref(),
        state.entity_access_service.as_ref(),
        user_id,
        user_org_id,
        id,
    )
    .await?;
    let token = state.service.mint_token(user_id, receipt, id).await?;
    Ok(Json(CollabSurfaceTokenResponse {
        token: token.into_inner(),
    }))
}

/// Soft-delete a collab surface.
#[utoipa::path(
    delete,
    tag = "collab_surfaces",
    operation_id = "delete_collab_surface",
    path = "/collab_surfaces/{id}",
    params(SurfaceIdParams),
    responses(
        (status = 204, description = "Deleted"),
        (status = 401, description = "Missing or invalid credentials", body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn delete_surface_handler<S, Eas, Auth>(
    State(state): State<CollabSurfaceRouterState<S, Eas, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Path(SurfaceIdParams { id }): Path<SurfaceIdParams>,
) -> Result<StatusCode, CollabSurfaceError>
where
    S: CollabSurfaceService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let (user_id, user_org_id) = caller_identity(&user);
    let receipt = receipt_for_surface(
        state.service.as_ref(),
        state.entity_access_service.as_ref(),
        user_id,
        user_org_id,
        id,
    )
    .await?;
    state.service.delete_surface(user_id, receipt, id).await?;
    Ok(StatusCode::NO_CONTENT)
}

impl IntoResponse for CollabSurfaceError {
    fn into_response(self) -> axum::response::Response {
        let status_code = match &self {
            CollabSurfaceError::NotFound | CollabSurfaceError::ParentNotFound => {
                StatusCode::NOT_FOUND
            }
            CollabSurfaceError::Gone => StatusCode::GONE,
            CollabSurfaceError::BadRequest(_) => StatusCode::BAD_REQUEST,
            CollabSurfaceError::AccessDenied => StatusCode::FORBIDDEN,
            CollabSurfaceError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };

        let message = match &self {
            CollabSurfaceError::Internal(_) => {
                tracing::error!(error=?self, "collab surface internal server error");
                "internal server error".to_string()
            }
            error => error.to_string(),
        };

        (
            status_code,
            Json(ErrorResponse {
                message: message.into(),
            }),
        )
            .into_response()
    }
}
