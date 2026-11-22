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
    /// Programs that passed a precheck, oldest first, each good for one run
    /// until it expires.
    prechecked: Arc<std::sync::Mutex<std::collections::VecDeque<Prechecked>>>,
}

/// A precheck pass: what was checked (a program's shape, or `None` for a
/// module) and its SHA-256, and when it lapses.
struct Prechecked {
    shape: Option<ContextShape>,
    digest: [u8; 32],
    until: Instant,
}

/// What one type check covers.
#[derive(Clone, Copy)]
enum Checked<'a> {
    /// An attended TypeScript program, whose `main` receives a context of
    /// `shape`.
    Program {
        source: &'a str,
        shape: ContextShape,
    },
    /// A JS tools program's TypeScript module: no SDK, no context.
    Module(&'a str),
}

impl<'a> Checked<'a> {
    /// What a run of `request` checks before it runs: a TypeScript program,
    /// a JS tools program's module, or nothing (a JS tools program alone,
    /// which its run parses and analyzes instead).
    fn of(request: &'a ExecuteRequest, shape: ContextShape) -> Option<Self> {
        match request.language {
            Language::Javascript => Some(Self::Program {
                source: &request.source,
                shape,
            }),
            Language::JsTools => request.module.as_deref().map(Self::Module),
        }
    }

    fn text(self) -> &'a str {
        match self {
            Self::Program { source, .. } | Self::Module(source) => source,
        }
    }

    fn shape(self) -> Option<ContextShape> {
        match self {
            Self::Program { shape, .. } => Some(shape),
            Self::Module(_) => None,
        }
    }

    /// How the model's error text names it.
    fn noun(self) -> &'static str {
        match self {
            Self::Program { .. } => "it",
            Self::Module(_) => "its module",
        }
    }
}

/// How long a pass waits for its run: long enough for an owner to approve.
const PRECHECK_TTL: std::time::Duration = std::time::Duration::from_secs(30 * 60);
/// Passes remembered at once; past it the oldest is forgotten and its run
/// checks it again.
const MAX_PRECHECKED: usize = 4096;

