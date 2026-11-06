//! Stopping a session's permission requests from one of them, mounted under
//! `/agent-sessions`.
//!
//! The caller needs edit access to the session, the access that answers its
//! requests, checked by the extractor before the handler runs. Whether they
//! may change the runtime and the agent is the domain's to decide.

use std::sync::Arc;

use agent_session::domain::model::AgentSessionId;
use axum::Router;
use axum::extract::{FromRef, Json, Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use entity_access::domain::models::EditAccessLevel;
use entity_access::domain::ports::EntityAccessService;
use entity_access::inbound::axum_extractors::AgentSessionAccessLevelExtractor;
use macro_authorization::{MacroAuthorizationService, MacroAuthorizationState};
use macro_uuid::Uuid;
use serde::Serialize;
use utoipa::ToSchema;

use crate::domain::runtime_bypass::{RuntimeBypassError, RuntimeBypassOffer, RuntimeBypassService};

#[cfg(test)]
mod test;

/// What stopping the asking changes for the session.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeBypassOfferDto {
    /// The registered runtime whose bypass is turned on.
    #[schema(value_type = String)]
    pub harness_id: Uuid,
    /// The agent is set to bypass too, because it asks by its own choice.
    pub enables_agent_auto_accept: bool,
}

impl From<RuntimeBypassOffer> for RuntimeBypassOfferDto {
    fn from(offer: RuntimeBypassOffer) -> Self {
        Self {
            harness_id: offer.harness.as_uuid(),
            enables_agent_auto_accept: offer.enables_agent_auto_accept,
        }
    }
}

/// Response body for reading the offer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeBypassOfferResponse {
    /// `null` when nothing the caller may change would stop the session
    /// asking.
    pub offer: Option<RuntimeBypassOfferDto>,
}

/// Router state: the service, plus what the access extractor resolves grants
/// and identity through.
pub struct RuntimeBypassRouterState<Service, Access, Auth> {
    service: Arc<Service>,
    entity_access: Arc<Access>,
    authorization: MacroAuthorizationState<Auth>,
}

impl<Service, Access, Auth> RuntimeBypassRouterState<Service, Access, Auth> {
    /// Build the state.
    pub fn new(
        service: Arc<Service>,
        entity_access: Arc<Access>,
        authorization: MacroAuthorizationState<Auth>,
    ) -> Self {
        Self {
            service,
            entity_access,
            authorization,
        }
    }
}

impl<Service, Access, Auth> Clone for RuntimeBypassRouterState<Service, Access, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: Arc::clone(&self.service),
            entity_access: Arc::clone(&self.entity_access),
            authorization: self.authorization.clone(),
        }
    }
}

impl<Service, Access, Auth> FromRef<RuntimeBypassRouterState<Service, Access, Auth>>
    for MacroAuthorizationState<Auth>
{
    fn from_ref(state: &RuntimeBypassRouterState<Service, Access, Auth>) -> Self {
        state.authorization.clone()
    }
}

impl<Service, Access, Auth> FromRef<RuntimeBypassRouterState<Service, Access, Auth>>
    for Arc<Access>
{
    fn from_ref(state: &RuntimeBypassRouterState<Service, Access, Auth>) -> Self {
        Arc::clone(&state.entity_access)
    }
}

/// Build the router. Mount it under `/agent-sessions`.
pub fn runtime_bypass_router<Service, Access, Auth, S>(
    state: RuntimeBypassRouterState<Service, Access, Auth>,
) -> Router<S>
where
    Service: RuntimeBypassService,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
    S: Clone + Send + Sync + 'static,
{
    Router::new()
        .route(
            "/{session_id}/runtime-bypass",
            get(get_runtime_bypass_offer_handler::<Service, Access, Auth>)
                .post(stop_asking_on_runtime_handler::<Service, Access, Auth>),
        )
        .with_state(state)
}

/// Why the asking could not be stopped, on the wire.
#[derive(Debug)]
pub struct RuntimeBypassApiError(RuntimeBypassError);

