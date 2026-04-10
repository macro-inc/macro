//! Axum routers for call endpoints.
//!
//! Two routers are exposed so the consumer can attach different middleware:
//!
//! - [`call_router`] — authenticated call operations (get/create, leave/end).
//!   Requires auth middleware.
//! - [`webhook_router`] — RTC provider webhook ingestion.
//!   Does **not** require auth middleware (LiveKit signs requests itself).

use std::borrow::Cow;
use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{FromRef, FromRequestParts, State},
    http::{StatusCode, request::Parts},
    response::IntoResponse,
    routing::{get, post},
};
use entity_access::{
    domain::models::MemberParticipantRole,
    domain::ports::EntityAccessService,
    inbound::axum_extractors::{
        CallWithChannelIdAccessLevelExtractor, ChannelAccessLevelExtractor,
    },
};
use model_error_response::ErrorResponse;
use model_user::axum_extractor::MacroUserExtractor;
use uuid::Uuid;

use crate::domain::models::{
    CallActiveResponse, CallError, CallTokenResponse, LeaveCallResponse, TranscriptSegmentRequest,
};
use crate::domain::ports::CallService;

// ---------------------------------------------------------------------------
// Call router (authenticated)
// ---------------------------------------------------------------------------

/// Router state for authenticated call operations.
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
    /// Create a new router state from shared service references.
    pub fn new(service: Arc<S>, access_service: Arc<Svc>) -> Self {
        Self {
            service,
            access_service,
        }
    }
}

impl<S, Svc> FromRef<CallRouterState<S, Svc>> for Arc<Svc> {
    fn from_ref(state: &CallRouterState<S, Svc>) -> Self {
        state.access_service.clone()
    }
}

/// Authenticated call router.
///
/// Routes:
/// - `GET /{channel_id}` — get or create a call (join existing or start new)
/// - `GET /{channel_id}/active` — check if an active call exists
/// - `DELETE /{channel_id}` — leave or end a call
pub fn call_router<S, Svc, T>(state: CallRouterState<S, Svc>) -> Router<T>
where
    S: CallService,
    Svc: EntityAccessService,
    T: Send + Sync,
{
    Router::new()
        .route(
            "/{channel_id}",
            get(get_or_create_call_handler::<S, Svc>).delete(leave_or_end_call_handler::<S, Svc>),
        )
        .route(
            "/{channel_id}/active",
            get(check_active_call_handler::<S, Svc>),
        )
        .with_state(state)
}

// ---------------------------------------------------------------------------
// Webhook router (unauthenticated — LiveKit validates via its own JWT)
// ---------------------------------------------------------------------------

/// Router state for the webhook endpoint.
pub struct WebhookRouterState<S> {
    service: Arc<S>,
}

impl<S> Clone for WebhookRouterState<S> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
        }
    }
}

impl<S: CallService> WebhookRouterState<S> {
    /// Create a new webhook router state wrapping the call service.
    pub fn new(service: Arc<S>) -> Self {
        Self { service }
    }
}

/// Webhook router for RTC provider event ingestion.
///
/// Routes:
/// - `POST /webhook` — ingest a webhook event from LiveKit
pub fn webhook_router<S, T>(state: WebhookRouterState<S>) -> Router<T>
where
    S: CallService,
    T: Send + Sync,
{
    Router::new()
        .route("/webhook", post(webhook_handler::<S>))
        .with_state(state)
}

// ---------------------------------------------------------------------------
// Internal call router (agent-authenticated via shared secret)
// ---------------------------------------------------------------------------

/// Router state for the internal transcript endpoint.
pub struct InternalCallRouterState<S> {
    service: Arc<S>,
}

impl<S> Clone for InternalCallRouterState<S> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
        }
    }
}

impl<S: CallService> InternalCallRouterState<S> {
    /// Create a new internal call router state wrapping the call service.
    pub fn new(service: Arc<S>) -> Self {
        Self { service }
    }
}

impl<S> FromRef<InternalCallRouterState<S>> for Arc<S> {
    fn from_ref(state: &InternalCallRouterState<S>) -> Self {
        state.service.clone()
    }
}

/// Internal call router for agent-submitted transcript segments.
///
/// Routes:
/// - `POST /{channel_id}/transcript` — ingest a transcript segment (from internal agent)
pub fn internal_call_router<S, T>(state: InternalCallRouterState<S>) -> Router<T>
where
    S: CallService,
    T: Send + Sync,
{
    Router::new()
        .route("/{channel_id}/transcript", post(transcript_handler::<S>))
        .with_state(state)
}

// ---------------------------------------------------------------------------
// Internal call access extractor
// ---------------------------------------------------------------------------

static INTERNAL_CALL_HEADER: &str = "x-macro-internal-call";

/// Axum extractor that validates the `x-macro-internal-call` header against
/// the shared secret stored in the [`CallService`].
pub struct InternalCallAccessExtractor(());

