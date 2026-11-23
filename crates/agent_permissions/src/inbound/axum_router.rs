//! The HTTP API: the catalog, an agent's and a session's permissions,
//! setting, tightening and resetting them, and following another policy
//! (its source) or detaching from it.
//!
//! Handlers only translate: the caller's credential becomes a [`Credential`]
//! (from transport facts: a person's own session, an agent-attributed token
//! with its verified invocation, or anything else), and every decision is the
//! service's. When the feature is off for the caller, every route is 404.

#[cfg(test)]
mod test;

use std::sync::Arc;

use agent_fold::domain::log::AgentSessionId;
use axum::Router;
use axum::extract::{FromRef, Json, Path, Query, State};
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post, put};
use bot_id::BotId;
use entity_access::domain::models::ViewAccessLevel;
use entity_access::domain::ports::EntityAccessService;
use entity_access::inbound::axum_extractors::AgentSessionAccessLevelExtractor;
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState,
    MacroUserAuthentication, UserOnly,
};
use macro_uuid::Uuid;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::domain::model::{
    Caller, CandidatesFor, Change, Credential, LoosenedOperation, PermissionError, PermissionsView,
    PolicyId, SourceCandidates, Target, TeamPermissionsView, Tightened, ToolPermissionCatalog,
};
use crate::domain::service::AgentPermissions;

/// The OpenAPI tag of these routes.
pub const TAG: &str = "agent-tool-permissions";

/// Changes to an agent's permissions.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ToolPermissionChanges {
    /// Between 1 and 200 changes, applied together.
    pub changes: Vec<Change>,
}

/// The policy an agent is to follow.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SetToolPermissionSource {
    /// The source's policy id, from the picker (`sources`) or a view's
    /// `policyId`.
    pub source_policy_id: PolicyId,
}

/// A detach, and the changes to make in the same transaction.
#[derive(Debug, Default, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DetachToolPermissions {
    /// Changes applied on top of the snapshot (between 1 and 200), as `set`
    /// takes them.
    #[serde(default)]
    pub changes: Option<Vec<Change>>,
}

/// Whose sources to list: an agent's, or a scope for an agent not created
/// yet.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum SourceScopeQuery {
    /// The caller's private agent.
    Private,
    /// A team's agent (`teamId`).
    Team,
}

/// The picker's query.
#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[serde(rename_all = "camelCase")]
#[into_params(parameter_in = Query)]
pub struct SourceCandidatesQuery {
    /// An existing agent: its scope, with candidates it can't follow marked.
    pub agent_id: Option<Uuid>,
    /// Without `agentId`: the scope the new agent will have.
    pub scope: Option<SourceScopeQuery>,
    /// With `scope=team`: the team.
    pub team_id: Option<Uuid>,
}

impl SourceCandidatesQuery {
    fn of(&self) -> Result<CandidatesFor, PermissionError> {
        match (self.agent_id, self.scope, self.team_id) {
            (Some(agent), None, None) => Ok(CandidatesFor::Agent(BotId::new_from_uuid(agent))),
            (None, Some(SourceScopeQuery::Private), None) => Ok(CandidatesFor::Private),
            (None, Some(SourceScopeQuery::Team), Some(team)) => Ok(CandidatesFor::Team(team)),
            _ => Err(PermissionError::Invalid(
                "pass agentId, scope=private, or scope=team with teamId".to_owned(),
            )),
        }
    }
}

/// Why a request was refused.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolPermissionError {
    /// `invalid`, `unknown_target`, `forbidden`, `needs_person`, `not_found`,
    /// `would_loosen`, `follows_source`, `source_cycle`, `source_too_deep`,
    /// `source_not_allowed` or `internal`.
    pub code: &'static str,
    /// What went wrong, for a person.
    pub message: String,
    /// For `follows_source`: the policy the agent follows.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<PolicyId>,
    /// For `would_loosen` and `follows_source`: the operations the change
    /// would have loosened.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub operations: Option<Vec<LoosenedOperation>>,
    /// For `unknown_target`: the targets the registry does not have.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub targets: Option<Vec<Target>>,
}

/// A refusal on the wire.
#[derive(Debug)]
pub struct ToolPermissionApiError(pub PermissionError);

