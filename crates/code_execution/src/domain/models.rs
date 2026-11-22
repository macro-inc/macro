use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;
use uuid::Uuid;

/// Identity assigned by the runner, never by sandbox code.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct RunId(pub Uuid);

/// A program to run: a JavaScript ES module exporting an async `main`
/// function, or a JS tools script.
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExecuteRequest {
    /// The complete program: a JavaScript module, including imports and
    /// `export async function main`, or a JS tools script.
    pub source: String,
    /// Total budget including queueing, compiling and API requests.
    pub timeout_ms: u64,
    /// The language `source` is written in.
    #[serde(default)]
    pub language: Language,
    /// JS tools only: a TypeScript module the program reads with
    /// `get(name)` and calls with `call(name, ...args)`. It runs in its own
    /// process with no network, no SDK and no token, for this run only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub module: Option<String>,
}

/// The language a program is written in.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Language {
    /// A JavaScript ES module (TypeScript for an unattended program), run by
    /// Deno directly.
    #[default]
    Javascript,
    /// A script in `@opencode/codemode`'s JavaScript dialect, run by its
    /// interpreter inside Deno: it calls SDK operations as
    /// `tools.<service>.<operation>(input)` and nothing else reaches the
    /// network. Every run analyzes it first and runs only what the analysis
    /// found.
    JsTools,
}

impl Language {
    /// Its name in spans and the bootstrap's context.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Javascript => "javascript",
            Self::JsTools => "js_tools",
        }
    }
}

/// Run-only credentials and destinations supplied by the authenticated host.
/// Never serialize this into journals, tool results, or tracing fields.
#[derive(Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RunEnvironment {
    /// Short-lived user bearer token; no refresh credential is provided.
    pub token: String,
    /// W3C trace context from the trusted host, sent only on authenticated SDK traffic.
    pub trace_headers: std::collections::BTreeMap<String, String>,
    /// Authenticated session handle made available to the program.
    pub session_id: Option<Uuid>,
    /// Current execution handle made available to the program.
    pub execution_id: Option<Uuid>,
    /// Where the SDK sends requests and what its links point at.
    #[serde(flatten)]
    pub endpoints: SdkEndpoints,
    /// Set for a program that runs with nobody watching (a routine step)
    /// instead of an agent's or a person's call.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unattended: Option<Unattended>,
    /// How the program's requests leave its process. Host-only: the child
    /// sees only the hosts it may reach.
    #[serde(skip)]
    pub egress: Egress,
    /// JS tools only: the only requests the program may send, as the
    /// permission gate admitted them. The bootstrap refuses any other SDK
    /// request, and any authenticated request that doesn't name its
    /// operation; a JS tools program that may call anything outside them
    /// doesn't start, and a JS tools run without them is refused, so it fails
    /// closed. `None` for JavaScript, which the gate doesn't check.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub allowed_operations: Option<Vec<SdkCall>>,
}

/// The handles an attended program's `main` receives besides the SDK, which
/// decide the `CodeContext` it is type-checked with.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ContextShape {
    /// `session`: the run belongs to an agent session.
    pub session: bool,
    /// `execution`: the run is one of the session's code executions.
    pub execution: bool,
}

impl RunEnvironment {
    /// What `main` receives: `execution` only with `session`, as the
    /// bootstrap passes them.
    pub fn shape(&self) -> ContextShape {
        ContextShape {
            session: self.session_id.is_some(),
            execution: self.session_id.is_some() && self.execution_id.is_some(),
        }
    }
}

/// How a program's requests reach the SDK hosts.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Egress {
    /// Straight from the process to the hosts, which `--allow-net` names.
    #[default]
    Direct,
    /// Through a loopback forwarder the host runs for the run, the only
    /// address `--allow-net` names; it marks every request.
    Proxied,
}

/// The deployment's Macro SDK targets, so a program's requests and links stay
/// in the environment it runs in.
#[derive(Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SdkEndpoints {
    /// Service base URLs, also used for Deno's network allowlist.
    pub hosts: std::collections::BTreeMap<String, String>,
    /// The web app origin that `webUrl()` links start with.
    pub web_app_url: String,
}

/// How an unattended program runs: its source is TypeScript, and `main`
/// receives `macro` and `arguments` but never the credential.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Unattended {
    /// Spread into `main`'s argument beside `macro`.
    pub arguments: serde_json::Map<String, Value>,
    /// No write runs: each one returns an empty result to the program and is
    /// reported as skipped, so a run shows what it would have done. Writes
    /// are every catalog operation that isn't a known read, so an operation
    /// missing from the catalog is a write.
    pub dry_run: bool,
}

/// Frame bytes kept beside a full-size result for its `{"type":"result",...}` envelope.
pub const RESULT_FRAME_OVERHEAD: usize = 256;

