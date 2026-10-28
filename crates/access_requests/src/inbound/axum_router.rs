//! Authenticated HTTP adapters; policy lives in AccessRequestService.
use crate::domain::{
    models::*,
    ports::{Clock, RequestRepository},
    service::AccessRequestService,
};
use axum::{
    Json, Router,
    extract::{FromRef, Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post, put},
};
use entity_access::domain::ports::EntityAccessService;
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOnly,
};
use macro_user_id::user_id::MacroUserIdStr;
use serde::Deserialize;
use std::sync::Arc;
use uuid::Uuid;

/// Shared service and authentication wiring.
pub struct AccessRequestsRouterState<R, A, C, Auth> {
    /// Domain service.
    pub service: Arc<AccessRequestService<R, A, C>>,
    /// Authenticated user boundary.
    pub authorization_state: MacroAuthorizationState<Auth>,
}
impl<R, A, C, Auth> Clone for AccessRequestsRouterState<R, A, C, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}
impl<R, A, C, Auth> FromRef<AccessRequestsRouterState<R, A, C, Auth>>
    for MacroAuthorizationState<Auth>
{
    fn from_ref(state: &AccessRequestsRouterState<R, A, C, Auth>) -> Self {
        state.authorization_state.clone()
    }
}
/// Routes nested beneath `/entities`.
pub fn router<R, A, C, Auth, S>(state: AccessRequestsRouterState<R, A, C, Auth>) -> Router<S>
where
    R: RequestRepository,
    A: EntityAccessService,
    C: Clock,
    Auth: MacroAuthorizationService,
    S: Send + Sync + 'static,
{
    Router::new()
        .route(
            "/{entity_type}/{entity_id}/access-requests",
            get(state_handler::<R, A, C, Auth>),
        )
        .route(
            "/{entity_type}/{entity_id}/access-requests/mine",
            put(submit_handler::<R, A, C, Auth>).delete(cancel_handler::<R, A, C, Auth>),
        )
        .route(
            "/{entity_type}/{entity_id}/access-requests/{request_id}/resolve",
            post(resolve_handler::<R, A, C, Auth>),
        )
        .route(
            "/{entity_type}/{entity_id}/direct-access",
            get(direct_handler::<R, A, C, Auth>),
        )
        .route(
            "/{entity_type}/{entity_id}/direct-access/{user_id}",
            put(set_direct_handler::<R, A, C, Auth>).delete(remove_direct_handler::<R, A, C, Auth>),
        )
        .with_state(state)
}
/// Validated route components.
#[derive(Deserialize)]
pub struct TargetPath {
    /// Kind from the Share surface allowlist.
    entity_type: ShareEntityType,
    /// Target identifier.
    entity_id: Uuid,
    /// Request when resolving.
    request_id: Option<Uuid>,
    /// Direct-grant recipient when managing access.
    user_id: Option<String>,
}
impl TargetPath {
    fn entity(&self) -> ShareEntity {
        ShareEntity {
            entity_type: self.entity_type,
            entity_id: self.entity_id,
        }
    }
    fn recipient(&self) -> Result<MacroUserIdStr<'static>, RequestError> {
        MacroUserIdStr::try_from(self.user_id.clone().ok_or(RequestError::NotFound)?)
            .map_err(|_| RequestError::NotFound)
    }
}
/// Reviewer page cursor.
#[derive(Default, Deserialize, utoipa::IntoParams)]
pub struct Page {
    /// Offset into pending requests; page size is bounded by the service.
    #[serde(default)]
    pub offset: u32,
}
/// Cancellation concurrency token.
#[derive(Deserialize, utoipa::IntoParams)]
pub struct Revision {
    /// Last observed request revision.
    pub revision: i32,
}
impl IntoResponse for RequestError {
    fn into_response(self) -> axum::response::Response {
        let status = match &self {
            Self::Forbidden => StatusCode::FORBIDDEN,
            Self::NotFound => StatusCode::NOT_FOUND,
            Self::InvalidLevel => StatusCode::BAD_REQUEST,
            Self::Conflict => StatusCode::CONFLICT,
            Self::Cooldown(_) => StatusCode::TOO_MANY_REQUESTS,
            Self::Internal(error) => {
                tracing::error!(error=?error, "access request failed");
                StatusCode::INTERNAL_SERVER_ERROR
            }
        };
        let retry_after = match &self {
            Self::Cooldown(until) => Some(*until),
            _ => None,
        };
        (
            status,
            Json(serde_json::json!({"message": self.to_string(), "retryAfter": retry_after})),
        )
            .into_response()
    }
}

