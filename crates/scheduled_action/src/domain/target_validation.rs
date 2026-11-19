//! Configuration acceptance policy. Runtime provisioning belongs to execution only.

use std::sync::Arc;

use agent_session::domain::routines::{RoutineSessions, ValidateRoutineSession};
use anyhow::Result;
use bots::domain::models::AgentMcpServer;
use macro_user_id::user_id::MacroUserIdStr;
use routine_program::{AgentStep, ProgramError, RoutineProgram, Step, SubRoutineCopy};
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
    /// The scheduler has no session domain to authorize agents or apps with.
    #[error("this scheduler cannot check agents or required apps")]
    SessionsUnavailable,
    #[error("this routine selects an agent; reload or upgrade your client before updating")]
    ExplicitAgentRequired,
    #[error("this routine requires apps; reload or upgrade your client before updating")]
    ExplicitAppsRequired,
    #[error("this routine has steps; reload or upgrade your client before updating")]
    ExplicitStepsRequired,
    #[error(
        "this routine defines sub-routines or inputs; reload or upgrade your client before updating"
    )]
    ExplicitSubRoutinesRequired,
    /// A task without steps is the single agent, whose parser skips fields
    /// it doesn't know: definitions or inputs beside it would be saved
    /// unchecked.
    #[error("a routine's sub-routines and inputs are saved with its steps")]
    SubRoutinesWithoutSteps,
}

/// Default acceptance policy for composition roots without a session domain.
pub struct ModelOnlyTargets;

impl TaskTargetValidator for ModelOnlyTargets {
    async fn validate_task(&self, task: &Value, _owner: &MacroUserIdStr<'static>) -> Result<()> {
        let program = parse_program(task)?;
        // Agents and required apps need the session domain to authorize them.
        let agents = agents(&program);
        let agent = agents.iter().any(|(step, _)| {
            matches!(
                ResolvedTaskTarget::of(step),
                Ok(ResolvedTaskTarget::Agent { .. })
            )
        });
        if agent || agents.iter().any(|(_, apps)| !apps.is_empty()) {
            return Err(TargetValidationError::SessionsUnavailable.into());
        }
        Ok(())
    }
}

/// Every agent step a routine holds, its sub-routines' included, with the
/// apps the run it belongs to requires.
fn agents(program: &RoutineProgram) -> Vec<(&AgentStep, &[AgentMcpServer])> {
    let own = program
        .agent_steps()
        .into_iter()
        .map(|step| (step, program.mcp_servers.as_slice()));
    let definitions = program.sub_routines.iter().flat_map(|definition| {
        definition.steps.iter().filter_map(|step| match step {
            Step::Agent(agent) => Some((agent, definition.mcp_servers.as_slice())),
            Step::Code(_) => None,
        })
    });
    // Apps without an agent never get here: `validate` refuses them.
    own.chain(definitions).collect()
}

/// Authorizes every agent step's selection without opening a session or
/// checking runtime connectivity, so a self-hosted agent can be saved while
/// its runtime is offline.
pub struct TargetValidation<Sessions> {
    sessions: Arc<Sessions>,
}

impl<Sessions> TargetValidation<Sessions> {
    pub fn new(sessions: Arc<Sessions>) -> Self {
        Self { sessions }
    }
}

impl<Sessions: RoutineSessions> TaskTargetValidator for TargetValidation<Sessions> {
    async fn validate_task(&self, task: &Value, owner: &MacroUserIdStr<'static>) -> Result<()> {
        let program = parse_program(task)?;
        for (step, apps) in agents(&program) {
            let (bot_id, model) = ResolvedTaskTarget::of(step)?.session_target();
            self.sessions
                .validate(ValidateRoutineSession {
                    owner: owner.clone(),
                    bot_id,
                    model: model.map(str::to_owned),
                    mcp_servers: apps.to_vec(),
                })
                .await?;
        }
        Ok(())
    }
}

/// A stored task's program, checked structurally, each agent step (its
/// sub-routines' included) with a target.
pub(super) fn parse_program(task: &Value) -> Result<RoutineProgram, TargetValidationError> {
    // Anywhere in what is saved, not only in the fields a program reads:
    // the single agent's parser skips fields it doesn't know.
    if routine_program::holds_nul(task) {
        return Err(ProgramError::Nul.into());
    }
    let program =
        RoutineProgram::from_task(task).map_err(|_| TargetValidationError::InvalidTask)?;
    program.validate()?;
    for (step, _) in agents(&program) {
        ResolvedTaskTarget::of(step).map_err(|_| TargetValidationError::InvalidTask)?;
    }
    Ok(program)
}

/// Refuse a single agent task carrying a field only a task with steps keeps,
/// which its parser would skip unchecked. Only for a new or changed task: a
/// stored one with such a field still runs, and is renamed or resumed with
/// its task sent back as it is.
pub(super) fn refuse_fields_beside_agent(task: &Value) -> Result<(), TargetValidationError> {
    if task.get("steps").is_none()
        && SubRoutineCopy::from_task(task).is_none()
        && ["sub_routines", "inputs", "sub_routine"]
            .iter()
            .any(|field| task.get(field).is_some())
    {
        return Err(TargetValidationError::SubRoutinesWithoutSteps);
    }
    Ok(())
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
    // A client that predates sub-routines rebuilds the task from what it
    // knows, so saving would delete the definitions its copies run, or the
    // inputs a detached copy's code reads.
    for field in ["sub_routines", "inputs"] {
        if previous
            .get(field)
            .and_then(Value::as_array)
            .is_some_and(|items| !items.is_empty())
            && incoming.get(field).is_none()
        {
            return Err(TargetValidationError::ExplicitSubRoutinesRequired.into());
        }
    }
    Ok(())
}

#[cfg(test)]
pub(crate) mod test;
