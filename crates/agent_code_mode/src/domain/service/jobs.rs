//! Background jobs: an `ExecuteCode` call that returns at once and runs on,
//! past its turn, until its program ends, someone cancels it, or its limit.
//!
//! A job is its execution record plus the job columns its store keeps. It
//! settles exactly once, writing its final record and its `job.settled`
//! notification in one transaction, which wakes the session. A replica that
//! stops settles its jobs as interrupted; a sweep settles the ones a replica
//! that died left behind. A job never runs again on its own.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use agent_runtime_protocol::domain::job::{
    BackgroundJobSummary, JobSettlement, JobUpdatedNotification,
};
use agent_runtime_protocol::domain::notification::NotificationEvent;
use agent_session::domain::notifications::{PendingNotification, ProduceNotification};
use tokio_util::task::TaskTracker;

use super::*;

#[cfg(test)]
mod test;

/// The longest a job runs, from its launch, slot wait included.
pub const JOB_LIMIT: Duration = Duration::from_secs(10 * 60);
/// How long past its deadline a job may stay running before the sweep
/// decides its replica died.
pub const SWEEP_GRACE: Duration = Duration::from_secs(2 * 60);
/// How many jobs run at once in a session and across an account.
pub const JOB_CAPS: JobCaps = JobCaps {
    per_session: 3,
    per_account: 10,
};
/// Jobs one replica runs at once; the rest wait for a slot.
const JOB_SLOTS: usize = 4;
/// Jobs one replica takes, running and waiting for a slot; past it a
/// launch runs in the foreground instead of queueing behind long jobs.
const JOBS_ON_REPLICA: usize = JOB_SLOTS * 2;
/// How often a running job reads its row (a cancel from another replica).
const WATCH_EVERY: Duration = Duration::from_secs(1);
/// Every how many row reads it also checks its session is still open.
const SESSION_EVERY: u32 = 5;
/// How often a running job saves its activity; its card polls every 2 s.
const SAVE_EVERY: Duration = Duration::from_secs(1);
/// Longest title a job may have.
const MAX_TITLE_CHARS: usize = 80;
/// Largest result a `job.settled` event carries; the event itself is
/// bounded to 64 KiB.
const MAX_SETTLED_RESULT_BYTES: usize = 48 * 1024;
/// A settled job's error, cut so the event stays under the 64 KiB limit.
const MAX_SETTLED_ERROR_BYTES: usize = 8 * 1024;
/// How often a settle is tried, and the wait before the first retry.
const SETTLE_ATTEMPTS: u32 = 3;
const SETTLE_RETRY_FIRST_WAIT: Duration = Duration::from_millis(250);
/// Longest shutdown waits for running jobs to settle as interrupted.
const SHUTDOWN_LIMIT: Duration = Duration::from_secs(20);
/// Longest a job waits on one read of its row or session.
const WATCH_READ_LIMIT: Duration = Duration::from_secs(2);
/// Most jobs one sweep settles.
const SWEEP_BATCH: u16 = 100;
/// How long settled jobs stay in the agent's job list.
const LISTED_FOR: chrono::TimeDelta = chrono::TimeDelta::hours(1);
/// Most jobs the agent's list shows.
const LISTED_JOBS: u16 = 10;

/// What a session's jobs run on, wired once at startup.
pub struct JobRuntime {
    /// A background executor with its own slots and the job limit, so
    /// foreground calls never wait behind jobs.
    pub executor: Arc<dyn ProgramExecutor>,
    /// Job rows.
    pub store: Arc<dyn JobStore>,
    /// Session liveness and the session log.
    pub sessions: Arc<dyn JobSessions>,
}

/// The running side of [`JobRuntime`].
pub(super) struct Jobs {
    runtime: JobRuntime,
    slots: Arc<Semaphore>,
    /// Places for this replica's jobs, running or waiting
    /// ([`JOBS_ON_REPLICA`]).
    taken: Arc<Semaphore>,
    tasks: TaskTracker,
    shutdown: CancellationToken,
    /// This replica's running jobs, so a cancel landing here stops one at
    /// once; others see their row within [`WATCH_EVERY`].
    local: Arc<Mutex<HashMap<ExecutionId, CancellationToken>>>,
}

