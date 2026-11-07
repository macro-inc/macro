//! Axum router for ai projection endpoints.

/// Get-or-create a projection and the requesting user's instance.
pub mod upsert_projection;

#[cfg(test)]
mod test;

use std::sync::Arc;

use axum::{
    Json, Router,
    extract::FromRef,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::post,
};
use macro_authorization::{MacroAuthorizationService, MacroAuthorizationState};
use model_error_response::ErrorResponse;

use crate::domain::{
    ai_projection_service::AiProjectionService,
    model::{AiProjectionError, UpsertProjectionError},
};

/// Router state containing the ai projection service and the authorization
/// state used to authenticate callers.
pub struct AiProjectionRouterState<T, Auth> {
    /// The ai projection service implementation.
    pub service: Arc<T>,
    /// The authorization state used by the request extractors.
    pub authorization_state: MacroAuthorizationState<Auth>,
}

// Manual Clone impl so T doesn't need to be Clone (it's behind Arc).
impl<T, Auth> Clone for AiProjectionRouterState<T, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<T, Auth> FromRef<AiProjectionRouterState<T, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &AiProjectionRouterState<T, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// Build the ai projections router with all endpoints.
pub fn ai_projections_router<T, Auth, S>(state: AiProjectionRouterState<T, Auth>) -> Router<S>
where
    T: AiProjectionService,
    Auth: MacroAuthorizationService,
    S: Send + Sync + 'static,
{
    Router::new()
        .route(
            "/ai-projections",
            post(upsert_projection::handler::<T, Auth>),
        )
        .with_state(state)
}

// --- Error IntoResponse implementations ---

impl IntoResponse for AiProjectionError {
    fn into_response(self) -> Response {
        match self {
            AiProjectionError::NotFound => (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    message: "projection does not exist".into(),
                }),
            ),
            AiProjectionError::BadRequest(msg) => (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    message: msg.into(),
                }),
            ),
            AiProjectionError::InvalidStoredData(_)
            | AiProjectionError::Generation(_)
            | AiProjectionError::StorageLayerError(_) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "internal server error".into(),
                }),
            ),
        }
        .into_response()
    }
}

impl IntoResponse for UpsertProjectionError {
    fn into_response(self) -> Response {
        match self {
            UpsertProjectionError::BadRequest(msg) => (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    message: msg.into(),
                }),
            )
                .into_response(),
            UpsertProjectionError::ProfessionalFeaturesRequired => (
                StatusCode::FORBIDDEN,
                Json(ErrorResponse {
                    message: "professional features required".into(),
                }),
            )
                .into_response(),
            UpsertProjectionError::AiProjectionError(err) => err.into_response(),
        }
    }
}
