use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;
use uuid::Uuid;

/// Identity assigned by the runner, never by sandbox code.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct RunId(pub Uuid);

/// A JavaScript ES module exporting an async `main` function.
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExecuteRequest {
    /// Complete JavaScript module, including imports and `export async function main`.
    pub source: String,
    /// Total budget including queueing and API requests.
    pub timeout_ms: u64,
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
    /// Explicit Macro SDK service base URLs, also used for Deno's network allowlist.
    pub hosts: std::collections::BTreeMap<String, String>,
}

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
    /// Maximum regular events, plus a separate equal budget for advisory progress.
    pub max_events: usize,
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
            max_events: 1024,
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
            || !(2..=65536).contains(&self.max_events)
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
    /// Legacy source compilation failure retained for persisted outcomes.
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
