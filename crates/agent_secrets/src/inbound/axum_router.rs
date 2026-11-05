//! HTTP routes for agent secrets, nested at `/team_agents` in the auth
//! service next to the team agents router.

use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{FromRef, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
};
use entity_access::{
    domain::{models::AdminTeamRole, ports::EntityAccessService},
    inbound::axum_extractors::MacroUserTeamExtractorV2,
};
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOrInternal,
};
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use model_error_response::ErrorResponse;
use serde::Deserialize;

use crate::domain::models::{
    AgentSecret, AgentSecretError, AgentSecretSummaries, AgentSecretSummary, PutAgentSecret,
};
use crate::domain::ports::AgentSecretService;

#[cfg(test)]
mod test;

/// Router state.
pub struct AgentSecretsRouterState<S, Eas, Auth> {
    /// The agent secret service.
    pub service: Arc<S>,
    /// The entity access service, for the team admin check.
    pub entity_access_service: Arc<Eas>,
    /// State for request authorization.
    pub authorization_state: MacroAuthorizationState<Auth>,
}

impl<S, Eas, Auth> Clone for AgentSecretsRouterState<S, Eas, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            entity_access_service: self.entity_access_service.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<S, Eas, Auth> FromRef<AgentSecretsRouterState<S, Eas, Auth>> for Arc<Eas> {
    fn from_ref(state: &AgentSecretsRouterState<S, Eas, Auth>) -> Self {
        state.entity_access_service.clone()
    }
}