/// Server-owned admission and execution limits.
#[derive(Debug, Clone)]
pub struct Limits {
    /// Maximum simultaneous Deno executions.
    pub max_running: usize,
    /// Additional admitted executions waiting for a process slot.
    pub max_queued: usize,
    /// Maximum requested execution lifetime.
    pub max_duration: Duration,
    /// Maximum UTF-8 source length.
    pub max_source_bytes: usize,
    /// Maximum individual child frame, including the final model-facing result.
    pub max_frame_bytes: usize,
    /// Combined stdout and stderr budget per execution.
    pub max_output_bytes: usize,
    /// Largest model-facing result JSON; a larger `data` is replaced by a bounded summary.
    pub max_result_bytes: usize,
    /// Maximum regular events, plus a separate equal budget for advisory progress.
    pub max_events: usize,
    /// Calls of any one SDK operation a program may make; the next one stops
    /// the run with an error naming it. A program reading the same thing in
    /// an unbounded loop would otherwise hammer one API until the deadline
    /// and end with nothing to tell the agent why.
    pub max_calls_per_operation: u32,
    /// CPU time a process may use across its threads before the kernel stops
    /// it; `None` leaves only the wall-clock deadline.
    pub max_cpu: Option<Duration>,
    /// Run processes at a lower scheduling priority than the host, so busy
    /// background programs yield the CPU to its requests.
    pub background: bool,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            max_running: 8,
            max_queued: 16,
            max_duration: Duration::from_secs(30),
            max_source_bytes: 64 * 1024,
            max_frame_bytes: 256 * 1024,
            max_output_bytes: 2 * 1024 * 1024,
            max_result_bytes: 64 * 1024,
            max_events: 1024,
            max_calls_per_operation: 200,
            max_cpu: None,
            background: false,
        }
    }
}

impl Limits {
    /// Reject unusable or unreasonable deployment settings before serving traffic.
    pub fn validate(&self) -> Result<(), AdmissionError> {
        if !(1..=64).contains(&self.max_running)
            || self.max_queued > 1024
            || self.max_duration.is_zero()
            || self.max_duration > Duration::from_secs(300)
            || !(1..=1024 * 1024).contains(&self.max_source_bytes)
            || !(1024..=1024 * 1024).contains(&self.max_frame_bytes)
            || self.max_output_bytes < self.max_frame_bytes
            || self.max_output_bytes > 16 * 1024 * 1024
            || self.max_result_bytes < 512
            || self.max_result_bytes + RESULT_FRAME_OVERHEAD > self.max_frame_bytes
            || !(2..=65536).contains(&self.max_events)
            || !(1..=100_000).contains(&self.max_calls_per_operation)
            || self
                .max_cpu
                .is_some_and(|cpu| cpu < Duration::from_secs(1) || cpu > self.max_duration)
        {
            return Err(AdmissionError::InvalidLimits);
        }
        Ok(())
    }
}

/// Admission fails before a process is started.
#[derive(Debug, thiserror::Error)]
pub enum AdmissionError {
    /// Invalid startup configuration.
    #[error("invalid execution limits")]
    InvalidLimits,
    /// Empty or oversized source.
    #[error("source must be nonempty and within the configured size limit")]
    InvalidSource,
    /// An empty or oversized module, or one sent with a program that
    /// isn't a JS tools program.
    #[error(
        "module must be nonempty, within the configured size limit and sent with a JS tools program"
    )]
    InvalidModule,
    /// A caller cannot raise the server's deadline.
    #[error("timeout must be positive and within the configured limit")]
    InvalidTimeout,
    /// Running and queued slots are both occupied.
    #[error("execution capacity exhausted")]
    Busy,
    /// The runner is draining.
    #[error("runner is shutting down")]
    ShuttingDown,
}

/// Stable categories suitable for backend retry and presentation decisions.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FailureCode {
    /// The program didn't type-check against the SDK (JavaScript), or didn't
    /// parse or pass the analysis (JS tools), so it never ran.
    Compile,
    /// Program threw or exited without a result.
    Runtime,
    /// Invalid, duplicate, or unsolicited bridge messages.
    Protocol,
    /// Byte, event, or consumer capacity was exceeded.
    Limit,
    /// Runner infrastructure failed.
    Internal,
}

/// A bounded failure description. Source and data must not be traced by callers.
#[derive(Debug, Clone, Serialize, Deserialize, thiserror::Error)]
#[error("{code:?}: {message}")]
pub struct ExecutionFailure {
    /// Machine-readable failure category.
    pub code: FailureCode,
    /// Human-readable diagnostic, potentially containing user data.
    pub message: String,
}

