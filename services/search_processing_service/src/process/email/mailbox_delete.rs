//! Removes a disconnected inbox's email documents from the search index as a
//! throttled background OpenSearch task, so the delete holds no consumer
//! worker and never stalls the Kafka poll loop.
//!
//! The inbox's mail is out of search results before this runs: the email
//! service removes the inbox's rows before it announces the disconnect, and
//! email search drops hits it cannot resolve to a row. The index delete only
//! reclaims the documents, so it forces no refresh and can wait its turn.

use std::{
    collections::HashSet,
    sync::{Arc, Mutex, PoisonError},
    time::{Duration, Instant},
};

use opensearch_client::{
    OpensearchClient,
    delete::email::{EmailDeleteState, EmailDeleteTask, EmailDeleteTaskId},
};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};
use tokio_util::{sync::CancellationToken, task::TaskTracker};
use tracing::{Instrument as _, field};
use uuid::Uuid;

#[cfg(test)]
mod test;

/// Documents per second one inbox delete may remove, split across slices.
const DOCS_PER_SECOND: i64 = 1_000;
/// Inbox deletes running at once; the throttle is per task, so this bounds
/// the total. More wait their turn in the background.
const MAX_RUNNING: usize = 2;
/// How often a running delete task is checked, and how long a failed start
/// waits before the next attempt.
const POLL_INTERVAL: Duration = Duration::from_secs(5);
/// Consecutive failed progress reads before the first warning. The delete
/// keeps its slot meanwhile: the task may still run.
const MAX_POLL_ERRORS: u8 = 3;
/// Failed progress reads between later warnings, about five minutes apart.
const POLL_ERRORS_PER_WARNING: u32 = 60;
/// How long progress may stay unreadable before the delete is given up on and
/// its slot freed. Its task may still be running then, so past this the
/// [`MAX_RUNNING`] limit is best effort.
const UNREADABLE_LIMIT: Duration = Duration::from_secs(30 * 60);
/// Attempts to start a task that waited for its turn or replaces a failed one.
const START_ATTEMPTS: u8 = 3;
/// Times a failed or vanished task is started again. `restarted_task_id` on
/// the span holds the replacement, so this stays at one.
const MAX_RESTARTS: u8 = 1;

/// The OpenSearch operations a whole-inbox delete needs.
pub(crate) trait DeleteTasks: Send + Sync + 'static {
    fn start(
        &self,
        link_id: Uuid,
    ) -> impl Future<Output = anyhow::Result<EmailDeleteTaskId>> + Send;
    fn progress(
        &self,
        task_id: &EmailDeleteTaskId,
    ) -> impl Future<Output = anyhow::Result<Option<EmailDeleteTask>>> + Send;
    /// Makes every write so far visible to the next delete-by-query.
    fn refresh(&self) -> impl Future<Output = anyhow::Result<()>> + Send;
}

impl DeleteTasks for OpensearchClient {
    async fn start(&self, link_id: Uuid) -> anyhow::Result<EmailDeleteTaskId> {
        Ok(self
            .start_email_link_delete(&link_id.to_string(), DOCS_PER_SECOND)
            .await?)
    }

    async fn progress(
        &self,
        task_id: &EmailDeleteTaskId,
    ) -> anyhow::Result<Option<EmailDeleteTask>> {
        Ok(self.email_delete_task(task_id).await?)
    }

    async fn refresh(&self) -> anyhow::Result<()> {
        Ok(self.refresh_email_index().await?)
    }
}

/// Starts whole-inbox deletes, at most [`MAX_RUNNING`] at a time, and follows
/// each to completion in the background.
pub(crate) struct MailboxDeletes<T = OpensearchClient> {
    tasks: Arc<T>,
    running: Arc<Semaphore>,
    /// Inboxes with a delete waiting or followed in this process, so a second
    /// event for one starts no second follower.
    following: Arc<Mutex<HashSet<Uuid>>>,
    tracker: TaskTracker,
    shutdown: CancellationToken,
    poll_interval: Duration,
}

impl<T> Clone for MailboxDeletes<T> {
    fn clone(&self) -> Self {
        Self {
            tasks: Arc::clone(&self.tasks),
            running: Arc::clone(&self.running),
            following: Arc::clone(&self.following),
            tracker: self.tracker.clone(),
            shutdown: self.shutdown.clone(),
            poll_interval: self.poll_interval,
        }
    }
}

/// What following one inbox delete found.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct FollowReport {
    outcome: FollowOutcome,
    restarts: u8,
    deleted: u64,
    total: u64,
    poll_errors: u32,
}

