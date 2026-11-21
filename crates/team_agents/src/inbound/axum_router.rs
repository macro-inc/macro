//! HTTP routes for agent teammates, nested at `/team_agents` in the auth
//! service, and the internal enrollment route the computer operator calls.

#[cfg(test)]
mod test;

use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{FromRef, Path, State},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
    routing::{delete, get, post},
};
use entity_access::{
    domain::{
        models::{AdminTeamRole, MemberTeamRole},
        ports::EntityAccessService,
    },
    inbound::axum_extractors::MacroUserTeamExtractorV2,
};
use hosted_runtimes::domain::models::PurchaseRefusalCode;
use hosted_runtimes::domain::{agent::AgentEnrollmentError, enrollment::EnrollmentGeneration};
use macro_authorization::{
    AccountHolderOrInternal, InternalOnly, MacroAuthorizationExtractor, MacroAuthorizationService,
    MacroAuthorizationState,
};
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use model_error_response::ErrorResponse;
use serde::Deserialize;
use uuid::Uuid;

use crate::domain::models::{
    ComputerId, ComputerSize, CreateTeamAgent, TeamAgent, TeamAgentError, TeamAgents,
};
use crate::domain::ports::TeamAgentService;
use crate::domain::voice::AgentVoice;

/// Router state.
pub struct TeamAgentsRouterState<S, Eas, Auth> {
    /// The team agent service.
    pub service: Arc<S>,
    /// The entity access service, for team role checks.
    pub entity_access_service: Arc<Eas>,
    /// State for request authorization.
    pub authorization_state: MacroAuthorizationState<Auth>,
}

impl<S, Eas, Auth> Clone for TeamAgentsRouterState<S, Eas, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            entity_access_service: self.entity_access_service.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<S, Eas, Auth> FromRef<TeamAgentsRouterState<S, Eas, Auth>> for Arc<Eas> {
    fn from_ref(state: &TeamAgentsRouterState<S, Eas, Auth>) -> Self {
        state.entity_access_service.clone()
    }
}

impl<S, Eas, Auth> FromRef<TeamAgentsRouterState<S, Eas, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &TeamAgentsRouterState<S, Eas, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

impl IntoResponse for TeamAgentError {
    fn into_response(self) -> Response {
        let status = match &self {
            Self::InvalidName
            | Self::InvalidProfile
            | Self::InvalidAvatar
            | Self::InvalidPurchaseKey
            | Self::InvalidAgentId => StatusCode::BAD_REQUEST,
            Self::UnknownVoice => StatusCode::BAD_REQUEST,
            Self::NotFound | Self::NoVoice => StatusCode::NOT_FOUND,
            Self::NotEnabled | Self::Forbidden(_) => StatusCode::FORBIDDEN,
            Self::ComputerUnavailable(_)
            | Self::NoRoom(_)
            | Self::PurchaseConfirming
            | Self::InviteInProgress => StatusCode::CONFLICT,
            Self::PaymentDeclined => StatusCode::PAYMENT_REQUIRED,
            Self::RepoUnavailable(_) | Self::VoiceUnavailable(_) => StatusCode::BAD_GATEWAY,
            Self::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };
        let message = match &self {
            Self::Internal(error) => {
                tracing::error!(error = ?error, "agent teammate request failed");
                "internal error".to_owned()
            }
            Self::RepoUnavailable(error) => {
                tracing::error!(error = ?error, "the workspace repository service failed");
                self.to_string()
            }
            Self::VoiceUnavailable(error) => {
                tracing::error!(error = ?error, "a voice request failed");
                self.to_string()
            }
            other => other.to_string(),
        };
        let code = match &self {
            Self::NoRoom(_) => Some(PurchaseRefusalCode::NoRoom),
            Self::PaymentDeclined => Some(PurchaseRefusalCode::PaymentDeclined),
            Self::InviteInProgress => Some(PurchaseRefusalCode::InviteInProgress),
            _ => None,
        };
        let size = match &self {
            Self::NoRoom(size) => Some(*size),
            _ => None,
        };
        (
            status,
            Json(TeamAgentErrorBody {
                message,
                code,
                size,
            }),
        )
            .into_response()
    }
}

/// [`ErrorResponse`] plus a stable code for refusals the invite dialog shows
/// its own way rather than as a message.
#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
pub struct TeamAgentErrorBody {
    /// Human-readable message.
    message: String,
    /// Set for refusals the client handles by kind.
    #[serde(skip_serializing_if = "Option::is_none")]
    code: Option<PurchaseRefusalCode>,
    /// The size there was no room for, with [`PurchaseRefusalCode::NoRoom`].
    #[serde(skip_serializing_if = "Option::is_none")]
    size: Option<ComputerSize>,
}