impl ExecutionFailure {
    /// Construct a failure without attaching source or credentials.
    pub fn new(code: FailureCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

/// Exactly one terminal outcome is emitted after process cleanup.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum Outcome {
    /// JSON returned by the program, not a trusted assertion about external state.
    Succeeded {
        /// Returned JSON; `undefined` becomes `null`.
        value: Value,
    },
    /// Execution or transport failed.
    Failed {
        /// Failure details.
        error: ExecutionFailure,
    },
    /// Cancellation was requested, including by disconnect.
    Cancelled,
    /// Queueing or execution exhausted its wall-clock budget.
    TimedOut,
}

impl From<ExecutionFailure> for Outcome {
    fn from(error: ExecutionFailure) -> Self {
        Self::Failed { error }
    }
}

/// Supported console levels.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LogLevel {
    /// Debug output.
    Debug,
    /// Informational output.
    Info,
    /// Warning output, including raw stderr.
    Warn,
    /// Error output.
    Error,
}

/// Events from the supervisor; program output is untrusted data.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum EventKind {
    /// The execution has been admitted.
    Queued,
    /// A process slot has been acquired.
    Started,
    /// Program console or process stderr.
    Log {
        /// Console severity.
        level: LogLevel,
        /// Untrusted text.
        message: String,
    },
    /// Program-authored progress; not an assertion of external API completion.
    Progress {
        /// Bounded JSON progress data.
        value: Value,
    },
    /// Terminal event, after reaping the process and releasing its scratch directory.
    Finished {
        /// Terminal outcome.
        outcome: Outcome,
    },
}

/// Ordered envelope stamped by the supervisor.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionEvent {
    /// Supervisor-assigned identity.
    pub run_id: RunId,
    /// Monotonic sequence starting at zero, local to the execution.
    pub sequence: u64,
    /// Event payload.
    #[serde(flatten)]
    pub kind: EventKind,
}

/// One type-checker problem, as the checker reported it. Locations are
/// `<file>:<line>:<column>`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Diagnostic {
    /// The file it is in, when it is in one of the checked files.
    pub file: Option<String>,
    /// The problem with its code, the offending line and its location.
    pub message: String,
}

/// A TypeScript module checked together with others.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceFile {
    /// Its file name: lowercase letters, digits and `_`, ending in `.ts`.
    pub name: String,
    /// Its source.
    pub source: String,
}

/// The modules a checked program may import besides its own files.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProgramImports {
    /// Only `@macro-inc/sdk`, as an unattended program runs with.
    Sdk,
    /// `@macro-inc/sdk` and `handlebars`, as an attended program runs with.
    SdkAndHandlebars,
    /// Only `handlebars`, as a JS tools program's module runs with: it never
    /// reaches the SDK.
    Handlebars,
}

/// The checker couldn't decide whether a program checks.
#[derive(Debug, thiserror::Error)]
pub enum CheckError {
    /// Empty or oversized source.
    #[error("source must be nonempty and within the configured size limit")]
    InvalidSource,
    /// Every checker slot and queue place is taken.
    #[error("type checking is busy; try again later")]
    Busy,
    /// The checker process failed or ran out of time.
    #[error("type checking failed to run")]
    Internal,
}

/// One Macro SDK operation, by the OpenAPI spec it comes from and its raw
/// `operationId`: the key the permission registry uses.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SdkOperation {
    /// The spec's name, such as `storage`.
    pub service: String,
    /// The raw `operationId`, such as `create_task_handler`.
    pub operation_id: String,
}

impl std::fmt::Display for SdkOperation {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}.{}", self.service, self.operation_id)
    }
}

/// One request a program may send: its operation and the route the SDK
/// sends it to. Two SDK values can share an `operationId` on different routes.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SdkCall {
    /// The operation, by service and raw `operationId`.
    #[serde(flatten)]
    pub operation: SdkOperation,
    /// HTTP method, uppercase.
    pub method: String,
    /// The path below the service's host, `{}` for each parameter segment,
    /// such as `/documents/{}/markdown`.
    pub route: String,
    /// Other operations' routes with this method that a request on `route`
    /// could also match (`/documents/system_skills` for `/documents/{}`).
    /// The backstop refuses a request that a more specific one of them
    /// matches, since the server would route it there.
    #[serde(default)]
    pub rivals: Vec<SdkRoute>,
}

/// A route of a service, `{}` for each parameter segment.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct SdkRoute {
    /// The service's spec name.
    pub service: String,
    /// The path below the service's host.
    pub route: String,
}

/// Where a program reaches SDK operations the analysis cannot see.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AnalysisReason {
    /// What the program does there.
    pub message: String,
    /// 1-based line in the program.
    pub line: u32,
    /// 1-based column in the program.
    pub column: u32,
}

/// Which SDK operations a program may call, read from it without running it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Analysis {
    /// Every operation the program names, in any branch. May be empty.
    Calls(std::collections::BTreeSet<SdkCall>),
    /// The program can reach operations the analysis cannot see; it must be
    /// rewritten before it can run.
    CannotAnalyze(Vec<AnalysisReason>),
    /// The program does not compile, or the policy check refuses it.
    Diagnostics(Vec<Diagnostic>),
}
