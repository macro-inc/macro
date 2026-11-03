//! HTTP routes for team agents, nested at `/team_agents` in the auth service.

use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{FromRef, Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
};
use entity_access::{
    domain::{models::AdminTeamRole, ports::EntityAccessService},
    inbound::axum_extractors::MacroUserTeamExtractorV2,
};
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOrInternal,
};
use model_error_response::ErrorResponse;
use serde::Deserialize;

use crate::domain::models::{
    CreateTeamAgent, EmailMessage, EmailMessages, SendEmail, SentEmail, TeamAgent, TeamAgentError,
};
use crate::domain::ports::TeamAgentService;

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
/// - `POST /` — a team admin creates an agent on their team.
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
        .route("/", post(create_team_agent_handler::<S, Eas, Auth>))
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

impl IntoResponse for TeamAgentError {
    fn into_response(self) -> Response {
        let status = match &self {
            TeamAgentError::BadRequest(_) | TeamAgentError::Runtime(_) => StatusCode::BAD_REQUEST,
            TeamAgentError::NotAnAgent => StatusCode::NOT_FOUND,
            TeamAgentError::EmailUnavailable => StatusCode::SERVICE_UNAVAILABLE,
            TeamAgentError::Forbidden | TeamAgentError::NotEnabled => StatusCode::FORBIDDEN,
            TeamAgentError::EmailProvider(_) => StatusCode::BAD_GATEWAY,
            TeamAgentError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };

        let message = match &self {
            TeamAgentError::Internal(error) => {
                tracing::error!(error = ?error, "team agent request failed");
                "internal error".to_string()
            }
            TeamAgentError::EmailProvider(error) => {
                tracing::error!(error = ?error, "the email provider failed");
                "the email provider failed".to_string()
            }
            other => other.to_string(),
        };

        (
            status,
            Json(ErrorResponse {
                message: message.into(),
            }),
        )
            .into_response()
    }
}

/// Create a team agent on the caller's team. Requires a team admin or owner.
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
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn create_team_agent_handler<S, Eas, Auth>(
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
    pub message_id: String,
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