impl IntoResponse for ToolPermissionApiError {
    fn into_response(self) -> Response {
        let message = self.0.to_string();
        let mut source = None;
        let (status, code, operations, targets) = match self.0 {
            PermissionError::Disabled | PermissionError::NotFound => {
                (StatusCode::NOT_FOUND, "not_found", None, None)
            }
            PermissionError::Forbidden => (StatusCode::FORBIDDEN, "forbidden", None, None),
            PermissionError::NeedsPerson => (StatusCode::FORBIDDEN, "needs_person", None, None),
            PermissionError::Invalid(_) => (StatusCode::BAD_REQUEST, "invalid", None, None),
            PermissionError::UnknownTarget(targets) => (
                StatusCode::BAD_REQUEST,
                "unknown_target",
                None,
                Some(targets),
            ),
            PermissionError::WouldLoosen(operations) => (
                StatusCode::UNPROCESSABLE_ENTITY,
                "would_loosen",
                Some(operations),
                None,
            ),
            PermissionError::FollowsSource {
                operations,
                followed,
            } => {
                source = followed;
                (
                    StatusCode::CONFLICT,
                    "follows_source",
                    Some(operations),
                    None,
                )
            }
            PermissionError::SourceCycle => (StatusCode::CONFLICT, "source_cycle", None, None),
            PermissionError::SourceTooDeep => (StatusCode::CONFLICT, "source_too_deep", None, None),
            PermissionError::SourceNotAllowed => {
                (StatusCode::FORBIDDEN, "source_not_allowed", None, None)
            }
            PermissionError::Internal(report) => {
                tracing::error!(error = ?report, "agent permissions request failed");
                (StatusCode::INTERNAL_SERVER_ERROR, "internal", None, None)
            }
        };
        (
            status,
            Json(ToolPermissionError {
                code,
                message,
                source,
                operations,
                targets,
            }),
        )
            .into_response()
    }
}

/// Router state: the service, plus what the session access extractor
/// resolves grants and identity through.
pub struct AgentPermissionsRouterState<Access, Auth> {
    service: Arc<dyn AgentPermissions>,
    entity_access: Arc<Access>,
    authorization: MacroAuthorizationState<Auth>,
}

impl<Access, Auth> AgentPermissionsRouterState<Access, Auth> {
    /// Build the state.
    pub fn new(
        service: Arc<dyn AgentPermissions>,
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

impl<Access, Auth> Clone for AgentPermissionsRouterState<Access, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: Arc::clone(&self.service),
            entity_access: Arc::clone(&self.entity_access),
            authorization: self.authorization.clone(),
        }
    }
}

impl<Access, Auth> FromRef<AgentPermissionsRouterState<Access, Auth>>
    for MacroAuthorizationState<Auth>
{
    fn from_ref(state: &AgentPermissionsRouterState<Access, Auth>) -> Self {
        state.authorization.clone()
    }
}

impl<Access, Auth> FromRef<AgentPermissionsRouterState<Access, Auth>> for Arc<Access> {
    fn from_ref(state: &AgentPermissionsRouterState<Access, Auth>) -> Self {
        Arc::clone(&state.entity_access)
    }
}

/// Build the router; it serves absolute paths.
pub fn router<Access, Auth, S>(state: AgentPermissionsRouterState<Access, Auth>) -> Router<S>
where
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
    S: Clone + Send + Sync + 'static,
{
    Router::new()
        .route(
            "/agent-tool-permissions/catalog",
            get(get_catalog_handler::<Access, Auth>),
        )
        .route(
            "/agents/{agent_id}/tool-permissions",
            get(get_agent_handler::<Access, Auth>)
                .put(set_handler::<Access, Auth>)
                .delete(reset_handler::<Access, Auth>),
        )
        .route(
            "/agents/{agent_id}/tool-permissions/tighten",
            post(tighten_handler::<Access, Auth>),
        )
        .route(
            "/agents/{agent_id}/tool-permissions/source",
            put(set_source_handler::<Access, Auth>),
        )
        .route(
            "/agents/{agent_id}/tool-permissions/detach",
            post(detach_handler::<Access, Auth>),
        )
        .route(
            "/agent-tool-permissions/sources",
            get(get_sources_handler::<Access, Auth>),
        )
        .route(
            "/agent-tool-permissions/policies/{policy_id}",
            get(get_policy_handler::<Access, Auth>),
        )
        .route(
            "/agent-tool-permissions/teams/{team_id}",
            get(get_team_handler::<Access, Auth>)
                .put(set_team_handler::<Access, Auth>)
                .delete(reset_team_handler::<Access, Auth>),
        )
        .route(
            "/agent-sessions/{session_id}/tool-permissions",
            get(get_session_handler::<Access, Auth>),
        )
        .with_state(state)
}

