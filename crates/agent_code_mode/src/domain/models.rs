use agent_session::domain::model::AgentSessionId;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::ToSchema;

/// Caller-selected UUID persisted in tool input before execution begins.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema, ToSchema, specta::Type,
)]
#[serde(transparent)]
pub struct ExecutionId(
    #[schemars(with = "String")]
    #[specta(type = String)]
    Uuid,
);

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

/// Trusted session identity and the explicit, unresolved account choice.
#[derive(Clone)]
pub struct ExecutionIdentity {
    /// Run identity supplied by the session execution service.
    pub execution: ExecutionId,
    /// Explicit account choice for this execution.
    pub acting_as: ai_toolset::actor::ToolActor,
    /// Session whose owner authorized this execution.
    pub session: AgentSessionId,
    /// Session owner; credential issuance resolves acting_as against the verified turn.
    pub owner: MacroUserIdStr<'static>,
    /// Agent from the authenticated session, used to attribute SDK messages.
    pub agent_id: bot_id::BotId,
    /// The server-resolved turn. Work cannot outlive or move to another turn.
    pub turn: Uuid,
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
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema, ToSchema)]
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

/// Durable source and final outcome, with historical bridge calls when present.
/// The full journal is not included in the model's tool result.
#[derive(Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionRecord {
    /// Execution identity.
    pub execution_id: ExecutionId,
    /// Account choice bound to this saved execution; absent on historical records.
    #[serde(default)]
    pub acting_as: Option<ai_toolset::actor::ToolActor>,
    /// Original turn, preventing another requester from replaying a saved result.
    #[serde(default)]
    pub turn_id: Option<Uuid>,
    /// The submitted JavaScript module.
    pub source: String,
    /// Overall execution state.
    pub status: ExecutionStatus,
    /// JSON returned by the program, if successful.
    pub result: Option<Value>,
    /// Safe execution failure text.
    pub error: Option<String>,
    /// Historical bridge calls. Direct HTTP executions leave this empty.
    pub calls: Vec<RecordedToolCall>,
    /// Advisory SDK operation activity, without arguments or response contents.
    #[serde(default)]
    pub activity: Vec<ExecutionActivity>,
    /// Additional request activity was omitted at the bounded observation limit.
    #[serde(default)]
    pub activity_truncated: bool,
}

/// Compact model result with an identity the UI uses to load the durable record.
#[derive(Clone, Serialize, Deserialize, JsonSchema, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionReceipt {
    /// Reference to the session's durable rendering record.
    pub execution_id: ExecutionId,
    /// Last recorded outcome; running may be stale after a process interruption.
    pub status: ExecutionStatus,
    /// Observed SDK operations for conversation activity snapshots.
    #[serde(default)]
    pub activity: Vec<ExecutionActivity>,
    /// Only the value explicitly returned by the program.
    pub result: Option<Value>,
    /// Safe failure text, when execution did not succeed.
    pub error: Option<String>,
    /// Pixels of the images `main` returned in `images`, for the model.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub model_media: Vec<ModelImage>,
}

/// Most images one result may show the model, as for a RenderCanvas result.
pub const MAX_RESULT_IMAGES: usize = 2;

/// A static file `main` returned in `images`, such as `await canvas.render()`.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct ReturnedImage {
    /// Static file id; other serialized fields of the SDK image are ignored.
    pub id: StaticFileId,
}

/// A static file id: a path component, never a URL or path.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(try_from = "String")]
pub struct StaticFileId(String);

impl TryFrom<String> for StaticFileId {
    type Error = &'static str;
    fn try_from(id: String) -> Result<Self, Self::Error> {
        if lazy_regex::regex_is_match!(r"^[A-Za-z0-9_-]{1,128}$", &id) {
            Ok(Self(id))
        } else {
            Err("an image id is a static file id")
        }
    }
}

impl AsRef<str> for StaticFileId {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

/// Base64 PNG pixels the model sees as an image block, never a URL.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ModelImage {
    /// Always an image.
    pub r#type: ModelMediaType,
    /// Always a PNG.
    pub media_type: ModelImageMediaType,
    /// Base64 PNG bytes.
    pub data: String,
}

/// The kind of model media; only images.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum ModelMediaType {
    /// An image block.
    Image,
}

/// The media type of a model image; only PNG.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema, ToSchema)]
pub enum ModelImageMediaType {
    /// image/png.
    #[serde(rename = "image/png")]
    Png,
}

/// Safe service errors, separate from failures returned by a running program.
#[derive(Debug, thiserror::Error)]
pub enum CodeModeError {
    /// The deployment has not configured its local Deno runtime.
    #[error("code execution is not configured")]
    Unavailable,
    /// The authenticated principal cannot execute or read this session's record.
    #[error("code execution is not authorized for this session")]
    Forbidden,
    /// No record belongs to this session and execution pair.
    #[error("code execution not found")]
    NotFound,
    /// A connected app's server could not be reached or broke the exchange.
    /// Upstream details stay in server diagnostics.
    #[error("the connected app could not be reached; try again later")]
    ConnectedAppUnreachable,
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
    /// A review changed or was already submitted. Reload before acting.
    #[error("review changed; reload before acting")]
    Conflict,
    /// The supervised request task failed unexpectedly.
    #[error("code execution task failed")]
    Task(#[source] tokio::task::JoinError),
}

/// A bounded SDK operation observed during execution; not an authorization or write receipt.
#[derive(Clone, Serialize, Deserialize, JsonSchema, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionActivity {
    /// Request identity within the execution.
    pub id: u64,
    /// Server-selected label from the generated operation catalog.
    pub label: String,
    /// Observed request state; unfinished operations have unknown outcomes.
    pub status: RecordedCallStatus,
}