impl IntoResponse for RuntimeBypassApiError {
    fn into_response(self) -> Response {
        match self.0 {
            RuntimeBypassError::Unavailable => (
                StatusCode::CONFLICT,
                "nothing you may change would stop this session asking",
            )
                .into_response(),
            RuntimeBypassError::Forbidden => (
                StatusCode::FORBIDDEN,
                "you may not change this runtime or agent",
            )
                .into_response(),
            RuntimeBypassError::Session(error) => {
                tracing::error!(error = ?error, "reading the session for runtime bypass failed");
                (StatusCode::INTERNAL_SERVER_ERROR, "internal error").into_response()
            }
            RuntimeBypassError::Settings(error) => {
                tracing::error!(error = ?error, "changing runtime bypass failed");
                (StatusCode::INTERNAL_SERVER_ERROR, "internal error").into_response()
            }
        }
    }
}

#[utoipa::path(
    get,
    path = "/agent-sessions/{session_id}/runtime-bypass",
    tag = "agent-sessions",
    operation_id = "get_agent_session_runtime_bypass",
    params(("session_id" = Uuid, Path, description = "ID of the agent session")),
    responses(
        (status = 200, body = RuntimeBypassOfferResponse),
        (status = 401, body = String),
        (status = 403, body = String, description = "No edit access, or not a person"),
        (status = 404, body = String),
        (status = 500, body = String),
    )
)]
/// What stopping this session's permission requests would change - its
/// runtime's bypass, and the agent's own choice when that asks too - when
/// the caller may make every change.
#[tracing::instrument(skip_all, fields(%session_id), err(Debug))]
pub async fn get_runtime_bypass_offer_handler<Service, Access, Auth>(
    access: AgentSessionAccessLevelExtractor<EditAccessLevel, Access, Auth>,
    State(state): State<RuntimeBypassRouterState<Service, Access, Auth>>,
    Path(session_id): Path<Uuid>,
) -> Result<Json<RuntimeBypassOfferResponse>, Response>
where
    Service: RuntimeBypassService,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let caller = access
        .entity_access_receipt
        .get_authenticated_user()
        .map_err(|_| (StatusCode::FORBIDDEN, "a person must ask").into_response())?
        .clone();
    let offer = state
        .service
        .runtime_bypass_offer(&caller, AgentSessionId::new_from_uuid(session_id))
        .await
        .map_err(|error| RuntimeBypassApiError(error).into_response())?;
    Ok(Json(RuntimeBypassOfferResponse {
        offer: offer.map(Into::into),
    }))
}

#[utoipa::path(
    post,
    path = "/agent-sessions/{session_id}/runtime-bypass",
    tag = "agent-sessions",
    operation_id = "stop_agent_session_runtime_asking",
    params(("session_id" = Uuid, Path, description = "ID of the agent session")),
    responses(
        (status = 200, body = RuntimeBypassOfferDto, description = "What was changed"),
        (status = 401, body = String),
        (status = 403, body = String, description = "No edit access, or a change was refused"),
        (status = 404, body = String),
        (status = 409, body = String, description = "Nothing the caller may change would stop the asking"),
        (status = 500, body = String),
    )
)]
/// Turn on the session's runtime bypass, and the agent's own choice to
/// bypass when that asks too. The session stops asking once a person answers
/// the request in front of them, or from its next turn.
#[tracing::instrument(skip_all, fields(%session_id), err(Debug))]
pub async fn stop_asking_on_runtime_handler<Service, Access, Auth>(
    access: AgentSessionAccessLevelExtractor<EditAccessLevel, Access, Auth>,
    State(state): State<RuntimeBypassRouterState<Service, Access, Auth>>,
    Path(session_id): Path<Uuid>,
) -> Result<Json<RuntimeBypassOfferDto>, Response>
where
    Service: RuntimeBypassService,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let caller = access
        .entity_access_receipt
        .get_authenticated_user()
        .map_err(|_| (StatusCode::FORBIDDEN, "a person must ask").into_response())?
        .clone();
    let offer = state
        .service
        .stop_asking_on_runtime(&caller, AgentSessionId::new_from_uuid(session_id))
        .await
        .map_err(|error| RuntimeBypassApiError(error).into_response())?;
    Ok(Json(offer.into()))
}
