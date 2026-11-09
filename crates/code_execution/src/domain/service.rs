use super::context::program_context;
use super::*;
use std::sync::Arc;
use tokio::sync::{Semaphore, mpsc};
use tokio::time::{Instant, sleep_until};
use tokio_util::{sync::CancellationToken, task::TaskTracker};
use tracing::Instrument;

/// Domain service owning admission, queueing, deadlines, and shutdown policy.
#[derive(Clone)]
pub struct ExecutionService {
    runner: Arc<dyn CodeRunner>,
    checker: Arc<dyn ProgramChecker>,
    limits: Limits,
    admitted: Arc<Semaphore>,
    running: Arc<Semaphore>,
    shutdown: CancellationToken,
    tasks: TaskTracker,
}

impl ExecutionService {
    /// Validate policy and wire the process and type-checking adapters. An
    /// attended program runs only once `checker` finds no type errors in it;
    /// an unattended one was checked by its host with the rest of its
    /// program before it was saved.
    pub fn new(
        runner: Arc<dyn CodeRunner>,
        checker: Arc<dyn ProgramChecker>,
        limits: Limits,
    ) -> Result<Self, AdmissionError> {
        limits.validate()?;
        Ok(Self {
            runner,
            checker,
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
        let span = tracing::info_span!(
            "code_execution.run",
            run_id = %run_id.0,
            check = tracing::field::Empty,
            outcome = tracing::field::Empty,
        );
        self.tasks.spawn(
            async move {
                let _admitted = admitted;
                let outcome = match sink.emit(EventKind::Queued) {
                    Err(error) => error.into(),
                    Ok(()) => service.check_then_run(job, &mut sink, token).await,
                };
                let label = match &outcome {
                    Outcome::Succeeded { .. } => "succeeded",
                    Outcome::Failed { .. } => "failed",
                    Outcome::Cancelled => "cancelled",
                    Outcome::TimedOut => "timed_out",
                };
                tracing::Span::current().record("outcome", label);
                sink.finish(outcome);
            }
            .instrument(span.or_current()),
        );
        Ok(ExecutionHandle {
            run_id,
            events,
            cancellation,
        })
    }

    /// Type-check an attended program, then run it once a process slot is
    /// free. A program that doesn't check, or that couldn't be checked,
    /// never runs.
    async fn check_then_run(
        &self,
        job: ExecutionJob,
        sink: &mut EventSink,
        token: CancellationToken,
    ) -> Outcome {
        let span = tracing::Span::current();
        if job.environment.unattended.is_some() {
            span.record("check", "skipped");
        } else {
            let files = [SourceFile {
                name: PROGRAM_FILE.to_owned(),
                source: job.request.source.clone(),
            }];
            let declarations = program_context(&job.environment);
            let checked = tokio::select! {
                biased;
                _ = token.cancelled() => return Outcome::Cancelled,
                _ = sink.closed() => return Outcome::Cancelled,
                _ = sleep_until(job.deadline) => return Outcome::TimedOut,
                checked = self.checker.check_files(&files, &declarations, ProgramImports::SdkAndHandlebars) => checked,
            };
            let rejection = match checked {
                Ok(diagnostics) if diagnostics.is_empty() => None,
                Ok(diagnostics) => Some(("rejected", type_errors(&diagnostics))),
                Err(CheckError::Busy) => Some((
                    "busy",
                    ExecutionFailure::new(
                        FailureCode::Limit,
                        "The program wasn't run: Macro is busy type-checking other programs. Run it again shortly.",
                    ),
                )),
                Err(CheckError::InvalidSource | CheckError::Internal) => Some((
                    "failed",
                    ExecutionFailure::new(
                        FailureCode::Internal,
                        "The program wasn't run: type-checking it failed. Run it again shortly.",
                    ),
                )),
            };
            match rejection {
                None => span.record("check", "passed"),
                Some((label, failure)) => {
                    span.record("check", label);
                    return failure.into();
                }
            };
        }
        let queued = tracing::info_span!("code_execution.queue");
        tokio::select! {
            biased;
            _ = token.cancelled() => Outcome::Cancelled,
            _ = sink.closed() => Outcome::Cancelled,
            _ = sleep_until(job.deadline) => Outcome::TimedOut,
            permit = self.running.acquire().instrument(queued) => {
                let _permit = permit.expect("execution semaphore is never closed");
                match sink.emit(EventKind::Started) {
                    Err(error) => error.into(),
                    Ok(()) => {
                        self.runner
                            .run(job, sink, token)
                            .instrument(tracing::info_span!(
                                "code_execution.process",
                                result_summarized_from_bytes = tracing::field::Empty,
                            ))
                            .await
                    }
                }
            }
        }
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

/// What an attended program's module is checked as.
const PROGRAM_FILE: &str = "main.ts";
/// Type errors shown to the model; it fixes these and sees the rest next time.
const MAX_REPORTED_DIAGNOSTICS: usize = 20;

/// The checker's problems, as the model reads them to fix the program. Each
/// message names its file, line and column (`at main.ts:2:18`).
fn type_errors(diagnostics: &[Diagnostic]) -> ExecutionFailure {
    let mut message = String::from(
        "The program wasn't run: it doesn't type-check against the Macro SDK. Fix these errors and run it again.\n",
    );
    for diagnostic in diagnostics.iter().take(MAX_REPORTED_DIAGNOSTICS) {
        message.push('\n');
        message.push_str(&diagnostic.message);
        message.push('\n');
    }
    if diagnostics.len() > MAX_REPORTED_DIAGNOSTICS {
        message.push_str(&format!(
            "\n...and {} more errors.\n",
            diagnostics.len() - MAX_REPORTED_DIAGNOSTICS
        ));
    }
    ExecutionFailure::new(FailureCode::Compile, message)
}

#[cfg(test)]
mod test;

mod program;