impl<S, Eas, Auth> FromRef<AgentSecretsRouterState<S, Eas, Auth>>
    for MacroAuthorizationState<Auth>
{
    fn from_ref(state: &AgentSecretsRouterState<S, Eas, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// Builds the agent secrets router:
///
/// - `PUT|GET|DELETE /me/secrets/{name}` — the calling agent's own secret.
/// - `GET /{agent_user_id}/secrets` — a team admin lists an agent's secrets.
/// - `DELETE /{agent_user_id}/secrets/{name}` — a team admin deletes one.
pub fn agent_secrets_router<S, Eas, Auth, T>(
    state: AgentSecretsRouterState<S, Eas, Auth>,
) -> Router<T>
where
    S: AgentSecretService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
    T: Send + Sync + 'static,
{
    Router::new()
        .route(
            "/me/secrets/{name}",
            get(get_my_secret_handler::<S, Eas, Auth>)
                .put(put_my_secret_handler::<S, Eas, Auth>)
                .delete(delete_my_secret_handler::<S, Eas, Auth>),
        )
        .route(
            "/{agent_user_id}/secrets",
            get(list_agent_secrets_handler::<S, Eas, Auth>),
        )
        .route(
            "/{agent_user_id}/secrets/{name}",
            axum::routing::delete(delete_agent_secret_handler::<S, Eas, Auth>),
        )
        .with_state(state)
}

impl IntoResponse for AgentSecretError {
    fn into_response(self) -> Response {
        let status = match &self {
            AgentSecretError::BadRequest(_) => StatusCode::BAD_REQUEST,
            AgentSecretError::NotAnAgent | AgentSecretError::NotFound => StatusCode::NOT_FOUND,
            AgentSecretError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };

        let message = match &self {
            AgentSecretError::Internal(error) => {
                tracing::error!(error = ?error, "agent secret request failed");
                "internal error".to_string()
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

/// Path for one of the caller's secrets.
#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Path)]
pub struct SecretPath {
    /// The secret's name.
    pub name: String,
}

/// Path for an agent's secrets.
#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Path)]
pub struct AgentPath {
    /// The agent's Macro user id.
    pub agent_user_id: String,
}

/// Path for one of an agent's secrets.
#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Path)]
pub struct AgentSecretPath {
    /// The agent's Macro user id.
    pub agent_user_id: String,
    /// The secret's name.
    pub name: String,
}

fn parse_agent(raw: &str) -> Result<MacroUserIdStr<'static>, AgentSecretError> {
    MacroUserIdStr::parse_from_str(raw)
        .map(MacroUserIdStr::into_owned)
        .map_err(|_| AgentSecretError::BadRequest(format!("{raw} is not a user id")))
}

/// Store a secret for the calling team agent, replacing one with that name.
#[utoipa::path(
    put,
    tag = "team-agents",
    operation_id = "put_my_team_agent_secret",
    path = "/team_agents/me/secrets/{name}",
    params(SecretPath),
    request_body = PutAgentSecret,
    responses(
        (status = 200, body = AgentSecretSummary),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn put_my_secret_handler<S, Eas, Auth>(
    State(state): State<AgentSecretsRouterState<S, Eas, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Path(path): Path<SecretPath>,
    Json(body): Json<PutAgentSecret>,
) -> Result<Json<AgentSecretSummary>, AgentSecretError>
where
    S: AgentSecretService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let summary = state
        .service
        .put(&user.authorization.user.macro_user_id, &path.name, body.value)
        .await?;

    Ok(Json(summary))
}

/// One of the calling team agent's secrets, decrypted.
#[utoipa::path(
    get,
    tag = "team-agents",
    operation_id = "get_my_team_agent_secret",
    path = "/team_agents/me/secrets/{name}",
    params(SecretPath),
    responses(
        (status = 200, body = AgentSecret),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn get_my_secret_handler<S, Eas, Auth>(
    State(state): State<AgentSecretsRouterState<S, Eas, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Path(path): Path<SecretPath>,
) -> Result<Json<AgentSecret>, AgentSecretError>
where
    S: AgentSecretService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let secret = state
        .service
        .get(&user.authorization.user.macro_user_id, &path.name)
        .await?;

    Ok(Json(secret))
}

/// Delete one of the calling team agent's secrets.
#[utoipa::path(
    delete,
    tag = "team-agents",
    operation_id = "delete_my_team_agent_secret",
    path = "/team_agents/me/secrets/{name}",
    params(SecretPath),
    responses(
        (status = 204),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn delete_my_secret_handler<S, Eas, Auth>(
    State(state): State<AgentSecretsRouterState<S, Eas, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Path(path): Path<SecretPath>,
) -> Result<StatusCode, AgentSecretError>
where
    S: AgentSecretService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    state
        .service
        .delete(&user.authorization.user.macro_user_id, &path.name)
        .await?;

    Ok(StatusCode::NO_CONTENT)
}

/// A team admin lists an agent's secrets by name, without values.
#[utoipa::path(
    get,
    tag = "team-agents",
    operation_id = "list_team_agent_secrets",
    path = "/team_agents/{agent_user_id}/secrets",
    params(AgentPath),
    responses(
        (status = 200, body = AgentSecretSummaries),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn list_agent_secrets_handler<S, Eas, Auth>(
    access: MacroUserTeamExtractorV2<AdminTeamRole, Eas, Auth>,
    State(state): State<AgentSecretsRouterState<S, Eas, Auth>>,
    Path(path): Path<AgentPath>,
) -> Result<Json<AgentSecretSummaries>, AgentSecretError>
where
    S: AgentSecretService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let agent_user_id = parse_agent(&path.agent_user_id)?;
    let secrets = state
        .service
        .list_for_admin(access.entity_access_receipt, &agent_user_id)
        .await?;

    Ok(Json(secrets))
}

/// A team admin deletes one of an agent's secrets.
#[utoipa::path(
    delete,
    tag = "team-agents",
    operation_id = "delete_team_agent_secret",
    path = "/team_agents/{agent_user_id}/secrets/{name}",
    params(AgentSecretPath),
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
pub async fn delete_agent_secret_handler<S, Eas, Auth>(
    access: MacroUserTeamExtractorV2<AdminTeamRole, Eas, Auth>,
    State(state): State<AgentSecretsRouterState<S, Eas, Auth>>,
    Path(path): Path<AgentSecretPath>,
) -> Result<StatusCode, AgentSecretError>
where
    S: AgentSecretService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let agent_user_id = parse_agent(&path.agent_user_id)?;
    state
        .service
        .delete_for_admin(access.entity_access_receipt, &agent_user_id, &path.name)
        .await?;

    Ok(StatusCode::NO_CONTENT)
}
