//! Axum router for the system status endpoints.
//!
//! Nested under `/system-status` by the authentication service:
//! - `GET /` — anyone: the current status
//! - `POST /` — Macro staff: set the status
//! - `GET /history` — Macro staff: recent updates, newest first

/// The current status.
pub mod get_current;
/// Recent updates.
pub mod list_history;
/// Set the status.
pub mod set_status;
#[cfg(test)]
mod test;

use std::sync::Arc;

use axum::{
    Json, Router, extract::FromRef, http::StatusCode, response::IntoResponse, routing::get,
};
use macro_authorization::{MacroAuthorizationService, MacroAuthorizationState};
use model_error_response::ErrorResponse;
use serde::Serialize;
use utoipa::ToSchema;

use crate::domain::{
    models::{StatusUpdate, SystemStatusError},
    ports::SystemStatusService,
};

impl IntoResponse for SystemStatusError {
    fn into_response(self) -> axum::response::Response {
        let status_code = match &self {
            SystemStatusError::Forbidden => StatusCode::FORBIDDEN,
            SystemStatusError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };
        if status_code.is_server_error() {
            tracing::error!(error = ?self, "internal server error");
        }

        (
            status_code,
            Json(ErrorResponse {
                message: self.to_string().into(),
            }),
        )
            .into_response()
    }
}

/// Recent status updates, newest first.
#[derive(Debug, Serialize, ToSchema)]
pub struct SystemStatusHistory {
    /// The updates.
    pub updates: Vec<StatusUpdate>,
}

/// Router state containing the system status service.
pub struct SystemStatusRouterState<T, Auth> {
    /// The system status service implementation.
    pub service: Arc<T>,
    /// State for request authorization.
    pub authorization_state: MacroAuthorizationState<Auth>,
}

impl<T, Auth> Clone for SystemStatusRouterState<T, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<T, Auth> FromRef<SystemStatusRouterState<T, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &SystemStatusRouterState<T, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// Build the system status router.
pub fn system_status_router<T, Auth, S>(state: SystemStatusRouterState<T, Auth>) -> Router<S>
where
    T: SystemStatusService,
    Auth: MacroAuthorizationService,
    S: Send + Sync + 'static,
{
    Router::new()
        .route(
            "/",
            get(get_current::handler::<T, Auth>).post(set_status::handler::<T, Auth>),
        )
        .route("/history", get(list_history::handler::<T, Auth>))
        .with_state(state)
}
