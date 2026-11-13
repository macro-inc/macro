use std::sync::Arc;

use axum::extract::{FromRef, Path, State};
use axum::routing::get;
use axum::{Json, Router};
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOnly,
};
use macro_user_id::user_id::MacroUserIdStr;

use crate::domain::agent_routines::AgentRoutines;
use crate::domain::models::ActionPolicyError;
use crate::domain::ports::AgentRoutineService;
use crate::inbound::axum_router::ScheduledActionApiError;

#[cfg(test)]
mod test;

pub struct AgentRoutineRouterState<S, Auth> {
    pub service: Arc<S>,
    pub authorization_state: MacroAuthorizationState<Auth>,
}

impl<S, Auth> Clone for AgentRoutineRouterState<S, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: Arc::clone(&self.service),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<S, Auth> FromRef<AgentRoutineRouterState<S, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &AgentRoutineRouterState<S, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

pub fn agent_routine_router<S, Auth, St>(state: AgentRoutineRouterState<S, Auth>) -> Router<St>
where
    S: AgentRoutineService,
    Auth: MacroAuthorizationService,
    St: Send + Sync,
{
    Router::new()
        .route(
            "/scheduled-actions/agents/{agent_id}",
            get(list_agent_routines::<S, Auth>),
        )
        .with_state(state)
}

#[utoipa::path(
    get,
    path = "/scheduled-actions/agents/{agent_id}",
    tag = "scheduled actions",
    operation_id = "list_agent_routines",
    params(("agent_id" = String, Path, description = "User ID of the agent account")),
    responses(
        (status = 200, body = AgentRoutines, description = "The agent's top-level routines, oldest first, summarized without their content"),
        (status = 401, body = String),
        (status = 404, body = String, description = "Not the agent or an owner or admin of its team, not an agent account, or agent dashboards are off for the caller"),
        (status = 500, body = String),
    )
)]
pub async fn list_agent_routines<S, Auth>(
    State(state): State<AgentRoutineRouterState<S, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOnly>,
    Path(agent_id): Path<String>,
) -> Result<Json<AgentRoutines>, ScheduledActionApiError>
where
    S: AgentRoutineService,
    Auth: MacroAuthorizationService,
{
    // An id that can't name a user names no agent the caller oversees.
    let agent = MacroUserIdStr::parse_from_str(&agent_id)
        .map_err(|_| anyhow::Error::from(ActionPolicyError::NotFound))?;
    let routines = state
        .service
        .agent_routines(&user.authorization.macro_user_id, &agent)
        .await?;
    Ok(Json(routines))
}