/// The team agents router:
///
/// - `POST /` — a team admin invites an agent teammate and buys its computer.
/// - `GET /` — a team member lists the team's agents.
/// - `POST /me/online` — an agent reports that it is online.
/// - `DELETE /{agent_user_id}` — a team admin removes an agent.
/// - `GET`/`PUT /{agent_user_id}/voice` — a team admin reads or changes the
///   agent's call voice.
pub fn team_agents_router<S, Eas, Auth, T>(state: TeamAgentsRouterState<S, Eas, Auth>) -> Router<T>
where
    S: TeamAgentService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
    T: Send + Sync + 'static,
{
    Router::new()
        .route(
            "/",
            post(create_team_agent_handler::<S, Eas, Auth>)
                .get(list_team_agents_handler::<S, Eas, Auth>),
        )
        .route("/me/online", post(agent_online_handler::<S, Eas, Auth>))
        .route(
            "/{agent_user_id}",
            delete(delete_team_agent_handler::<S, Eas, Auth>),
        )
        .route(
            "/{agent_user_id}/voice",
            get(get_team_agent_voice_handler::<S, Eas, Auth>)
                .put(set_team_agent_voice_handler::<S, Eas, Auth>),
        )
        .with_state(state)
}

/// Invite an agent teammate and buy its computer. Requires a team admin or
/// owner using their own credential. The agent comes back `provisioning`.
#[utoipa::path(
    post,
    tag = "team-agents",
    operation_id = "create_team_agent",
    path = "/team_agents",
    request_body = CreateTeamAgent,
    responses(
        (status = 201, body = TeamAgent),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 402, body = TeamAgentErrorBody, description = "The card was declined (`payment_declined`); nothing was created"),
        (status = 403, body = ErrorResponse),
        (status = 409, body = TeamAgentErrorBody, description = "No room for the size (`no_room`, with `size`), or the invite is in flight (`invite_in_progress`); nothing was created"),
        (status = 500, body = ErrorResponse),
        (status = 502, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn create_team_agent_handler<S, Eas, Auth>(
    authorization: MacroAuthorizationExtractor<Auth, AccountHolderOrInternal>,
    headers: axum::http::HeaderMap,
    access: MacroUserTeamExtractorV2<AdminTeamRole, Eas, Auth>,
    State(state): State<TeamAgentsRouterState<S, Eas, Auth>>,
    Json(body): Json<CreateTeamAgent>,
) -> Result<(StatusCode, Json<TeamAgent>), TeamAgentError>
where
    S: TeamAgentService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    // Creating one adds a member to the team, mints its key and buys a
    // computer: a person does that, never an agent's program (a credential
    // signed for an agent or a routine run, or the code-mode header).
    let attribution = authorization.authorization.user.attribution();
    if macro_authorization::is_program_run(attribution, &headers) {
        tracing::warn!(?attribution, "refused creating a team agent to a program");
        return Err(TeamAgentError::Forbidden(
            "An agent's program cannot add an agent teammate: it adds a team member and buys a computer. Tell the user to add one in Macro, under Settings, Agents.",
        ));
    }
    let agent = state
        .service
        .create(access.entity_access_receipt, body)
        .await?;
    Ok((StatusCode::CREATED, Json(agent)))
}

/// The caller's team's agents, with their computers' status.
#[utoipa::path(
    get,
    tag = "team-agents",
    operation_id = "list_team_agents",
    path = "/team_agents",
    responses(
        (status = 200, body = TeamAgents),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn list_team_agents_handler<S, Eas, Auth>(
    access: MacroUserTeamExtractorV2<MemberTeamRole, Eas, Auth>,
    State(state): State<TeamAgentsRouterState<S, Eas, Auth>>,
) -> Result<Json<TeamAgents>, TeamAgentError>
where
    S: TeamAgentService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    Ok(Json(
        state.service.list(access.entity_access_receipt).await?,
    ))
}

