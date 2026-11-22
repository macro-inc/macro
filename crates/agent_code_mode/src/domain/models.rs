pub use agent_permissions::domain::model::{DeclinedStatus, ExecutionPermission, GatedOperation};
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

/// What code mode a session's turn offers its agent, resolved once per turn
/// from the owner's `enable-agent-permissions` flag
/// ([`CodeModeKinds`](super::CodeModeKinds)) and passed to every surface the
/// agent reads or calls: the system prompt, the code-mode tools' schemas and
/// texts, and `ExecuteCode`, which refuses a program of the other kind. No
/// surface reads the flag itself, so a turn never mixes the two.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum CodeModeKind {
    /// Flag off: a TypeScript module with the whole SDK and the run's token,
    /// which the agent's permissions do not check.
    TypeScript,
    /// Flag on: every SDK call is a `tools.*` call in the JS tools dialect,
    /// analyzed and gated by the agent's permissions; an optional TypeScript
    /// module computes with no network, no SDK and no token.
    Dialect,
}

/// The language of a session program. JavaScript tools programs are offered
/// only to sessions whose owner has agent permissions
/// ([`OwnerRollout`](super::OwnerRollout)), which gate them.
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema, ToSchema,
)]
#[serde(rename_all = "snake_case")]
pub enum ProgramLanguage {
    /// A JavaScript ES module exporting `main`.
    #[default]
    Javascript,
    /// A script in opencode's JavaScript dialect (`main.js`) that calls SDK
    /// operations as `tools.<service>.<operation>(input)`.
    JsTools,
}

impl ProgramLanguage {
    /// Whether this is the default, JavaScript.
    pub fn is_javascript(&self) -> bool {
        *self == Self::Javascript
    }
}

impl From<ProgramLanguage> for code_execution::domain::Language {
    fn from(language: ProgramLanguage) -> Self {
        match language {
            ProgramLanguage::Javascript => Self::Javascript,
            ProgramLanguage::JsTools => Self::JsTools,
        }
    }
}

impl From<code_execution::domain::Language> for ProgramLanguage {
    fn from(language: code_execution::domain::Language) -> Self {
        match language {
            code_execution::domain::Language::Javascript => Self::Javascript,
            code_execution::domain::Language::JsTools => Self::JsTools,
        }
    }
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
    /// Never sent: the operation was outside what the permission gate checked
    /// the program to call.
    Refused,
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
    /// The submitted program: a JavaScript module or a JS tools script.
    pub source: String,
    /// The language `source` is written in; historical records are JavaScript.
    /// JavaScript, the default, is left out, so records of JavaScript
    /// programs serialize as they did before languages.
    #[serde(default, skip_serializing_if = "ProgramLanguage::is_javascript")]
    pub language: ProgramLanguage,
    /// For a JavaScript tools program, the fingerprint of the interpreter and
    /// catalog it ran with.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sdk_fingerprint: Option<String>,
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
    /// Set when the agent's permissions stopped the program before it ran:
    /// an operation set to never, or an approval that was not given. The
    /// status is then `failed`, and `error` says why in the model's words.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub permission: Option<ExecutionPermission>,
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
    /// Set when the agent's permissions stopped the program; see
    /// [`ExecutionRecord::permission`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub permission: Option<ExecutionPermission>,
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

/// A program that was not run, with what the model is told and, when its
/// permissions stopped it, how. The run is recorded as failed and the
/// caller gets a receipt, not an error: the program was the problem.
#[derive(Debug, Clone)]
pub struct NotRun {
    /// What the model is told: why, and what to do instead.
    pub message: String,
    /// How the agent's permissions stopped it; `None` when the program has
    /// to be rewritten (it cannot be analyzed, or does not compile).
    pub permission: Option<ExecutionPermission>,
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
    /// The account's calls to a connected app exceeded its budget: the
    /// app kept answering HTTP 429 after the harness paced and retried the
    /// call, or the queue ahead of it outlasted its deadline. It did not run.
    #[error(
        "too many calls to this connected app for this account; this call did not run. Make fewer calls (page or limit results, call per item only for the few items you need) and try again later"
    )]
    ConnectedAppRateLimited {
        /// How long the app last asked callers to wait.
        retry_after: Option<std::time::Duration>,
    },
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
    /// The program was checked before running and not run. `run` records it
    /// and returns a receipt instead of this error.
    #[error("{}", .0.message)]
    NotRun(NotRun),
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
