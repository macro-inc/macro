//! Thin user-authenticated routes mounted beside the agent session controls.

use crate::domain::{
    model::{StartVoice, VoiceConnection, VoiceError, VoiceOptions, VoiceSessionId},
    service::AgentVoiceService,
};
use axum::{
    Json, Router,
    extract::{FromRef, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{delete, get, post},
};
use entity_access::{
    domain::{models::EditAccessLevel, ports::EntityAccessService},
    inbound::axum_extractors::AgentSessionAccessLevelExtractor,
};
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOnly,
};
use macro_uuid::Uuid;
use serde::Deserialize;
use std::sync::Arc;

/// Dependencies needed by voice handlers and standard access extractors.
pub struct VoiceRouterState<Access, Auth> {
    service: AgentVoiceService,
    access: Arc<Access>,
    auth: MacroAuthorizationState<Auth>,
}

impl<Access, Auth> VoiceRouterState<Access, Auth> {
    /// Construct at the application composition root.
    pub fn new(
        service: AgentVoiceService,
        access: Arc<Access>,
        auth: MacroAuthorizationState<Auth>,
    ) -> Self {
        Self {
            service,
            access,
            auth,
        }
    }
}
impl<Access, Auth> Clone for VoiceRouterState<Access, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            access: self.access.clone(),
            auth: self.auth.clone(),
        }
    }
}
impl<Access, Auth> FromRef<VoiceRouterState<Access, Auth>> for Arc<Access> {
    fn from_ref(state: &VoiceRouterState<Access, Auth>) -> Self {
        state.access.clone()
    }
}
impl<Access, Auth> FromRef<VoiceRouterState<Access, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &VoiceRouterState<Access, Auth>) -> Self {
        state.auth.clone()
    }
}

/// Routes under `/agent-sessions`; runtime principals cannot mint media credentials.
pub fn voice_router<Access: EntityAccessService, Auth: MacroAuthorizationService>(
    state: VoiceRouterState<Access, Auth>,
) -> Router {
    Router::new()
        .route("/{session_id}/voice/options", get(options::<Access, Auth>))
        .route("/{session_id}/voice", post(start::<Access, Auth>))
        .route(
            "/{session_id}/voice/{voice_session_id}",
            delete(end::<Access, Auth>),
        )
        .with_state(state)
}

/// Safe transport mapping for voice failures.
pub struct ApiError(VoiceError);
impl From<VoiceError> for ApiError {
    fn from(error: VoiceError) -> Self {
        Self(error)
    }
}
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let status = match &self.0 {
            VoiceError::Infrastructure(_) => StatusCode::SERVICE_UNAVAILABLE,
            VoiceError::UnsupportedHarness => StatusCode::BAD_REQUEST,
            VoiceError::Forbidden => StatusCode::FORBIDDEN,
            VoiceError::Conflict => StatusCode::CONFLICT,
            VoiceError::Ended => StatusCode::GONE,
        };
        if matches!(&self.0, VoiceError::Infrastructure(_)) {
            tracing::error!(error = ?self.0, "agent voice request failed");
        }
        (
            status,
            Json(serde_json::json!({"error": self.0.to_string()})),
        )
            .into_response()
    }
}

/// Inspect the deployment capability and voice catalog for an editable session.
#[utoipa::path(
    get,
    path = "/agent-sessions/{session_id}/voice/options",
    tag = "agent-voice",
    operation_id = "get_agent_voice_options",
    params(("session_id" = Uuid, Path, description = "ID of the agent session")),
    responses((status = 200, body = VoiceOptions), (status = 401), (status = 403), (status = 503))
)]
pub async fn options<Access: EntityAccessService, Auth: MacroAuthorizationService>(
    _user: MacroAuthorizationExtractor<Auth, UserOnly>,
    access: AgentSessionAccessLevelExtractor<EditAccessLevel, Access, Auth>,
    State(state): State<VoiceRouterState<Access, Auth>>,
) -> Result<Json<VoiceOptions>, ApiError> {
    Ok(Json(
        state.service.options(access.entity_access_receipt).await?,
    ))
}

/// Start or rejoin one private voice conversation.
#[utoipa::path(
    post,
    path = "/agent-sessions/{session_id}/voice",
    tag = "agent-voice",
    operation_id = "start_agent_voice",
    params(("session_id" = Uuid, Path, description = "ID of the agent session")),
    request_body = StartVoice,
    responses((status = 200, body = VoiceConnection), (status = 400), (status = 401), (status = 403), (status = 409), (status = 410), (status = 503))
)]
pub async fn start<Access: EntityAccessService, Auth: MacroAuthorizationService>(
    _user: MacroAuthorizationExtractor<Auth, UserOnly>,
    access: AgentSessionAccessLevelExtractor<EditAccessLevel, Access, Auth>,
    State(state): State<VoiceRouterState<Access, Auth>>,
    Json(request): Json<StartVoice>,
) -> Result<Json<VoiceConnection>, ApiError> {
    Ok(Json(
        state
            .service
            .start(access.entity_access_receipt, request)
            .await?,
    ))
}

#[derive(Deserialize)]
/// Voice identity extracted alongside the standard session access receipt.
pub struct EndPath {
    voice_session_id: Uuid,
}

/// Close only the requesting user's matching private conversation.
#[utoipa::path(
    delete,
    path = "/agent-sessions/{session_id}/voice/{voice_session_id}",
    tag = "agent-voice",
    operation_id = "end_agent_voice",
    params(
        ("session_id" = Uuid, Path, description = "ID of the agent session"),
        ("voice_session_id" = Uuid, Path, description = "ID of the private voice conversation")
    ),
    responses((status = 204), (status = 401), (status = 403), (status = 409), (status = 503))
)]
pub async fn end<Access: EntityAccessService, Auth: MacroAuthorizationService>(
    _user: MacroAuthorizationExtractor<Auth, UserOnly>,
    access: AgentSessionAccessLevelExtractor<EditAccessLevel, Access, Auth>,
    State(state): State<VoiceRouterState<Access, Auth>>,
    Path(path): Path<EndPath>,
) -> Result<StatusCode, ApiError> {
    state
        .service
        .end(
            access.entity_access_receipt,
            VoiceSessionId(path.voice_session_id),
        )
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
