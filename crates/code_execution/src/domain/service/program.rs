use super::*;

#[async_trait::async_trait]
impl ProgramExecutor for ExecutionService {
    async fn execute_program(
        &self,
        request: ExecuteRequest,
        environment: RunEnvironment,
        cancellation: CancellationToken,
    ) -> Outcome {
        self.run_program(request, environment, cancellation, None)
            .await
    }
    async fn execute_program_with_progress(
        &self,
        request: ExecuteRequest,
        environment: RunEnvironment,
        cancellation: CancellationToken,
        progress: tokio::sync::mpsc::Sender<serde_json::Value>,
    ) -> Outcome {
        self.run_program(request, environment, cancellation, Some(progress))
            .await
    }
}

impl ExecutionService {
    async fn run_program(
        &self,
        request: ExecuteRequest,
        environment: RunEnvironment,
        cancellation: CancellationToken,
        progress: Option<tokio::sync::mpsc::Sender<serde_json::Value>>,
    ) -> Outcome {
        let mut handle = match self.execute(request, environment) {
            Ok(handle) => handle,
            Err(error) => {
                return ExecutionFailure::new(FailureCode::Limit, error.to_string()).into();
            }
        };
        let mut cancelled = false;
        loop {
            tokio::select! {
                biased;
                () = cancellation.cancelled(), if !cancelled => {
                    cancelled = true;
                    handle.cancellation.cancel();
                }
                event = handle.events.recv() => match event.map(|event| event.kind) {
                    Some(EventKind::Finished { outcome }) => return outcome,
                    None => return ExecutionFailure::new(FailureCode::Internal, "execution supervisor stopped before completion").into(),
                    Some(EventKind::Progress { value }) => {
                        if let Some(progress) = &progress {
                            // A UI observer cannot delay process supervision.
                            let _ = progress.try_send(value);
                        }
                    }
                    Some(_) => {},
                }
            }
        }
    }
}
