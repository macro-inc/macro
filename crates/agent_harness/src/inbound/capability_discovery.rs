//! Authenticated HTTP adapter for fresh ACP capability discovery.

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

use crate::domain::capability_discovery::{
    AgentCapabilities, AgentCapabilitiesService, CapabilityHarness, DiscoverAgentCapabilities,
    DiscoverAgentCapabilitiesError,
};

#[cfg(test)]
mod test;

/// HTTP request selecting one provider to probe.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DiscoverAgentCapabilitiesRequest {
    /// Provider to probe.
    pub harness: CapabilityHarnessDto,
    /// Required for macrod and forbidden for other targets.
    pub harness_id: Option<Uuid>,
    /// Model whose session settings should be inspected.
    pub model: Option<String>,
}

/// Harness names accepted by the capability-discovery endpoint.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "kebab-case")]
pub enum CapabilityHarnessDto {
    /// Macro's in-process agent.
    InMemory,
    /// The caller's Cursor account.
    Cursor,
    /// A paired macrod runtime.
    Macrod,
}

impl TryFrom<DiscoverAgentCapabilitiesRequest> for DiscoverAgentCapabilities {
    type Error = DiscoverAgentCapabilitiesError;

    fn try_from(value: DiscoverAgentCapabilitiesRequest) -> Result<Self, Self::Error> {
        let harness = match value.harness {
            CapabilityHarnessDto::InMemory => CapabilityHarness::InMemory,
            CapabilityHarnessDto::Cursor => CapabilityHarness::Cursor,
            CapabilityHarnessDto::Macrod => CapabilityHarness::Macrod,
        };
        Ok(Self {
            harness,
            harness_id: value.harness_id.map(HarnessId::new_from_uuid),
            model: value.model,
        })
    }
}

/// One value in an agent-advertised select.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentConfigSelectOptionDto {
    /// Opaque value returned to the agent when selected.
    pub value: String,
    /// Display label.
    pub name: String,
    /// Optional provider description of this value.
    pub description: Option<String>,
    /// Optional group heading supplied by the provider.
    pub group: Option<String>,
}

/// Type-specific state for one agent session setting.
#[derive(Debug, Serialize, ToSchema)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum AgentConfigKindDto {
    /// A single-value selector.
    Select {
        /// Current opaque value.
        #[serde(rename = "currentValue")]
        #[schema(rename = "currentValue")]
        current_value: String,
        /// Ordered values supplied by the agent.
        options: Vec<AgentConfigSelectOptionDto>,
    },
    /// An on/off setting.
    Boolean {
        /// Current value.
        #[serde(rename = "currentValue")]
        #[schema(rename = "currentValue")]
        current_value: bool,
    },
}

/// One agent-advertised ACP session setting.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentConfigOptionDto {
    /// Opaque id used to change this setting.
    pub id: String,
    /// Display label supplied by the agent.
    pub name: String,
    /// Optional explanatory copy.
    pub description: Option<String>,
    /// ACP semantic category, such as `model` or `thought_level`.
    pub category: Option<String>,
    /// Type-specific current value and choices.
    #[serde(flatten)]
    pub kind: AgentConfigKindDto,
}

/// Successful capability-discovery response.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DiscoverAgentCapabilitiesResponse {
    /// Complete ordered ACP session configuration advertised by the agent.
    pub config_options: Vec<AgentConfigOptionDto>,
}

impl From<AgentCapabilities> for DiscoverAgentCapabilitiesResponse {
    fn from(value: AgentCapabilities) -> Self {
        Self {
            config_options: value
                .config_options
                .into_iter()
                .map(|option| AgentConfigOptionDto {
                    id: option.id,
                    name: option.name,
                    description: option.description,
                    category: option.category,
                    kind: match option.kind {
                        agent_fold::domain::session_config::SessionConfigKind::Select {
                            current_value,
                            options,
                        } => AgentConfigKindDto::Select {
                            current_value,
                            options: options
                                .into_iter()
                                .map(|option| AgentConfigSelectOptionDto {
                                    value: option.value,
                                    name: option.name,
                                    description: option.description,
                                    group: option.group,
                                })
                                .collect(),
                        },
                        agent_fold::domain::session_config::SessionConfigKind::Boolean {
                            current_value,
                        } => AgentConfigKindDto::Boolean { current_value },
                    },
                })
                .collect(),
        }
    }
}

