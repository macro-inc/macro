//! Axum router for foreign entity endpoints.

#[cfg(test)]
mod tests;

use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{FromRef, State},
    http::StatusCode,
    response::IntoResponse,
    routing::get,
};
use entity_access::{
    domain::{models::ViewAccessLevel, ports::EntityAccessService},
    inbound::axum_extractors::ForeignEntityAccessLevelExtractor,
};
use macro_authorization::{MacroAuthorizationService, MacroAuthorizationState};
use model_error_response::ErrorResponse;

use crate::domain::{
    models::{ForeignEntity, ForeignEntityError},
    ports::ForeignEntityService,
};

/// Router state for authenticated foreign entity operations.
pub struct ForeignEntityRouterState<S, AccessSvc, Auth> {
    service: Arc<S>,
    access_service: Arc<AccessSvc>,
    authorization_state: MacroAuthorizationState<Auth>,
}

impl<S, AccessSvc, Auth> Clone for ForeignEntityRouterState<S, AccessSvc, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            access_service: self.access_service.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<S, AccessSvc, Auth> ForeignEntityRouterState<S, AccessSvc, Auth>
where
    S: ForeignEntityService,
    AccessSvc: EntityAccessService,
{
    /// Create router state from shared service references and authorization state.
    pub fn new(
        service: Arc<S>,
        access_service: Arc<AccessSvc>,
        authorization_state: MacroAuthorizationState<Auth>,
    ) -> Self {
        Self {
            service,
            access_service,
            authorization_state,
        }
    }
}

impl<S, AccessSvc, Auth> FromRef<ForeignEntityRouterState<S, AccessSvc, Auth>> for Arc<AccessSvc> {
    fn from_ref(state: &ForeignEntityRouterState<S, AccessSvc, Auth>) -> Self {
        state.access_service.clone()
    }
}

impl<S, AccessSvc, Auth> FromRef<ForeignEntityRouterState<S, AccessSvc, Auth>>
    for MacroAuthorizationState<Auth>
{
    fn from_ref(state: &ForeignEntityRouterState<S, AccessSvc, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// Build the authenticated foreign entity router.
///
/// Routes:
/// - `GET /{id}` — get a visible foreign entity by its internal ID.
pub fn foreign_entity_router<S, AccessSvc, Auth, T>(
    state: ForeignEntityRouterState<S, AccessSvc, Auth>,
) -> Router<T>
where
    S: ForeignEntityService,
    AccessSvc: EntityAccessService,
    Auth: MacroAuthorizationService,
    T: Send + Sync + 'static,
{
    Router::new()
        .route(
            "/{id}",
            get(get_foreign_entity_handler::<S, AccessSvc, Auth>),
        )
        .with_state(state)
}

/// Get a visible foreign entity by its internal ID.
#[utoipa::path(
    get,
    tag = "foreign_entity",
    operation_id = "get_foreign_entity",
    path = "/foreign_entity/{id}",
    params(
        ("id" = uuid::Uuid, Path, description = "Foreign entity ID")
    ),
    responses(
        (status = 200, body = ForeignEntity),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn get_foreign_entity_handler<S, AccessSvc, Auth>(
    State(state): State<ForeignEntityRouterState<S, AccessSvc, Auth>>,
    access: ForeignEntityAccessLevelExtractor<ViewAccessLevel, AccessSvc, Auth>,
) -> Result<Json<ForeignEntity>, ForeignEntityError>
where
    S: ForeignEntityService,
    AccessSvc: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let foreign_entity = state
        .service
        .get_foreign_entity(access.entity_access_receipt)
        .await?;

    Ok(Json(foreign_entity))
}

impl IntoResponse for ForeignEntityError {
    fn into_response(self) -> axum::response::Response {
        let status_code = match &self {
            ForeignEntityError::NotFound(_) => StatusCode::NOT_FOUND,
            ForeignEntityError::BadRequest(_) => StatusCode::BAD_REQUEST,
            ForeignEntityError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };

        if status_code.is_server_error() {
            tracing::error!(error=?self, "internal server error");
        }

        let message = match &self {
            ForeignEntityError::Internal(_) => "internal server error".to_string(),
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