/// The caller as the domain sees it. An agent-attributed credential's session
/// is the invocation `agent_correlation` verified at the request boundary.
fn caller(user: MacroUserAuthentication) -> Caller {
    let credential = if user.is_human_session() {
        Credential::PersonSession
    } else if let Some(agent) = user.agent_id {
        Credential::Agent {
            agent,
            session: agent_correlation::context::current_session()
                .map(AgentSessionId::new_from_uuid),
        }
    } else {
        Credential::Other
    };
    Caller {
        user: user.macro_user_id,
        credential,
    }
}

#[utoipa::path(
    get,
    path = "/agent-tool-permissions/catalog",
    tag = TAG,
    operation_id = "get_agent_tool_permission_catalog",
    responses(
        (status = 200, body = ToolPermissionCatalog),
        (status = 401, body = String),
        (status = 404, body = ToolPermissionError, description = "Agent permissions are off"),
    )
)]
/// Every group, action and SDK operation an agent permission can name.
#[tracing::instrument(skip_all, err(Debug, level = "warn"))]
pub async fn get_catalog_handler<Access, Auth>(
    State(state): State<AgentPermissionsRouterState<Access, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOnly>,
) -> Result<Response, ToolPermissionApiError>
where
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let catalog = state
        .service
        .catalog(&caller(authorization.authorization))
        .await
        .map_err(ToolPermissionApiError)?;
    // The catalog changes only with the registry, which its version names.
    let etag = HeaderValue::from_str(&format!("\"{}\"", catalog.version));
    let mut response = Json(catalog).into_response();
    let headers = response.headers_mut();
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("private, max-age=3600"),
    );
    if let Ok(etag) = etag {
        headers.insert(header::ETAG, etag);
    }
    Ok(response)
}

#[utoipa::path(
    get,
    path = "/agents/{agent_id}/tool-permissions",
    tag = TAG,
    operation_id = "get_agent_tool_permissions",
    params(("agent_id" = Uuid, Path, description = "The agent or built-in persona")),
    responses(
        (status = 200, body = PermissionsView),
        (status = 401, body = String),
        (status = 403, body = ToolPermissionError),
        (status = 404, body = ToolPermissionError),
    )
)]
/// An agent's tool permissions: its own when the caller may edit it or is the
/// agent, the caller's own settings for a built-in persona.
#[tracing::instrument(skip_all, fields(%agent_id), err(Debug, level = "warn"))]
pub async fn get_agent_handler<Access, Auth>(
    State(state): State<AgentPermissionsRouterState<Access, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOnly>,
    Path(agent_id): Path<Uuid>,
) -> Result<Json<PermissionsView>, ToolPermissionApiError>
where
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    state
        .service
        .view_agent(
            &caller(authorization.authorization),
            BotId::new_from_uuid(agent_id),
        )
        .await
        .map(Json)
        .map_err(ToolPermissionApiError)
}

#[utoipa::path(
    get,
    path = "/agent-sessions/{session_id}/tool-permissions",
    tag = TAG,
    operation_id = "get_agent_session_tool_permissions",
    params(("session_id" = Uuid, Path, description = "ID of the agent session")),
    responses(
        (status = 200, body = PermissionsView),
        (status = 401, body = String),
        (status = 403, body = ToolPermissionError),
        (status = 404, body = ToolPermissionError),
    )
)]
/// The tool permissions that apply in a session: its agent's (for a built-in
/// persona, the session owner's) and the agent's restrictions on itself for
/// this session (`sessionRules`).
#[tracing::instrument(skip_all, fields(%session_id), err(Debug, level = "warn"))]
pub async fn get_session_handler<Access, Auth>(
    access: AgentSessionAccessLevelExtractor<ViewAccessLevel, Access, Auth>,
    State(state): State<AgentPermissionsRouterState<Access, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOnly>,
    Path(session_id): Path<Uuid>,
) -> Result<Json<PermissionsView>, ToolPermissionApiError>
where
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    state
        .service
        .view_session(
            &caller(authorization.authorization),
            &access.entity_access_receipt,
        )
        .await
        .map(Json)
        .map_err(ToolPermissionApiError)
}

