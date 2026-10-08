use agent_session::domain::model::AgentSessionId;
use bot_id::BotId;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::ToSchema;

/// Caller-selected UUID persisted in tool input before execution begins.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema, ToSchema)]
#[serde(transparent)]
pub struct ExecutionId(#[schemars(with = "String")] Uuid);

impl ExecutionId {
    /// Mint an execution identity.
    pub fn mint() -> Self {
        Self(macro_uuid::generate_uuid_v7())
    }
    /// Read a UUID from an authenticated route.
    pub fn from_uuid(id: Uuid) -> Self {
        Self(id)
    }
    /// Storage identity.
    pub fn as_uuid(self) -> Uuid {
        self.0
    }
}

impl std::fmt::Display for ExecutionId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(f)
    }
}

/// Identity copied from the authenticated session, never from program arguments.
#[derive(Clone)]
pub struct ExecutionIdentity {
    /// Session whose owner authorized this execution.
    pub session: AgentSessionId,
    /// User whose permissions the tools enforce.
    pub owner: MacroUserIdStr<'static>,
    /// Bot to attribute writes to.
    pub bot: BotId,
    /// The server-resolved turn. Work cannot outlive or move to another turn.
    pub turn: Uuid,
}

/// SDK method documentation derived from the registered tool's schemas.
#[derive(Clone, Serialize, Deserialize, JsonSchema)]
pub struct ToolDocumentation {
    /// The exact method name in `sdk.<name>(input)`.
    pub name: String,
    /// Existing tool description, including use-case guidance.
    pub description: String,
    /// Full input JSON schema, including any definitions it references.
    pub input_schema: Value,
    /// Full output JSON schema.
    pub output_schema: Value,
    /// Whether execution waits for a human to finish the operation.
    #[serde(skip)]
    pub user_tool: bool,
}

/// The recorded outcome of a program.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ExecutionStatus {
    /// Execution has been admitted; a process interruption may leave it here.
    Running,
    /// The program returned a JSON value.
    Succeeded,
    /// Compilation, dispatch, or execution failed.
    Failed,
    /// The caller cancelled execution.
    Cancelled,
    /// The deadline elapsed.
    TimedOut,
}

/// A real inner call, recorded by trusted dispatch for the existing renderers.
#[derive(Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RecordedToolCall {
    /// Stable, execution-scoped component identity.
    pub id: String,
    /// Canonical Macro tool name from the allowlisted registry.
    pub name: String,
    /// Arguments passed to the actual tool.
    pub input: Value,
    /// Original tool output, retained independently of the program's return value.
    pub output: Option<Value>,
    /// Whether the response was omitted to keep the durable journal bounded.
    pub output_omitted: bool,
    /// Safe tool failure, if one was returned.
    pub error: Option<String>,
    /// A started call that never replied has an unknown side-effect outcome.
    pub status: RecordedCallStatus,
}

/// A dispatch result; unfinished work is never reported as success.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum RecordedCallStatus {
    /// The dispatcher is still awaiting the tool.
    Running,
    /// A successful response was observed.
    Completed,
    /// The tool returned an error.
    Failed,
    /// Execution ended before a response was observed.
    Unknown,
}

/// Durable UI record. This is never included in the model's tool result.
#[derive(Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionRecord {
    /// Execution identity.
    pub execution_id: ExecutionId,
    /// The submitted async TypeScript function body.
    pub source: String,
    /// Overall execution state.
    pub status: ExecutionStatus,
    /// JSON returned by the program, if successful.
    pub result: Option<Value>,
    /// Safe execution failure text.
    pub error: Option<String>,
    /// Actual tool calls in dispatch order.
    pub calls: Vec<RecordedToolCall>,
}

/// Compact model result with an identity the UI uses to load the durable record.
#[derive(Clone, Serialize, Deserialize, JsonSchema, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionReceipt {
    /// Reference to the session's durable rendering record.
    pub execution_id: ExecutionId,
    /// Recorded outcome (running only when recovering an in-flight execution).
    pub status: ExecutionStatus,
    /// Only the value explicitly returned by the program.
    pub result: Option<Value>,
    /// Safe failure text, when execution did not succeed.
    pub error: Option<String>,
}

/// Safe service errors, separate from failures returned by a running program.
#[derive(Debug, thiserror::Error)]
pub enum CodeModeError {
    /// The deployment has not configured its private runner.
    #[error("code execution is not configured")]
    Unavailable,
    /// The authenticated principal cannot execute or read this session's record.
    #[error("code execution is not authorized for this session")]
    Forbidden,
    /// No record belongs to this session and execution pair.
    #[error("code execution not found")]
    NotFound,
    /// A submitted identity cannot replay an execution or replace its journal.
    #[error("execution_id was already used; execution was not started")]
    Duplicate,
    /// Invalid source, deadline, or discovery arguments.
    #[error("{0}")]
    Invalid(String),
    /// Admission is bounded before starting work.
    #[error("code execution is busy; try again later")]
    Busy,
    /// A persistence operation failed; details stay in server diagnostics.
    #[error("could not persist code execution")]
    Storage(rootcause::Report),
    /// The supervised request task failed unexpectedly.
    #[error("code execution task failed")]
    Task(#[source] tokio::task::JoinError),
}
