//! Removes a disconnected inbox's email documents from the search index as a
//! throttled background OpenSearch task, so the delete holds no consumer
//! worker and never stalls the Kafka poll loop.
//!
//! The inbox's mail is out of search results before this runs: the email
//! service removes the inbox's rows before it announces the disconnect, and
//! email search drops hits it cannot resolve to a row. The index delete only
//! reclaims the documents, so it forces no refresh and can wait its turn.

use std::{
    sync::Arc,
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
/// Consecutive failed progress reads before a delete is no longer followed.
const MAX_POLL_ERRORS: u8 = 3;
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
}

/// Starts whole-inbox deletes, at most [`MAX_RUNNING`] at a time, and follows
/// each to completion in the background.
pub(crate) struct MailboxDeletes<T = OpensearchClient> {
    tasks: Arc<T>,
    running: Arc<Semaphore>,
    tracker: TaskTracker,
    shutdown: CancellationToken,
    poll_interval: Duration,
}

impl<T> Clone for MailboxDeletes<T> {
    fn clone(&self) -> Self {
        Self {
            tasks: Arc::clone(&self.tasks),
            running: Arc::clone(&self.running),
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
}

impl FollowReport {
    fn new(outcome: FollowOutcome, restarts: u8, task: Option<&EmailDeleteTask>) -> Self {
        Self {
            outcome,
            restarts,
            deleted: task.map_or(0, |task| task.deleted),
            total: task.map_or(0, |task| task.total),
        }
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
    /// Progress could not be read; the task may still be running.
    Unreadable,
    /// The service shut down while following; OpenSearch keeps running the task.
    Unfollowed,
    /// The service shut down before the delete's turn came; nothing was started.
    NotStarted,
}

impl FollowOutcome {
    fn is_error(self) -> bool {
        matches!(self, Self::Failed | Self::Unreadable | Self::NotStarted)
    }
}

/// Why waiting on a task stopped.
enum Wait {
    Ended(Ended),
    Unreadable(anyhow::Error),
    Shutdown,
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
        let span = tracing::info_span!(
            "email.mailbox_delete",
            link_id = %link_id,
            task_id = field::Empty,
            restarted_task_id = field::Empty,
            queued_ms = field::Empty,
            deleted = field::Empty,
            total = field::Empty,
            restarts = field::Empty,
            outcome = field::Empty,
            otel.status_code = field::Empty,
        );
        let started = match Arc::clone(&self.running).try_acquire_owned() {
            Ok(permit) => {
                let task_id = self.tasks.start(link_id).instrument(span.clone()).await?;
                Some((permit, task_id))
            }
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
        let span = tracing::Span::current();
        span.record("deleted", report.deleted);
        span.record("total", report.total);
        span.record("restarts", report.restarts);
        span.record("outcome", <&'static str>::from(report.outcome));
        if report.outcome.is_error() {
            span.record("otel.status_code", "ERROR");
        }
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
            None => FollowReport::new(FollowOutcome::NotStarted, 0, None),
            Some(Err(error)) => {
                tracing::error!(error = ?error, "inbox search delete could not start; its documents stay in the index");
                FollowReport::new(FollowOutcome::Failed, 0, None)
            }
            Some(Ok(task_id)) => self.follow_started(link_id, permit, task_id).await,
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
        loop {
            let (failure, task) = match self.wait(&task_id).await {
                Wait::Shutdown => {
                    return FollowReport::new(FollowOutcome::Unfollowed, restarts, None);
                }
                Wait::Unreadable(error) => {
                    tracing::error!(error = ?error, "inbox search delete progress unreadable; the task may still be running");
                    return FollowReport::new(FollowOutcome::Unreadable, restarts, None);
                }
                Wait::Ended(Ended::Completed(task)) => {
                    return FollowReport::new(FollowOutcome::Completed, restarts, Some(&task));
                }
                Wait::Ended(Ended::Canceled(task, reason)) => {
                    tracing::warn!(
                        reason,
                        "inbox search delete was cancelled; not starting it again"
                    );
                    return FollowReport::new(FollowOutcome::Canceled, restarts, Some(&task));
                }
                Wait::Ended(Ended::Failed(task, failure)) => (failure, Some(task)),
                Wait::Ended(Ended::Vanished) => {
                    ("OpenSearch no longer knows the task".to_owned(), None)
                }
            };
            if restarts >= MAX_RESTARTS {
                tracing::error!(failure, "inbox search delete failed");
                return FollowReport::new(FollowOutcome::Failed, restarts, task.as_ref());
            }
            tracing::warn!(failure, "inbox search delete failed, starting it again");
            restarts += 1;
            match self.start_task(link_id).await {
                None => return FollowReport::new(FollowOutcome::Unfollowed, restarts, None),
                Some(Err(error)) => {
                    tracing::error!(error = ?error, "inbox search delete could not restart");
                    return FollowReport::new(FollowOutcome::Failed, restarts, task.as_ref());
                }
                Some(Ok(id)) => {
                    tracing::Span::current().record("restarted_task_id", id.as_str());
                    task_id = id;
                }
            }
        }
    }

    /// Starts a task, trying [`START_ATTEMPTS`] times. `None` when shutdown
    /// came first.
    async fn start_task(&self, link_id: Uuid) -> Option<anyhow::Result<EmailDeleteTaskId>> {
        let mut attempt = 1;
        loop {
            let result = tokio::select! {
                biased;
                () = self.shutdown.cancelled() => return None,
                result = self.tasks.start(link_id) => result,
            };
            match result {
                Ok(task_id) => return Some(Ok(task_id)),
                Err(error) if attempt >= START_ATTEMPTS => return Some(Err(error)),
                Err(error) => {
                    tracing::warn!(error = ?error, attempt, "inbox search delete could not start; trying again");
                    attempt += 1;
                    tokio::select! {
                        biased;
                        () = self.shutdown.cancelled() => return None,
                        () = tokio::time::sleep(self.poll_interval) => {}
                    }
                }
            }
        }
    }

    /// Polls `task_id` until it ends, its progress stays unreadable, or the
    /// service shuts down.
    async fn wait(&self, task_id: &EmailDeleteTaskId) -> Wait {
        let mut poll_errors = 0;
        loop {
            tokio::select! {
                biased;
                () = self.shutdown.cancelled() => return Wait::Shutdown,
                () = tokio::time::sleep(self.poll_interval) => {}
            }
            let progress = tokio::select! {
                biased;
                () = self.shutdown.cancelled() => return Wait::Shutdown,
                progress = self.tasks.progress(task_id) => progress,
            };
            match progress {
                Ok(None) => return Wait::Ended(Ended::Vanished),
                Ok(Some(task)) => match task.state.clone() {
                    EmailDeleteState::Running => poll_errors = 0,
                    EmailDeleteState::Completed => return Wait::Ended(Ended::Completed(task)),
                    EmailDeleteState::Failed(failure) => {
                        return Wait::Ended(Ended::Failed(task, failure));
                    }
                    EmailDeleteState::Canceled(reason) => {
                        return Wait::Ended(Ended::Canceled(task, reason));
                    }
                },
                Err(error) => {
                    poll_errors += 1;
                    if poll_errors >= MAX_POLL_ERRORS {
                        return Wait::Unreadable(error);
                    }
                }
            }
        }
    }
}