#[utoipa::path(
    put,
    path = "/agents/{agent_id}/tool-permissions",
    tag = TAG,
    operation_id = "set_agent_tool_permissions",
    params(("agent_id" = Uuid, Path, description = "The agent or built-in persona")),
    request_body = ToolPermissionChanges,
    responses(
        (status = 200, body = PermissionsView),
        (status = 400, body = ToolPermissionError),
        (status = 401, body = String),
        (status = 403, body = ToolPermissionError, description = "May not edit the agent, or not a person's own session (needs_person)"),
        (status = 404, body = ToolPermissionError),
    )
)]
/// Change an agent's tool permissions in either direction: an action's
/// default (`always` removes it), an entity's exception to it (any state is
/// kept, `always` included; `null` follows the default again) or one
/// operation. Only a person signed in to Macro who may edit the agent; for a
/// built-in persona, the caller's own settings.
#[tracing::instrument(skip_all, fields(%agent_id), err(Debug, level = "warn"))]
pub async fn set_handler<Access, Auth>(
    State(state): State<AgentPermissionsRouterState<Access, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOnly>,
    Path(agent_id): Path<Uuid>,
    Json(request): Json<ToolPermissionChanges>,
) -> Result<Json<PermissionsView>, ToolPermissionApiError>
where
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    state
        .service
        .set(
            &caller(authorization.authorization),
            BotId::new_from_uuid(agent_id),
            request.changes,
        )
        .await
        .map(Json)
        .map_err(ToolPermissionApiError)
}

#[utoipa::path(
    post,
    path = "/agents/{agent_id}/tool-permissions/tighten",
    tag = TAG,
    operation_id = "tighten_agent_tool_permissions",
    params(("agent_id" = Uuid, Path, description = "The agent or built-in persona")),
    request_body = ToolPermissionChanges,
    responses(
        (status = 200, body = Tightened),
        (status = 400, body = ToolPermissionError),
        (status = 401, body = String),
        (status = 403, body = ToolPermissionError),
        (status = 404, body = ToolPermissionError),
        (status = 422, body = ToolPermissionError, description = "The change would make an operation more permissive (would_loosen)"),
    )
)]
/// Make an agent's tool permissions stricter. An agent may call this on
/// itself; it is saved to the agent when the person it acts for may edit
/// it, else to the current session only. Refused when anything would become
/// more permissive: an operation, a default, or an entity's action no
/// operation has yet.
#[tracing::instrument(skip_all, fields(%agent_id), err(Debug, level = "warn"))]
pub async fn tighten_handler<Access, Auth>(
    State(state): State<AgentPermissionsRouterState<Access, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOnly>,
    Path(agent_id): Path<Uuid>,
    Json(request): Json<ToolPermissionChanges>,
) -> Result<Json<Tightened>, ToolPermissionApiError>
where
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    state
        .service
        .tighten(
            &caller(authorization.authorization),
            BotId::new_from_uuid(agent_id),
            request.changes,
        )
        .await
        .map(Json)
        .map_err(ToolPermissionApiError)
}

#[utoipa::path(
    delete,
    path = "/agents/{agent_id}/tool-permissions",
    tag = TAG,
    operation_id = "reset_agent_tool_permissions",
    params(("agent_id" = Uuid, Path, description = "The agent or built-in persona")),
    responses(
        (status = 200, body = PermissionsView),
        (status = 401, body = String),
        (status = 403, body = ToolPermissionError, description = "May not edit the agent, or not a person's own session (needs_person)"),
        (status = 404, body = ToolPermissionError),
    )
)]
/// Reset an agent's tool permissions so everything is always allowed. Only a
/// person signed in to Macro who may edit the agent.
#[tracing::instrument(skip_all, fields(%agent_id), err(Debug, level = "warn"))]
pub async fn reset_handler<Access, Auth>(
    State(state): State<AgentPermissionsRouterState<Access, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOnly>,
    Path(agent_id): Path<Uuid>,
) -> Result<Json<PermissionsView>, ToolPermissionApiError>
where
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    state
        .service
        .reset(
            &caller(authorization.authorization),
            BotId::new_from_uuid(agent_id),
        )
        .await
        .map(Json)
        .map_err(ToolPermissionApiError)
}

