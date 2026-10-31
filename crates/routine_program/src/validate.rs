//! Structural rules every saved program follows.

use std::collections::HashSet;

use jev::domain::QuestionError;

use crate::model::{AgentStep, RoutineProgram, Step, StepId};
use crate::plan::choice_question;
use crate::template::{self, Reference, TemplateError};

#[cfg(test)]
mod test;

/// Bounds on a program's size, so a run stays inside its deadline and one
/// classifier call answers every decision.
pub mod limits {
    /// Steps in the whole program, including nested ones.
    pub const MAX_STEPS: usize = 40;
    /// Nesting depth of decisions.
    pub const MAX_DEPTH: usize = 4;
    /// Options per choose step.
    pub const MAX_OPTIONS: usize = 8;
    /// Questions across all decisions; one classifier call answers them all.
    pub const MAX_QUESTIONS: usize = jev::domain::MAX_QUESTIONS;
    /// Characters in an option label.
    pub const MAX_LABEL_CHARS: usize = 80;
    /// Characters in an option description or a choose step's question.
    pub const MAX_DESCRIPTION_CHARS: usize = 200;
    /// Serialized bytes of one tool step's arguments.
    pub const MAX_ARGUMENT_BYTES: usize = 16 * 1024;
    /// Characters in an agent step's instructions.
    pub const MAX_INSTRUCTION_CHARS: usize = 20_000;
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
    /// Decisions nested too deeply.
    #[error("decisions can be nested at most {MAX_DEPTH} levels deep")]
    TooDeep,
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
    /// Two agents could run in one run.
    #[error("a run can hand off to at most one agent; put agents in different branches")]
    TooManyAgents,
    /// Required apps with no agent to hand them to.
    #[error("apps a routine requires are for its agent; add an agent step or remove the apps")]
    AppsWithoutAgent,
    /// A choose step with too few or too many options.
    #[error("a choice needs between 2 and {MAX_OPTIONS} options")]
    OptionCount,
    /// A blank or long option label.
    #[error("option labels need between 1 and {MAX_LABEL_CHARS} characters")]
    OptionLabel,
    /// Two options with the same label.
    #[error("option \"{0}\" appears twice in one choice")]
    DuplicateOption(String),
    /// A long option description or choose question.
    #[error(
        "choice questions and option descriptions can be at most {MAX_DESCRIPTION_CHARS} characters"
    )]
    DescriptionTooLong,
    /// A question the classifier cannot take.
    #[error("invalid question: {0}")]
    Question(#[from] QuestionError),
    /// More questions than one classifier call answers.
    #[error(
        "decisions can ask at most {MAX_QUESTIONS} questions; each option of a choice is one question"
    )]
    TooManyQuestions,
    /// Oversized tool arguments.
    #[error("tool arguments can be at most {MAX_ARGUMENT_BYTES} bytes")]
    ArgumentsTooLarge,
    /// Two steps with the same id.
    #[error("step id `{0}` is used twice")]
    DuplicateStepId(StepId),
    /// A placeholder naming no step that runs before it on every path.
    #[error(
        "`{{{{steps.{0}…}}}}` must name a tool step that always runs before it: earlier in the same list, or before the decision it sits in"
    )]
    UnknownStep(StepId),
    /// A placeholder that cannot be read.
    #[error(transparent)]
    Template(#[from] TemplateError),
}

/// Facts about a valid program that its routine's triggers must support.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct ProgramSummary {
    /// Questions its decisions ask about the triggering item.
    pub questions: usize,
    /// Whether a tool argument reads the triggering item.
    pub reads_trigger: bool,
}

impl ProgramSummary {
    /// Whether the program only makes sense when an event triggered the run.
    pub fn needs_event(self) -> bool {
        self.questions > 0 || self.reads_trigger
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
        check.steps(&self.steps, 0)?;
        if check.count > MAX_STEPS {
            return Err(ProgramError::TooManySteps);
        }
        if max_agents(&self.steps) > 1 {
            return Err(ProgramError::TooManyAgents);
        }
        if !self.mcp_servers.is_empty() && self.agent_steps().is_empty() {
            return Err(ProgramError::AppsWithoutAgent);
        }
        let questions = self.questions()?.len();
        if questions > MAX_QUESTIONS {
            return Err(ProgramError::TooManyQuestions);
        }
        Ok(ProgramSummary {
            questions,
            reads_trigger: check.reads_trigger,
        })
    }
}

