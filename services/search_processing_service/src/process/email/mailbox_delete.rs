//! Removes a disconnected inbox's email documents from the search index as a
//! throttled background OpenSearch task, so the delete holds no consumer
//! worker and never stalls the Kafka poll loop.
//!
//! The inbox's mail is out of search results before this runs: the email
//! service removes the inbox's rows before it announces the disconnect, and
//! email search drops hits it cannot resolve to a row. The index delete only
//! reclaims the documents, so it forces no refresh.

use std::{sync::Arc, time::Duration};

use opensearch_client::{OpensearchClient, delete::email::EmailDeleteTask};
use tokio_util::{sync::CancellationToken, task::TaskTracker};
use tracing::{Instrument as _, field};
use uuid::Uuid;

#[cfg(test)]
mod test;

/// Documents per second one inbox delete may remove, split across slices.
const DOCS_PER_SECOND: i64 = 1_000;
/// How often a running delete task is checked.
const POLL_INTERVAL: Duration = Duration::from_secs(5);
/// Consecutive failed progress reads before a delete is given up on.
const MAX_POLL_ERRORS: u8 = 3;
/// Times a failed delete task is started again.
const MAX_RESTARTS: u8 = 1;

/// The OpenSearch operations a whole-inbox delete needs.
pub(crate) trait DeleteTasks: Send + Sync + 'static {
    fn start(&self, link_id: Uuid) -> impl Future<Output = anyhow::Result<String>> + Send;
    fn progress(
        &self,
        task_id: &str,
    ) -> impl Future<Output = anyhow::Result<EmailDeleteTask>> + Send;
}

impl DeleteTasks for OpensearchClient {
    async fn start(&self, link_id: Uuid) -> anyhow::Result<String> {
        Ok(self
            .start_email_link_delete(&link_id.to_string(), DOCS_PER_SECOND)
            .await?)
    }

    async fn progress(&self, task_id: &str) -> anyhow::Result<EmailDeleteTask> {
        Ok(self.email_delete_task(task_id).await?)
    }
}

/// Starts whole-inbox deletes and follows each to completion in the background.
pub(crate) struct MailboxDeletes<T = OpensearchClient> {
    tasks: Arc<T>,
    tracker: TaskTracker,
    shutdown: CancellationToken,
    poll_interval: Duration,
}

impl<T> Clone for MailboxDeletes<T> {
    fn clone(&self) -> Self {
        Self {
            tasks: Arc::clone(&self.tasks),
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

/// How following one delete task ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
enum FollowOutcome {
    Completed,
    Failed,
    /// The service shut down first; OpenSearch finishes the task regardless.
    Unfollowed,
}

impl<T: DeleteTasks> MailboxDeletes<T> {
    pub(crate) fn new(tasks: Arc<T>, tracker: TaskTracker, shutdown: CancellationToken) -> Self {
        Self {
            tasks,
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

    /// Starts deleting `link_id`'s documents and returns once OpenSearch has
    /// accepted the task; a failure to start fails the event so it retries.
    pub(crate) async fn start(&self, link_id: Uuid) -> anyhow::Result<()> {
        let task_id = self.tasks.start(link_id).await?;
        let span = tracing::info_span!(
            "email.mailbox_delete",
            link_id = %link_id,
            task_id = %task_id,
            deleted = field::Empty,
            total = field::Empty,
            restarts = field::Empty,
            outcome = field::Empty,
            otel.status_code = field::Empty,
        );
        let this = self.clone();
        self.tracker.spawn(
            async move {
                let report = this.follow(link_id, task_id).await;
                let span = tracing::Span::current();
                span.record("deleted", report.deleted);
                span.record("total", report.total);
                span.record("restarts", report.restarts);
                span.record("outcome", <&'static str>::from(report.outcome));
                if report.outcome == FollowOutcome::Failed {
                    span.record("otel.status_code", "ERROR");
                }
            }
            .instrument(span),
        );
        Ok(())
    }

    async fn follow(&self, link_id: Uuid, mut task_id: String) -> FollowReport {
        let mut restarts = 0;
        loop {
            match self.wait(&task_id).await {
                None => return FollowReport::new(FollowOutcome::Unfollowed, restarts, None),
                Some(Ok(task)) if task.failure.is_none() => {
                    return FollowReport::new(FollowOutcome::Completed, restarts, Some(&task));
                }
                result => {
                    let failure = match result {
                        Some(Ok(task)) => task.failure.unwrap_or_default(),
                        Some(Err(error)) => format!("{error:#}"),
                        None => String::new(),
                    };
                    if restarts >= MAX_RESTARTS {
                        tracing::error!(failure, "inbox search delete failed");
                        return FollowReport::new(FollowOutcome::Failed, restarts, None);
                    }
                    tracing::warn!(failure, "inbox search delete failed, starting it again");
                    restarts += 1;
                    match self.tasks.start(link_id).await {
                        Ok(id) => task_id = id,
                        Err(error) => {
                            tracing::error!(error = ?error, "inbox search delete could not restart");
                            return FollowReport::new(FollowOutcome::Failed, restarts, None);
                        }
                    }
                }
            }
        }
    }

    /// Polls `task_id` until it completes. `None` when shutdown came first.
    async fn wait(&self, task_id: &str) -> Option<anyhow::Result<EmailDeleteTask>> {
        let mut poll_errors = 0;
        loop {
            tokio::select! {
                () = self.shutdown.cancelled() => return None,
                () = tokio::time::sleep(self.poll_interval) => {}
            }
            match self.tasks.progress(task_id).await {
                Ok(task) if task.completed => return Some(Ok(task)),
                Ok(_) => poll_errors = 0,
                Err(error) => {
                    poll_errors += 1;
                    if poll_errors >= MAX_POLL_ERRORS {
                        return Some(Err(error));
                    }
                }
            }
        }
    }
}