#[utoipa::path(
    put,
    path = "/agents/{agent_id}/tool-permissions/source",
    tag = TAG,
    operation_id = "set_agent_tool_permissions_source",
    params(("agent_id" = Uuid, Path, description = "The owned agent")),
    request_body = SetToolPermissionSource,
    responses(
        (status = 200, body = PermissionsView),
        (status = 401, body = String),
        (status = 403, body = ToolPermissionError, description = "May not edit the agent, not a person's own session (needs_person), or a source it may not follow (source_not_allowed)"),
        (status = 404, body = ToolPermissionError),
        (status = 409, body = ToolPermissionError, description = "The source follows the agent (source_cycle), or too many agents would follow each other in a row (source_too_deep)"),
    )
)]
/// Make an agent follow another policy (its source): the source's settings
/// apply on the agent's next call, and its own rows only restrict them. An
/// agent that owned its settings loses the ones a person made; its
/// restrictions on itself stay. Only a person signed in to Macro who may
/// edit the agent; following grants nothing over the source.
#[tracing::instrument(skip_all, fields(%agent_id), err(Debug, level = "warn"))]
pub async fn set_source_handler<Access, Auth>(
    State(state): State<AgentPermissionsRouterState<Access, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOnly>,
    Path(agent_id): Path<Uuid>,
    Json(request): Json<SetToolPermissionSource>,
) -> Result<Json<PermissionsView>, ToolPermissionApiError>
where
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    state
        .service
        .set_source(
            &caller(authorization.authorization),
            BotId::new_from_uuid(agent_id),
            request.source_policy_id,
        )
        .await
        .map(Json)
        .map_err(ToolPermissionApiError)
}

#[utoipa::path(
    post,
    path = "/agents/{agent_id}/tool-permissions/detach",
    tag = TAG,
    operation_id = "detach_agent_tool_permissions",
    params(("agent_id" = Uuid, Path, description = "The owned agent")),
    request_body = DetachToolPermissions,
    responses(
        (status = 200, body = PermissionsView),
        (status = 400, body = ToolPermissionError),
        (status = 401, body = String),
        (status = 403, body = ToolPermissionError, description = "May not edit the agent, or not a person's own session (needs_person)"),
        (status = 404, body = ToolPermissionError),
    )
)]
/// Make an agent own its settings again: they become what it resolves to
/// now (session restrictions and approvals aside), its own restrictions
/// kept, with `changes` applied on top, all in one transaction. Only a
/// person signed in to Macro who may edit the agent.
#[tracing::instrument(skip_all, fields(%agent_id), err(Debug, level = "warn"))]
pub async fn detach_handler<Access, Auth>(
    State(state): State<AgentPermissionsRouterState<Access, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOnly>,
    Path(agent_id): Path<Uuid>,
    Json(request): Json<DetachToolPermissions>,
) -> Result<Json<PermissionsView>, ToolPermissionApiError>
where
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    state
        .service
        .detach(
            &caller(authorization.authorization),
            BotId::new_from_uuid(agent_id),
            request.changes,
        )
        .await
        .map(Json)
        .map_err(ToolPermissionApiError)
}

#[utoipa::path(
    get,
    path = "/agent-tool-permissions/sources",
    tag = TAG,
    operation_id = "get_agent_tool_permission_sources",
    params(SourceCandidatesQuery),
    responses(
        (status = 200, body = SourceCandidates),
        (status = 400, body = ToolPermissionError),
        (status = 401, body = String),
        (status = 403, body = ToolPermissionError),
        (status = 404, body = ToolPermissionError),
    )
)]
/// The policies an agent may follow, for the picker: the caller's own Macro
/// first (private agents only), then agents. With `agentId`, those it can't
/// follow say why (`unavailable`) and the one it follows is `current`.
#[tracing::instrument(skip_all, err(Debug, level = "warn"))]
pub async fn get_sources_handler<Access, Auth>(
    State(state): State<AgentPermissionsRouterState<Access, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOnly>,
    Query(query): Query<SourceCandidatesQuery>,
) -> Result<Json<SourceCandidates>, ToolPermissionApiError>
where
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let caller = caller(authorization.authorization);
    let of = match query.of() {
        Ok(of) => of,
        Err(invalid) => {
            // With the feature off, a bad query is still not found.
            state
                .service
                .catalog(&caller)
                .await
                .map_err(ToolPermissionApiError)?;
            return Err(ToolPermissionApiError(invalid));
        }
    };
    state
        .service
        .source_candidates(&caller, of)
        .await
        .map(Json)
        .map_err(ToolPermissionApiError)
}