fn digest(source: &str) -> [u8; 32] {
    use sha2::Digest as _;
    sha2::Sha256::digest(source.as_bytes()).into()
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
            prechecked: Arc::default(),
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
        if let Some(module) = &request.module
            && (request.language != Language::JsTools
                || module.trim().is_empty()
                || module.len() > self.limits.max_source_bytes)
        {
            return Err(AdmissionError::InvalidModule);
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
            language = job.request.language.as_str(),
            module_bytes = job.request.module.as_ref().map(String::len),
            allowed_operations = job.environment.allowed_operations.as_ref().map(Vec::len),
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
    /// never runs. One [`ProgramExecutor::check_program`] passed for this
    /// run isn't checked again.
    async fn check_then_run(
        &self,
        job: ExecutionJob,
        sink: &mut EventSink,
        token: CancellationToken,
    ) -> Outcome {
        let span = tracing::Span::current();
        // A JS tools program isn't TypeScript: its run parses and analyzes
        // it, and refuses one that doesn't. Its module is TypeScript.
        let checked = Checked::of(&job.request, job.environment.shape())
            .filter(|_| job.environment.unattended.is_none());
        match checked {
            None => {
                span.record("check", "skipped");
            }
            Some(checked) if self.take_prechecked(checked) => {
                span.record("check", "prechecked");
            }
            Some(checked) => {
                let outcome = tokio::select! {
                    biased;
                    _ = token.cancelled() => return Outcome::Cancelled,
                    _ = sink.closed() => return Outcome::Cancelled,
                    _ = sleep_until(job.deadline) => return Outcome::TimedOut,
                    outcome = self.check(checked) => outcome,
                };
                if let Err((label, failure)) = outcome {
                    span.record("check", label);
                    return failure.into();
                }
                span.record("check", "passed");
            }
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
                                process.exit_code = tracing::field::Empty,
                                process.signal = tracing::field::Empty,
                                process.wall_ms = tracing::field::Empty,
                                process.cpu_ms = tracing::field::Empty,
                                process.peak_rss_kib = tracing::field::Empty,
                                process.killed = tracing::field::Empty,
                            ))
                            .await
                    }
                }
            }
        }
    }

    /// Type-check a program or module: `Err` carries the span label and
    /// the failure to end the run with.
    async fn check(&self, checked: Checked<'_>) -> Result<(), (&'static str, ExecutionFailure)> {
        let source = checked.text();
        if let Some(directive) = CHECK_OPT_OUTS
            .iter()
            .find(|directive| source.contains(**directive))
        {
            return Err((
                "rejected",
                ExecutionFailure::new(
                    FailureCode::Compile,
                    format!(
                        "The program wasn't run: {} turns type checking off with {directive}. Remove it and fix the types instead.",
                        checked.noun()
                    ),
                ),
            ));
        }
        let (file, declarations, imports) = match checked {
            Checked::Program { shape, .. } => (
                PROGRAM_FILE,
                program_context(shape),
                ProgramImports::SdkAndHandlebars,
            ),
            Checked::Module(_) => (
                MODULE_FILE,
                MODULE_DECLARATIONS.to_owned(),
                ProgramImports::Handlebars,
            ),
        };
        let files = [SourceFile {
            name: file.to_owned(),
            source: source.to_owned(),
        }];
        match self
            .checker
            .check_files(&files, &declarations, imports)
            .await
        {
            Ok(diagnostics) if diagnostics.is_empty() => Ok(()),
            Ok(diagnostics) => Err(("rejected", type_errors(checked, &diagnostics))),
            Err(CheckError::Busy) => Err((
                "busy",
                ExecutionFailure::new(
                    FailureCode::Limit,
                    "The program wasn't run: Macro is busy type-checking other programs. Run it again shortly.",
                ),
            )),
            Err(CheckError::InvalidSource | CheckError::Internal) => Err((
                "failed",
                ExecutionFailure::new(
                    FailureCode::Internal,
                    "The program wasn't run: type-checking it failed. Run it again shortly.",
                ),
            )),
        }
    }

    /// Check a program ahead of its run, so a type error stops it before
    /// its host does anything for it. A pass is remembered for one run of
    /// the same source and shape.
    pub(super) async fn precheck(
        &self,
        request: &ExecuteRequest,
        shape: ContextShape,
        cancellation: CancellationToken,
    ) -> Result<(), Outcome> {
        let span = tracing::info_span!("code_execution.precheck", check = tracing::field::Empty);
        let Some(checked) = Checked::of(request, shape) else {
            span.record("check", "skipped");
            return Ok(());
        };
        if checked.text().trim().is_empty() || checked.text().len() > self.limits.max_source_bytes {
            span.record("check", "invalid");
            let invalid = match checked {
                Checked::Program { .. } => AdmissionError::InvalidSource,
                Checked::Module(_) => AdmissionError::InvalidModule,
            };
            return Err(ExecutionFailure::new(FailureCode::Limit, invalid.to_string()).into());
        }
        // A precheck counts against this executor's admission like a run,
        // so one executor's callers can't fill the checker it shares.
        let Ok(_admitted) = self.admitted.try_acquire() else {
            span.record("check", "busy");
            return Err(ExecutionFailure::new(
                FailureCode::Limit,
                AdmissionError::Busy.to_string(),
            )
            .into());
        };
        let duration =
            std::time::Duration::from_millis(request.timeout_ms).min(self.limits.max_duration);
        let outcome = tokio::select! {
            biased;
            _ = cancellation.cancelled() => {
                span.record("check", "cancelled");
                return Err(Outcome::Cancelled);
            }
            _ = tokio::time::sleep(duration) => {
                span.record("check", "timed_out");
                return Err(Outcome::TimedOut);
            }
            outcome = self.check(checked).instrument(span.clone()) => outcome,
        };
        match outcome {
            Ok(()) => {
                span.record("check", "passed");
                let mut prechecked = self
                    .prechecked
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner);
                let now = Instant::now();
                prechecked.retain(|pass| pass.until > now);
                if prechecked.len() == MAX_PRECHECKED {
                    prechecked.pop_front();
                }
                prechecked.push_back(Prechecked {
                    shape: checked.shape(),
                    digest: digest(checked.text()),
                    until: now + PRECHECK_TTL,
                });
                Ok(())
            }
            Err((label, failure)) => {
                span.record("check", label);
                Err(failure.into())
            }
        }
    }

    /// Whether `checked` passed a precheck that no run has used yet; using
    /// it takes it.
    fn take_prechecked(&self, checked: Checked<'_>) -> bool {
        let mut prechecked = self
            .prechecked
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let shape = checked.shape();
        let digest = digest(checked.text());
        let now = Instant::now();
        match prechecked
            .iter()
            .position(|pass| pass.shape == shape && pass.digest == digest && pass.until > now)
        {
            Some(index) => {
                prechecked.remove(index);
                true
            }
            None => false,
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
/// What a JS tools program's module is checked as.
const MODULE_FILE: &str = "module.ts";
/// A module's ambient declarations: none.
const MODULE_DECLARATIONS: &str = "export {};\n";
/// Type errors shown to the model; it fixes these and sees the rest next time.
const MAX_REPORTED_DIAGNOSTICS: usize = 20;

/// The checker's problems, as the model reads them to fix the program. Each
/// message names its file, line and column (`at main.ts:2:18`).
fn type_errors(checked: Checked<'_>, diagnostics: &[Diagnostic]) -> ExecutionFailure {
    let mut message = String::from(match checked {
        Checked::Program { .. } => {
            "The program wasn't run: it doesn't type-check against the Macro SDK. Fix these errors and run it again.\n"
        }
        Checked::Module(_) => {
            "The program wasn't run: its module doesn't type-check. Fix these errors and run it again.\n"
        }
    });
    for diagnostic in diagnostics.iter().take(MAX_REPORTED_DIAGNOSTICS) {
        message.push('\n');
        message.push_str(&diagnostic.message);
        message.push('\n');
        if let Some(members) = missing_member_hint(&diagnostic.message) {
            message.push_str(&members);
            message.push('\n');
        }
    }
    if diagnostics.len() > MAX_REPORTED_DIAGNOSTICS {
        message.push_str(&format!(
            "\n...and {} more errors.\n",
            diagnostics.len() - MAX_REPORTED_DIAGNOSTICS
        ));
    }
    ExecutionFailure::new(FailureCode::Compile, message)
}

/// Comments that would turn the checker off for a program.
const CHECK_OPT_OUTS: [&str; 3] = ["@ts-nocheck", "@ts-ignore", "@ts-expect-error"];

/// Most SDK members a hint lists.
const MAX_HINTED_MEMBERS: usize = 80;

/// For a use of a member an SDK type doesn't have (TS2339; one the checker
/// can suggest a near name for is TS2551 instead), the members it has.
fn missing_member_hint(message: &str) -> Option<String> {
    use nom::Parser as _;
    use nom::bytes::complete::{tag, take_until, take_while1};
    let (rest, _) = take_until::<_, _, ()>("TS2339 [ERROR]: Property '")
        .parse(message)
        .ok()?;
    let (_, (_, _, _, type_name, _)) = (
        tag::<_, _, ()>("TS2339 [ERROR]: Property '"),
        take_until("'"),
        tag("' does not exist on type '"),
        take_while1(|c: char| c.is_ascii_alphanumeric() || c == '_'),
        tag("'."),
    )
        .parse(rest)
        .ok()?;
    let members = sdk_members(type_name)?;
    if members.is_empty() || members.len() > MAX_HINTED_MEMBERS {
        return None;
    }
    Some(format!("  {type_name} has: {}.", members.join(", ")))
}

#[cfg(test)]
mod test;

mod program;
