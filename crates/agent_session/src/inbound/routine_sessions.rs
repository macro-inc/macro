//! Internal-only routine session commands. Ownership and persona policy stay in the domain.
//!
//! All operations use POST with the domain command as JSON (including status,
//! so explicit owner/action identity is not placed in URLs). Successful cancel
//! returns 204; other successes return the domain result. Errors carry only a
//! closed `code`. Prepare and prompt must not be replayed after ambiguous errors.

use std::{sync::Arc, time::Duration};

use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, FromRef, Request, State, rejection::JsonRejection},
    http::StatusCode,
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::post,
};
use macro_authorization::{
    InternalOnly, MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState,
};
use serde::Serialize;

use crate::domain::routines::{
    PrepareRoutineSession, PreparedRoutineSession, PromptRoutineSession, RoutineActionStatus,
    RoutinePromptAccepted, RoutineSessionAction, RoutineSessionError, RoutineSessions,
    ValidateRoutineSession, ValidatedRoutineSession,
};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const STATUS_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_COMMAND_BYTES: usize = 1024 * 1024;

/// Independent state for the scheduler-facing capability; no public control access.
pub struct RoutineSessionsState<Service, Auth> {
    service: Arc<Service>,
    authorization: MacroAuthorizationState<Auth>,
}

impl<Service, Auth> RoutineSessionsState<Service, Auth> {
    /// Compose a domain capability with the shared authentication service.
    pub fn new(service: Arc<Service>, authorization: MacroAuthorizationState<Auth>) -> Self {
        Self {
            service,
            authorization,
        }
    }
}

impl<Service, Auth> Clone for RoutineSessionsState<Service, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            authorization: self.authorization.clone(),
        }
    }
}

impl<Service, Auth> FromRef<RoutineSessionsState<Service, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &RoutineSessionsState<Service, Auth>) -> Self {
        state.authorization.clone()
    }
}

/// Internal routes, already mounted beneath `/internal/routine-sessions`.
///
/// No browser OpenAPI schemas or public authentication policies are changed.
pub fn routine_sessions_router<Service: RoutineSessions, Auth: MacroAuthorizationService>(
    state: RoutineSessionsState<Service, Auth>,
) -> Router {
    Router::new().nest(
        "/internal/routine-sessions",
        Router::new()
            .route("/validate", post(validate::<Service, Auth>))
            .route("/prepare", post(prepare::<Service, Auth>))
            .route("/prompt", post(prompt::<Service, Auth>))
            .route("/status", post(status::<Service, Auth>))
            .route("/cancel", post(cancel::<Service, Auth>))
            .layer(DefaultBodyLimit::max(MAX_COMMAND_BYTES))
            .layer(middleware::from_fn(bound_request))
            .with_state(state),
    )
}

/// Sanitized error envelope for scheduler mapping. Never contains upstream text.
#[derive(Debug, Serialize)]
pub struct RoutineSessionErrorResponse {
    /// Closed domain code; prompt delivery uncertainty must never trigger replay.
    pub code: RoutineSessionError,
}

struct ApiError(RoutineSessionError);

impl From<RoutineSessionError> for ApiError {
    fn from(error: RoutineSessionError) -> Self {
        Self(error)
    }
}

impl From<JsonRejection> for ApiError {
    fn from(_: JsonRejection) -> Self {
        Self(RoutineSessionError::InvalidCommand)
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let status = match self.0 {
            RoutineSessionError::Admission(error) => {
                ai_billing::inbound::admission::admission_status(error)
            }
            RoutineSessionError::InvalidCommand
            | RoutineSessionError::InvalidRepositorySelection => StatusCode::BAD_REQUEST,
            RoutineSessionError::Forbidden => StatusCode::FORBIDDEN,
            RoutineSessionError::PersonaUnavailable => StatusCode::NOT_FOUND,
            RoutineSessionError::RuntimeUnavailable => StatusCode::SERVICE_UNAVAILABLE,
            RoutineSessionError::SessionMismatch
            | RoutineSessionError::ModelMismatch
            | RoutineSessionError::Conflict => StatusCode::CONFLICT,
            RoutineSessionError::PromptDeliveryUnknown => StatusCode::BAD_GATEWAY,
            RoutineSessionError::OperationFailed => StatusCode::INTERNAL_SERVER_ERROR,
        };
        (status, Json(RoutineSessionErrorResponse { code: self.0 })).into_response()
    }
}

async fn bound_request(request: Request, next: Next) -> Response {
    let is_prompt = request.uri().path().ends_with("/prompt");
    let timeout = if request.uri().path().ends_with("/status") {
        STATUS_TIMEOUT
    } else {
        REQUEST_TIMEOUT
    };
    bounded_response(is_prompt, timeout, next.run(request)).await
}

async fn bounded_response(
    is_prompt: bool,
    timeout: Duration,
    response: impl Future<Output = Response>,
) -> Response {
    match tokio::time::timeout(timeout, response).await {
        Ok(response) => response,
        Err(_) => {
            // Cancellation of the HTTP future cannot undo already-admitted work.
            let code = if is_prompt {
                RoutineSessionError::PromptDeliveryUnknown
            } else {
                RoutineSessionError::OperationFailed
            };
            (
                StatusCode::GATEWAY_TIMEOUT,
                Json(RoutineSessionErrorResponse { code }),
            )
                .into_response()
        }
    }
}

async fn validate<Service: RoutineSessions, Auth: MacroAuthorizationService>(
    State(state): State<RoutineSessionsState<Service, Auth>>,
    _internal: MacroAuthorizationExtractor<Auth, InternalOnly>,
    command: Result<Json<ValidateRoutineSession>, JsonRejection>,
) -> Result<Json<ValidatedRoutineSession>, ApiError> {
    Ok(Json(state.service.validate(command?.0).await?))
}

async fn prepare<Service: RoutineSessions, Auth: MacroAuthorizationService>(
    State(state): State<RoutineSessionsState<Service, Auth>>,
    _internal: MacroAuthorizationExtractor<Auth, InternalOnly>,
    command: Result<Json<PrepareRoutineSession>, JsonRejection>,
) -> Result<Json<PreparedRoutineSession>, ApiError> {
    Ok(Json(state.service.prepare(command?.0).await?))
}

async fn prompt<Service: RoutineSessions, Auth: MacroAuthorizationService>(
    State(state): State<RoutineSessionsState<Service, Auth>>,
    _internal: MacroAuthorizationExtractor<Auth, InternalOnly>,
    command: Result<Json<PromptRoutineSession>, JsonRejection>,
) -> Result<Json<RoutinePromptAccepted>, ApiError> {
    Ok(Json(state.service.prompt(command?.0).await?))
}

async fn status<Service: RoutineSessions, Auth: MacroAuthorizationService>(
    State(state): State<RoutineSessionsState<Service, Auth>>,
    _internal: MacroAuthorizationExtractor<Auth, InternalOnly>,
    command: Result<Json<RoutineSessionAction>, JsonRejection>,
) -> Result<Json<RoutineActionStatus>, ApiError> {
    Ok(Json(state.service.status(command?.0).await?))
}

async fn cancel<Service: RoutineSessions, Auth: MacroAuthorizationService>(
    State(state): State<RoutineSessionsState<Service, Auth>>,
    _internal: MacroAuthorizationExtractor<Auth, InternalOnly>,
    command: Result<Json<RoutineSessionAction>, JsonRejection>,
) -> Result<StatusCode, ApiError> {
    state.service.cancel(command?.0).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod test;
