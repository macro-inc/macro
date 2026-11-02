//! Structural rules every saved program follows.

use std::collections::HashSet;

use crate::model::{AgentStep, CodeStep, RoutineProgram, Step, StepId};
use crate::template::{self, Reference, TemplateError};

#[cfg(test)]
mod test;

/// Bounds on a program's size, so a run stays inside its deadline.
pub mod limits {
    /// Steps in the program.
    pub const MAX_STEPS: usize = 40;
    /// Serialized bytes of one tool step's arguments.
    pub const MAX_ARGUMENT_BYTES: usize = 16 * 1024;
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
    /// Oversized tool arguments.
    #[error("tool arguments can be at most {MAX_ARGUMENT_BYTES} bytes")]
    ArgumentsTooLarge,
    /// Two steps with the same id.
    #[error("step id `{0}` is used twice")]
    DuplicateStepId(StepId),
    /// A placeholder naming no step before it.
    #[error("`{{{{steps.{0}…}}}}` must name a tool or code step before it")]
    UnknownStep(StepId),
    /// A placeholder that cannot be read.
    #[error(transparent)]
    Template(#[from] TemplateError),
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

/// Facts about a valid program that its routine's triggers must support.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct ProgramSummary {
    /// Whether a tool argument reads the triggering item.
    pub reads_trigger: bool,
}

impl ProgramSummary {
    /// Whether the program only makes sense when an event triggered the run.
    pub fn needs_event(self) -> bool {
        self.reads_trigger
    }
}

impl RoutineProgram {
    /// Check every structural rule and summarize what the program needs.
    pub fn validate(&self) -> Result<ProgramSummary, ProgramError> {
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
        Ok(ProgramSummary {
            reads_trigger: check.reads_trigger,
        })
    }
}

#[derive(Default)]
struct Check {
    /// Ids of the steps so far, which must be unique; `{{steps.<id>…}}` can
    /// read only these.
    ids: HashSet<StepId>,
    reads_trigger: bool,
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
            Step::Tool(tool) => {
                let arguments = serde_json::Value::Object(tool.arguments.clone());
                if arguments.to_string().len() > MAX_ARGUMENT_BYTES {
                    return Err(ProgramError::ArgumentsTooLarge);
                }
                for reference in template::references(&arguments)? {
                    match reference {
                        Reference::Trigger(_) => self.reads_trigger = true,
                        Reference::Step { id, .. } if !self.ids.contains(&id) => {
                            return Err(ProgramError::UnknownStep(id));
                        }
                        Reference::Step { .. } => {}
                    }
                }
                // Registered after its own arguments: a step cannot read itself.
                self.name(tool.id.as_ref())
            }
        }
    }

    /// A step's id becomes readable by the steps after it.
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