/// What a launch did.
pub(super) enum Launch {
    /// The job runs; this is its receipt.
    Started(Box<ExecutionReceipt>),
    /// It may not run in the background; run it in the foreground.
    Foreground(String),
}

/// Why a job's run loop stopped watching.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Stop {
    /// The program ended on its own, or at its limit.
    Ended,
    /// Someone cancelled it.
    Cancelled,
    /// Its session was archived.
    Archived,
    /// This replica is stopping.
    Interrupted,
    /// Its row is gone or was settled elsewhere; nothing to save.
    Gone,
}

impl Jobs {
    pub(super) fn new(runtime: JobRuntime) -> Self {
        Self {
            runtime,
            slots: Arc::new(Semaphore::new(JOB_SLOTS)),
            taken: Arc::new(Semaphore::new(JOBS_ON_REPLICA)),
            tasks: TaskTracker::new(),
            shutdown: CancellationToken::new(),
            local: Arc::default(),
        }
    }

    /// Start `request` as a job, or say why it runs in the foreground.
    #[tracing::instrument(
        name = "agent.job.start",
        skip_all,
        fields(
            job_id = %identity.execution,
            agent_session_id = %identity.session,
            kind = "execute_code",
            launch_turn = %identity.turn,
            outcome = tracing::field::Empty,
        ),
        err
    )]
    pub(super) async fn launch(
        &self,
        service: &CodeModeService,
        mut identity: ExecutionIdentity,
        request: &ExecuteRequest,
        background: BackgroundRequest,
        turn: CancellationToken,
    ) -> Result<Launch, CodeModeError> {
        let span = tracing::Span::current();
        let title = background.title.trim().to_owned();
        if title.is_empty() || title.chars().count() > MAX_TITLE_CHARS {
            return Err(CodeModeError::Invalid(format!(
                "background.title must be 1 to {MAX_TITLE_CHARS} characters."
            )));
        }
        if self.shutdown.is_cancelled() {
            span.record("outcome", "foreground");
            return Ok(Launch::Foreground(
                "This server is restarting, so it could not start a background job.".into(),
            ));
        }
        // Until a job's credential can be revoked when it settles, a job
        // never sends: it runs unwatched for minutes.
        if background.sends {
            span.record("outcome", "foreground");
            return Ok(Launch::Foreground(SENDS_IN_FOREGROUND.into()));
        }
        if let Detach::Refused(reason) = service.inner.credentials.may_detach(&identity).await? {
            span.record("outcome", "foreground");
            return Ok(Launch::Foreground(reason));
        }
        let Ok(place) = Arc::clone(&self.taken).try_acquire_owned() else {
            span.record("outcome", "foreground");
            return Ok(Launch::Foreground(REPLICA_BUSY.into()));
        };
        let now = chrono::Utc::now();
        let deadline =
            now + chrono::TimeDelta::from_std(JOB_LIMIT).map_err(|_| CodeModeError::Unavailable)?;
        identity.lifetime = RunLifetime::Job { deadline };
        let mut record = ExecutionRecord {
            execution_id: identity.execution,
            acting_as: Some(identity.acting_as),
            turn_id: Some(identity.turn),
            source: request.source.clone(),
            status: ExecutionStatus::Running,
            result: None,
            error: None,
            calls: Vec::new(),
            activity: Vec::new(),
            activity_truncated: false,
            job: Some(JobInfo {
                title: title.clone(),
                started_at: now,
                deadline,
                correlation: None,
                never_ran: false,
            }),
        };
        let store = &self.runtime.store;
        match store
            .launch(identity.session, &identity.owner, &record, JOB_CAPS)
            .await
        {
            Ok(()) => {}
            Err(CodeModeError::Duplicate) => {
                match service
                    .inner
                    .store
                    .get(identity.session, identity.execution)
                    .await
                {
                    // The same launch again: its job, not a second one, or
                    // the foreground run it fell back to; never a replay.
                    Ok(existing)
                        if existing.source == request.source
                            && existing.acting_as == Some(identity.acting_as)
                            && existing.turn_id == Some(identity.turn) =>
                    {
                        span.record("outcome", "existing");
                        return Ok(Launch::Started(Box::new(receipt(&existing))));
                    }
                    Ok(_) | Err(CodeModeError::NotFound) => {
                        let fresh = ExecutionId::mint();
                        record.execution_id = fresh;
                        identity.execution = fresh;
                        store
                            .launch(identity.session, &identity.owner, &record, JOB_CAPS)
                            .await?;
                    }
                    Err(error) => return Err(error),
                }
            }
            Err(error) => {
                span.record("outcome", "refused");
                return Err(error);
            }
        }
        // Type errors and approval refusals come back at once, in this turn,
        // so they settle quietly: the agent reads them in the receipt. The
        // credential is minted only once the job holds a slot.
        let executor = &self.runtime.executor;
        if let Err(outcome) = executor
            .check_program(request, SESSION_PROGRAM, turn.clone())
            .await
        {
            (record.status, record.result, record.error) = settle_unrun(outcome, Reviews::Allowed);
            settle_retrying(store.as_ref(), identity.session, &record, None).await?;
            span.record("outcome", "check_failed");
            return Ok(Launch::Started(Box::new(receipt(&record))));
        }
        let acting_user = match service
            .inner
            .credentials
            .approve_job(&identity, &request.source, turn.clone())
            .await
        {
            Ok(acting_user) => acting_user,
            Err(error) => {
                record.status = ExecutionStatus::Failed;
                record.error = Some(error.to_string());
                settle_retrying(store.as_ref(), identity.session, &record, None).await?;
                span.record("outcome", "unauthorized");
                return Err(error);
            }
        };
        // Stop during the launch stops it; once spawned, only the job's own
        // cancel does.
        if turn.is_cancelled() {
            record.status = ExecutionStatus::Cancelled;
            record.error = Some("Execution cancelled before it started.".into());
            settle_retrying(store.as_ref(), identity.session, &record, None).await?;
            span.record("outcome", "cancelled");
            return Ok(Launch::Started(Box::new(receipt(&record))));
        }
        let stop = self.shutdown.child_token();
        if let Ok(mut local) = self.local.lock() {
            local.insert(record.execution_id, stop.clone());
        }
        self.announce(identity.session, &record).await;
        // Stop may have come while the announcement was written.
        if turn.is_cancelled() {
            if let Ok(mut local) = self.local.lock() {
                local.remove(&record.execution_id);
            }
            record.status = ExecutionStatus::Cancelled;
            record.error = Some("Execution cancelled before it started.".into());
            settle_retrying(store.as_ref(), identity.session, &record, None).await?;
            self.announce(identity.session, &record).await;
            span.record("outcome", "cancelled");
            return Ok(Launch::Started(Box::new(receipt(&record))));
        }
        let started = receipt(&record);
        let session = identity.session;
        let run = JobRun {
            store: Arc::clone(store),
            sessions: Arc::clone(&self.runtime.sessions),
            executor: Arc::clone(executor),
            credentials: Arc::clone(&service.inner.credentials),
            slots: Arc::clone(&self.slots),
            _place: place,
            shutdown: self.shutdown.clone(),
            stop,
            session,
            identity,
            acting_user,
            record,
            request: request.clone(),
        };
        let job = run.record.execution_id;
        let run_span = tracing::info_span!(
            parent: None,
            "agent.job.run",
            job_id = %job,
            agent_session_id = %session,
            outcome = tracing::field::Empty,
            duration_ms = tracing::field::Empty,
            writes = tracing::field::Empty,
            slot_wait_ms = tracing::field::Empty,
            result_bytes = tracing::field::Empty,
        );
        run_span.follows_from(&span);
        let local = Arc::clone(&self.local);
        self.tasks.spawn(
            async move {
                run.run().await;
                if let Ok(mut local) = local.lock() {
                    local.remove(&job);
                }
            }
            .instrument(run_span),
        );
        span.record("outcome", "started");
        Ok(Launch::Started(Box::new(started)))
    }

    /// Ask a job to stop: at once when it runs here, and through its row
    /// for the replica that runs it.
    #[tracing::instrument(name = "agent.job.cancel", skip_all, fields(job_id = %job, agent_session_id = %session), err)]
    pub(super) async fn cancel(
        &self,
        session: AgentSessionId,
        job: ExecutionId,
    ) -> Result<JobCancel, CodeModeError> {
        let cancel = self.runtime.store.request_cancel(session, job).await?;
        if cancel == JobCancel::Requested
            && let Some(stop) = self
                .local
                .lock()
                .ok()
                .and_then(|local| local.get(&job).cloned())
        {
            stop.cancel();
        }
        Ok(cancel)
    }

    /// The session's jobs for the agent's prompt.
    pub(super) async fn listing(
        &self,
        session: AgentSessionId,
    ) -> Result<Vec<BackgroundJobSummary>, CodeModeError> {
        let since = chrono::Utc::now() - LISTED_FOR;
        Ok(self
            .runtime
            .store
            .list(session, since, LISTED_JOBS)
            .await?
            .into_iter()
            .filter_map(|record| {
                let job = record.job?;
                Some(BackgroundJobSummary {
                    job_id: record.execution_id.as_uuid(),
                    title: job.title,
                    status: record.status.job_status(),
                    started_at: job.started_at.to_rfc3339(),
                })
            })
            .collect())
    }

    /// Settle jobs a dead replica left running.
    #[tracing::instrument(name = "agent.job.sweep", skip_all, fields(settled = tracing::field::Empty), err)]
    pub(super) async fn sweep(
        &self,
        credentials: &dyn ExecutionCredentials,
    ) -> Result<usize, CodeModeError> {
        let grace =
            chrono::TimeDelta::from_std(SWEEP_GRACE).map_err(|_| CodeModeError::Unavailable)?;
        let overdue = self
            .runtime
            .store
            .overdue(chrono::Utc::now() - grace, SWEEP_BATCH)
            .await?;
        let mut settled = 0;
        for (session, mut record) in overdue {
            revoke(credentials, &record).await;
            super::activity::finish(&mut record.activity);
            record.status = ExecutionStatus::Interrupted;
            // A job binds its credential before its program starts, so one
            // with none never ran.
            let never_ran = record
                .job
                .as_ref()
                .is_some_and(|job| job.correlation.is_none());
            if let Some(job) = &mut record.job {
                job.never_ran = never_ran;
            }
            record.error = Some(
                if never_ran {
                    INTERRUPTED_BEFORE_START
                } else {
                    INTERRUPTED
                }
                .into(),
            );
            match settle_job(self.runtime.store.as_ref(), session, &record).await {
                Ok(true) => {
                    settled += 1;
                    self.announce(session, &record).await;
                }
                Ok(false) => {}
                Err(error) => {
                    tracing::error!(?error, job_id = %record.execution_id, "could not settle an overdue job")
                }
            }
        }
        tracing::Span::current().record("settled", settled);
        Ok(settled)
    }

    /// Interrupt every job and wait, at most [`SHUTDOWN_LIMIT`], for them to
    /// settle; one whose settle can't finish in time is left to the sweep.
    pub(super) async fn shutdown(&self) {
        self.shutdown.cancel();
        self.tasks.close();
        if tokio::time::timeout(SHUTDOWN_LIMIT, self.tasks.wait())
            .await
            .is_err()
        {
            tracing::warn!("background jobs did not settle before shutdown; the sweep will");
        }
    }

    async fn announce(&self, session: AgentSessionId, record: &ExecutionRecord) {
        announce(self.runtime.sessions.as_ref(), session, record).await;
    }
}

