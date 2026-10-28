use super::*;
use std::sync::Arc;
use tokio::sync::{Semaphore, mpsc};
use tokio::time::{Instant, sleep_until};
use tokio_util::{sync::CancellationToken, task::TaskTracker};

/// Domain service owning admission, queueing, deadlines, and shutdown policy.
#[derive(Clone)]
pub struct ExecutionService {
    runner: Arc<dyn CodeRunner>,
    limits: Limits,
    admitted: Arc<Semaphore>,
    running: Arc<Semaphore>,
    shutdown: CancellationToken,
    tasks: TaskTracker,
}

impl ExecutionService {
    /// Validate policy and wire a replaceable process adapter.
    pub fn new(runner: Arc<dyn CodeRunner>, limits: Limits) -> Result<Self, AdmissionError> {
        limits.validate()?;
        Ok(Self {
            runner,
            admitted: Arc::new(Semaphore::new(limits.max_running + limits.max_queued)),
            running: Arc::new(Semaphore::new(limits.max_running)),
            limits,
            shutdown: CancellationToken::new(),
            tasks: TaskTracker::new(),
        })
    }

    /// Admit a request; dropping the handle cancels queued or running work.
    #[tracing::instrument(skip_all, err)]
    pub fn execute(
        &self,
        request: ExecuteRequest,
        environment: RunEnvironment,
    ) -> Result<ExecutionHandle, AdmissionError> {
        if self.shutdown.is_cancelled() {
            return Err(AdmissionError::ShuttingDown);
        }
        if request.source.trim().is_empty() || request.source.len() > self.limits.max_source_bytes {
            return Err(AdmissionError::InvalidSource);
        }
        let duration = std::time::Duration::from_millis(request.timeout_ms);
        if duration.is_zero() || duration > self.limits.max_duration {
            return Err(AdmissionError::InvalidTimeout);
        }
        let admitted = self
            .admitted
            .clone()
            .try_acquire_owned()
            .map_err(|_| AdmissionError::Busy)?;
        let run_id = RunId(uuid::Uuid::now_v7());
        let cancellation = self.shutdown.child_token();
        let (sender, events) = mpsc::channel(self.limits.max_events * 2 + 1);
        let mut sink = EventSink {
            run_id,
            sender,
            sequence: 0,
            remaining: self.limits.max_events,
            remaining_progress: self.limits.max_events,
        };
        let service = self.clone();
        let job = ExecutionJob {
            request,
            environment,
            limits: self.limits.clone(),
            deadline: Instant::now() + duration,
        };
        let token = cancellation.clone();
        self.tasks.spawn(async move {
            let _admitted = admitted;
            let outcome = match sink.emit(EventKind::Queued) {
                Err(error) => error.into(),
                Ok(()) => {
                    tokio::select! {
                        biased;
                        _ = token.cancelled() => Outcome::Cancelled,
                        _ = sink.closed() => Outcome::Cancelled,
                        _ = sleep_until(job.deadline) => Outcome::TimedOut,
                        permit = service.running.acquire() => {
                            let _permit = permit.expect("execution semaphore is never closed");
                            match sink.emit(EventKind::Started) {
                                Err(error) => error.into(),
                                Ok(()) => service.runner.run(job, &mut sink, token).await,
                            }
                        }
                    }
                }
            };
            sink.finish(outcome);
        });
        Ok(ExecutionHandle {
            run_id,
            events,
            cancellation,
        })
    }

    /// Stop admission, cancel executions, and wait for process cleanup.
    pub async fn shutdown(&self) {
        self.shutdown.cancel();
        self.tasks.close();
        self.tasks.wait().await;
    }
}

/// One handle owns one execution and its event feed.
pub struct ExecutionHandle {
    /// Supervisor identity, stable throughout this execution.
    pub run_id: RunId,
    /// Bounded live event feed.
    pub events: mpsc::Receiver<ExecutionEvent>,
    /// Cancels this execution without affecting other sessions.
    pub cancellation: CancellationToken,
}

impl Drop for ExecutionHandle {
    fn drop(&mut self) {
        self.cancellation.cancel();
    }
}

/// A bounded event writer reserving one channel slot for the terminal event.
pub struct EventSink {
    run_id: RunId,
    sender: mpsc::Sender<ExecutionEvent>,
    sequence: u64,
    remaining: usize,
    remaining_progress: usize,
}

impl EventSink {
    /// Publish without allowing a slow consumer to stall process supervision.
    pub fn emit(&mut self, kind: EventKind) -> Result<(), ExecutionFailure> {
        if self.remaining == 0 || self.sender.capacity() <= 1 {
            return Err(ExecutionFailure::new(
                FailureCode::Limit,
                "event limit or slow consumer",
            ));
        }
        let event = ExecutionEvent {
            run_id: self.run_id,
            sequence: self.sequence,
            kind,
        };
        self.sender.try_send(event).map_err(|_| {
            ExecutionFailure::new(FailureCode::Limit, "event consumer disconnected")
        })?;
        self.sequence += 1;
        self.remaining -= 1;
        Ok(())
    }

    /// Advisory progress must not fail API work when an observer falls behind.
    pub fn progress(&mut self, value: serde_json::Value) {
        if self.remaining_progress > 0 && self.sender.capacity() > 1 {
            let event = ExecutionEvent {
                run_id: self.run_id,
                sequence: self.sequence,
                kind: EventKind::Progress { value },
            };
            if self.sender.try_send(event).is_ok() {
                self.sequence += 1;
                self.remaining_progress -= 1;
            }
        }
    }

    /// Resolve when the caller drops its event receiver.
    pub async fn closed(&self) {
        self.sender.closed().await;
    }

    fn finish(self, outcome: Outcome) {
        let _ = self.sender.try_send(ExecutionEvent {
            run_id: self.run_id,
            sequence: self.sequence,
            kind: EventKind::Finished { outcome },
        });
    }
}

#[cfg(test)]
mod test;

mod program;
