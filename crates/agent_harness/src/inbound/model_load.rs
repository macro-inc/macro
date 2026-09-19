//! Authenticated HTTP adapter for fresh agent-model discovery.

use std::sync::Arc;

use axum::Router;
use axum::extract::{FromRef, Json, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use harness_id::HarnessId;
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOnly,
};
use macro_uuid::Uuid;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::domain::model_load::{
    AgentModels, AgentModelsService, AgentModelsStatus, LoadAgentModels, LoadAgentModelsError,
    ModelHarness,
};

#[cfg(test)]
mod test;

/// HTTP request selecting one provider to probe.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct LoadAgentModelsRequest {
    /// Provider to probe.
    pub harness: ModelHarnessDto,
    /// Required for macrod and forbidden for other targets.
    pub harness_id: Option<Uuid>,
}

/// Harness names accepted by the model discovery endpoint.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "kebab-case")]
pub enum ModelHarnessDto {
    /// Macro's in-process agent.
    InMemory,
    /// The caller's Cursor account.
    Cursor,
    /// A paired macrod runtime.
    Macrod,
}

impl TryFrom<LoadAgentModelsRequest> for LoadAgentModels {
    type Error = LoadAgentModelsError;

    fn try_from(value: LoadAgentModelsRequest) -> Result<Self, Self::Error> {
        let harness = match value.harness {
            ModelHarnessDto::InMemory => ModelHarness::InMemory,
            ModelHarnessDto::Cursor => ModelHarness::Cursor,
            ModelHarnessDto::Macrod => ModelHarness::Macrod,
        };
        Ok(Self {
            harness,
            harness_id: value.harness_id.map(HarnessId::new_from_uuid),
        })
    }
}

/// One model picker option.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentModelDto {
    /// Provider model id.
    pub id: String,
    /// Display name.
    pub name: String,
    /// Optional provider description.
    pub description: Option<String>,
    /// Optional group heading supplied by the provider.
    pub group: Option<String>,
}

/// Successful model-discovery response.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct LoadAgentModelsResponse {
    /// Model-selection availability.
    pub status: AgentModelsStatusDto,
    /// Current provider model, if model selection is available.
    pub current_model: Option<String>,
    /// Ordered model catalog.
    pub models: Vec<AgentModelDto>,
}

/// Model-selection availability returned over HTTP.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum AgentModelsStatusDto {
    /// A model select was advertised.
    Available,
    /// The provider does not advertise model selection.
    Unsupported,
}

impl From<AgentModels> for LoadAgentModelsResponse {
    fn from(value: AgentModels) -> Self {
        Self {
            status: match value.status {
                AgentModelsStatus::Available => AgentModelsStatusDto::Available,
                AgentModelsStatus::Unsupported => AgentModelsStatusDto::Unsupported,
            },
            current_model: value.current_model,
            models: value
                .models
                .into_iter()
                .map(|model| AgentModelDto {
                    id: model.id,
                    name: model.name,
                    description: model.description,
                    group: model.group,
                })
                .collect(),
        }
    }
}

/// Router state for model discovery.
pub struct AgentModelsRouterState<Service, Auth> {
    service: Arc<Service>,
    authorization: MacroAuthorizationState<Auth>,
}

impl<Service, Auth> AgentModelsRouterState<Service, Auth> {
    /// Build model-discovery route state.
    pub fn new(service: Arc<Service>, authorization: MacroAuthorizationState<Auth>) -> Self {
        Self {
            service,
            authorization,
        }
    }
}

impl<Service, Auth> Clone for AgentModelsRouterState<Service, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: Arc::clone(&self.service),
            authorization: self.authorization.clone(),
        }
    }
}

impl<Service, Auth> FromRef<AgentModelsRouterState<Service, Auth>>
    for MacroAuthorizationState<Auth>
{
    fn from_ref(state: &AgentModelsRouterState<Service, Auth>) -> Self {
        state.authorization.clone()
    }
}

/// Build `POST /agent-models/load`.
pub fn agent_models_router<Service, Auth, S>(
    state: AgentModelsRouterState<Service, Auth>,
) -> Router<S>
where
    Service: AgentModelsService,
    Auth: MacroAuthorizationService,
    S: Clone + Send + Sync + 'static,
{
    Router::new()
        .route(
            "/agent-models/load",
            post(load_agent_models_handler::<Service, Auth>),
        )
        .with_state(state)
}

/// Probe one provider's model catalog without creating an agent session.
#[utoipa::path(
    post,
    path = "/agent-models/load",
    tag = "agent-models",
    security(("bearerAuth" = [])),
    request_body = LoadAgentModelsRequest,
    responses(
        (status = 200, description = "Fresh provider model catalog", body = LoadAgentModelsResponse),
        (status = 400, description = "Invalid target"),
        (status = 401, description = "Unauthenticated"),
        (status = 403, description = "Harness is not visible to caller"),
        (status = 409, description = "Macrod runtime is disconnected"),
        (status = 504, description = "Macrod probe timed out"),
        (status = 502, description = "Provider probe failed"),
    )
)]
pub async fn load_agent_models_handler<Service, Auth>(
    State(state): State<AgentModelsRouterState<Service, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOnly>,
    Json(request): Json<LoadAgentModelsRequest>,
) -> Response
where
    Service: AgentModelsService,
    Auth: MacroAuthorizationService,
{
    let request = match request.try_into() {
        Ok(request) => request,
        Err(error) => return model_error_response(error),
    };
    match state
        .service
        .load(authorization.authorization.macro_user_id.clone(), request)
        .await
    {
        Ok(models) => (StatusCode::OK, Json(LoadAgentModelsResponse::from(models))).into_response(),
        Err(error) => model_error_response(error),
    }
}

fn model_error_response(error: LoadAgentModelsError) -> Response {
    let status = match error {
        LoadAgentModelsError::BadRequest(_) => StatusCode::BAD_REQUEST,
        LoadAgentModelsError::Forbidden => StatusCode::FORBIDDEN,
        LoadAgentModelsError::Disconnected => StatusCode::CONFLICT,
        LoadAgentModelsError::Timeout => StatusCode::GATEWAY_TIMEOUT,
        LoadAgentModelsError::Probe(_) => StatusCode::BAD_GATEWAY,
    };
    (status, error.to_string()).into_response()
}