impl FollowReport {
    fn new(outcome: FollowOutcome, restarts: u8, task: Option<&EmailDeleteTask>) -> Self {
        Self {
            outcome,
            restarts,
            deleted: task.map_or(0, |task| task.deleted),
            total: task.map_or(0, |task| task.total),
            poll_errors: 0,
        }
    }

    fn with_poll_errors(mut self, poll_errors: u32) -> Self {
        self.poll_errors = poll_errors;
        self
    }
}

/// How one inbox delete ended, as far as this service saw it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
enum FollowOutcome {
    Completed,
    Failed,
    /// Cancelled in OpenSearch, by an operator; not started again.
    Canceled,
    /// Progress stayed unreadable for [`UNREADABLE_LIMIT`]; the task may still run.
    Unreadable,
    /// The service shut down while following; OpenSearch keeps running the task.
    Unfollowed,
    /// The service shut down before the delete, or its replacement, was sent.
    NotStarted,
    /// The service shut down while a start was in flight, so OpenSearch may
    /// have accepted it; look for the task by its `X-Opaque-Id`.
    StartInterrupted,
}

impl FollowOutcome {
    fn is_error(self) -> bool {
        matches!(
            self,
            Self::Failed | Self::Unreadable | Self::NotStarted | Self::StartInterrupted
        )
    }
}

/// Why waiting on a task stopped, with the failed progress reads seen.
enum Wait {
    Ended(Ended, u32),
    Unreadable(anyhow::Error, u32),
    Shutdown(u32),
}

/// What an attempt to start a task came to.
enum Start {
    Started(EmailDeleteTaskId),
    Failed(anyhow::Error),
    /// Shutdown came before a request was sent.
    NotSent,
    /// Shutdown came while a request was in flight.
    Interrupted,
}

/// How a task ended.
enum Ended {
    Completed(EmailDeleteTask),
    Failed(EmailDeleteTask, String),
    Canceled(EmailDeleteTask, String),
    /// OpenSearch no longer knows the task, so it stopped without a result.
    Vanished,
}

impl<T: DeleteTasks> MailboxDeletes<T> {
    pub(crate) fn new(tasks: Arc<T>, tracker: TaskTracker, shutdown: CancellationToken) -> Self {
        Self {
            tasks,
            running: Arc::new(Semaphore::new(MAX_RUNNING)),
            following: Arc::default(),
            tracker,
            shutdown,
            poll_interval: POLL_INTERVAL,
        }
    }

    #[cfg(test)]
    fn with_poll_interval(mut self, poll_interval: Duration) -> Self {
        self.poll_interval = poll_interval;
        self
    }

    /// Starts deleting `link_id`'s documents. With a free slot it returns once
    /// OpenSearch has accepted the task, and a failure to start fails the event
    /// so it retries. Otherwise the delete waits for a slot in the background
    /// and the event is done.
    pub(crate) async fn start(&self, link_id: Uuid) -> anyhow::Result<()> {
        if !self
            .following
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(link_id)
        {
            tracing::info!(link_id = %link_id, "inbox search delete already followed");
            return Ok(());
        }
        let span = tracing::info_span!(
            "email.mailbox_delete",
            link_id = %link_id,
            task_id = field::Empty,
            restarted_task_id = field::Empty,
            queued_ms = field::Empty,
            deleted = field::Empty,
            total = field::Empty,
            restarts = field::Empty,
            poll_errors = field::Empty,
            outcome = field::Empty,
            otel.status_code = field::Empty,
        );
        let started = match Arc::clone(&self.running).try_acquire_owned() {
            Ok(permit) => match self.tasks.start(link_id).instrument(span.clone()).await {
                Ok(task_id) => Some((permit, task_id)),
                Err(error) => {
                    self.stop_following(link_id);
                    return Err(error);
                }
            },
            Err(_) => None,
        };
        let this = self.clone();
        let queued_at = Instant::now();
        self.tracker
            .spawn(async move { this.run(link_id, started, queued_at).await }.instrument(span));
        Ok(())
    }

