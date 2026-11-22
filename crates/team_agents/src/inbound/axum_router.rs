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
    routing::{delete, get, post, put},
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

use crate::domain::avatar::AgentAvatar;
use crate::domain::models::{
    ComputerId, ComputerSize, CreateTeamAgent, HarnessId, TeamAgent, TeamAgentError, TeamAgents,
};
use crate::domain::ports::TeamAgentService;
use crate::domain::self_hosting::{
    FloorResource, HostIneligibility, IssuedInstall, MoveTeammate, TeammateHosts,
};
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
            | Self::InvalidAvatarFace
            | Self::InvalidPurchaseKey
            | Self::InvalidComputer
            | Self::InvalidAgentId => StatusCode::BAD_REQUEST,
            Self::UnknownVoice => StatusCode::BAD_REQUEST,
            Self::NotFound | Self::NoVoice => StatusCode::NOT_FOUND,
            Self::NotEnabled | Self::SelfHostedNotEnabled | Self::Forbidden(_) => {
                StatusCode::FORBIDDEN
            }
            Self::ComputerUnavailable(_)
            | Self::NoRoom(_)
            | Self::PurchaseConfirming
            | Self::InviteInProgress
            | Self::HostNotEligible(_)
            | Self::NotSelfHosted => StatusCode::CONFLICT,
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
            Self::HostNotEligible(_) => Some(PurchaseRefusalCode::HostNotEligible),
            Self::SelfHostedNotEnabled => Some(PurchaseRefusalCode::SelfHostedNotEnabled),
            _ => None,
        };
        let (reason, resource) = match &self {
            Self::HostNotEligible(eligibility) => (eligibility.reason, eligibility.resource),
            _ => (None, None),
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
                reason,
                resource,
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
    /// Why the machine can't host the agent, with
    /// [`PurchaseRefusalCode::HostNotEligible`].
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<HostIneligibility>,
    /// The resource that is short, with [`HostIneligibility::BelowFloor`].
    #[serde(skip_serializing_if = "Option::is_none")]
    resource: Option<FloorResource>,
}

/// The team agents router:
///
/// - `POST /` — a team admin invites an agent teammate and buys its computer,
///   or installs it on one of their own machines.
/// - `GET /` — a team member lists the team's agents.
/// - `GET /hosts` — a team admin's own machines, for the Invite dialog.
/// - `POST /hosts/{harness_id}/recheck` — a team admin asks one of their own
///   machines to check its teammate hosting again.
/// - `POST /{agent_user_id}/install` — a team admin moves an agent to
///   another of their own machines.
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
        .route("/hosts", get(list_teammate_hosts_handler::<S, Eas, Auth>))
        .route(
            "/hosts/{harness_id}/recheck",
            post(recheck_teammate_host_handler::<S, Eas, Auth>),
        )
        .route(
            "/{agent_user_id}/install",
            post(move_team_agent_handler::<S, Eas, Auth>),
        )
        .route(
            "/{agent_user_id}/avatar",
            put(set_team_agent_avatar_handler::<S, Eas, Auth>),
        )
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

/// Invite an agent teammate and buy its computer, or install it on one of the
/// inviter's own machines (`computer: {kind: "own", harnessId}`). Requires a
/// team admin or owner using their own credential. The agent comes back
/// `provisioning`.
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
        (status = 403, body = TeamAgentErrorBody, description = "Not a person's own request, agent teammates are off, or hosting on one's own machine is off (`self_hosted_not_enabled`)"),
        (status = 404, body = ErrorResponse, description = "The named machine isn't one of the inviter's own"),
        (status = 409, body = TeamAgentErrorBody, description = "No room for the size (`no_room`, with `size`), the invite is in flight (`invite_in_progress`), or the own machine can't host the agent (`host_not_eligible`, with `reason` and `resource`); nothing was created"),
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

/// The acting admin's own machines, each with whether it can host an agent
/// teammate now, for the Invite dialog.
#[utoipa::path(
    get,
    tag = "team-agents",
    operation_id = "list_teammate_hosts",
    path = "/team_agents/hosts",
    responses(
        (status = 200, body = TeammateHosts),
        (status = 401, body = ErrorResponse),
        (status = 403, body = TeamAgentErrorBody),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn list_teammate_hosts_handler<S, Eas, Auth>(
    access: MacroUserTeamExtractorV2<AdminTeamRole, Eas, Auth>,
    State(state): State<TeamAgentsRouterState<S, Eas, Auth>>,
) -> Result<Json<TeammateHosts>, TeamAgentError>
where
    S: TeamAgentService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    Ok(Json(
        state.service.hosts(access.entity_access_receipt).await?,
    ))
}

