//! Axum router for call endpoints.
//!
//! Provides routes:
//! - `POST /{channel_id}` — create a new call
//! - `GET /{channel_id}` — join an existing call
//! - `DELETE /{channel_id}` — leave or end a call

use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{FromRef, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{delete, get, post},
};
use entity_access::{
    domain::{
        models::{EntityAccessReceipt, MemberParticipantRole, RequiredPermission},
        ports::EntityAccessService,
    },
    inbound::axum_extractors::ChannelAccessLevelExtractor,
};
use model_error_response::ErrorResponse;
use model_user::axum_extractor::MacroUserExtractor;
use uuid::Uuid;

use crate::domain::models::{CallError, CallTokenResponse, LeaveCallResponse};
use crate::domain::ports::CallService;

/// Router state containing the call service and entity access service.
pub struct CallRouterState<S, Svc> {
    service: Arc<S>,
    access_service: Arc<Svc>,
}

impl<S, Svc> Clone for CallRouterState<S, Svc> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            access_service: self.access_service.clone(),
        }
    }
}

impl<S: CallService, Svc: EntityAccessService> CallRouterState<S, Svc> {
    /// Create a new router state wrapping the service and entity access service.
    pub fn new(service: S, access_service: Svc) -> Self {
        Self {
            service: Arc::new(service),
            access_service: Arc::new(access_service),
        }
    }
}

impl<S, Svc> FromRef<CallRouterState<S, Svc>> for Arc<Svc> {
    fn from_ref(state: &CallRouterState<S, Svc>) -> Self {
        state.access_service.clone()
    }
}

fn channel_id_from_receipt<T: RequiredPermission>(
    receipt: &EntityAccessReceipt<T>,
) -> Result<Uuid, CallError> {
    Uuid::parse_str(&receipt.entity().entity_id)
        .map_err(|_| CallError::Internal(anyhow::anyhow!("invalid channel_id")))
}

/// Create the call router.
pub fn call_router<S, Svc, T>(state: CallRouterState<S, Svc>) -> Router<T>
where
    S: CallService,
    Svc: EntityAccessService,
    T: Send + Sync,
{
    Router::new()
        .route("/{channel_id}", post(create_call_handler::<S, Svc>))
        .route("/{channel_id}", get(join_call_handler::<S, Svc>))
        .route("/{channel_id}", delete(leave_or_end_call_handler::<S, Svc>))
        .with_state(state)
}

/// Handler for `POST /call/{channel_id}`.
#[utoipa::path(
    post,
    operation_id = "create_call",
    path = "/call/{channel_id}",
    params(
        ("channel_id" = Uuid, Path, description = "Channel ID"),
    ),
    responses(
        (status = 201, body = CallTokenResponse),
        (status = 401, body = ErrorResponse),
        (status = 409, body = ErrorResponse, description = "Call already exists"),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn create_call_handler<S: CallService, Svc: EntityAccessService>(
    State(state): State<CallRouterState<S, Svc>>,
    access: ChannelAccessLevelExtractor<MemberParticipantRole, Svc>,
    user: MacroUserExtractor,
) -> Result<(StatusCode, Json<CallTokenResponse>), CallError> {
    let channel_id = channel_id_from_receipt(&access.entity_access_receipt)?;
    let user_id = user.macro_user_id.as_ref();

    let response = state.service.create_call(channel_id, user_id).await?;

    Ok((StatusCode::CREATED, Json(response)))
}

/// Handler for `GET /call/{channel_id}`.
#[utoipa::path(
    get,
    operation_id = "join_call",
    path = "/call/{channel_id}",
    params(
        ("channel_id" = Uuid, Path, description = "Channel ID"),
    ),
    responses(
        (status = 200, body = CallTokenResponse),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse, description = "No active call"),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn join_call_handler<S: CallService, Svc: EntityAccessService>(
    State(state): State<CallRouterState<S, Svc>>,
    access: ChannelAccessLevelExtractor<MemberParticipantRole, Svc>,
    user: MacroUserExtractor,
) -> Result<Json<CallTokenResponse>, CallError> {
    let channel_id = channel_id_from_receipt(&access.entity_access_receipt)?;
    let user_id = user.macro_user_id.as_ref();

    let response = state.service.join_call(channel_id, user_id).await?;

    Ok(Json(response))
}

/// Handler for `DELETE /call/{channel_id}`.
#[utoipa::path(
    delete,
    operation_id = "leave_or_end_call",
    path = "/call/{channel_id}",
    params(
        ("channel_id" = Uuid, Path, description = "Channel ID"),
    ),
    responses(
        (status = 200, body = LeaveCallResponse),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse, description = "No active call"),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn leave_or_end_call_handler<S: CallService, Svc: EntityAccessService>(
    State(state): State<CallRouterState<S, Svc>>,
    access: ChannelAccessLevelExtractor<MemberParticipantRole, Svc>,
    user: MacroUserExtractor,
) -> Result<Json<LeaveCallResponse>, CallError> {
    let channel_id = channel_id_from_receipt(&access.entity_access_receipt)?;
    let user_id = user.macro_user_id.as_ref();

    let response = state.service.leave_or_end_call(channel_id, user_id).await?;

    Ok(Json(response))
}

impl IntoResponse for CallError {
    fn into_response(self) -> axum::response::Response {
        let status_code = match &self {
            CallError::AlreadyExists(_) => StatusCode::CONFLICT,
            CallError::NotFound(_) => StatusCode::NOT_FOUND,
            CallError::AlreadyJoined => StatusCode::CONFLICT,
            CallError::NotInCall => StatusCode::BAD_REQUEST,
            CallError::Internal(_) => {
                tracing::error!(error=?self, "internal server error");
                StatusCode::INTERNAL_SERVER_ERROR
            }
        };

        let message = self.to_string();
        (
            status_code,
            Json(ErrorResponse {
                message: message.into(),
            }),
        )
            .into_response()
    }
}
