use super::{EventSink, ExecuteRequest, Limits, Outcome, RunEnvironment};
use async_trait::async_trait;
use tokio::time::Instant;
use tokio_util::sync::CancellationToken;

/// Executes a JavaScript module with run-scoped credentials and cancellation.
#[async_trait]
pub trait ProgramExecutor: Send + Sync + 'static {
    /// Observe advisory progress separately from the final model result.
    async fn execute_program_with_progress(
        &self,
        request: ExecuteRequest,
        environment: RunEnvironment,
        cancellation: CancellationToken,
        _progress: tokio::sync::mpsc::Sender<serde_json::Value>,
    ) -> Outcome {
        self.execute_program(request, environment, cancellation)
            .await
    }
    /// Await final JSON after the child has been reaped.
    async fn execute_program(
        &self,
        request: ExecuteRequest,
        environment: RunEnvironment,
        cancellation: CancellationToken,
    ) -> Outcome;
}

/// Validated execution context supplied by the domain service.
pub struct ExecutionJob {
    /// Source and requested timeout.
    pub request: ExecuteRequest,
    /// Credentials never included in the public execution request.
    pub environment: RunEnvironment,
    /// Server-owned resource policy.
    pub limits: Limits,
    /// Absolute deadline, including queue time.
    pub deadline: Instant,
}

/// The process adapter must kill and reap its child on every exit path.
#[async_trait]
pub trait CodeRunner: Send + Sync + 'static {
    /// Execute with bounded output, observing cancellation.
    async fn run(
        &self,
        job: ExecutionJob,
        events: &mut EventSink,
        cancellation: CancellationToken,
    ) -> Outcome;
}
