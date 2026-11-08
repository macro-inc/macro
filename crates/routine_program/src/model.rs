//! The program's data model and its stored JSON form.

use std::fmt;

use bots::domain::models::AgentMcpServer;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::knob::Knob;

#[cfg(test)]
mod test;

/// What a routine does each time it runs.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(deny_unknown_fields)]
pub struct RoutineProgram {
    /// Steps run in order. A failed step stops the run.
    pub steps: Vec<Step>,
    /// Apps the routine requires, handed to its agent on top of the agent's
    /// own. The owner must have each one connected to save the routine and
    /// for it to run.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub mcp_servers: Vec<AgentMcpServer>,
    /// Loaded from a single-agent task saved before programs existed, whose
    /// instructions had no length or blank limits; validation keeps it so.
    #[serde(skip)]
    pub(crate) single_agent_task: bool,
    /// The SDK its code steps were last type-checked against, recorded by
    /// the service that checked them. A run on another SDK checks them again
    /// before running them.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sdk: Option<SdkFingerprint>,
    /// Code steps write as the owner, with no agent badge: their posts,
    /// comments and emails appear written by the owner. Set only when the
    /// owner explicitly asked for the routine to act or send as them; by
    /// default code steps' writes are attributed to Macro's agent acting for
    /// the owner. Agent ("Ask AI") steps keep their own agent attribution
    /// either way: an agent session speaking as a person is a different
    /// change. A single agent task has no code steps, so it never applies.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub dangerously_operate_as_user: bool,
}

/// Who a routine's code steps write as.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum CodeIdentity {
    /// Macro's agent acting for the owner, with the owner's access: writes
    /// show as the agent's, from the owner.
    #[default]
    Agent,
    /// The owner: writes show as theirs, with no agent badge.
    Owner,
}

/// One step of a routine.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = RoutineStep))]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Step {
    /// Run TypeScript against Macro's SDK, as the routine owner.
    Code(CodeStep),
    /// Hand the run to a model or agent with instructions.
    Agent(AgentStep),
}

/// TypeScript written against Macro's SDK, usually by the AI that built the
/// routine. It is type-checked before it is saved and runs with its owner's
/// access.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(deny_unknown_fields)]
pub struct CodeStep {
    /// Names this step's output for later steps: `steps.<id>` in later code.
    /// Saving gives a step without one an id from its title, e.g.
    /// `label_invoices`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<StepId>,
    /// What the step does, in a few words, e.g. "Label invoices".
    pub title: String,
    /// One or two sentences on how, for the routine's owner.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub summary: String,
    /// A module exporting `async function main({ macro, run, routine,
    /// trigger, steps }: StepContext)`: `run` is this run (its time, zone and
    /// the previous run), `trigger` what started it (a schedule, an event and
    /// its item, or a person), `steps` the typed outputs of the steps before
    /// it. What `main` returns, as JSON of at most 64 KB, is the step's output.
    pub source: String,
    /// Values its owner can change without new code, which the code reads
    /// as `knobs.<name>`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub knobs: Vec<Knob>,
    /// What it does as one sentence for its owner, with `{name}` where a
    /// knob's value shows and `{?name}` where a question knob's question
    /// shows, e.g. "Label it {label} when {?aboutMoney}". Saving checks every
    /// slot names one of its knobs.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sentence: Option<String>,
}

impl CodeStep {
    /// Each knob's value by name: `main`'s `knobs`.
    pub fn knob_values(&self) -> serde_json::Map<String, Value> {
        self.knobs
            .iter()
            .map(|knob| (knob.name().to_string(), knob.value()))
            .collect()
    }

    /// The items its entity knobs name, each with the knob's label.
    pub fn entities(&self) -> impl Iterator<Item = (&str, &crate::EntityValue)> {
        self.knobs
            .iter()
            .filter_map(|knob| Some((knob.label(), knob.entity()?)))
    }
}

/// Identifies the SDK API code was type-checked against: its version and a
/// hash of its declarations, e.g. `0.2.2+18cc1c19c35c`.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(try_from = "String", into = "String")]
pub struct SdkFingerprint(pub(crate) String);

impl SdkFingerprint {
    /// The fingerprint as written.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for SdkFingerprint {
    type Error = BlankFingerprint;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        if value.trim().is_empty() {
            return Err(BlankFingerprint);
        }
        Ok(Self(value))
    }
}

impl From<SdkFingerprint> for String {
    fn from(fingerprint: SdkFingerprint) -> Self {
        fingerprint.0
    }
}

impl fmt::Display for SdkFingerprint {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

/// An SDK fingerprint that is empty or only whitespace.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("an SDK fingerprint must not be blank")]
pub struct BlankFingerprint;

/// Names a step's output: a lowercase letter, then up to 31 lowercase
/// letters, digits or underscores.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(try_from = "String", into = "String")]
pub struct StepId(String);

impl StepId {
    /// The id as written.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for StepId {
    type Error = InvalidStepId;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        let mut chars = value.chars();
        let valid = value.len() <= 32
            && chars.next().is_some_and(|first| first.is_ascii_lowercase())
            && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_');
        if valid {
            Ok(Self(value))
        } else {
            Err(InvalidStepId(value))
        }
    }
}

impl From<StepId> for String {
    fn from(id: StepId) -> Self {
        id.0
    }
}

