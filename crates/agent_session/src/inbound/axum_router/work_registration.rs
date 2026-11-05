//! Thin transport adapters for registering sessions as an account's work.

use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    routing::{get, put},
};
use chrono::{DateTime, Utc};
use entity_access::{
    domain::{models::EditAccessLevel, ports::EntityAccessService},
    inbound::axum_extractors::AgentSessionAccessLevelExtractor,
};
use macro_authorization::{ActingUser, MacroAuthorizationExtractor, MacroAuthorizationService};
use serde::Serialize;
use utoipa::ToSchema;

use super::{AgentSessionApiError, AgentSessionRouterState};
use crate::domain::model::AgentSessionId;
use crate::domain::work_registration::{WorkRegistration, WorkRegistrations};

/// The register, unregister, and list-own routes. Mount at the root.
pub fn work_registration_router<T, Access, Auth, S>(
    state: AgentSessionRouterState<T, Access, Auth>,
) -> Router<S>
where
    T: WorkRegistrations,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
    S: Clone + Send + Sync + 'static,
{
    Router::new()
        .route(
            "/agent-sessions/{session_id}/work-registration",
            put(register_work::<T, Access, Auth>).delete(unregister_work::<T, Access, Auth>),
        )
        .route(
            "/agent-work-registrations",
            get(list_own_work::<T, Access, Auth>),
        )
        .with_state(state)
}

/// One account's active registration of one session as its work.
#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct WorkRegistrationResponse {
    /// The registration.
    pub id: uuid::Uuid,
    /// The account whose work this is.
    pub account_id: String,
    /// The session registered.
    pub agent_session_id: uuid::Uuid,
    /// When the account registered it.
    pub registered_at: DateTime<Utc>,
}

impl From<WorkRegistration> for WorkRegistrationResponse {
    fn from(registration: WorkRegistration) -> Self {
        Self {
            id: registration.id.as_uuid(),
            account_id: registration.account_id.as_ref().to_owned(),
            agent_session_id: registration.session.as_uuid(),
            registered_at: registration.registered_at,
        }
    }
}

#[utoipa::path(
    put,
    path = "/agent-sessions/{session_id}/work-registration",
    tag = "agent-sessions",
    operation_id = "register_agent_session_work",
    params(("session_id" = uuid::Uuid, Path, description = "ID of the agent session")),
    responses(
        (status = 200, body = WorkRegistrationResponse),
        (status = 401, body = String),
        (status = 403, body = String),
        (status = 409, body = String),
        (status = 500, body = String),
    )
)]
/// Register a session as the caller's work. Requires edit access. Repeating returns the active
/// registration. Registering does not share the session: viewers who cannot open it do not see
/// it, so share it too.
#[tracing::instrument(skip_all, fields(actor = %caller.acting_entity()), err(Debug))]
pub async fn register_work<
    T: WorkRegistrations,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: AgentSessionAccessLevelExtractor<EditAccessLevel, Access, Auth>,
    State(state): State<AgentSessionRouterState<T, Access, Auth>>,
    caller: MacroAuthorizationExtractor<Auth, ActingUser>,
) -> Result<Json<WorkRegistrationResponse>, AgentSessionApiError> {
    let registration = state
        .service
        .register(
            &access.entity_access_receipt,
            &caller.authorization.user.macro_user_id,
        )
        .await?;
    Ok(Json(registration.into()))
}

#[utoipa::path(
    delete,
    path = "/agent-sessions/{session_id}/work-registration",
    tag = "agent-sessions",
    operation_id = "unregister_agent_session_work",
    params(("session_id" = uuid::Uuid, Path, description = "ID of the agent session")),
    responses(
        (status = 204, description = "The caller has no active registration of the session"),
        (status = 401, body = String),
        (status = 500, body = String),
    )
)]
/// End the caller's own registration of a session. Repeating does nothing. It touches only the
/// caller's own row, so it needs no access to the session: losing access must not strand it.
#[tracing::instrument(skip_all, fields(actor = %caller.acting_entity()), err(Debug))]
pub async fn unregister_work<
    T: WorkRegistrations,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<AgentSessionRouterState<T, Access, Auth>>,
    caller: MacroAuthorizationExtractor<Auth, ActingUser>,
    Path(session_id): Path<uuid::Uuid>,
) -> Result<StatusCode, AgentSessionApiError> {
    state
        .service
        .unregister(
            &caller.authorization.user.macro_user_id,
            AgentSessionId::new_from_uuid(session_id),
        )
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    get,
    path = "/agent-work-registrations",
    tag = "agent-sessions",
    operation_id = "list_agent_work_registrations",
    responses(
        (status = 200, body = Vec<WorkRegistrationResponse>),
        (status = 401, body = String),
        (status = 500, body = String),
    )
)]
/// List the caller's active registrations of sessions they can still view, newest first.
#[tracing::instrument(skip_all, fields(actor = %caller.acting_entity()), err(Debug))]
pub async fn list_own_work<
    T: WorkRegistrations,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<AgentSessionRouterState<T, Access, Auth>>,
    caller: MacroAuthorizationExtractor<Auth, ActingUser>,
) -> Result<Json<Vec<WorkRegistrationResponse>>, AgentSessionApiError> {
    let account = &caller.authorization.user.macro_user_id;
    let registrations = state
        .service
        .visible_registrations(account, std::slice::from_ref(account))
        .await?;
    Ok(Json(
        registrations.into_iter().map(Into::into).collect(),
    ))
}
