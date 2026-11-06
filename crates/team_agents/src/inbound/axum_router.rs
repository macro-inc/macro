//! HTTP routes for team agents, nested at `/team_agents` in the auth service.

use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{FromRef, Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{delete, get, post},
};
use entity_access::{
    domain::{models::AdminTeamRole, ports::EntityAccessService},
    inbound::axum_extractors::MacroUserTeamExtractorV2,
};
use macro_authorization::{
    AccountHolderOrInternal, MacroAuthorizationExtractor, MacroAuthorizationService,
    MacroAuthorizationState, UserOrInternal,
};
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use model_error_response::ErrorResponse;
use serde::Deserialize;

use crate::domain::models::{
    ComputerSize, CreateTeamAgent, EmailMessage, EmailMessages, SendEmail, SentEmail, TeamAgent,
    TeamAgentError, TeamAgentQuote, TeamAgentSizes, TeamAgents,
};
use crate::domain::ports::TeamAgentService;

#[cfg(test)]
mod test;

/// Emails listed when the caller gives no limit.
const DEFAULT_EMAIL_LIMIT: u8 = 20;

/// Router state.
pub struct TeamAgentsRouterState<S, Eas, Auth> {
    /// The team agent service.
    pub service: Arc<S>,
    /// The entity access service, for the team admin check.
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

/// Builds the team agents router:
///
/// - `GET /sizes` — specifications without billing.
/// - `GET /quote?size=` — a team admin prices an agent and its computer.
/// - `POST /` — a team admin invites an agent and buys its computer.
/// - `GET /` — a team admin lists the team's agents.
/// - `DELETE /{agent_user_id}` — a team admin deletes an agent.
/// - `GET /me` — the calling agent's profile.
/// - `GET /me/email/messages` — the calling agent's newest emails.
/// - `GET /me/email/messages/{message_id}` — one email with its body.
/// - `POST /me/email/send` — send an email as the calling agent.
pub fn team_agents_router<S, Eas, Auth, T>(state: TeamAgentsRouterState<S, Eas, Auth>) -> Router<T>
where
    S: TeamAgentService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
    T: Send + Sync + 'static,
{
    Router::new()
        .route("/sizes", get(get_team_agent_sizes_handler::<S, Eas, Auth>))
        .route("/quote", get(quote_team_agent_handler::<S, Eas, Auth>))
        .route(
            "/",
            post(create_team_agent_handler::<S, Eas, Auth>)
                .get(list_team_agents_handler::<S, Eas, Auth>),
        )
        .route(
            "/{agent_user_id}",
            delete(delete_team_agent_handler::<S, Eas, Auth>),
        )
        .route(
            "/{agent_user_id}/retry",
            post(retry_team_agent_handler::<S, Eas, Auth>),
        )
        .route("/me", get(get_my_team_agent_handler::<S, Eas, Auth>))
        .route(
            "/me/email/messages",
            get(list_my_email_handler::<S, Eas, Auth>),
        )
        .route(
            "/me/email/messages/{message_id}",
            get(get_my_email_handler::<S, Eas, Auth>),
        )
        .route(
            "/me/email/send",
            post(send_my_email_handler::<S, Eas, Auth>),
        )
        .with_state(state)
}

/// Stable conflict codes for invitation and provisioning failures.
#[derive(serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum TeamAgentConflictCode {
    /// The quote must be reviewed again before any purchase.
    QuoteChanged,
    /// The team has no active plan.
    NoSubscription,
    /// This computer cannot currently be purchased.
    ComputerUnavailable,
    /// This provisioning state cannot be retried.
    RetryUnavailable,
}

/// A conflict the client can handle without inspecting error messages.
#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct TeamAgentConflict {
    /// Machine-readable reason.
    pub code: TeamAgentConflictCode,
    /// Human-readable explanation.
    pub message: String,
}