/// State access request state through the domain service.
#[utoipa::path(get, tag = "access-requests", operation_id = "access_requests_state",
    path = "/entities/{entity_type}/{entity_id}/access-requests", params(("entity_type" = ShareEntityType, Path), ("entity_id" = Uuid, Path), Page),
    responses((status = 200, body = AccessRequestState), (status = 400), (status = 403), (status = 404), (status = 409), (status = 429), (status = 500)))]
#[tracing::instrument(err, skip_all)]
pub async fn state_handler<R, A, C, Auth>(
    State(state): State<AccessRequestsRouterState<R, A, C, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOnly>,
    Path(path): Path<TargetPath>,
    Query(page): Query<Page>,
) -> Result<Json<AccessRequestState>, RequestError>
where
    R: RequestRepository,
    A: EntityAccessService,
    C: Clock,
    Auth: MacroAuthorizationService,
{
    Ok(Json(
        state
            .service
            .state(user.authorization.macro_user_id, path.entity(), page.offset)
            .await?,
    ))
}

/// Submit access request state through the domain service.
#[utoipa::path(put, tag = "access-requests", operation_id = "access_requests_submit",
    path = "/entities/{entity_type}/{entity_id}/access-requests/mine", params(("entity_type" = ShareEntityType, Path), ("entity_id" = Uuid, Path)), request_body = RequestAccess,
    responses((status = 200, body = AccessRequest), (status = 400), (status = 403), (status = 404), (status = 409), (status = 429), (status = 500)))]
#[tracing::instrument(err, skip_all)]
pub async fn submit_handler<R, A, C, Auth>(
    State(state): State<AccessRequestsRouterState<R, A, C, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOnly>,
    Path(path): Path<TargetPath>,

    Json(body): Json<RequestAccess>,
) -> Result<Json<AccessRequest>, RequestError>
where
    R: RequestRepository,
    A: EntityAccessService,
    C: Clock,
    Auth: MacroAuthorizationService,
{
    Ok(Json(
        state
            .service
            .submit(user.authorization.macro_user_id, path.entity(), body)
            .await?,
    ))
}

/// Cancel access request state through the domain service.
#[utoipa::path(delete, tag = "access-requests", operation_id = "access_requests_cancel",
    path = "/entities/{entity_type}/{entity_id}/access-requests/mine", params(("entity_type" = ShareEntityType, Path), ("entity_id" = Uuid, Path), Revision),
    responses((status = 200, body = () ), (status = 400), (status = 403), (status = 404), (status = 409), (status = 429), (status = 500)))]
#[tracing::instrument(err, skip_all)]
pub async fn cancel_handler<R, A, C, Auth>(
    State(state): State<AccessRequestsRouterState<R, A, C, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOnly>,
    Path(path): Path<TargetPath>,
    Query(revision): Query<Revision>,
) -> Result<Json<()>, RequestError>
where
    R: RequestRepository,
    A: EntityAccessService,
    C: Clock,
    Auth: MacroAuthorizationService,
{
    Ok(Json(
        state
            .service
            .cancel(
                user.authorization.macro_user_id,
                path.entity(),
                revision.revision,
            )
            .await?,
    ))
}

/// Resolve access request state through the domain service.
#[utoipa::path(post, tag = "access-requests", operation_id = "access_requests_resolve",
    path = "/entities/{entity_type}/{entity_id}/access-requests/{request_id}/resolve", params(("entity_type" = ShareEntityType, Path), ("entity_id" = Uuid, Path), ("request_id" = Uuid, Path)), request_body = ResolveRequest,
    responses((status = 200, body = AccessRequest), (status = 400), (status = 403), (status = 404), (status = 409), (status = 429), (status = 500)))]