/// Router state for capability discovery.
pub struct AgentCapabilitiesRouterState<Service, Auth> {
    service: Arc<Service>,
    authorization: MacroAuthorizationState<Auth>,
}

impl<Service, Auth> AgentCapabilitiesRouterState<Service, Auth> {
    /// Build capability-discovery route state.
    pub fn new(service: Arc<Service>, authorization: MacroAuthorizationState<Auth>) -> Self {
        Self {
            service,
            authorization,
        }
    }
}

impl<Service, Auth> Clone for AgentCapabilitiesRouterState<Service, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: Arc::clone(&self.service),
            authorization: self.authorization.clone(),
        }
    }
}

impl<Service, Auth> FromRef<AgentCapabilitiesRouterState<Service, Auth>>
    for MacroAuthorizationState<Auth>
{
    fn from_ref(state: &AgentCapabilitiesRouterState<Service, Auth>) -> Self {
        state.authorization.clone()
    }
}

/// Build `POST /agent-capabilities/discover`.
pub fn agent_capabilities_router<Service, Auth, S>(
    state: AgentCapabilitiesRouterState<Service, Auth>,
) -> Router<S>
where
    Service: AgentCapabilitiesService,
    Auth: MacroAuthorizationService,
    S: Clone + Send + Sync + 'static,
{
    Router::new()
        .route(
            "/agent-capabilities/discover",
            post(discover_agent_capabilities_handler::<Service, Auth>),
        )
        .with_state(state)
}

/// Probe one provider's ACP session configuration without persisting a session.
#[utoipa::path(
    post,
    path = "/agent-capabilities/discover",
    tag = "agent-capabilities",
    security(("bearerAuth" = [])),
    request_body = DiscoverAgentCapabilitiesRequest,
    responses(
        (status = 200, description = "Fresh provider session capabilities", body = DiscoverAgentCapabilitiesResponse),
        (status = 400, description = "Invalid target"),
        (status = 401, description = "Unauthenticated"),
        (status = 403, description = "Harness is not visible to caller"),
        (status = 409, description = "Macrod runtime is disconnected"),
        (status = 504, description = "Macrod probe timed out"),
        (status = 502, description = "Provider probe failed"),
    )
)]
pub async fn discover_agent_capabilities_handler<Service, Auth>(
    State(state): State<AgentCapabilitiesRouterState<Service, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOnly>,
    Json(request): Json<DiscoverAgentCapabilitiesRequest>,
) -> Response
where
    Service: AgentCapabilitiesService,
    Auth: MacroAuthorizationService,
{
    let request = match request.try_into() {
        Ok(request) => request,
        Err(error) => return capability_error_response(error),
    };
    match state
        .service
        .load(authorization.authorization.macro_user_id.clone(), request)
        .await
    {
        Ok(capabilities) => (
            StatusCode::OK,
            Json(DiscoverAgentCapabilitiesResponse::from(capabilities)),
        )
            .into_response(),
        Err(error) => capability_error_response(error),
    }
}

fn capability_error_response(error: DiscoverAgentCapabilitiesError) -> Response {
    let status = match error {
        DiscoverAgentCapabilitiesError::BadRequest(_) => StatusCode::BAD_REQUEST,
        DiscoverAgentCapabilitiesError::Forbidden => StatusCode::FORBIDDEN,
        DiscoverAgentCapabilitiesError::Disconnected => StatusCode::CONFLICT,
        DiscoverAgentCapabilitiesError::Timeout => StatusCode::GATEWAY_TIMEOUT,
        DiscoverAgentCapabilitiesError::Probe(_) => StatusCode::BAD_GATEWAY,
    };
    (status, error.to_string()).into_response()
}
