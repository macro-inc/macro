//! Configuration acceptance policy. Runtime provisioning belongs to execution only.

use std::sync::Arc;

use agent_session::domain::routines::{RoutineSessions, ValidateRoutineSession};
use anyhow::Result;
use macro_user_id::user_id::MacroUserIdStr;
use routine_program::{ProgramError, RoutineProgram};
use serde_json::Value;

use super::{models::ResolvedTaskTarget, ports::TaskTargetValidator};

/// Safe configuration failures, independent of transport status codes.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum TargetValidationError {
    #[error("invalid routine task; add steps, or select a model or agent and provide instructions")]
    InvalidTask,
    /// The steps break a structural rule; the message says which.
    #[error("{0}")]
    InvalidProgram(#[from] ProgramError),
    #[error("agent routines are not enabled")]
    AgentsDisabled,
    #[error("this routine selects an agent; reload or upgrade your client before updating")]
    ExplicitAgentRequired,
    #[error("this routine requires apps; reload or upgrade your client before updating")]
    ExplicitAppsRequired,
    #[error("this routine has steps; reload or upgrade your client before updating")]
    ExplicitStepsRequired,
}

/// Default acceptance policy for composition roots that have not enabled agents.
pub struct ModelOnlyTargets;

impl TaskTargetValidator for ModelOnlyTargets {
    async fn validate_task(&self, task: &Value, _owner: &MacroUserIdStr<'static>) -> Result<()> {
        // Required apps need the session domain to check the owner's connections.
        if !parse_program(task, false)?.mcp_servers.is_empty() {
            return Err(TargetValidationError::AgentsDisabled.into());
        }
        Ok(())
    }
}

/// Authorizes every agent step's selection without opening a session or
/// checking runtime connectivity.
pub struct TargetValidation<Sessions> {
    sessions: Arc<Sessions>,
    agents_enabled: bool,
}

impl<Sessions> TargetValidation<Sessions> {
    pub fn new(sessions: Arc<Sessions>, agents_enabled: bool) -> Self {
        Self {
            sessions,
            agents_enabled,
        }
    }
}

impl<Sessions: RoutineSessions> TaskTargetValidator for TargetValidation<Sessions> {
    async fn validate_task(&self, task: &Value, owner: &MacroUserIdStr<'static>) -> Result<()> {
        let program = parse_program(task, self.agents_enabled)?;
        for step in program.agent_steps() {
            let (bot_id, model) = ResolvedTaskTarget::of(step)?.session_target();
            self.sessions
                .validate(ValidateRoutineSession {
                    owner: owner.clone(),
                    bot_id,
                    model: model.map(str::to_owned),
                    mcp_servers: program.mcp_servers.clone(),
                })
                .await?;
        }
        Ok(())
    }
}

/// A stored task's program, checked structurally and against the agent gate.
pub(super) fn parse_program(
    task: &Value,
    agents_enabled: bool,
) -> Result<RoutineProgram, TargetValidationError> {
    let program =
        RoutineProgram::from_task(task).map_err(|_| TargetValidationError::InvalidTask)?;
    program.validate()?;
    for step in program.agent_steps() {
        let target =
            ResolvedTaskTarget::of(step).map_err(|_| TargetValidationError::InvalidTask)?;
        if matches!(target, ResolvedTaskTarget::Agent { .. }) && !agents_enabled {
            return Err(TargetValidationError::AgentsDisabled);
        }
    }
    Ok(program)
}

/// The raw JSON preserves absent versus explicit null without changing stored contracts.
/// Even a malformed historical selection must not be silently erased by an old client.
pub(super) fn require_explicit_selection(previous: &Value, incoming: &Value) -> Result<()> {
    if previous.get("agent").is_some_and(|agent| !agent.is_null())
        && incoming.get("agent").is_none()
        && incoming.get("steps").is_none()
    {
        return Err(TargetValidationError::ExplicitAgentRequired.into());
    }
    // Same for required apps: a client that predates them omits the key, and
    // an update must not drop the apps it never showed.
    if previous
        .get("mcp_servers")
        .and_then(Value::as_array)
        .is_some_and(|servers| !servers.is_empty())
        && incoming.get("mcp_servers").is_none()
    {
        return Err(TargetValidationError::ExplicitAppsRequired.into());
    }
    // A client that predates steps, or a tab loaded before they were added,
    // sends a single agent task; saving it would delete the steps.
    if previous.get("steps").is_some_and(|steps| !steps.is_null())
        && incoming.get("steps").is_none()
    {
        return Err(TargetValidationError::ExplicitStepsRequired.into());
    }
    Ok(())
}

#[cfg(test)]
pub(crate) mod test;