#[tracing::instrument(err, skip_all)]
pub async fn resolve_handler<R, A, C, Auth>(
    State(state): State<AccessRequestsRouterState<R, A, C, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOnly>,
    Path(path): Path<TargetPath>,

    Json(body): Json<ResolveRequest>,
) -> Result<Json<AccessRequest>, RequestError>
where
    R: RequestRepository,
    A: EntityAccessService,
    C: Clock,
    Auth: MacroAuthorizationService,
{
    Ok(Json(
        state
            .service
            .resolve(
                user.authorization.macro_user_id,
                path.entity(),
                path.request_id.ok_or(RequestError::NotFound)?,
                body,
            )
            .await?,
    ))
}

/// Direct access request state through the domain service.
#[utoipa::path(get, tag = "access-requests", operation_id = "access_requests_direct",
    path = "/entities/{entity_type}/{entity_id}/direct-access", params(("entity_type" = ShareEntityType, Path), ("entity_id" = Uuid, Path)),
    responses((status = 200, body = Vec<DirectAccess>), (status = 400), (status = 403), (status = 404), (status = 409), (status = 429), (status = 500)))]
#[tracing::instrument(err, skip_all)]
pub async fn direct_handler<R, A, C, Auth>(
    State(state): State<AccessRequestsRouterState<R, A, C, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOnly>,
    Path(path): Path<TargetPath>,
) -> Result<Json<Vec<DirectAccess>>, RequestError>
where
    R: RequestRepository,
    A: EntityAccessService,
    C: Clock,
    Auth: MacroAuthorizationService,
{
    Ok(Json(
        state
            .service
            .direct_access(user.authorization.macro_user_id, path.entity())
            .await?,
    ))
}

/// Set direct access request state through the domain service.
#[utoipa::path(put, tag = "access-requests", operation_id = "access_requests_set_direct",
    path = "/entities/{entity_type}/{entity_id}/direct-access/{user_id}", params(("entity_type" = ShareEntityType, Path), ("entity_id" = Uuid, Path), ("user_id" = String, Path)), request_body = SetDirectAccess,
    responses((status = 200, body = ()), (status = 400), (status = 403), (status = 404), (status = 409), (status = 429), (status = 500)))]
#[tracing::instrument(err, skip_all)]
pub async fn set_direct_handler<R, A, C, Auth>(
    State(state): State<AccessRequestsRouterState<R, A, C, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOnly>,
    Path(path): Path<TargetPath>,

    Json(body): Json<SetDirectAccess>,
) -> Result<Json<()>, RequestError>
where
    R: RequestRepository,
    A: EntityAccessService,
    C: Clock,
    Auth: MacroAuthorizationService,
{
    Ok(Json(
        state
            .service
            .set_direct_access(
                user.authorization.macro_user_id,
                path.entity(),
                path.recipient()?,
                body.access_level,
            )
            .await?,
    ))
}

/// Remove direct access request state through the domain service.
#[utoipa::path(delete, tag = "access-requests", operation_id = "access_requests_remove_direct",
    path = "/entities/{entity_type}/{entity_id}/direct-access/{user_id}", params(("entity_type" = ShareEntityType, Path), ("entity_id" = Uuid, Path), ("user_id" = String, Path)),
    responses((status = 200, body = ()), (status = 400), (status = 403), (status = 404), (status = 409), (status = 429), (status = 500)))]
#[tracing::instrument(err, skip_all)]
pub async fn remove_direct_handler<R, A, C, Auth>(
    State(state): State<AccessRequestsRouterState<R, A, C, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOnly>,
    Path(path): Path<TargetPath>,
) -> Result<Json<()>, RequestError>
where
    R: RequestRepository,
    A: EntityAccessService,
    C: Clock,
    Auth: MacroAuthorizationService,
{
    Ok(Json(
        state
            .service
            .set_direct_access(
                user.authorization.macro_user_id,
                path.entity(),
                path.recipient()?,
                None,
            )
            .await?,
    ))
}
