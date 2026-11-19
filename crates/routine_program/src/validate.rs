//! Structural rules every saved program follows.

use std::collections::HashSet;

use bots::domain::models::AgentMcpServer;

use crate::{
    knob::{EntityKind, Knob, SentenceSyntax, mentions, sentence_slots},
    model::{AgentStep, CodeStep, RoutineProgram, Step, StepId},
    sub_routine::{Input, MAX_INPUT_TEXT_CHARS, SubRoutineDefinition, SubRoutineName},
};

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
    /// Knobs on one code step.
    pub const MAX_KNOBS: usize = 12;
    /// Characters in a knob's label.
    pub const MAX_KNOB_LABEL_CHARS: usize = 60;
    /// Characters in a text knob's value.
    pub const MAX_KNOB_TEXT_CHARS: usize = 500;
    /// Characters in a question knob's question.
    pub const MAX_QUESTION_CHARS: usize = 300;
    /// Options a choice knob offers, at most; it offers at least two.
    pub const MAX_CHOICE_OPTIONS: usize = 12;
    /// Characters in one option of a choice knob.
    pub const MAX_OPTION_CHARS: usize = 60;
    /// Characters in a code step's sentence.
    pub const MAX_SENTENCE_CHARS: usize = 300;
    /// Sub-routines one routine defines.
    pub const MAX_SUB_ROUTINES: usize = 5;
    /// Code steps in one type check, one file each: the checker takes at most
    /// this many. A routine's check holds its sub-routines' code steps and
    /// its own; one of its copies made standalone holds them and its
    /// definition's again.
    pub const MAX_CODE_STEPS: usize = 40;
    /// Inputs of one routine or sub-routine.
    pub const MAX_INPUTS: usize = 12;
    /// Characters in an input's label.
    pub const MAX_INPUT_LABEL_CHARS: usize = 60;
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
    /// Too many knobs on one step.
    #[error("a code step can have at most {MAX_KNOBS} knobs")]
    TooManyKnobs,
    /// Two knobs with the same name.
    #[error("knob `{0}` is declared twice")]
    DuplicateKnob(String),
    /// A knob without a label, or with a long one.
    #[error("knob `{0}` needs a label of 1 to {MAX_KNOB_LABEL_CHARS} characters")]
    KnobLabel(String),
    /// A knob whose value or options don't fit its type.
    #[error("knob `{name}`: {reason}")]
    KnobValue {
        /// The knob.
        name: String,
        /// What is wrong, for the author.
        reason: String,
    },
    /// A knob the code never reads.
    #[error("knob `{0}` isn't used by the code; read it as `knobs.{0}` or remove it")]
    UnusedKnob(String),
    /// A long sentence.
    #[error("a step's sentence can be at most {MAX_SENTENCE_CHARS} characters")]
    SentenceTooLong,
    /// Braces in a sentence that aren't knob slots.
    #[error("{0}")]
    SentenceSyntax(#[from] SentenceSyntax),
    /// A sentence slot that names no knob.
    #[error("the sentence shows `{0}`, but the step has no knob by that name")]
    SentenceUnknownKnob(String),
    /// A slot written the wrong way for its knob.
    #[error(
        "in the sentence, write question knob `{0}` as `{{?{0}}}`, and other knobs as `{{{0}}}`"
    )]
    SentenceSlotKind(String),
    /// More sub-routines than a routine may define.
    #[error("a routine can define at most {MAX_SUB_ROUTINES} sub-routines")]
    TooManySubRoutines,
    /// More code steps than one check takes, in the routine or in one of its
    /// copies made standalone.
    #[error(
        "too many code steps: the sub-routines' code steps, plus the routine's own or its largest \
         sub-routine's, whichever has more, can be at most {MAX_CODE_STEPS}"
    )]
    TooManyCodeSteps,
    /// Two sub-routines with the same name.
    #[error("sub-routine `{0}` is defined twice")]
    DuplicateSubRoutine(SubRoutineName),
    /// A sub-routine without a title, with a long one, or with a NUL in it.
    #[error("a sub-routine needs a title of 1 to {MAX_TITLE_CHARS} characters, without NUL")]
    SubRoutineTitle,
    /// A rule one of the routine's sub-routines breaks.
    #[error("in sub-routine `{name}`: {error}")]
    InSubRoutine {
        /// The sub-routine.
        name: SubRoutineName,
        /// The rule it breaks.
        error: Box<ProgramError>,
    },
    /// Too many inputs.
    #[error("a routine or sub-routine can have at most {MAX_INPUTS} inputs")]
    TooManyInputs,
    /// Two inputs with the same name.
    #[error("input `{0}` is declared twice")]
    DuplicateInput(String),
    /// An input without a label, with a long one, or with a NUL in it.
    #[error("input `{0}` needs a label of 1 to {MAX_INPUT_LABEL_CHARS} characters, without NUL")]
    InputLabel(String),
    /// An input whose value is missing, unexpected or doesn't fit.
    #[error("input `{name}`: {reason}")]
    InputValue {
        /// The input.
        name: String,
        /// What is wrong, for the author.
        reason: String,
    },
    /// Text anywhere in the routine with a NUL in it.
    #[error("text in a routine can't hold a NUL character")]
    Nul,
}