impl fmt::Display for StepId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

/// A step id that is not a lowercase identifier.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error(
    "step id `{0}` must be a lowercase letter followed by up to 31 lowercase letters, digits or underscores"
)]
pub struct InvalidStepId(String);

/// Hand the run to a model running as Macro, or to an agent.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(deny_unknown_fields)]
pub struct AgentStep {
    /// Required when no agent is selected; otherwise overrides the agent's default model.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    /// The agent (persona) that runs, by `bot_id` from ListAgents.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent: Option<AgentSelection>,
    /// What the model or agent should do. It also sees the triggering event
    /// and what earlier steps in this run did.
    pub instructions: String,
}

/// A persona selection, independent of its runtime and current default model.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = AgentTaskAgent))]
#[serde(deny_unknown_fields)]
pub struct AgentSelection {
    /// The agent's bot id.
    #[cfg_attr(feature = "schema", schema(value_type = String, format = Uuid))]
    pub bot_id: Uuid,
}

/// A nonblank model identifier. Runtime catalogs, not the scheduler, own availability.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(try_from = "String", into = "String")]
pub struct RoutineModelId(String);

impl RoutineModelId {
    /// The id as written.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for RoutineModelId {
    type Error = BlankModelId;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        if value.trim().is_empty() {
            return Err(BlankModelId);
        }
        Ok(Self(value))
    }
}

impl From<RoutineModelId> for String {
    fn from(id: RoutineModelId) -> Self {
        id.0
    }
}

/// A model id that is empty or only whitespace.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("a supplied model must not be blank")]
pub struct BlankModelId;

/// The single agent task: how routines were stored before they had steps,
/// and still how a routine that is only an agent is saved.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct AgentTask {
    /// Required for model targets; overrides the persona default for agent targets.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<RoutineModelId>,
    /// Absent when using Macro's agent-session runtime with a selected model.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent: Option<AgentSelection>,
    /// Apps the routine requires on top of the agent's own. The owner must
    /// have each one connected to save the routine and for it to run.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub mcp_servers: Vec<AgentMcpServer>,
    /// Instructions placed before the user's.
    pub prompt: String,
    /// What the agent should do.
    pub user_prompt: String,
}

/// A stored task's two forms, as the scheduler's API describes `task`:
/// [`RoutineProgram::from_task`] reads them.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(untagged)]
pub enum RoutineTask {
    /// Steps, run in order.
    Program(RoutineProgram),
    /// A routine that is only an agent.
    Agent(AgentTask),
}

/// A stored task that is neither a program nor a pre-program agent task.
#[derive(Debug, thiserror::Error)]
#[error("invalid routine task: {0}")]
pub struct InvalidTask(#[from] serde_json::Error);

impl RoutineProgram {
    /// A program of `steps`, without apps or a checked SDK.
    pub fn new(steps: Vec<Step>) -> Self {
        Self {
            steps,
            mcp_servers: Vec::new(),
            single_agent_task: false,
            sdk: None,
            dangerously_operate_as_user: false,
        }
    }

    /// Read a stored task: a program (`{"steps": [...]}`), or the single agent
    /// task written before routines had steps, which becomes one agent step.
    pub fn from_task(task: &Value) -> Result<Self, InvalidTask> {
        if task.get("steps").is_some() {
            return Ok(serde_json::from_value(task.clone())?);
        }
        let legacy: AgentTask = serde_json::from_value(task.clone())?;
        let instructions = match legacy.prompt.trim() {
            "" => legacy.user_prompt,
            prompt => format!("{prompt}\n\n{}", legacy.user_prompt),
        };
        Ok(Self {
            steps: vec![Step::Agent(AgentStep {
                model: legacy.model.map(String::from),
                agent: legacy.agent,
                instructions,
            })],
            mcp_servers: legacy.mcp_servers,
            single_agent_task: true,
            sdk: None,
            dangerously_operate_as_user: false,
        })
    }

    /// Who its code steps write as.
    pub fn code_identity(&self) -> CodeIdentity {
        if self.dangerously_operate_as_user {
            CodeIdentity::Owner
        } else {
            CodeIdentity::Agent
        }
    }

    /// Every code step, mutably, in program order.
    pub fn code_steps_mut(&mut self) -> Vec<&mut CodeStep> {
        self.steps
            .iter_mut()
            .filter_map(|step| match step {
                Step::Code(step) => Some(step),
                Step::Agent(_) => None,
            })
            .collect()
    }

    /// Every code step, in program order.
    pub fn code_steps(&self) -> Vec<&CodeStep> {
        self.steps
            .iter()
            .filter_map(|step| match step {
                Step::Code(step) => Some(step),
                Step::Agent(_) => None,
            })
            .collect()
    }

    /// Every agent step, in program order.
    pub fn agent_steps(&self) -> Vec<&AgentStep> {
        self.steps
            .iter()
            .filter_map(|step| match step {
                Step::Agent(agent) => Some(agent),
                Step::Code(_) => None,
            })
            .collect()
    }

    /// The agent the run starts with, when its first step is one. Such a run
    /// opens its transcript before anything else happens.
    pub fn leading_agent(&self) -> Option<&AgentStep> {
        match self.steps.first() {
            Some(Step::Agent(agent)) => Some(agent),
            _ => None,
        }
    }
}