/// Stable provider failure reason safe for invitation error presentation.
#[derive(serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum TeamAgentFailureCode {
    /// Repository creation failed before purchase; no charge was attempted.
    RepositoryCreationFailed,
    /// Other provider failures keep their generic presentation.
    ProviderFailed,
}

/// Public provider failure details. Never contains raw upstream response bodies.
#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct TeamAgentFailure {
    /// Machine-readable failure stage.
    pub code: TeamAgentFailureCode,
    /// Safe, actionable reason.
    pub message: String,
}

impl IntoResponse for TeamAgentError {
    fn into_response(self) -> Response {
        let conflict = match &self {
            Self::QuoteChanged => Some(TeamAgentConflictCode::QuoteChanged),
            Self::NoSubscription => Some(TeamAgentConflictCode::NoSubscription),
            Self::ComputerUnavailable(_) => Some(TeamAgentConflictCode::ComputerUnavailable),
            Self::RetryUnavailable(_) => Some(TeamAgentConflictCode::RetryUnavailable),
            _ => None,
        };
        if let Some(code) = conflict {
            return (
                StatusCode::CONFLICT,
                Json(TeamAgentConflict {
                    code,
                    message: self.to_string(),
                }),
            )
                .into_response();
        }
        let status = match &self {
            TeamAgentError::BadRequest(_) => StatusCode::BAD_REQUEST,
            TeamAgentError::NotAnAgent | TeamAgentError::NotFound => StatusCode::NOT_FOUND,
            TeamAgentError::EmailUnavailable => StatusCode::SERVICE_UNAVAILABLE,
            TeamAgentError::Forbidden | TeamAgentError::NotEnabled => StatusCode::FORBIDDEN,
            TeamAgentError::QuoteChanged
            | TeamAgentError::NoSubscription
            | TeamAgentError::ComputerUnavailable(_)
            | TeamAgentError::RetryUnavailable(_) => StatusCode::CONFLICT,
            TeamAgentError::EmailProvider(_)
            | TeamAgentError::ComputerProvider(_)
            | TeamAgentError::RepoProvider(_)
            | TeamAgentError::InvitationFailed(_) => StatusCode::BAD_GATEWAY,
            TeamAgentError::Internal(_) | TeamAgentError::ComputerIdentityUnavailable => {
                StatusCode::INTERNAL_SERVER_ERROR
            }
        };

        let message = match &self {
            TeamAgentError::Internal(error) => {
                tracing::error!(error = ?error, "team agent request failed");
                "internal error".to_string()
            }
            TeamAgentError::ComputerProvider(error) => {
                tracing::error!(error = ?error, "the computer billing provider failed");
                "the computer billing provider failed".to_string()
            }
            TeamAgentError::RepoProvider(error) => {
                tracing::error!(error = ?error, "the repo provider failed");
                "the repo provider failed".to_string()
            }
            TeamAgentError::EmailProvider(error) => {
                tracing::error!(error = ?error, "the email provider failed");
                "the email provider failed".to_string()
            }
            other => other.to_string(),
        };

        if status == StatusCode::BAD_GATEWAY {
            let code = if matches!(self, TeamAgentError::InvitationFailed(_)) {
                TeamAgentFailureCode::RepositoryCreationFailed
            } else {
                TeamAgentFailureCode::ProviderFailed
            };
            return (status, Json(TeamAgentFailure { code, message })).into_response();
        }
        (
            status,
            Json(ErrorResponse {
                message: message.into(),
            }),
        )
            .into_response()
    }
}

/// Computer specifications for rollout-enabled team admins, independent of billing.
#[utoipa::path(
    get, tag = "team-agents", operation_id = "get_team_agent_sizes",
    path = "/team_agents/sizes",
    responses(
        (status = 200, body = TeamAgentSizes),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(skip_all, err)]
pub async fn get_team_agent_sizes_handler<S, Eas, Auth>(
    access: MacroUserTeamExtractorV2<AdminTeamRole, Eas, Auth>,
    State(state): State<TeamAgentsRouterState<S, Eas, Auth>>,
) -> Result<Json<TeamAgentSizes>, TeamAgentError>
where
    S: TeamAgentService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    Ok(Json(
        state.service.sizes(access.entity_access_receipt).await?,
    ))
}

