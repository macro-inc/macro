//! Axum router for ai projection endpoints.

/// Extractor ensuring the authenticated user has professional features.
pub mod premium_user;
/// Get-or-create a projection and the requesting user's instance.
pub mod upsert_projection;

#[cfg(test)]
mod test;

use std::sync::Arc;

use axum::{
    Json, Router,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::post,
};
use model_error_response::ErrorResponse;

use crate::domain::{
    ai_projection_service::AiProjectionService,
    model::{AiProjectionError, UpsertProjectionError},
};

/// Router state containing the ai projection service.
pub struct AiProjectionRouterState<T> {
    /// The ai projection service implementation.
    pub service: Arc<T>,
}

// Manual Clone impl so T doesn't need to be Clone (it's behind Arc).
impl<T> Clone for AiProjectionRouterState<T> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
        }
    }
}

/// Build the ai projections router with all endpoints.
pub fn ai_projections_router<T, S>(state: AiProjectionRouterState<T>) -> Router<S>
where
    T: AiProjectionService,
    S: Send + Sync + 'static,
{
    Router::new()
        .route("/ai-projections", post(upsert_projection::handler::<T>))
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
            AiProjectionError::InvalidStoredData(_) | AiProjectionError::StorageLayerError(_) => (
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
            UpsertProjectionError::AiProjectionError(err) => err.into_response(),
        }
    }
}