impl RoutineProgram {
    /// Check every structural rule, the sub-routines it defines included.
    pub fn validate(&self) -> Result<(), ProgramError> {
        steps(&self.steps, &self.mcp_servers, self.single_agent_task)?;
        inputs(&self.inputs, Values::Required)?;
        if self.sub_routines.len() > MAX_SUB_ROUTINES {
            return Err(ProgramError::TooManySubRoutines);
        }
        let mut names = HashSet::new();
        for definition in &self.sub_routines {
            if !names.insert(&definition.name) {
                return Err(ProgramError::DuplicateSubRoutine(definition.name.clone()));
            }
            sub_routine(definition).map_err(|error| ProgramError::InSubRoutine {
                name: definition.name.clone(),
                error: Box::new(error),
            })?;
        }
        // The sub-routines' code is checked with the routine's own, and with
        // each one's again when its copy is made standalone, keeping them all.
        let code = |steps: &[Step]| {
            steps
                .iter()
                .filter(|step| matches!(step, Step::Code(_)))
                .count()
        };
        let defined: Vec<usize> = self
            .sub_routines
            .iter()
            .map(|definition| code(&definition.steps))
            .collect();
        let most = defined.iter().copied().fold(code(&self.steps), usize::max);
        if defined.iter().sum::<usize>() + most > MAX_CODE_STEPS {
            return Err(ProgramError::TooManyCodeSteps);
        }
        // Postgres can't store a NUL in JSON text, and its refusal would
        // quote the text beside it into an error that gets logged.
        if serde_json::to_value(self).is_ok_and(|program| holds_nul(&program)) {
            return Err(ProgramError::Nul);
        }
        Ok(())
    }
}

/// Whether any string in `value`, a key included, holds a NUL, which
/// Postgres refuses to store in JSON.
pub fn holds_nul(value: &serde_json::Value) -> bool {
    match value {
        serde_json::Value::String(text) => text.contains('\0'),
        serde_json::Value::Array(items) => items.iter().any(holds_nul),
        serde_json::Value::Object(fields) => fields
            .iter()
            .any(|(key, value)| key.contains('\0') || holds_nul(value)),
        _ => false,
    }
}

/// A routine's own steps, or a sub-routine's: each step's rules, ids unique
/// among them, at most one agent, and apps only for an agent.
fn steps(
    steps: &[Step],
    mcp_servers: &[AgentMcpServer],
    single_agent_task: bool,
) -> Result<(), ProgramError> {
    if steps.is_empty() {
        return Err(ProgramError::Empty);
    }
    if steps.len() > MAX_STEPS {
        return Err(ProgramError::TooManySteps);
    }
    let mut check = Check {
        single_agent_task,
        ..Check::default()
    };
    for step in steps {
        check.step(step)?;
    }
    let agents = steps
        .iter()
        .filter(|step| matches!(step, Step::Agent(_)))
        .count();
    if agents > 1 {
        return Err(ProgramError::TooManyAgents);
    }
    if !mcp_servers.is_empty() && agents == 0 {
        return Err(ProgramError::AppsWithoutAgent);
    }
    Ok(())
}

fn sub_routine(definition: &SubRoutineDefinition) -> Result<(), ProgramError> {
    // A NUL can't be stored, and the database's refusal would quote the
    // values beside it.
    let title = definition.title.trim().chars().count();
    if title == 0 || title > MAX_TITLE_CHARS || definition.title.contains('\0') {
        return Err(ProgramError::SubRoutineTitle);
    }
    steps(&definition.steps, &definition.mcp_servers, false)?;
    inputs(&definition.inputs, Values::Forbidden)
}

/// Whether inputs hold values: a routine's own do, the copy's it was kept
/// from; a sub-routine's don't, since each copy is given its own.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Values {
    Required,
    Forbidden,
}

fn inputs(inputs: &[Input], values: Values) -> Result<(), ProgramError> {
    if inputs.len() > MAX_INPUTS {
        return Err(ProgramError::TooManyInputs);
    }
    let mut names = HashSet::new();
    for input in inputs {
        let name = input.name().as_str();
        if !names.insert(name) {
            return Err(ProgramError::DuplicateInput(name.to_owned()));
        }
        let label = input.label().trim().chars().count();
        if label == 0 || label > MAX_INPUT_LABEL_CHARS || input.label().contains('\0') {
            return Err(ProgramError::InputLabel(name.to_owned()));
        }
        input_value(input, values).map_err(|reason| ProgramError::InputValue {
            name: name.to_owned(),
            reason: reason.to_owned(),
        })?;
    }
    Ok(())
}