#[utoipa::path(
    get,
    path = "/agent-tool-permissions/policies/{policy_id}",
    tag = TAG,
    operation_id = "get_agent_tool_permission_policy",
    params(("policy_id" = Uuid, Path, description = "The policy")),
    responses(
        (status = 200, body = PermissionsView),
        (status = 401, body = String),
        (status = 404, body = ToolPermissionError),
    )
)]
/// A policy by id, read only: the caller's own Macro policy, or an agent's
/// they may edit. The form shows it before the agent that will follow it
/// exists.
#[tracing::instrument(skip_all, fields(%policy_id), err(Debug, level = "warn"))]
pub async fn get_policy_handler<Access, Auth>(
    State(state): State<AgentPermissionsRouterState<Access, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOnly>,
    Path(policy_id): Path<Uuid>,
) -> Result<Json<PermissionsView>, ToolPermissionApiError>
where
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    state
        .service
        .view_policy(
            &caller(authorization.authorization),
            PolicyId::from_uuid(policy_id),
        )
        .await
        .map(Json)
        .map_err(ToolPermissionApiError)
}

#[utoipa::path(
    get,
    path = "/agent-tool-permissions/teams/{team_id}",
    tag = TAG,
    operation_id = "get_team_tool_permissions",
    params(("team_id" = Uuid, Path, description = "The team")),
    responses(
        (status = 200, body = TeamPermissionsView),
        (status = 401, body = String),
        (status = 404, body = ToolPermissionError, description = "Off, or not a member of the team"),
    )
)]
/// A team's default tool permissions: what its agents follow unless they
/// pick another source. Its members read them.
#[tracing::instrument(skip_all, fields(%team_id), err(Debug, level = "warn"))]
pub async fn get_team_handler<Access, Auth>(
    State(state): State<AgentPermissionsRouterState<Access, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOnly>,
    Path(team_id): Path<Uuid>,
) -> Result<Json<TeamPermissionsView>, ToolPermissionApiError>
where
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    state
        .service
        .view_team(&caller(authorization.authorization), team_id)
        .await
        .map(Json)
        .map_err(ToolPermissionApiError)
}

#[utoipa::path(
    put,
    path = "/agent-tool-permissions/teams/{team_id}",
    tag = TAG,
    operation_id = "set_team_tool_permissions",
    params(("team_id" = Uuid, Path, description = "The team")),
    request_body = ToolPermissionChanges,
    responses(
        (status = 200, body = TeamPermissionsView),
        (status = 400, body = ToolPermissionError),
        (status = 401, body = String),
        (status = 403, body = ToolPermissionError, description = "Not a team admin or owner, or not a person's own session (needs_person)"),
        (status = 404, body = ToolPermissionError),
    )
)]
/// Change a team's default tool permissions in either direction, as `PUT
/// /agents/{agent_id}/tool-permissions` does for an agent. Only a team admin
/// or owner signed in to Macro; every agent following it takes the change
/// on its next call.
#[tracing::instrument(skip_all, fields(%team_id), err(Debug, level = "warn"))]
pub async fn set_team_handler<Access, Auth>(
    State(state): State<AgentPermissionsRouterState<Access, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOnly>,
    Path(team_id): Path<Uuid>,
    Json(request): Json<ToolPermissionChanges>,
) -> Result<Json<TeamPermissionsView>, ToolPermissionApiError>
where
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    state
        .service
        .set_team(
            &caller(authorization.authorization),
            team_id,
            request.changes,
        )
        .await
        .map(Json)
        .map_err(ToolPermissionApiError)
}

#[utoipa::path(
    delete,
    path = "/agent-tool-permissions/teams/{team_id}",
    tag = TAG,
    operation_id = "reset_team_tool_permissions",
    params(("team_id" = Uuid, Path, description = "The team")),
    responses(
        (status = 200, body = TeamPermissionsView),
        (status = 401, body = String),
        (status = 403, body = ToolPermissionError, description = "Not a team admin or owner, or not a person's own session (needs_person)"),
        (status = 404, body = ToolPermissionError),
    )
)]
/// Reset a team's default tool permissions so everything is always allowed
/// for the agents following it. Only a team admin or owner signed in to
/// Macro.
#[tracing::instrument(skip_all, fields(%team_id), err(Debug, level = "warn"))]
pub async fn reset_team_handler<Access, Auth>(
    State(state): State<AgentPermissionsRouterState<Access, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOnly>,
    Path(team_id): Path<Uuid>,
) -> Result<Json<TeamPermissionsView>, ToolPermissionApiError>
where
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    state
        .service
        .reset_team(&caller(authorization.authorization), team_id)
        .await
        .map(Json)
        .map_err(ToolPermissionApiError)
}
