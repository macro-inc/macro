use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;
use uuid::Uuid;

/// Identity assigned by the runner, never by sandbox code.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct RunId(pub Uuid);

/// A correlation ID local to one execution, with no authorization meaning.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct CallId(pub u32);

/// An async TypeScript function body. Imports and external I/O are unavailable.
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExecuteRequest {
    /// Program body; may use `await`, `return`, `console`, `progress`, and `host.call`.
    pub source: String,
    /// Total budget including queueing, compilation, and host calls.
    pub timeout_ms: u64,
}

/// Server-owned admission and execution limits.
#[derive(Debug, Clone)]
pub struct Limits {
    /// Maximum simultaneous Deno executions, including compilation.
    pub max_running: usize,
    /// Additional admitted executions waiting for a process slot.
    pub max_queued: usize,
    /// Maximum requested execution lifetime.
    pub max_duration: Duration,
    /// Maximum UTF-8 source length.
    pub max_source_bytes: usize,
    /// Maximum individual child frame or host reply size.
    pub max_frame_bytes: usize,
    /// Combined stdout and stderr budget per execution.
    pub max_output_bytes: usize,
    /// Maximum lifetime host calls per execution.
    pub max_calls: usize,
    /// Maximum host calls waiting for replies per execution.
    pub max_pending_calls: usize,
    /// Maximum streamed events, independent of their byte sizes.
    pub max_events: usize,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            max_running: 4,
            max_queued: 16,
            max_duration: Duration::from_secs(30),
            max_source_bytes: 64 * 1024,
            max_frame_bytes: 256 * 1024,
            max_output_bytes: 2 * 1024 * 1024,
            max_calls: 128,
            max_pending_calls: 16,
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
            || self.max_pending_calls == 0
            || self.max_pending_calls > self.max_calls
            || self.max_calls > 4096
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
    /// Source could not be transpiled.
    Compile,
    /// Program threw or exited without a result.
    Runtime,
    /// Invalid, duplicate, or unsolicited bridge messages.
    Protocol,
    /// Byte, event, call, or consumer capacity was exceeded.
    Limit,
    /// Runner infrastructure failed.
    Internal,
    /// The runner connection failed; side-effect outcomes may be unknown.
    Transport,
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
    /// Compilation, execution, or transport failed.
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

/// An untrusted request to the caller's explicitly scoped dispatcher.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HostCall {
    /// Correlation only; unique for the lifetime of this execution.
    pub id: CallId,
    /// Name resolved by the caller's allowlisted dispatcher, never a URL.
    pub method: String,
    /// Method-specific arguments requiring validation by the dispatcher.
    pub args: Value,
}

/// Host response delivered to the corresponding promise in Deno.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case", deny_unknown_fields)]
pub enum HostResult {
    /// Successful response.
    Ok {
        /// Bounded JSON response.
        value: Value,
    },
    /// Dispatcher rejection or tool failure.
    Error {
        /// Safe diagnostic for the program.
        message: String,
    },
}

/// A host reply can only target a call on the same execution connection.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HostReply {
    /// Correlation ID from the request.
    pub id: CallId,
    /// Result of dispatching the call.
    pub result: HostResult,
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
    /// Program-authored progress, separate from authoritative host-call activity.
    Progress {
        /// Bounded JSON progress data.
        value: Value,
    },
    /// Request for backend dispatch; this does not mean a tool has started.
    HostCall {
        /// Untrusted method and arguments.
        call: HostCall,
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

/// Backend-side activity, independent of a model's pending execute call.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "data", rename_all = "snake_case")]
pub enum BackendEvent {
    /// Supervisor lifecycle, console, or program progress.
    Execution(ExecutionEvent),
    /// Dispatcher invocation began after acquiring a host-call slot.
    CallStarted {
        /// Execution identity.
        run_id: RunId,
        /// Correlation ID.
        call_id: CallId,
        /// Method selected by the program.
        method: String,
    },
    /// Progress supplied by the actual dispatcher implementation.
    CallProgress {
        /// Execution identity.
        run_id: RunId,
        /// Correlation ID.
        call_id: CallId,
        /// Dispatcher-authored progress.
        value: Value,
    },
    /// Dispatcher returned; result payload stays on the private bridge.
    CallFinished {
        /// Execution identity.
        run_id: RunId,
        /// Correlation ID.
        call_id: CallId,
        /// Whether the dispatcher returned an error.
        failed: bool,
    },
}
