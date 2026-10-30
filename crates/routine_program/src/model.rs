//! The program's data model and its stored JSON form.

use std::fmt;

use bots::domain::models::AgentMcpServer;
use jev::domain::YesNoQuestion;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use uuid::Uuid;

#[cfg(test)]
mod test;

/// What a routine does each time it runs.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
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
}

/// One step of a routine.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Step {
    /// Call one Macro tool with fixed arguments, as the routine owner.
    Tool(ToolStep),
    /// Ask a yes/no question about the triggering item, then run one branch.
    If(IfStep),
    /// Pick the option that best describes the triggering item, or every
    /// option that fits it, then run their steps.
    Choose(ChooseStep),
    /// Hand the run to a model or agent with instructions.
    Agent(AgentStep),
}

/// A deterministic call to one tool from Macro's catalog.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ToolStep {
    /// Names this step's output for later steps, e.g. `task` makes a created
    /// task's id available as `{{steps.task.documentId}}`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<StepId>,
    /// The tool to call.
    pub tool: RoutineTool,
    /// The tool's arguments, exactly as the tool documents them. String values
    /// may embed `{{trigger.<path>}}` (the triggering item, e.g.
    /// `{{trigger.entity_id}}` or `{{trigger.email.subject}}`) and
    /// `{{steps.<id>.<path>}}` (an earlier tool step's output). A string that
    /// is exactly one placeholder takes the referenced JSON value as is.
    pub arguments: Map<String, Value>,
}

/// Tools a routine may call unattended. Each one is a write whose effect the
/// owner chose when building the routine; reads and tools that need a person
/// to confirm them are not steps.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub enum RoutineTool {
    /// Add or remove one Gmail label on a thread: archive (remove INBOX), mark
    /// read (remove UNREAD), star (add STARRED), or apply a custom label.
    /// Arguments: `thread_id`, `label_id` (from ListLabels), `add`.
    UpdateThreadLabels,
    /// Treat a sender's future mail as signal, noise, or blocked.
    /// Arguments: `sender_email`, `policy` (`signal`, `noise` or `block`).
    SetSenderPolicy,
    /// Set a property on a task, document, email thread, channel or company:
    /// status, priority, assignees, due date, tags or any custom property.
    /// Arguments: `entity_id`, `entity_type`, `property_definition_id` and one value field.
    SetEntityProperty,
    /// Create a document or task. Arguments: `documentName`, `fileContent`,
    /// `fileExtension` (`md`), `isTask`, optional `projectId`. Output: `documentId`.
    CreateDocument,
    /// Comment on a document or task. Arguments: `documentId`, `content`.
    CommentOnDocument,
    /// Post a message in a channel, or reply in a thread.
    /// Arguments: `channel_id`, `content`, optional `thread_id`.
    SendChannelMessage,
    /// Move an item into a folder. Arguments: `entityType`, `entityId`, `projectId`.
    MoveToProject,
}

impl RoutineTool {
    /// Every tool a routine may call.
    pub const ALL: [Self; 7] = [
        Self::UpdateThreadLabels,
        Self::SetSenderPolicy,
        Self::SetEntityProperty,
        Self::CreateDocument,
        Self::CommentOnDocument,
        Self::SendChannelMessage,
        Self::MoveToProject,
    ];

    /// The catalog name the tool is registered under.
    pub const fn name(self) -> &'static str {
        match self {
            Self::UpdateThreadLabels => "UpdateThreadLabels",
            Self::SetSenderPolicy => "SetSenderPolicy",
            Self::SetEntityProperty => "SetEntityProperty",
            Self::CreateDocument => "CreateDocument",
            Self::CommentOnDocument => "CommentOnDocument",
            Self::SendChannelMessage => "SendChannelMessage",
            Self::MoveToProject => "MoveToProject",
        }
    }
}

impl fmt::Display for RoutineTool {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.name())
    }
}

/// Names a tool step's output: a lowercase letter, then up to 31 lowercase
/// letters, digits or underscores.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
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

/// Branch on a yes/no question about the triggering item.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IfStep {
    /// A yes/no question about the triggering item, e.g. "Is this email an invoice?"
    pub condition: YesNoQuestion,
    /// Steps to run when the answer is yes.
    #[serde(default)]
    pub then: Vec<Step>,
    /// Steps to run when the answer is no.
    #[serde(default, rename = "else", skip_serializing_if = "Vec::is_empty")]
    pub otherwise: Vec<Step>,
}

/// Run the steps of the option that best describes the triggering item, or
/// of every option that fits it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ChooseStep {
    /// What is being decided, e.g. "What kind of email is this?"
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub question: Option<String>,
    /// Two to eight distinct options. The best fitting option runs.
    pub options: Vec<ChoiceOption>,
    /// Run every option that fits, in order, instead of only the best one:
    /// e.g. apply each label that matches an email.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub multiple: bool,
    /// Steps to run when no option fits.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub otherwise: Vec<Step>,
}

/// One answer a choose step can pick.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ChoiceOption {
    /// Short name, e.g. "Invoice".
    pub label: String,
    /// What fits this option, e.g. "Bills, receipts and payment requests".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Steps to run when this option is chosen.
    #[serde(default)]
    pub steps: Vec<Step>,
}

/// Hand the run to a model running as Macro, or to an agent.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
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

/// A stored task that is neither a program nor a pre-program agent task.
#[derive(Debug, thiserror::Error)]
#[error("invalid routine task: {0}")]
pub struct InvalidTask(#[from] serde_json::Error);

impl RoutineProgram {
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
        })
    }

    /// Every agent step, in program order, including untaken branches.
    pub fn agent_steps(&self) -> Vec<&AgentStep> {
        let mut agents = Vec::new();
        visit(&self.steps, &mut |step| {
            if let Step::Agent(agent) = step {
                agents.push(agent);
            }
        });
        agents
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

impl Step {
    /// Nested step lists, in program order.
    pub fn branches(&self) -> Vec<&[Step]> {
        match self {
            Self::Tool(_) | Self::Agent(_) => Vec::new(),
            Self::If(step) => vec![&step.then, &step.otherwise],
            Self::Choose(step) => step
                .options
                .iter()
                .map(|option| option.steps.as_slice())
                .chain([step.otherwise.as_slice()])
                .collect(),
        }
    }
}

/// Visit every step in pre-order, including untaken branches.
pub(crate) fn visit<'a>(steps: &'a [Step], f: &mut impl FnMut(&'a Step)) {
    for step in steps {
        f(step);
        for branch in step.branches() {
            visit(branch, f);
        }
    }
}
