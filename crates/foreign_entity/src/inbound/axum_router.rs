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
use model_error_response::ErrorResponse;

use crate::domain::{
    models::{ForeignEntity, ForeignEntityError},
    ports::ForeignEntityService,
};

/// Router state for authenticated foreign entity operations.
pub struct ForeignEntityRouterState<S, AccessSvc> {
    service: Arc<S>,
    access_service: Arc<AccessSvc>,
}

impl<S, AccessSvc> Clone for ForeignEntityRouterState<S, AccessSvc> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            access_service: self.access_service.clone(),
        }
    }
}

impl<S, AccessSvc> ForeignEntityRouterState<S, AccessSvc>
where
    S: ForeignEntityService,
    AccessSvc: EntityAccessService,
{
    /// Create router state from shared service references.
    pub fn new(service: Arc<S>, access_service: Arc<AccessSvc>) -> Self {
        Self {
            service,
            access_service,
        }
    }
}

impl<S, AccessSvc> FromRef<ForeignEntityRouterState<S, AccessSvc>> for Arc<AccessSvc> {
    fn from_ref(state: &ForeignEntityRouterState<S, AccessSvc>) -> Self {
        state.access_service.clone()
    }
}

/// Build the authenticated foreign entity router.
///
/// Routes:
/// - `GET /{id}` — get a visible foreign entity by its internal ID.
pub fn foreign_entity_router<S, AccessSvc, T>(
    state: ForeignEntityRouterState<S, AccessSvc>,
) -> Router<T>
where
    S: ForeignEntityService,
    AccessSvc: EntityAccessService,
    T: Send + Sync + 'static,
{
    Router::new()
        .route("/{id}", get(get_foreign_entity_handler::<S, AccessSvc>))
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
pub async fn get_foreign_entity_handler<S, AccessSvc>(
    State(state): State<ForeignEntityRouterState<S, AccessSvc>>,
    access: ForeignEntityAccessLevelExtractor<ViewAccessLevel, AccessSvc>,
) -> Result<Json<ForeignEntity>, ForeignEntityError>
where
    S: ForeignEntityService,
    AccessSvc: EntityAccessService,
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