#[derive(Default)]
struct Check {
    count: usize,
    /// Every step id in the program, which must be unique.
    ids: HashSet<StepId>,
    /// Step ids whose outputs a step at the current position can read.
    visible: Vec<StepId>,
    reads_trigger: bool,
    single_agent_task: bool,
}

impl Check {
    /// `{{steps.<id>…}}` names a tool step that runs before it on every path
    /// to it: earlier in the same list, or earlier in a list that encloses it.
    /// A branch's steps are visible only inside that branch, so neither a
    /// sibling branch (`then`/`else`, another option) nor anything after the
    /// decision can read them; the branch may not have run.
    fn steps(&mut self, steps: &[Step], depth: usize) -> Result<(), ProgramError> {
        if depth > MAX_DEPTH {
            return Err(ProgramError::TooDeep);
        }
        for step in steps {
            self.count += 1;
            self.step(step)?;
            for branch in step.branches() {
                let scope = self.visible.len();
                self.steps(branch, depth + 1)?;
                self.visible.truncate(scope);
            }
        }
        Ok(())
    }

    fn step(&mut self, step: &Step) -> Result<(), ProgramError> {
        match step {
            Step::Agent(agent) => agent_step(agent, self.single_agent_task),
            Step::If(_) => Ok(()),
            Step::Choose(choose) => {
                if !(2..=MAX_OPTIONS).contains(&choose.options.len()) {
                    return Err(ProgramError::OptionCount);
                }
                if chars(choose.question.as_deref()) > MAX_DESCRIPTION_CHARS {
                    return Err(ProgramError::DescriptionTooLong);
                }
                let mut labels = HashSet::new();
                for option in &choose.options {
                    let label = option.label.trim();
                    if label.is_empty() || label.chars().count() > MAX_LABEL_CHARS {
                        return Err(ProgramError::OptionLabel);
                    }
                    if !labels.insert(label.to_lowercase()) {
                        return Err(ProgramError::DuplicateOption(label.to_owned()));
                    }
                    if chars(option.description.as_deref()) > MAX_DESCRIPTION_CHARS {
                        return Err(ProgramError::DescriptionTooLong);
                    }
                    choice_question(choose, option)?;
                }
                Ok(())
            }
            Step::Tool(tool) => {
                let arguments = serde_json::Value::Object(tool.arguments.clone());
                if arguments.to_string().len() > MAX_ARGUMENT_BYTES {
                    return Err(ProgramError::ArgumentsTooLarge);
                }
                for reference in template::references(&arguments)? {
                    match reference {
                        Reference::Trigger(_) => self.reads_trigger = true,
                        Reference::Step { id, .. } if !self.visible.contains(&id) => {
                            return Err(ProgramError::UnknownStep(id));
                        }
                        Reference::Step { .. } => {}
                    }
                }
                // Registered after its own arguments: a step cannot read itself.
                if let Some(id) = &tool.id {
                    if !self.ids.insert(id.clone()) {
                        return Err(ProgramError::DuplicateStepId(id.clone()));
                    }
                    self.visible.push(id.clone());
                }
                Ok(())
            }
        }
    }
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

fn chars(text: Option<&str>) -> usize {
    text.map_or(0, |text| text.trim().chars().count())
}

/// The most agents any one run can reach: sequences add up, branches don't,
/// except the options of a choice that runs every option that fits.
fn max_agents(steps: &[Step]) -> usize {
    steps
        .iter()
        .map(|step| match step {
            Step::Agent(_) => 1,
            Step::Tool(_) => 0,
            Step::Choose(choose) if choose.multiple => {
                let options = choose
                    .options
                    .iter()
                    .map(|option| max_agents(&option.steps))
                    .sum();
                max_agents(&choose.otherwise).max(options)
            }
            other => other
                .branches()
                .into_iter()
                .map(max_agents)
                .max()
                .unwrap_or(0),
        })
        .sum()
}
