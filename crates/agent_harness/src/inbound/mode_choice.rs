//! Authenticated HTTP adapter for the agent composer's Auto mode: the app asks
//! whether a prompt goes to a chat or a coding agent before starting the
//! session. The caller is always the user the token names.

use std::sync::Arc;

use axum::Router;
use axum::extract::{FromRef, Json, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOnly,
};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::domain::mode_choice::{AgentMode, ModeChoiceError, ModeChoiceService};

#[cfg(test)]
mod test;

/// Request body for `POST /agent-mode-choice`.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentModeChoiceRequest {
    /// The prompt the composer is about to send.
    pub prompt: String,
}

/// Response body for `POST /agent-mode-choice`.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentModeChoiceResponse {
    /// Which kind of agent should receive the prompt.
    pub mode: AgentMode,
}

/// Router state for Auto mode choice.
pub struct AgentModeChoiceRouterState<Auth> {
    service: Arc<dyn ModeChoiceService>,
    authorization: MacroAuthorizationState<Auth>,
}

impl<Auth> AgentModeChoiceRouterState<Auth> {
    /// Build Auto mode choice route state.
    pub fn new(
        service: Arc<dyn ModeChoiceService>,
        authorization: MacroAuthorizationState<Auth>,
    ) -> Self {
        Self {
            service,
            authorization,
        }
    }
}

impl<Auth> Clone for AgentModeChoiceRouterState<Auth> {
    fn clone(&self) -> Self {
        Self {
            service: Arc::clone(&self.service),
            authorization: self.authorization.clone(),
        }
    }
}

impl<Auth> FromRef<AgentModeChoiceRouterState<Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &AgentModeChoiceRouterState<Auth>) -> Self {
        state.authorization.clone()
    }
}

/// Build `POST /agent-mode-choice`.
pub fn agent_mode_choice_router<Auth, S>(state: AgentModeChoiceRouterState<Auth>) -> Router<S>
where
    Auth: MacroAuthorizationService,
    S: Clone + Send + Sync + 'static,
{
    Router::new()
        .route(
            "/agent-mode-choice",
            post(choose_agent_mode_handler::<Auth>),
        )
        .with_state(state)
}

/// Choose whether a composer prompt goes to a chat or a coding agent.
#[utoipa::path(
    post,
    path = "/agent-mode-choice",
    tag = "agent-mode-choice",
    operation_id = "choose_agent_mode",
    security(("bearerAuth" = [])),
    request_body = AgentModeChoiceRequest,
    responses(
        (status = 200, description = "The kind of agent the prompt goes to", body = AgentModeChoiceResponse),
        (status = 400, description = "The prompt is blank"),
        (status = 401, description = "Unauthenticated"),
        (status = 402, description = "The caller cannot start new AI work"),
        (status = 403, description = "Auto mode is not enabled for the caller"),
        (status = 503, description = "The classifier is unconfigured, failed, or timed out"),
    )
)]
pub async fn choose_agent_mode_handler<Auth>(
    State(state): State<AgentModeChoiceRouterState<Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOnly>,
    Json(request): Json<AgentModeChoiceRequest>,
) -> Response
where
    Auth: MacroAuthorizationService,
{
    match state
        .service
        .choose(
            authorization.authorization.macro_user_id.clone(),
            &request.prompt,
        )
        .await
    {
        Ok(mode) => (StatusCode::OK, Json(AgentModeChoiceResponse { mode })).into_response(),
        Err(ModeChoiceError::EmptyPrompt) => {
            (StatusCode::BAD_REQUEST, "a prompt needs text".to_owned()).into_response()
        }
        Err(ModeChoiceError::NotEnabled) => (
            StatusCode::FORBIDDEN,
            ModeChoiceError::NotEnabled.to_string(),
        )
            .into_response(),
        Err(ModeChoiceError::Admission(error)) => error.into_response(),
        Err(error) => {
            tracing::warn!(error = ?error, "could not choose an agent mode");
            (StatusCode::SERVICE_UNAVAILABLE, error.to_string()).into_response()
        }
    }
}