fn input_value(input: &Input, values: Values) -> Result<(), &'static str> {
    match (values, input) {
        (Values::Forbidden, _) if input.value().is_some() => {
            Err("a sub-routine's input gets its value when a copy is scheduled; remove `value`")
        }
        (Values::Forbidden, _) => Ok(()),
        (
            Values::Required,
            Input::Number {
                value: Some(number),
                ..
            },
        ) if !number.is_finite() => Err("numbers must be finite"),
        (
            Values::Required,
            Input::Text {
                value: Some(text), ..
            },
        ) if text.chars().count() > MAX_INPUT_TEXT_CHARS => Err("text is too long"),
        (
            Values::Required,
            Input::Text {
                value: Some(text), ..
            },
        ) if text.contains('\0') => Err("text can't hold a NUL character"),
        (Values::Required, _) if input.value().is_none() => Err("a routine's input needs a value"),
        (Values::Required, _) => Ok(()),
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

impl CodeStep {
    /// The rules a code step follows on its own: its title and source, its
    /// knobs, and its sentence.
    pub fn validate(&self) -> Result<(), ProgramError> {
        code_step(self)
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
    knobs(code)?;
    sentence(code)
}

/// Each knob fits its type and the code reads it.
fn knobs(code: &CodeStep) -> Result<(), ProgramError> {
    if code.knobs.len() > MAX_KNOBS {
        return Err(ProgramError::TooManyKnobs);
    }
    let mut names = HashSet::new();
    for knob in &code.knobs {
        let name = knob.name().as_str();
        if !names.insert(name) {
            return Err(ProgramError::DuplicateKnob(name.to_owned()));
        }
        let label = knob.label().trim().chars().count();
        if label == 0 || label > MAX_KNOB_LABEL_CHARS {
            return Err(ProgramError::KnobLabel(name.to_owned()));
        }
        knob_value(knob).map_err(|reason| ProgramError::KnobValue {
            name: name.to_owned(),
            reason: reason.to_owned(),
        })?;
        if !mentions(&code.source, name) {
            return Err(ProgramError::UnusedKnob(name.to_owned()));
        }
    }
    Ok(())
}

fn knob_value(knob: &Knob) -> Result<(), String> {
    match knob {
        Knob::Text { value, .. } if value.chars().count() > MAX_KNOB_TEXT_CHARS => Err(format!(
            "text can be at most {MAX_KNOB_TEXT_CHARS} characters"
        )),
        Knob::Question { value, .. }
            if value.trim().is_empty() || value.chars().count() > MAX_QUESTION_CHARS =>
        {
            Err(format!(
                "a question needs 1 to {MAX_QUESTION_CHARS} characters"
            ))
        }
        Knob::Number {
            value, min, max, ..
        } => {
            let bounds = [Some(*value), *min, *max];
            if bounds.iter().flatten().any(|number| !number.is_finite()) {
                return Err("numbers must be finite".to_owned());
            }
            if let (Some(min), Some(max)) = (min, max)
                && min > max
            {
                return Err("its min is above its max".to_owned());
            }
            if min.is_some_and(|min| *value < min) || max.is_some_and(|max| *value > max) {
                return Err("its value is outside its min and max".to_owned());
            }
            Ok(())
        }
        Knob::Choice { value, options, .. } => {
            if options.len() < 2 || options.len() > MAX_CHOICE_OPTIONS {
                return Err(format!("a choice offers 2 to {MAX_CHOICE_OPTIONS} options"));
            }
            let mut seen = HashSet::new();
            for option in options {
                let length = option.trim().chars().count();
                if length == 0 || length > MAX_OPTION_CHARS || !seen.insert(option.as_str()) {
                    return Err(format!(
                        "options must be distinct, with 1 to {MAX_OPTION_CHARS} characters each"
                    ));
                }
            }
            if !options.contains(value) {
                return Err("its value must be one of its options".to_owned());
            }
            Ok(())
        }
        Knob::Entity {
            entity_types,
            value,
            ..
        } => {
            let distinct: HashSet<_> = entity_types.iter().collect();
            if entity_types.is_empty() || distinct.len() != entity_types.len() {
                return Err("it must allow one or more kinds of item, each once".to_owned());
            }
            // Databases have their own picker, which offers nothing else.
            if entity_types.contains(&EntityKind::Database) && entity_types.len() > 1 {
                return Err("a database knob allows only databases".to_owned());
            }
            if value
                .as_ref()
                .is_some_and(|value| !entity_types.contains(&value.kind))
            {
                return Err("its value must be one of the kinds it allows".to_owned());
            }
            Ok(())
        }
        Knob::Text { .. } | Knob::Question { .. } | Knob::Boolean { .. } => Ok(()),
    }
}

/// Every slot in the sentence names one of the step's knobs, written the
/// way its kind shows.
fn sentence(code: &CodeStep) -> Result<(), ProgramError> {
    let Some(sentence) = &code.sentence else {
        return Ok(());
    };
    if sentence.chars().count() > MAX_SENTENCE_CHARS {
        return Err(ProgramError::SentenceTooLong);
    }
    for slot in sentence_slots(sentence)? {
        let knob = code
            .knobs
            .iter()
            .find(|knob| knob.name().as_str() == slot.name)
            .ok_or_else(|| ProgramError::SentenceUnknownKnob(slot.name.clone()))?;
        if knob.is_question() != slot.question {
            return Err(ProgramError::SentenceSlotKind(slot.name));
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