/// Query for pricing an agent.
#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
pub struct QuoteQuery {
    /// The computer size to price.
    pub size: ComputerSize,
}

/// What inviting an agent with a computer of `size` adds to the team's bill.
/// Requires a team admin or owner.
#[utoipa::path(
    get,
    tag = "team-agents",
    operation_id = "quote_team_agent",
    path = "/team_agents/quote",
    params(QuoteQuery),
    responses(
        (status = 200, body = TeamAgentQuote),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 409, body = TeamAgentConflict),
        (status = 500, body = ErrorResponse),
        (status = 502, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn quote_team_agent_handler<S, Eas, Auth>(
    access: MacroUserTeamExtractorV2<AdminTeamRole, Eas, Auth>,
    State(state): State<TeamAgentsRouterState<S, Eas, Auth>>,
    Query(query): Query<QuoteQuery>,
) -> Result<Json<TeamAgentQuote>, TeamAgentError>
where
    S: TeamAgentService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let quote = state
        .service
        .quote(access.entity_access_receipt, query.size)
        .await?;

    Ok(Json(quote))
}

/// Invite a team agent and buy its computer, in one Stripe update. Requires a
/// team admin or owner. The agent comes back `provisioning`.
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
        (status = 403, body = ErrorResponse),
        (status = 409, body = TeamAgentConflict),
        (status = 500, body = ErrorResponse),
        (status = 502, body = TeamAgentFailure),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn create_team_agent_handler<S, Eas, Auth>(
    _authorization: MacroAuthorizationExtractor<Auth, AccountHolderOrInternal>,
    access: MacroUserTeamExtractorV2<AdminTeamRole, Eas, Auth>,
    State(state): State<TeamAgentsRouterState<S, Eas, Auth>>,
    Json(body): Json<CreateTeamAgent>,
) -> Result<(StatusCode, Json<TeamAgent>), TeamAgentError>
where
    S: TeamAgentService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let agent = state
        .service
        .create(access.entity_access_receipt, body)
        .await?;

    Ok((StatusCode::CREATED, Json(agent)))
}

/// The caller's team's agents, with fresh computer status. Requires a team
/// admin or owner.
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
    access: MacroUserTeamExtractorV2<AdminTeamRole, Eas, Auth>,
    State(state): State<TeamAgentsRouterState<S, Eas, Auth>>,
) -> Result<Json<TeamAgents>, TeamAgentError>
where
    S: TeamAgentService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let agents = state.service.list(access.entity_access_receipt).await?;

    Ok(Json(agents))
}

/// Path for one agent.
#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Path)]
pub struct AgentPath {
    /// The agent's Macro user id.
    pub agent_user_id: String,
}

/// Retry a failed agent's existing computer and recover its workspace repo.
/// Requires a team admin or owner; preserves bootstrap credentials and billing.
#[utoipa::path(
    post, tag = "team-agents", operation_id = "retry_team_agent",
    path = "/team_agents/{agent_user_id}/retry", params(AgentPath),
    responses(
        (status = 200, body = TeamAgent),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 409, body = TeamAgentConflict),
        (status = 500, body = ErrorResponse),
        (status = 502, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn retry_team_agent_handler<S, Eas, Auth>(
    access: MacroUserTeamExtractorV2<AdminTeamRole, Eas, Auth>,
    State(state): State<TeamAgentsRouterState<S, Eas, Auth>>,
    Path(path): Path<AgentPath>,
) -> Result<Json<TeamAgent>, TeamAgentError>
where
    S: TeamAgentService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let agent_user_id = MacroUserIdStr::parse_from_str(&path.agent_user_id)
        .map(MacroUserIdStr::into_owned)
        .map_err(|_| TeamAgentError::BadRequest("invalid agent user id".to_string()))?;
    Ok(Json(
        state
            .service
            .retry(access.entity_access_receipt, &agent_user_id)
            .await?,
    ))
}