/// Path for one of the acting admin's machines.
#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Path)]
pub struct HostPath {
    /// The machine's harness id.
    pub harness_id: Uuid,
}

/// Ask one of the acting admin's own machines to check its teammate hosting
/// (its container engine) again now. It answers with a fresh report, which
/// `GET /team_agents/hosts` shows a moment later. Someone else's machine is
/// a 404; an agent's program is refused (403). At most one ask per machine
/// reaches it every 10 s; the rest join that one.
#[utoipa::path(
    post,
    tag = "team-agents",
    operation_id = "recheck_teammate_host",
    path = "/team_agents/hosts/{harness_id}/recheck",
    params(HostPath),
    responses(
        (status = 204),
        (status = 401, body = ErrorResponse),
        (status = 403, body = TeamAgentErrorBody),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn recheck_teammate_host_handler<S, Eas, Auth>(
    authorization: MacroAuthorizationExtractor<Auth, AccountHolderOrInternal>,
    headers: axum::http::HeaderMap,
    access: MacroUserTeamExtractorV2<AdminTeamRole, Eas, Auth>,
    State(state): State<TeamAgentsRouterState<S, Eas, Auth>>,
    Path(path): Path<HostPath>,
) -> Result<StatusCode, TeamAgentError>
where
    S: TeamAgentService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    // Each recheck runs a full probe on the owner's machine: a person asks
    // for one, never an agent's program.
    let attribution = authorization.authorization.user.attribution();
    if macro_authorization::is_program_run(attribution, &headers) {
        tracing::warn!(?attribution, "refused a machine recheck to a program");
        return Err(TeamAgentError::Forbidden(
            "An agent's program cannot ask a machine to check again. Tell the user to press Check again in Macro, under Settings, Agents.",
        ));
    }
    state
        .service
        .recheck_host(
            access.entity_access_receipt,
            HarnessId::new_from_uuid(path.harness_id),
        )
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

/// Replace an agent's avatar. Requires an owner or admin of its team.
#[utoipa::path(
    put,
    tag = "team-agents",
    operation_id = "set_team_agent_avatar",
    path = "/team_agents/{agent_user_id}/avatar",
    params(AgentPath),
    request_body = AgentAvatar,
    responses(
        (status = 204),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn set_team_agent_avatar_handler<S, Eas, Auth>(
    access: MacroUserTeamExtractorV2<AdminTeamRole, Eas, Auth>,
    State(state): State<TeamAgentsRouterState<S, Eas, Auth>>,
    Path(path): Path<AgentPath>,
    Json(avatar): Json<AgentAvatar>,
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
        .set_avatar(access.entity_access_receipt, &agent, avatar)
        .await?;
    Ok(StatusCode::NO_CONTENT)
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

/// Move an agent on an own machine to another of the admin's own machines.
/// The machine it leaves stops it first, so its last push lands; then it
/// runs on the new machine with fresh credentials. Requires a team admin or
/// owner using their own credential.
#[utoipa::path(
    post,
    tag = "team-agents",
    operation_id = "move_team_agent",
    path = "/team_agents/{agent_user_id}/install",
    params(AgentPath),
    request_body = MoveTeammate,
    responses(
        (status = 200, body = TeamAgent),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 403, body = TeamAgentErrorBody),
        (status = 404, body = ErrorResponse),
        (status = 409, body = TeamAgentErrorBody, description = "The agent runs on a Macro computer, or the machine can't host it (`host_not_eligible`)"),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn move_team_agent_handler<S, Eas, Auth>(
    authorization: MacroAuthorizationExtractor<Auth, AccountHolderOrInternal>,
    headers: axum::http::HeaderMap,
    access: MacroUserTeamExtractorV2<AdminTeamRole, Eas, Auth>,
    State(state): State<TeamAgentsRouterState<S, Eas, Auth>>,
    Path(path): Path<AgentPath>,
    Json(body): Json<MoveTeammate>,
) -> Result<Json<TeamAgent>, TeamAgentError>
where
    S: TeamAgentService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    // Moving revokes the agent's credentials on one machine and mints them
    // on another: a person does that, never an agent's program.
    let attribution = authorization.authorization.user.attribution();
    if macro_authorization::is_program_run(attribution, &headers) {
        tracing::warn!(?attribution, "refused moving a team agent to a program");
        return Err(TeamAgentError::Forbidden(
            "An agent's program cannot move an agent teammate. Tell the user to move it in Macro, under Settings, Agents.",
        ));
    }
    let agent = MacroUserIdStr::parse_from_str(&path.agent_user_id)
        .map(MacroUserIdStr::into_owned)
        .map_err(|_| TeamAgentError::InvalidAgentId)?;
    Ok(Json(
        state
            .service
            .move_install(access.entity_access_receipt, &agent, body)
            .await?,
    ))
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

/// Internal-only routes for the replica holding a machine's socket:
///
/// - `POST /team_agent_enrollment/{computer_id}/{generation}`: the agent part
///   of a Macro computer's enrollment.
/// - `POST /team_agent_install/{harness_id}/{install_id}`: the next delivery
///   of an install's credentials.
/// - `POST /team_agent_install/{install_id}/checkpointed`: the machine
///   stopped an install that is moving or being removed, or the wait gave
///   up.
/// - `POST /teammate_hosts/{harness_id}/offboard`: that machine was just
///   unpaired (in the service that owns harnesses); park its agents now
///   instead of at the next 60 s sweep.
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
        .route(
            "/team_agent_install/{harness_id}/{install_id}",
            post(issue_install_handler::<S, Auth>),
        )
        .route(
            "/team_agent_install/{install_id}/checkpointed",
            post(install_checkpointed_handler::<S, Auth>),
        )
        .route(
            "/teammate_hosts/{harness_id}/offboard",
            post(offboard_teammate_hosts_handler::<S, Auth>),
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

/// What the machine last said it runs of an install.
#[derive(Debug, Clone, Copy, serde::Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportedDelivery {
    /// Its generation.
    pub generation: u64,
    /// Which delivery of it.
    pub delivery: u64,
}

/// Body of the internal install issuance.
#[derive(Debug, Clone, Copy, serde::Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueInstallRequest {
    /// What the machine runs of the install; `None` when nothing.
    pub reported: Option<ReportedDelivery>,
}

/// The next delivery of an install's credentials: 200 with it, 204 when
/// there is nothing to deliver. Never cached.
#[tracing::instrument(skip_all, fields(%harness_id, %install_id), err)]
pub async fn issue_install_handler<S, Auth>(
    _authorization: MacroAuthorizationExtractor<Auth, InternalOnly>,
    State(state): State<AgentEnrollmentRouterState<S, Auth>>,
    Path((harness_id, install_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<IssueInstallRequest>,
) -> Result<Response, StatusCode>
where
    S: TeamAgentService,
    Auth: MacroAuthorizationService,
{
    let reported = body
        .reported
        .map(|reported| (reported.generation, reported.delivery));
    let issued: Option<IssuedInstall> = state
        .service
        .issue_install(HarnessId::new_from_uuid(harness_id), install_id, reported)
        .await
        .map_err(|error| match error {
            AgentEnrollmentError::NotFound => StatusCode::NOT_FOUND,
            AgentEnrollmentError::Unavailable | AgentEnrollmentError::IssuanceFailed => {
                StatusCode::SERVICE_UNAVAILABLE
            }
        })?;
    Ok(match issued {
        Some(issued) => ([(header::CACHE_CONTROL, "no-store")], Json(issued)).into_response(),
        None => StatusCode::NO_CONTENT.into_response(),
    })
}

/// Finish an install's move or removal: 204, also when nothing was pending.
#[tracing::instrument(skip_all, fields(%install_id), err)]
pub async fn install_checkpointed_handler<S, Auth>(
    _authorization: MacroAuthorizationExtractor<Auth, InternalOnly>,
    State(state): State<AgentEnrollmentRouterState<S, Auth>>,
    Path(install_id): Path<Uuid>,
) -> Result<StatusCode, TeamAgentError>
where
    S: TeamAgentService,
    Auth: MacroAuthorizationService,
{
    state.service.finish_checkpoint(install_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Park the agents on an unpaired machine, now: 204.
#[tracing::instrument(skip_all, fields(%harness_id), err)]
pub async fn offboard_teammate_hosts_handler<S, Auth>(
    _authorization: MacroAuthorizationExtractor<Auth, InternalOnly>,
    State(state): State<AgentEnrollmentRouterState<S, Auth>>,
    Path(harness_id): Path<Uuid>,
) -> Result<StatusCode, TeamAgentError>
where
    S: TeamAgentService,
    Auth: MacroAuthorizationService,
{
    state
        .service
        .offboard_host(HarnessId::new_from_uuid(harness_id))
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