    async fn run(
        &self,
        link_id: Uuid,
        started: Option<(OwnedSemaphorePermit, EmailDeleteTaskId)>,
        queued_at: Instant,
    ) {
        let report = match started {
            Some((permit, task_id)) => self.follow_started(link_id, permit, task_id).await,
            None => self.wait_turn_then_follow(link_id, queued_at).await,
        };
        self.stop_following(link_id);
        let span = tracing::Span::current();
        span.record("deleted", report.deleted);
        span.record("total", report.total);
        span.record("restarts", report.restarts);
        span.record("poll_errors", report.poll_errors);
        span.record("outcome", <&'static str>::from(report.outcome));
        if report.outcome.is_error() {
            span.record("otel.status_code", "ERROR");
        }
    }

    fn stop_following(&self, link_id: Uuid) {
        self.following
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .remove(&link_id);
    }

    async fn wait_turn_then_follow(&self, link_id: Uuid, queued_at: Instant) -> FollowReport {
        // Shutdown frees the running deletes' slots; checking it first keeps a
        // waiting delete from starting a task the service will not follow.
        let permit = tokio::select! {
            biased;
            () = self.shutdown.cancelled() => None,
            permit = Arc::clone(&self.running).acquire_owned() => permit.ok(),
        };
        let Some(permit) = permit else {
            tracing::warn!(
                "inbox search delete not started before shutdown; its documents stay in the index"
            );
            return FollowReport::new(FollowOutcome::NotStarted, 0, None);
        };
        let queued_ms = u64::try_from(queued_at.elapsed().as_millis()).unwrap_or(u64::MAX);
        tracing::Span::current().record("queued_ms", queued_ms);
        match self.start_task(link_id).await {
            Start::Started(task_id) => self.follow_started(link_id, permit, task_id).await,
            Start::NotSent => FollowReport::new(FollowOutcome::NotStarted, 0, None),
            Start::Interrupted => FollowReport::new(FollowOutcome::StartInterrupted, 0, None),
            Start::Failed(error) => {
                tracing::error!(error = ?error, "inbox search delete could not start; its documents stay in the index");
                FollowReport::new(FollowOutcome::Failed, 0, None)
            }
        }
    }

    /// Follows a started task, keeping its slot until it ends.
    async fn follow_started(
        &self,
        link_id: Uuid,
        _slot: OwnedSemaphorePermit,
        task_id: EmailDeleteTaskId,
    ) -> FollowReport {
        tracing::Span::current().record("task_id", task_id.as_str());
        self.follow(link_id, task_id).await
    }

    async fn follow(&self, link_id: Uuid, mut task_id: EmailDeleteTaskId) -> FollowReport {
        let mut restarts = 0;
        let mut poll_errors = 0;
        loop {
            let (failure, task) = match self.wait(&task_id).await {
                Wait::Shutdown(errors) => {
                    return FollowReport::new(FollowOutcome::Unfollowed, restarts, None)
                        .with_poll_errors(poll_errors + errors);
                }
                Wait::Unreadable(error, errors) => {
                    tracing::error!(error = ?error, "inbox search delete progress stayed unreadable; no longer following it");
                    return FollowReport::new(FollowOutcome::Unreadable, restarts, None)
                        .with_poll_errors(poll_errors + errors);
                }
                Wait::Ended(ended, errors) => {
                    poll_errors += errors;
                    match ended {
                        Ended::Completed(task) => {
                            return FollowReport::new(
                                FollowOutcome::Completed,
                                restarts,
                                Some(&task),
                            )
                            .with_poll_errors(poll_errors);
                        }
                        Ended::Canceled(task, reason) => {
                            tracing::warn!(
                                reason,
                                "inbox search delete was cancelled; not starting it again"
                            );
                            return FollowReport::new(
                                FollowOutcome::Canceled,
                                restarts,
                                Some(&task),
                            )
                            .with_poll_errors(poll_errors);
                        }
                        Ended::Failed(task, failure) => (failure, Some(task)),
                        Ended::Vanished => ("OpenSearch no longer knows the task".to_owned(), None),
                    }
                }
            };
            let report = |outcome| {
                FollowReport::new(outcome, restarts, task.as_ref()).with_poll_errors(poll_errors)
            };
            if restarts >= MAX_RESTARTS {
                tracing::error!(failure, "inbox search delete failed");
                return report(FollowOutcome::Failed);
            }
            tracing::warn!(failure, "inbox search delete failed, starting it again");
            // The replacement's scan must see what the failed task deleted and
            // what changed under it, so refresh first; if that fails, wait past
            // a scheduled refresh instead.
            let refreshed = tokio::select! {
                biased;
                () = self.shutdown.cancelled() => return report(FollowOutcome::NotStarted),
                refreshed = self.tasks.refresh() => refreshed,
            };
            if let Err(error) = refreshed {
                tracing::warn!(error = ?error, "could not refresh the email index before restarting an inbox delete");
                tokio::select! {
                    biased;
                    () = self.shutdown.cancelled() => return report(FollowOutcome::NotStarted),
                    () = tokio::time::sleep(self.poll_interval) => {}
                }
            }
            restarts += 1;
            match self.start_task(link_id).await {
                Start::Started(id) => {
                    tracing::Span::current().record("restarted_task_id", id.as_str());
                    task_id = id;
                }
                Start::NotSent => {
                    return FollowReport::new(FollowOutcome::NotStarted, restarts, task.as_ref())
                        .with_poll_errors(poll_errors);
                }
                Start::Interrupted => {
                    return FollowReport::new(
                        FollowOutcome::StartInterrupted,
                        restarts,
                        task.as_ref(),
                    )
                    .with_poll_errors(poll_errors);
                }
                Start::Failed(error) => {
                    tracing::error!(error = ?error, "inbox search delete could not restart");
                    return FollowReport::new(FollowOutcome::Failed, restarts, task.as_ref())
                        .with_poll_errors(poll_errors);
                }
            }
        }
    }

    /// Starts a task, trying [`START_ATTEMPTS`] times. Starting adopts a
    /// delete already running for the inbox, so a retry does not start a
    /// second one.
    async fn start_task(&self, link_id: Uuid) -> Start {
        let mut attempt = 1;
        loop {
            if self.shutdown.is_cancelled() {
                return if attempt == 1 {
                    Start::NotSent
                } else {
                    Start::Interrupted
                };
            }
            let result = tokio::select! {
                biased;
                () = self.shutdown.cancelled() => return Start::Interrupted,
                result = self.tasks.start(link_id) => result,
            };
            match result {
                Ok(task_id) => return Start::Started(task_id),
                Err(error) if attempt >= START_ATTEMPTS => return Start::Failed(error),
                Err(error) => {
                    tracing::warn!(error = ?error, attempt, "inbox search delete could not start; trying again");
                    attempt += 1;
                    // An attempt was sent, and OpenSearch may have accepted it.
                    tokio::select! {
                        biased;
                        () = self.shutdown.cancelled() => return Start::Interrupted,
                        () = tokio::time::sleep(self.poll_interval) => {}
                    }
                }
            }
        }
    }

    /// Polls `task_id` until it ends, its progress stays unreadable for
    /// [`UNREADABLE_LIMIT`], or the service shuts down. While reads fail the
    /// delete keeps its slot, since the task may still be running.
    async fn wait(&self, task_id: &EmailDeleteTaskId) -> Wait {
        let mut errors: u32 = 0;
        let mut unreadable_since: Option<tokio::time::Instant> = None;
        loop {
            tokio::select! {
                biased;
                () = self.shutdown.cancelled() => return Wait::Shutdown(errors),
                () = tokio::time::sleep(self.poll_interval) => {}
            }
            let progress = tokio::select! {
                biased;
                () = self.shutdown.cancelled() => return Wait::Shutdown(errors),
                progress = self.tasks.progress(task_id) => progress,
            };
            match progress {
                Ok(None) => return Wait::Ended(Ended::Vanished, errors),
                Ok(Some(task)) => {
                    if let Some(since) = unreadable_since.take() {
                        tracing::info!(
                            unreadable_ms =
                                u64::try_from(since.elapsed().as_millis()).unwrap_or(u64::MAX),
                            "inbox search delete progress readable again"
                        );
                    }
                    match task.state.clone() {
                        EmailDeleteState::Running => {}
                        EmailDeleteState::Completed => {
                            return Wait::Ended(Ended::Completed(task), errors);
                        }
                        EmailDeleteState::Failed(failure) => {
                            return Wait::Ended(Ended::Failed(task, failure), errors);
                        }
                        EmailDeleteState::Canceled(reason) => {
                            return Wait::Ended(Ended::Canceled(task, reason), errors);
                        }
                    }
                }
                Err(error) => {
                    errors += 1;
                    let since = *unreadable_since.get_or_insert_with(tokio::time::Instant::now);
                    if since.elapsed() >= UNREADABLE_LIMIT {
                        return Wait::Unreadable(error, errors);
                    }
                    if errors == u32::from(MAX_POLL_ERRORS)
                        || errors.is_multiple_of(POLL_ERRORS_PER_WARNING)
                    {
                        tracing::warn!(error = ?error, poll_errors = errors, "inbox search delete progress unreadable; still following it");
                    }
                }
            }
        }
    }
}