/// One job's run, owned by its task.
struct JobRun {
    store: Arc<dyn JobStore>,
    sessions: Arc<dyn JobSessions>,
    executor: Arc<dyn ProgramExecutor>,
    credentials: Arc<dyn ExecutionCredentials>,
    slots: Arc<Semaphore>,
    /// Its place on this replica, held until it settles.
    _place: tokio::sync::OwnedSemaphorePermit,
    shutdown: CancellationToken,
    stop: CancellationToken,
    session: AgentSessionId,
    /// Who launched it, for its credential.
    identity: ExecutionIdentity,
    /// The account its launch was approved to act as.
    acting_user: MacroUserIdStr<'static>,
    record: ExecutionRecord,
    request: ExecuteRequest,
}

/// How far a job got.
enum Progress {
    /// Its program never started; nothing ran.
    NotStarted,
    /// It got a slot but could not start, for this reason; nothing ran.
    Refused(&'static str),
    /// Its program ran to this outcome.
    Finished(Outcome),
}

const CANCELLED: &str = "Background job cancelled. Unfinished calls may have taken effect; check current state before retrying writes.";
const ARCHIVED: &str = "Background job cancelled because its session was archived. Unfinished calls may have taken effect.";
const TIMED_OUT: &str = "Background job reached its 10-minute limit. Unfinished calls may have taken effect; check current state before retrying writes.";
const INTERRUPTED: &str = "Background job interrupted: the server running it stopped. Its outcome is unconfirmed; check current state before retrying writes. It was not run again.";
const SENDS_IN_FOREGROUND: &str = "A background job can't send email or messages, save routines, call connected apps or reach the web yet, so this program ran in the foreground.";
const REPLICA_BUSY: &str =
    "The server is busy with other background jobs, so this program ran in the foreground.";
const NEVER_STARTED: &str = "Background job did not start: the server was busy for its whole 10-minute limit. Nothing ran; run it again.";
const CANCELLED_BEFORE_START: &str = "Background job cancelled before it started. Nothing ran.";
const ARCHIVED_BEFORE_START: &str =
    "Background job cancelled before it started because its session was archived. Nothing ran.";
const INTERRUPTED_BEFORE_START: &str = "Background job did not start: the server stopped before it got a turn. Nothing ran, and it was not run again.";
const NO_CREDENTIAL: &str =
    "Background job did not start: its credential could not be issued. Nothing ran; run it again.";

impl JobRun {
    async fn run(mut self) {
        let started = tokio::time::Instant::now();
        let span = tracing::Span::current();
        let deadline = self.deadline();
        let stopped = self.wait_for_slot(deadline).await;
        span.record("slot_wait_ms", started.elapsed().as_millis() as u64);
        let (stop, ran) = match stopped {
            Err(stop) => (stop, Progress::NotStarted),
            Ok(permit) => {
                // The credential is minted in this span, so the program's
                // SDK calls are traced under it.
                let ran = self
                    .start(deadline)
                    .instrument(tracing::info_span!("agent.job.execute"))
                    .await;
                drop(permit);
                ran
            }
        };
        // The program has stopped: its credential stops too, before the
        // settle is written.
        revoke(self.credentials.as_ref(), &self.record).await;
        if stop == Stop::Gone {
            span.record("outcome", "gone");
            return;
        }
        super::activity::finish(&mut self.record.activity);
        let never_ran = matches!(ran, Progress::NotStarted | Progress::Refused(_));
        let (status, result, error) = match (stop, ran) {
            (_, Progress::Refused(reason)) => (ExecutionStatus::Failed, None, Some(reason.into())),
            // A job that never started says so: nothing it would have
            // written can have taken effect.
            (Stop::Interrupted, Progress::NotStarted) => (
                ExecutionStatus::Interrupted,
                None,
                Some(INTERRUPTED_BEFORE_START.into()),
            ),
            (Stop::Cancelled, Progress::NotStarted) => (
                ExecutionStatus::Cancelled,
                None,
                Some(CANCELLED_BEFORE_START.into()),
            ),
            (Stop::Archived, Progress::NotStarted) => (
                ExecutionStatus::Cancelled,
                None,
                Some(ARCHIVED_BEFORE_START.into()),
            ),
            (Stop::Ended | Stop::Gone, Progress::NotStarted) => {
                (ExecutionStatus::TimedOut, None, Some(NEVER_STARTED.into()))
            }
            (Stop::Interrupted, Progress::Finished(_)) => {
                (ExecutionStatus::Interrupted, None, Some(INTERRUPTED.into()))
            }
            (Stop::Cancelled, Progress::Finished(_)) => {
                (ExecutionStatus::Cancelled, None, Some(CANCELLED.into()))
            }
            (Stop::Archived, Progress::Finished(_)) => {
                (ExecutionStatus::Cancelled, None, Some(ARCHIVED.into()))
            }
            (_, Progress::Finished(Outcome::TimedOut)) => {
                (ExecutionStatus::TimedOut, None, Some(TIMED_OUT.into()))
            }
            // Cancelled with no stop of ours: the executor shut down under it.
            (_, Progress::Finished(Outcome::Cancelled)) => {
                (ExecutionStatus::Interrupted, None, Some(INTERRUPTED.into()))
            }
            (_, Progress::Finished(outcome)) => settle(outcome, Reviews::Allowed),
        };
        if let Some(job) = &mut self.record.job {
            job.never_ran = never_ran;
        }
        self.record.status = status;
        self.record.result = result;
        self.record.error = error;
        let status = self.record.status.job_status();
        span.record("outcome", <&'static str>::from(status));
        span.record("duration_ms", started.elapsed().as_millis() as u64);
        span.record("writes", self.record.activity.len());
        if let Some(value) = &self.record.result {
            span.record("result_bytes", value.to_string().len());
        }
        match settle_job(self.store.as_ref(), self.session, &self.record).await {
            Ok(true) => announce(self.sessions.as_ref(), self.session, &self.record).await,
            Ok(false) => {}
            Err(error) => {
                tracing::error!(?error, "could not settle a background job; the sweep will")
            }
        }
    }

    fn deadline(&self) -> tokio::time::Instant {
        let left = self
            .record
            .job
            .as_ref()
            .and_then(|job| (job.deadline - chrono::Utc::now()).to_std().ok())
            .unwrap_or_default();
        tokio::time::Instant::now() + left
    }

    /// Wait for one of this replica's job slots, within the job's limit,
    /// watching for a cancel meanwhile.
    async fn wait_for_slot(
        &self,
        deadline: tokio::time::Instant,
    ) -> Result<tokio::sync::OwnedSemaphorePermit, Stop> {
        let wait = async {
            let mut watch = tokio::time::interval(WATCH_EVERY);
            let mut watched = 0_u32;
            watch.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
            let acquire = Arc::clone(&self.slots).acquire_owned();
            tokio::pin!(acquire);
            loop {
                tokio::select! {
                    biased;
                    () = self.shutdown.cancelled() => return Err(Stop::Interrupted),
                    () = self.stop.cancelled() => {
                        return Err(if self.shutdown.is_cancelled() {
                            Stop::Interrupted
                        } else {
                            Stop::Cancelled
                        });
                    }
                    () = tokio::time::sleep_until(deadline) => return Err(Stop::Ended),
                    permit = &mut acquire => return permit.map_err(|_| Stop::Interrupted),
                    _ = watch.tick() => {
                        watched = watched.wrapping_add(1);
                        if let Some(stop) = self.watch_bounded(watched).await {
                            return Err(stop);
                        }
                    }
                }
            }
        };
        wait.instrument(tracing::info_span!("agent.job.queue"))
            .await
    }

    /// Mint the job's credential, bind the job to it and run the program.
    async fn start(&mut self, deadline: tokio::time::Instant) -> (Stop, Progress) {
        let issued = match self
            .credentials
            .mint_job(&self.identity, &self.acting_user)
            .await
        {
            Ok(issued) => issued,
            Err(error) => {
                tracing::warn!(?error, "could not mint a background job's credential");
                return (Stop::Ended, Progress::Refused(NO_CREDENTIAL));
            }
        };
        // Only this credential may spend the job's connected-app authority;
        // the record names it before the program can make a call.
        if let Some(job) = &mut self.record.job {
            job.correlation = issued.correlation;
        }
        match self.store_activity().await {
            Ok(()) => {}
            Err(CodeModeError::NotFound) => return (Stop::Gone, Progress::NotStarted),
            Err(error) => {
                tracing::warn!(?error, "could not bind a background job to its credential");
                return (Stop::Ended, Progress::Refused(NO_CREDENTIAL));
            }
        }
        let (stop, outcome) = self.execute(deadline, issued.environment).await;
        (stop, Progress::Finished(outcome))
    }

    /// Run the program, watching its row, its session and this replica.
    async fn execute(
        &mut self,
        deadline: tokio::time::Instant,
        environment: code_execution::domain::RunEnvironment,
    ) -> (Stop, Outcome) {
        let left = deadline.saturating_duration_since(tokio::time::Instant::now());
        if left.is_zero() {
            return (Stop::Ended, Outcome::TimedOut);
        }
        let request = ExecuteRequest {
            source: self.request.source.clone(),
            timeout_ms: u64::try_from(left.as_millis()).unwrap_or(u64::MAX).max(1),
        };
        let cancel = CancellationToken::new();
        let (progress, mut updates) = tokio::sync::mpsc::channel(512);
        let execution = self.executor.execute_program_with_progress(
            request,
            environment,
            cancel.clone(),
            progress,
        );
        tokio::pin!(execution);
        let mut watch = tokio::time::interval(WATCH_EVERY);
        watch.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        let mut watched = 0_u32;
        let mut save_tick = tokio::time::interval(SAVE_EVERY);
        let mut dirty = false;
        let mut progress_open = true;
        let mut stop = Stop::Ended;
        let outcome = loop {
            tokio::select! {
                outcome = &mut execution => break outcome,
                () = self.shutdown.cancelled(), if stop == Stop::Ended => {
                    stop = Stop::Interrupted;
                    cancel.cancel();
                }
                // Shutdown cancels `stop` too, as its parent: it still
                // reads as interrupted, whichever branch runs first.
                () = self.stop.cancelled(), if stop == Stop::Ended => {
                    stop = if self.shutdown.is_cancelled() {
                        Stop::Interrupted
                    } else {
                        Stop::Cancelled
                    };
                    cancel.cancel();
                }
                _ = watch.tick(), if stop == Stop::Ended => {
                    watched = watched.wrapping_add(1);
                    if let Some(found) = self.watch_bounded(watched).await {
                        stop = found;
                        cancel.cancel();
                    }
                }
                update = updates.recv(), if progress_open => {
                    if let Some(value) = update {
                        super::activity::observe(&mut self.record.activity, &mut self.record.activity_truncated, value);
                        dirty = true;
                    } else {
                        progress_open = false;
                    }
                }
                _ = save_tick.tick(), if dirty && stop == Stop::Ended => {
                    dirty = false;
                    let saved = tokio::time::timeout(
                        Duration::from_millis(100),
                        self.store_activity(),
                    ).await;
                    if !matches!(saved, Ok(Ok(()))) {
                        tracing::warn!("could not save live background job activity");
                    }
                }
            }
        };
        while let Ok(value) = updates.try_recv() {
            super::activity::observe(
                &mut self.record.activity,
                &mut self.record.activity_truncated,
                value,
            );
        }
        (stop, outcome)
    }

    async fn store_activity(&self) -> Result<(), CodeModeError> {
        self.store.save_activity(self.session, &self.record).await
    }

    /// [`Self::watch`], given up after [`WATCH_READ_LIMIT`]: a stalled read
    /// must not keep the loop from seeing a cancel or shutdown.
    async fn watch_bounded(&self, read: u32) -> Option<Stop> {
        tokio::time::timeout(WATCH_READ_LIMIT, self.watch(read))
            .await
            .unwrap_or_else(|_| {
                tracing::warn!("a background job's watch read timed out");
                None
            })
    }

    /// Read the job's row, and on every [`SESSION_EVERY`]th read its
    /// session: whether to stop, and why.
    async fn watch(&self, read: u32) -> Option<Stop> {
        match self
            .store
            .control(self.session, self.record.execution_id)
            .await
        {
            Ok(JobControl::Running) => {}
            Ok(JobControl::CancelRequested) => return Some(Stop::Cancelled),
            Ok(JobControl::Settled | JobControl::Gone) => return Some(Stop::Gone),
            Err(error) => {
                tracing::warn!(?error, "could not read a background job's row");
                return None;
            }
        }
        if read % SESSION_EVERY != 1 {
            return None;
        }
        match self.sessions.open(self.session).await {
            Ok(true) => None,
            Ok(false) => Some(Stop::Archived),
            Err(error) => {
                tracing::warn!(?error, "could not read a background job's session");
                None
            }
        }
    }
}

/// Settle a job with its `job.settled` notification, which wakes the session.
#[tracing::instrument(name = "agent.job.settle", skip_all, fields(job_id = %record.execution_id, agent_session_id = %session, status = tracing::field::Empty, settled = tracing::field::Empty), err)]
async fn settle_job(
    store: &dyn JobStore,
    session: AgentSessionId,
    record: &ExecutionRecord,
) -> Result<bool, CodeModeError> {
    let status = record.status.job_status();
    tracing::Span::current().record("status", <&'static str>::from(status));
    let notification = PendingNotification::new(ProduceNotification {
        session_id: session,
        subject_id: record.execution_id.to_string(),
        event: NotificationEvent::JobSettled(settlement(record)),
        dedupe_key: None,
        wake: true,
    })
    .map_err(|error| CodeModeError::Storage(rootcause::report!(error).into()))?;
    let settled = settle_retrying(store, session, record, Some(&notification)).await?;
    tracing::Span::current().record("settled", settled);
    Ok(settled)
}

/// Settle, retrying a failed write twice with a short backoff: a job left
/// running waits for the sweep, minutes later, and then reads as interrupted.
async fn settle_retrying(
    store: &dyn JobStore,
    session: AgentSessionId,
    record: &ExecutionRecord,
    notification: Option<&PendingNotification>,
) -> Result<bool, CodeModeError> {
    let mut wait = SETTLE_RETRY_FIRST_WAIT;
    for _ in 1..SETTLE_ATTEMPTS {
        match store.settle(session, record, notification).await {
            Ok(settled) => return Ok(settled),
            Err(error) => {
                tracing::warn!(?error, "could not settle a background job; retrying");
                tokio::time::sleep(wait).await;
                wait *= 4;
            }
        }
    }
    store.settle(session, record, notification).await
}

/// What the agent reads about a settled job: its result when it fits.
fn settlement(record: &ExecutionRecord) -> JobSettlement {
    let title = record
        .job
        .as_ref()
        .map(|job| job.title.clone())
        .unwrap_or_default();
    // A thrown error can be as large as the program made it; the event that
    // carries it must stay under the notification size limit.
    let mut error = record.error.as_deref().map(truncate_error);
    let result = record.result.clone().filter(|value| {
        let bytes = value.to_string().len();
        let fits = bytes <= MAX_SETTLED_RESULT_BYTES;
        if !fits {
            error = Some(format!(
                "The result ({} KiB) is too large to deliver here. Run a program that returns only what you need.",
                bytes / 1024
            ));
        }
        fits
    });
    JobSettlement {
        job_id: record.execution_id.as_uuid(),
        title,
        status: record.status.job_status(),
        result,
        error,
    }
}

/// The start of a long error, cut on a character boundary.
fn truncate_error(error: &str) -> String {
    if error.len() <= MAX_SETTLED_ERROR_BYTES {
        return error.to_owned();
    }
    let mut end = MAX_SETTLED_ERROR_BYTES;
    while !error.is_char_boundary(end) {
        end -= 1;
    }
    format!(
        "{} [error cut at {} KiB]",
        &error[..end],
        MAX_SETTLED_ERROR_BYTES / 1024
    )
}

/// Revoke the credential a job started with, if it started, retrying a
/// failed write as a settle is retried; one that still fails expires on its
/// own at the deadline.
async fn revoke(credentials: &dyn ExecutionCredentials, record: &ExecutionRecord) {
    let Some(correlation) = record.job.as_ref().and_then(|job| job.correlation) else {
        return;
    };
    let mut wait = SETTLE_RETRY_FIRST_WAIT;
    for attempt in 1..=SETTLE_ATTEMPTS {
        match credentials.revoke_job(correlation).await {
            Ok(()) => return,
            Err(error) if attempt < SETTLE_ATTEMPTS => {
                tracing::warn!(
                    ?error,
                    "could not revoke a background job's credential; retrying"
                );
                tokio::time::sleep(wait).await;
                wait *= 4;
            }
            Err(error) => {
                tracing::error!(?error, "could not revoke a background job's credential")
            }
        }
    }
}

/// Log the job's state in its session, best effort: views also poll.
async fn announce(sessions: &dyn JobSessions, session: AgentSessionId, record: &ExecutionRecord) {
    let Some(job) = &record.job else {
        return;
    };
    let update = JobUpdatedNotification {
        job_id: record.execution_id.as_uuid(),
        title: job.title.clone(),
        status: record.status.job_status(),
    };
    if let Err(error) = sessions.announce(session, &update).await {
        tracing::warn!(?error, "could not log a background job's update");
    }
}
