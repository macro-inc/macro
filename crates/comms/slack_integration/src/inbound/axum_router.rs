//! Admin-only routes. Handlers pass typed team receipts to the domain service;
//! neither team IDs nor storage keys are accepted from the request body.

use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, FromRef},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
};
use entity_access::domain::ports::EntityAccessService;
use macro_authorization::{MacroAuthorizationService, MacroAuthorizationState};

use crate::domain::{models::ImportError, ports::ImportService};

pub mod create;
pub mod jobs;
#[cfg(test)]
mod test;
pub mod uploads;

/// Full selected metadata is bounded independently from small upload descriptors.
pub const CREATE_BODY_BYTES: usize = 32 * 1024 * 1024;
/// Enough for fifty descriptors or completion identities and one seal.
pub const UPLOAD_BODY_BYTES: usize = 64 * 1024;

/// Shared capabilities supplied by the hosting composition root.
pub struct SlackRouterState<T, Eas, Auth> {
    /// Administrator use cases, not worker execution.
    pub service: Arc<T>,
    /// Standard team receipt provider.
    pub entity_access_service: Arc<Eas>,
    /// Standard authentication provider.
    pub authorization_state: MacroAuthorizationState<Auth>,
}

impl<T, Eas, Auth> Clone for SlackRouterState<T, Eas, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            entity_access_service: self.entity_access_service.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<T, Eas, Auth> FromRef<SlackRouterState<T, Eas, Auth>> for Arc<Eas> {
    fn from_ref(state: &SlackRouterState<T, Eas, Auth>) -> Self {
        state.entity_access_service.clone()
    }
}

impl<T, Eas, Auth> FromRef<SlackRouterState<T, Eas, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &SlackRouterState<T, Eas, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// Build seven operations, mounted by DSS under `/slack`. No queue poller is started.
pub fn slack_router<T, Eas, Auth, S>(state: SlackRouterState<T, Eas, Auth>) -> Router<S>
where
    T: ImportService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
    S: Send + Sync + 'static,
{
    Router::new()
        .route(
            "/imports",
            get(jobs::list::<T, Eas, Auth>)
                .post(create::create::<T, Eas, Auth>)
                .layer(DefaultBodyLimit::max(CREATE_BODY_BYTES)),
        )
        .route("/imports/{job_id}", get(jobs::progress::<T, Eas, Auth>))
        .route(
            "/imports/{job_id}/uploads",
            post(uploads::register::<T, Eas, Auth>).layer(DefaultBodyLimit::max(UPLOAD_BODY_BYTES)),
        )
        .route(
            "/imports/{job_id}/uploads/complete",
            post(uploads::complete::<T, Eas, Auth>).layer(DefaultBodyLimit::max(UPLOAD_BODY_BYTES)),
        )
        .route(
            "/imports/{job_id}/finalize",
            post(jobs::finalize::<T, Eas, Auth>),
        )
        .route(
            "/imports/{job_id}/cancel",
            post(jobs::cancel::<T, Eas, Auth>),
        )
        .with_state(state)
}

/// OpenAPI operations, merged into the hosting service's document.
#[derive(utoipa::OpenApi)]
#[openapi(paths(
    create::create,
    uploads::register,
    uploads::complete,
    jobs::list,
    jobs::progress,
    jobs::finalize,
    jobs::cancel
))]
pub struct SlackApiDoc;

/// Transport mapping of sanitized domain errors. Never serialize diagnostic reports.
pub struct ApiError(ImportError);

impl From<ImportError> for ApiError {
    fn from(error: ImportError) -> Self {
        Self(error)
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let status = match self.0 {
            ImportError::InvalidInput => StatusCode::BAD_REQUEST,
            ImportError::LimitExceeded => StatusCode::PAYLOAD_TOO_LARGE,
            ImportError::Unavailable => StatusCode::NOT_FOUND,
            ImportError::AdminRequired => StatusCode::FORBIDDEN,
            ImportError::SourceMismatch | ImportError::Conflict | ImportError::LeaseLost => {
                StatusCode::CONFLICT
            }
            ImportError::UploadMismatch => StatusCode::UNPROCESSABLE_ENTITY,
            ImportError::Disabled | ImportError::Retryable => StatusCode::SERVICE_UNAVAILABLE,
            ImportError::Internal => StatusCode::INTERNAL_SERVER_ERROR,
        };
        (status, Json(self.0)).into_response()
    }
}
