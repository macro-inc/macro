use super::{EventSink, ExecuteRequest, HostCall, HostReply, HostResult, Limits, Outcome, RunId};
use async_trait::async_trait;
use serde_json::Value;
use tokio::{sync::mpsc, time::Instant};
use tokio_util::sync::CancellationToken;

/// Executes a program with caller-owned tool dispatch and cancellation.
#[async_trait]
pub trait ProgramExecutor: Send + Sync + 'static {
    /// Await one final JSON outcome. The executor owns child cleanup.
    async fn execute_program(
        &self,
        request: ExecuteRequest,
        dispatcher: std::sync::Arc<dyn HostDispatcher>,
        cancellation: CancellationToken,
    ) -> Outcome;
}

/// Validated execution context supplied by the domain service.
pub struct ExecutionJob {
    /// Validated source and requested timeout.
    pub request: ExecuteRequest,
    /// Server-owned resource policy.
    pub limits: Limits,
    /// Absolute deadline, including queue time.
    pub deadline: Instant,
}

/// The process adapter must kill and reap its child before returning on any path.
#[async_trait]
pub trait CodeRunner: Send + Sync + 'static {
    /// Execute with bounded events and private replies, observing cancellation.
    async fn run(
        &self,
        job: ExecutionJob,
        events: &mut EventSink,
        replies: mpsc::Receiver<HostReply>,
        cancellation: CancellationToken,
    ) -> Outcome;
}

/// A dispatcher instance is bound by the backend to an authenticated session.
///
/// It must validate method arguments and permissions on every invocation. Never
/// derive actor identity, credentials, or destination URLs from `call.args`.
#[async_trait]
pub trait HostDispatcher: Send + Sync + 'static {
    /// Execute one host call. Calls may arrive concurrently and out of order.
    ///
    /// Cancellation is cooperative. Dropping this future does not roll back an
    /// external write; implementations must apply their own idempotency policy.
    async fn dispatch(&self, call: HostCall, context: DispatchContext) -> HostResult;
}

/// Host-owned identity, cancellation, and live progress for one call.
pub struct DispatchContext {
    /// Supervisor-assigned execution identity.
    pub run_id: RunId,
    /// Cancellation for this execution.
    pub cancellation: CancellationToken,
    /// Optional bounded progress channel; absent for the awaited JSON API.
    pub progress: Option<mpsc::Sender<Value>>,
}
