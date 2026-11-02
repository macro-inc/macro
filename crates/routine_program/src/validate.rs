//! Structural rules every saved program follows.

use std::collections::HashSet;

use crate::model::{AgentStep, CodeStep, RoutineProgram, Step, StepId};

#[cfg(test)]
mod test;

/// Bounds on a program's size, so a run stays inside its deadline.
pub mod limits {
    /// Steps in the program.
    pub const MAX_STEPS: usize = 40;
    /// Characters in an agent step's instructions.
    pub const MAX_INSTRUCTION_CHARS: usize = 20_000;
    /// Characters in a code step's title.
    pub const MAX_TITLE_CHARS: usize = 80;
    /// Characters in a code step's summary.
    pub const MAX_SUMMARY_CHARS: usize = 300;
    /// Bytes of a code step's source; the executor's own limit.
    pub const MAX_SOURCE_BYTES: usize = 64 * 1024;
}

use limits::*;

/// Why a program cannot be saved. Messages are written for the person or
/// model building the routine.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ProgramError {
    /// No steps at all.
    #[error("add at least one step")]
    Empty,
    /// Too many steps.
    #[error("a routine can have at most {MAX_STEPS} steps")]
    TooManySteps,
    /// An agent step without instructions.
    #[error("agent steps need instructions")]
    BlankInstructions,
    /// Instructions over the limit.
    #[error("agent instructions can be at most {MAX_INSTRUCTION_CHARS} characters")]
    InstructionsTooLong,
    /// An agent step with neither a model nor an agent.
    #[error("agent steps need a model or an agent")]
    MissingTarget,
    /// A blank model id.
    #[error("agent steps need a nonblank model id")]
    BlankModel,
    /// More than one agent step.
    #[error("a routine can hand off to at most one agent")]
    TooManyAgents,
    /// Required apps with no agent to hand them to.
    #[error("apps a routine requires are for its agent; add an agent step or remove the apps")]
    AppsWithoutAgent,
    /// Two steps with the same id.
    #[error("step id `{0}` is used twice")]
    DuplicateStepId(StepId),
    /// A code step without a title, or with a long one.
    #[error("code steps need a title of 1 to {MAX_TITLE_CHARS} characters")]
    CodeTitle,
    /// A long code step summary.
    #[error("code step summaries can be at most {MAX_SUMMARY_CHARS} characters")]
    SummaryTooLong,
    /// A code step without code, or with too much.
    #[error("code steps need source of at most {MAX_SOURCE_BYTES} bytes")]
    CodeSource,
    /// A write scope listed twice.
    #[error("a code step lists `{0}` in writes twice")]
    DuplicateWriteScope(String),
}

impl RoutineProgram {
    /// Check every structural rule.
    pub fn validate(&self) -> Result<(), ProgramError> {
        if self.steps.is_empty() {
            return Err(ProgramError::Empty);
        }
        let mut check = Check {
            single_agent_task: self.single_agent_task,
            ..Check::default()
        };
        if self.steps.len() > MAX_STEPS {
            return Err(ProgramError::TooManySteps);
        }
        for step in &self.steps {
            check.step(step)?;
        }
        if self.agent_steps().len() > 1 {
            return Err(ProgramError::TooManyAgents);
        }
        if !self.mcp_servers.is_empty() && self.agent_steps().is_empty() {
            return Err(ProgramError::AppsWithoutAgent);
        }
        Ok(())
    }
}

#[derive(Default)]
struct Check {
    /// Ids of the steps so far, which must be unique.
    ids: HashSet<StepId>,
    single_agent_task: bool,
}

impl Check {
    fn step(&mut self, step: &Step) -> Result<(), ProgramError> {
        match step {
            Step::Agent(agent) => agent_step(agent, self.single_agent_task),
            Step::Code(code) => {
                code_step(code)?;
                self.name(code.id.as_ref())
            }
        }
    }

    /// A step's id, unique in the routine.
    fn name(&mut self, id: Option<&StepId>) -> Result<(), ProgramError> {
        if let Some(id) = id
            && !self.ids.insert(id.clone())
        {
            return Err(ProgramError::DuplicateStepId(id.clone()));
        }
        Ok(())
    }
}

fn code_step(code: &CodeStep) -> Result<(), ProgramError> {
    let title = code.title.trim();
    if title.is_empty() || title.chars().count() > MAX_TITLE_CHARS {
        return Err(ProgramError::CodeTitle);
    }
    if code.summary.trim().chars().count() > MAX_SUMMARY_CHARS {
        return Err(ProgramError::SummaryTooLong);
    }
    if code.source.trim().is_empty() || code.source.len() > MAX_SOURCE_BYTES {
        return Err(ProgramError::CodeSource);
    }
    let mut scopes = HashSet::new();
    for scope in &code.writes {
        if !scopes.insert(scope) {
            return Err(ProgramError::DuplicateWriteScope(scope.as_str().to_owned()));
        }
    }
    Ok(())
}

/// An old single-agent task keeps the rules it was saved under: its target
/// must resolve, but its instructions may be blank or long.
fn agent_step(agent: &AgentStep, single_agent_task: bool) -> Result<(), ProgramError> {
    if !single_agent_task && agent.instructions.trim().is_empty() {
        return Err(ProgramError::BlankInstructions);
    }
    if !single_agent_task && agent.instructions.chars().count() > MAX_INSTRUCTION_CHARS {
        return Err(ProgramError::InstructionsTooLong);
    }
    match (&agent.agent, &agent.model) {
        (_, Some(model)) if model.trim().is_empty() => Err(ProgramError::BlankModel),
        (None, None) => Err(ProgramError::MissingTarget),
        _ => Ok(()),
    }
}