impl<S> FromRequestParts<InternalCallRouterState<S>> for InternalCallAccessExtractor
where
    S: CallService,
{
    type Rejection = (StatusCode, Cow<'static, str>);

    async fn from_request_parts(
        parts: &mut Parts,
        state: &InternalCallRouterState<S>,
    ) -> Result<Self, Self::Rejection> {
        let token = parts
            .headers
            .get(INTERNAL_CALL_HEADER)
            .and_then(|v| v.to_str().ok())
            .ok_or((
                StatusCode::BAD_REQUEST,
                Cow::Borrowed("missing x-macro-internal-call header"),
            ))?;

        if state.service.validate_internal_call(token) {
            Ok(InternalCallAccessExtractor(()))
        } else {
            Err((StatusCode::UNAUTHORIZED, Cow::Borrowed("unauthorized")))
        }
    }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/// Handler for `GET /call/{channel_id}`.
///
/// Gets or creates a call for the channel. If a call already exists, joins it;
/// otherwise creates a new one. Always returns a join token.
#[utoipa::path(
    get,
    operation_id = "get_or_create_call",
    path = "/call/{channel_id}",
    params(
        ("channel_id" = Uuid, Path, description = "Channel ID"),
    ),
    responses(
        (status = 200, body = CallTokenResponse),
        (status = 401, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn get_or_create_call_handler<S: CallService, Svc: EntityAccessService>(
    State(state): State<CallRouterState<S, Svc>>,
    access: ChannelAccessLevelExtractor<MemberParticipantRole, Svc>,
    user: MacroUserExtractor,
) -> Result<Json<CallTokenResponse>, CallError> {
    let channel_id = Uuid::parse_str(&access.entity_access_receipt.entity().entity_id)
        .map_err(|_| CallError::Internal(anyhow::anyhow!("invalid channel_id")))?;
    let user_id = user.macro_user_id.as_ref();

    let response = state
        .service
        .get_or_create_call(&channel_id, user_id)
        .await?;

    Ok(Json(response))
}

/// Handler for `GET /call/{channel_id}/active`.
///
/// Returns 200 with call info if an active call exists, or 204 No Content if not.
#[utoipa::path(
    get,
    operation_id = "check_active_call",
    path = "/call/{channel_id}/active",
    params(
        ("channel_id" = Uuid, Path, description = "Channel ID"),
    ),
    responses(
        (status = 200, body = CallActiveResponse),
        (status = 204, description = "No active call"),
        (status = 401, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn check_active_call_handler<S: CallService, Svc: EntityAccessService>(
    State(state): State<CallRouterState<S, Svc>>,
    access: ChannelAccessLevelExtractor<MemberParticipantRole, Svc>,
) -> Result<axum::response::Response, CallError> {
    let channel_id = Uuid::parse_str(&access.entity_access_receipt.entity().entity_id)
        .map_err(|_| CallError::Internal(anyhow::anyhow!("invalid channel_id")))?;

    match state.service.check_active_call(&channel_id).await? {
        Some(response) => Ok(Json(response).into_response()),
        None => Ok(StatusCode::NO_CONTENT.into_response()),
    }
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
    access: CallWithChannelIdAccessLevelExtractor<MemberParticipantRole, Svc>,
    user: MacroUserExtractor,
) -> Result<Json<LeaveCallResponse>, CallError> {
    let channel_id = access.channel_id;
    let user_id = user.macro_user_id.as_ref();

    let response = state
        .service
        .leave_or_end_call(&channel_id, user_id)
        .await?;

    Ok(Json(response))
}

/// Handler for `POST /call/webhook`.
///
/// Receives webhook events from the RTC provider (e.g. LiveKit).
/// The `Authorization` header contains the webhook auth token
/// and the body contains the raw event payload.
#[utoipa::path(
    post,
    operation_id = "call_webhook",
    path = "/call/webhook",
    responses(
        (status = 200, description = "Event processed"),
        (status = 401, description = "Invalid webhook signature"),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn webhook_handler<S: CallService>(
    State(state): State<WebhookRouterState<S>>,
    headers: axum::http::HeaderMap,
    body: String,
) -> Result<StatusCode, CallError> {
    let auth_token = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .ok_or(CallError::Auth)?;

    state
        .service
        .process_webhook_event(&body, auth_token)
        .await?;

    Ok(StatusCode::OK)
}

/// Handler for `POST /call/{channel_id}/transcript`.
///
/// Receives transcript segments from the transcription agent.
/// Authenticated via the `x-macro-internal-call` shared secret.
/// Duplicate segments (same `segment_id`) are ignored.
#[utoipa::path(
    post,
    operation_id = "ingest_transcript",
    path = "/call/{channel_id}/transcript",
    params(
        ("channel_id" = Uuid, Path, description = "Channel ID"),
    ),
    request_body = TranscriptSegmentRequest,
    responses(
        (status = 200, description = "Segment ingested"),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse, description = "No active call"),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn transcript_handler<S: CallService>(
    State(state): State<InternalCallRouterState<S>>,
    _access: InternalCallAccessExtractor,
    axum::extract::Path(channel_id): axum::extract::Path<Uuid>,
    Json(segment): Json<TranscriptSegmentRequest>,
) -> Result<StatusCode, CallError> {
    state
        .service
        .ingest_transcript_segment(&channel_id, segment)
        .await?;

    Ok(StatusCode::OK)
}

// ---------------------------------------------------------------------------
// Error mapping
// ---------------------------------------------------------------------------

impl IntoResponse for CallError {
    fn into_response(self) -> axum::response::Response {
        let status_code = match &self {
            CallError::NotFound(_) => StatusCode::NOT_FOUND,
            CallError::NotInCall => StatusCode::BAD_REQUEST,
            CallError::Auth => StatusCode::UNAUTHORIZED,
            CallError::Internal(_) => {
                tracing::error!(error=?self, "internal server error");
                StatusCode::INTERNAL_SERVER_ERROR
            }
        };

        let message = match &self {
            CallError::Internal(_) => "internal server error".to_string(),
            other => other.to_string(),
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