/// The calling agent reports that it is online, with its own credential.
/// The first report makes it `running` and tells its inviter it is ready;
/// later ones change nothing. 404 for an account that isn't an agent of its
/// team.
#[utoipa::path(
    post,
    tag = "team-agents",
    operation_id = "report_team_agent_online",
    path = "/team_agents/me/online",
    responses(
        (status = 204),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn agent_online_handler<S, Eas, Auth>(
    access: MacroUserTeamExtractorV2<MemberTeamRole, Eas, Auth>,
    State(state): State<TeamAgentsRouterState<S, Eas, Auth>>,
) -> Result<StatusCode, TeamAgentError>
where
    S: TeamAgentService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    state
        .service
        .agent_online(access.entity_access_receipt)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Path for one agent.
#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Path)]
pub struct AgentPath {
    /// The agent's Macro user id.
    pub agent_user_id: String,
}

/// Remove an agent teammate: release its computer, take it off the team and
/// delete its repository and account. Requires a team admin or owner.
#[utoipa::path(
    delete,
    tag = "team-agents",
    operation_id = "delete_team_agent",
    path = "/team_agents/{agent_user_id}",
    params(AgentPath),
    responses(
        (status = 204),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
        (status = 502, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn delete_team_agent_handler<S, Eas, Auth>(
    access: MacroUserTeamExtractorV2<AdminTeamRole, Eas, Auth>,
    State(state): State<TeamAgentsRouterState<S, Eas, Auth>>,
    Path(path): Path<AgentPath>,
) -> Result<StatusCode, TeamAgentError>
where
    S: TeamAgentService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let agent = MacroUserIdStr::parse_from_str(&path.agent_user_id)
        .map(MacroUserIdStr::into_owned)
        .map_err(|_| TeamAgentError::InvalidAgentId)?;
    state
        .service
        .delete(access.entity_access_receipt, &agent)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// The agent's call voice, as committed in its workspace repository.
/// Requires a team admin or owner.
#[utoipa::path(
    get,
    tag = "team-agents",
    operation_id = "get_team_agent_voice",
    path = "/team_agents/{agent_user_id}/voice",
    params(AgentPath),
    responses(
        (status = 200, body = AgentVoice),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
        (status = 502, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn get_team_agent_voice_handler<S, Eas, Auth>(
    access: MacroUserTeamExtractorV2<AdminTeamRole, Eas, Auth>,
    State(state): State<TeamAgentsRouterState<S, Eas, Auth>>,
    Path(path): Path<AgentPath>,
) -> Result<Json<AgentVoice>, TeamAgentError>
where
    S: TeamAgentService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let agent = MacroUserIdStr::parse_from_str(&path.agent_user_id)
        .map(MacroUserIdStr::into_owned)
        .map_err(|_| TeamAgentError::InvalidAgentId)?;
    Ok(Json(
        state
            .service
            .voice(access.entity_access_receipt, &agent)
            .await?,
    ))
}

/// Change the agent's call voice: a commit to its workspace repository that
/// its next call picks up. Requires a team admin or owner.
#[utoipa::path(
    put,
    tag = "team-agents",
    operation_id = "set_team_agent_voice",
    path = "/team_agents/{agent_user_id}/voice",
    params(AgentPath),
    request_body = AgentVoice,
    responses(
        (status = 200, body = AgentVoice),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
        (status = 502, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn set_team_agent_voice_handler<S, Eas, Auth>(
    access: MacroUserTeamExtractorV2<AdminTeamRole, Eas, Auth>,
    State(state): State<TeamAgentsRouterState<S, Eas, Auth>>,
    Path(path): Path<AgentPath>,
    Json(voice): Json<AgentVoice>,
) -> Result<Json<AgentVoice>, TeamAgentError>
where
    S: TeamAgentService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let agent = MacroUserIdStr::parse_from_str(&path.agent_user_id)
        .map(MacroUserIdStr::into_owned)
        .map_err(|_| TeamAgentError::InvalidAgentId)?;
    Ok(Json(
        state
            .service
            .set_voice(access.entity_access_receipt, &agent, voice)
            .await?,
    ))
}

/// State for the internal enrollment route.
pub struct AgentEnrollmentRouterState<S, Auth> {
    /// The team agent service.
    pub service: Arc<S>,
    /// State for request authorization.
    pub authorization_state: MacroAuthorizationState<Auth>,
}

impl<S, Auth> Clone for AgentEnrollmentRouterState<S, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<S, Auth> FromRef<AgentEnrollmentRouterState<S, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &AgentEnrollmentRouterState<S, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// Internal-only: `POST /team_agent_enrollment/{computer_id}/{generation}`,
/// the agent part of a computer's enrollment, for the computer operator.
pub fn agent_enrollment_router<S, Auth, T>(state: AgentEnrollmentRouterState<S, Auth>) -> Router<T>
where
    S: TeamAgentService,
    Auth: MacroAuthorizationService,
    T: Send + Sync + 'static,
{
    Router::new()
        .route(
            "/team_agent_enrollment/{computer_id}/{generation}",
            post(issue_agent_enrollment_handler::<S, Auth>),
        )
        .with_state(state)
}

/// Fresh credentials and environment for the agent a computer runs: 200 with
/// the enrollment, 204 when the computer runs no agent. Never cached.
#[tracing::instrument(skip_all, fields(%computer_id, generation), err)]
pub async fn issue_agent_enrollment_handler<S, Auth>(
    _authorization: MacroAuthorizationExtractor<Auth, InternalOnly>,
    State(state): State<AgentEnrollmentRouterState<S, Auth>>,
    Path((computer_id, generation)): Path<(Uuid, u32)>,
) -> Result<Response, StatusCode>
where
    S: TeamAgentService,
    Auth: MacroAuthorizationService,
{
    let issued = state
        .service
        .issue_enrollment(
            ComputerId::new_from_uuid(computer_id),
            EnrollmentGeneration::new(generation),
        )
        .await
        .map_err(|error| match error {
            AgentEnrollmentError::NotFound => StatusCode::NOT_FOUND,
            AgentEnrollmentError::Unavailable | AgentEnrollmentError::IssuanceFailed => {
                StatusCode::SERVICE_UNAVAILABLE
            }
        })?;
    Ok(match issued {
        Some(enrollment) => {
            ([(header::CACHE_CONTROL, "no-store")], Json(enrollment)).into_response()
        }
        None => StatusCode::NO_CONTENT.into_response(),
    })
}
