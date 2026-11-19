//! Configuration acceptance policy. Runtime provisioning belongs to execution only.

use std::sync::Arc;

use agent_session::domain::routines::{RoutineSessionValidation, ValidateRoutineSession};
use anyhow::Result;
use bots::domain::models::AgentMcpServer;
use macro_user_id::user_id::MacroUserIdStr;
use routine_program::{AgentStep, ProgramError, RoutineProgram, Step, SubRoutineCopy};
use serde_json::Value;

use super::{
    knob_entities::{UnusableKnob, unusable_items, unusable_knobs},
    models::ResolvedTaskTarget,
    ports::{KnobEntities, TaskTargetValidator},
};

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
    /// Entity knobs naming items the owner can't use, one problem each.
    #[error("{}", .0.join("; "))]
    UnusableItems(Vec<String>),
    /// The scheduler has no way to look up the items entity knobs name.
    #[error("this scheduler cannot check the items routines use")]
    ItemsUnavailable,
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
        let items = program
            .code_steps()
            .iter()
            .any(|step| step.entities().next().is_some());
        if items {
            return Err(TargetValidationError::ItemsUnavailable.into());
        }
        Ok(())
    }

    /// Routines with entity knobs can't be saved here, so none has any.
    async fn unusable_knobs(
        &self,
        task: &Value,
        _owner: &MacroUserIdStr<'static>,
    ) -> Result<Vec<UnusableKnob>> {
        let Ok(program) = RoutineProgram::from_task(task) else {
            return Ok(Vec::new());
        };
        if program
            .code_steps()
            .iter()
            .any(|step| step.entities().next().is_some())
        {
            return Err(TargetValidationError::ItemsUnavailable.into());
        }
        Ok(Vec::new())
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
/// its runtime is offline, and checks the owner can use every item the
/// program's entity knobs name.
pub struct TargetValidation<Validator> {
    validator: Arc<Validator>,
    entities: Option<Arc<dyn KnobEntities>>,
}

impl<Validator> TargetValidation<Validator> {
    /// Entity knobs are refused until [`Self::with_knob_entities`] says how
    /// to look their items up.
    pub fn new(validator: Arc<Validator>) -> Self {
        Self {
            validator,
            entities: None,
        }
    }

    pub fn with_knob_entities(mut self, entities: Arc<dyn KnobEntities>) -> Self {
        self.entities = Some(entities);
        self
    }
}

impl<Validator: RoutineSessionValidation> TaskTargetValidator for TargetValidation<Validator> {
    async fn validate_task(&self, task: &Value, owner: &MacroUserIdStr<'static>) -> Result<()> {
        let program = parse_program(task)?;
        let mut selections = Vec::new();
        for (step, apps) in agents(&program) {
            let (bot_id, model) = ResolvedTaskTarget::of(step)?.session_target();
            selections.push(ValidateRoutineSession {
                owner: owner.clone(),
                bot_id,
                model: model.map(str::to_owned),
                mcp_servers: apps.to_vec(),
            });
        }
        if !selections.is_empty() {
            self.validator.validate_selections(&selections).await?;
        }
        let steps = program.code_steps();
        if !steps.iter().any(|step| step.entities().next().is_some()) {
            return Ok(());
        }
        let Some(entities) = &self.entities else {
            return Err(TargetValidationError::ItemsUnavailable.into());
        };
        let unusable = unusable_items(entities.as_ref(), owner, &steps)
            .await
            .map_err(|error| anyhow::anyhow!("could not check a routine's items: {error}"))?;
        if !unusable.is_empty() {
            return Err(TargetValidationError::UnusableItems(
                unusable.iter().map(|item| item.save_problem()).collect(),
            )
            .into());
        }
        Ok(())
    }

    async fn unusable_knobs(
        &self,
        task: &Value,
        owner: &MacroUserIdStr<'static>,
    ) -> Result<Vec<UnusableKnob>> {
        // A stored task that no longer parses has no knobs to show.
        let Ok(program) = RoutineProgram::from_task(task) else {
            return Ok(Vec::new());
        };
        if !program
            .code_steps()
            .iter()
            .any(|step| step.entities().next().is_some())
        {
            return Ok(Vec::new());
        }
        let Some(entities) = &self.entities else {
            return Err(TargetValidationError::ItemsUnavailable.into());
        };
        unusable_knobs(entities.as_ref(), owner, &program)
            .await
            .map_err(|error| anyhow::anyhow!("could not check a routine's items: {error}"))
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

/// `task` without the fields only a task with steps or a copy keeps, when it
/// is a single agent's: its parser skips them, so they would be stored
/// unchecked and mean nothing. Main kept them, and clients send a stored
/// task back as they loaded it, so they are dropped rather than refused.
pub(super) fn without_fields_beside_agent(task: &Value) -> Value {
    let mut task = task.clone();
    if task.get("steps").is_none()
        && SubRoutineCopy::from_task(&task).is_none()
        && let Value::Object(fields) = &mut task
    {
        for field in ["sub_routines", "inputs", "sub_routine"] {
            fields.remove(field);
        }
    }
    task
}

/// Whether `task` has steps: only such a task defines sub-routines or holds
/// inputs; a single agent's are skipped by its parser and mean nothing.
pub(super) fn defines_steps(task: &Value) -> bool {
    task.get("steps").is_some_and(|steps| !steps.is_null())
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
    // inputs a detached copy's code reads. A single agent's are neither.
    for field in ["sub_routines", "inputs"] {
        if defines_steps(previous)
            && previous
                .get(field)
                .and_then(Value::as_array)
                .is_some_and(|items| !items.is_empty())
            && incoming.get(field).is_none()
        {
            return Err(TargetValidationError::ExplicitSubRoutinesRequired.into());
        }
    }
    // A definition sent back on update must restate its required apps.
    // Omitting the whole definition removes it on purpose.
    // Only a task with steps defines any: a single agent's are ignored.
    let definitions = |task: &Value| {
        defines_steps(task)
            .then(|| task.get("sub_routines").and_then(Value::as_array).cloned())
            .flatten()
            .unwrap_or_default()
    };
    let kept = definitions(incoming);
    for definition in definitions(previous) {
        let has_apps = definition
            .get("mcp_servers")
            .and_then(Value::as_array)
            .is_some_and(|servers| !servers.is_empty());
        if has_apps
            && kept.iter().any(|kept| {
                kept.get("name") == definition.get("name") && kept.get("mcp_servers").is_none()
            })
        {
            return Err(TargetValidationError::ExplicitAppsRequired.into());
        }
    }
    Ok(())
}

#[cfg(test)]
pub(crate) mod test;