/// Delete a team agent: release its computer, delete its repo, remove its
/// seat, mailbox and account. Requires a team admin or owner. Safe to retry.
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
        (status = 409, body = TeamAgentConflict),
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
    let agent_user_id = MacroUserIdStr::parse_from_str(&path.agent_user_id)
        .map(MacroUserIdStr::into_owned)
        .map_err(|_| {
            TeamAgentError::BadRequest(format!("{} is not a user id", path.agent_user_id))
        })?;

    state
        .service
        .delete(access.entity_access_receipt, &agent_user_id)
        .await?;

    Ok(StatusCode::NO_CONTENT)
}

/// The calling team agent's own profile.
#[utoipa::path(
    get,
    tag = "team-agents",
    operation_id = "get_my_team_agent",
    path = "/team_agents/me",
    responses(
        (status = 200, body = TeamAgent),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn get_my_team_agent_handler<S, Eas, Auth>(
    State(state): State<TeamAgentsRouterState<S, Eas, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
) -> Result<Json<TeamAgent>, TeamAgentError>
where
    S: TeamAgentService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let agent = state
        .service
        .me(&user.authorization.user.macro_user_id)
        .await?;

    Ok(Json(agent))
}

/// Query for listing emails.
#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
pub struct ListEmailQuery {
    /// Most emails to return, 1 to 100. Defaults to 20.
    pub limit: Option<u8>,
}

/// The calling team agent's newest emails.
#[utoipa::path(
    get,
    tag = "team-agents",
    operation_id = "list_my_team_agent_email",
    path = "/team_agents/me/email/messages",
    params(ListEmailQuery),
    responses(
        (status = 200, body = EmailMessages),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 502, body = ErrorResponse),
        (status = 503, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn list_my_email_handler<S, Eas, Auth>(
    State(state): State<TeamAgentsRouterState<S, Eas, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Query(query): Query<ListEmailQuery>,
) -> Result<Json<EmailMessages>, TeamAgentError>
where
    S: TeamAgentService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let messages = state
        .service
        .list_email(
            &user.authorization.user.macro_user_id,
            query.limit.unwrap_or(DEFAULT_EMAIL_LIMIT),
        )
        .await?;

    Ok(Json(messages))
}

/// Path for one email.
#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Path)]
pub struct EmailPath {
    /// Provider message id.
    #[param(value_type = String)]
    pub message_id: crate::domain::mail::MailMessageId,
}

/// One of the calling team agent's emails, with its body.
#[utoipa::path(
    get,
    tag = "team-agents",
    operation_id = "get_my_team_agent_email",
    path = "/team_agents/me/email/messages/{message_id}",
    params(EmailPath),
    responses(
        (status = 200, body = EmailMessage),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 502, body = ErrorResponse),
        (status = 503, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn get_my_email_handler<S, Eas, Auth>(
    State(state): State<TeamAgentsRouterState<S, Eas, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Path(path): Path<EmailPath>,
) -> Result<Json<EmailMessage>, TeamAgentError>
where
    S: TeamAgentService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let message = state
        .service
        .get_email(&user.authorization.user.macro_user_id, &path.message_id)
        .await?;

    Ok(Json(message))
}

/// Send an email as the calling team agent.
#[utoipa::path(
    post,
    tag = "team-agents",
    operation_id = "send_team_agent_email",
    path = "/team_agents/me/email/send",
    request_body = SendEmail,
    responses(
        (status = 200, body = SentEmail),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 502, body = ErrorResponse),
        (status = 503, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn send_my_email_handler<S, Eas, Auth>(
    State(state): State<TeamAgentsRouterState<S, Eas, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Json(body): Json<SendEmail>,
) -> Result<Json<SentEmail>, TeamAgentError>
where
    S: TeamAgentService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let sent = state
        .service
        .send_email(&user.authorization.user.macro_user_id, body)
        .await?;

    Ok(Json(sent))
}
