//! Configuration acceptance policy. Runtime provisioning belongs to execution only.

use std::sync::Arc;

use agent_session::domain::routines::{RoutineSessions, ValidateRoutineSession};
use anyhow::Result;
use macro_user_id::user_id::MacroUserIdStr;
use serde_json::Value;

use super::{
    models::{AgentTask, ResolvedTaskTarget},
    ports::TaskTargetValidator,
};

/// Safe configuration failures, independent of transport status codes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum TargetValidationError {
    #[error("invalid routine task; select a model or agent and provide instructions")]
    InvalidTask,
    #[error("agent routines are not enabled")]
    AgentsDisabled,
    #[error("this routine selects an agent; reload or upgrade your client before updating")]
    ExplicitAgentRequired,
}

/// Default acceptance policy for composition roots that have not enabled agents.
pub struct ModelOnlyTargets;

impl TaskTargetValidator for ModelOnlyTargets {
    async fn validate_task(&self, task: &Value, _owner: &MacroUserIdStr<'static>) -> Result<()> {
        parse_task(task, false)?;
        Ok(())
    }
}

/// Authorizes the selection without opening a session or checking runtime connectivity.
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
        let task = parse_task(task, self.agents_enabled)?;
        let (bot_id, model) = task.resolve_target()?.session_target();
        self.sessions
            .validate(ValidateRoutineSession {
                owner: owner.clone(),
                bot_id,
                model: model.map(|model| model.as_str().to_owned()),
            })
            .await?;
        Ok(())
    }
}

fn parse_task(task: &Value, agents_enabled: bool) -> Result<AgentTask, TargetValidationError> {
    let task: AgentTask =
        serde_json::from_value(task.clone()).map_err(|_| TargetValidationError::InvalidTask)?;
    let target = task
        .resolve_target()
        .map_err(|_| TargetValidationError::InvalidTask)?;
    if matches!(target, ResolvedTaskTarget::Agent { .. }) && !agents_enabled {
        return Err(TargetValidationError::AgentsDisabled);
    }
    Ok(task)
}

/// The raw JSON preserves absent versus explicit null without changing stored contracts.
/// Even a malformed historical selection must not be silently erased by an old client.
pub(super) fn require_explicit_agent(previous: &Value, incoming: &Value) -> Result<()> {
    if previous.get("agent").is_some_and(|agent| !agent.is_null())
        && incoming.get("agent").is_none()
    {
        return Err(TargetValidationError::ExplicitAgentRequired.into());
    }
    Ok(())
}

#[cfg(test)]
pub(crate) mod test;
