//! Committed channel change identities and log retention.

use std::future::Future;

use chrono::{DateTime, Utc};
use uuid::Uuid;

use super::ports::MessageError;

#[cfg(test)]
mod test;

/// How long committed changes remain available for incremental reads.
pub const CHANGE_LOG_RETENTION: chrono::Duration = chrono::Duration::days(30);
/// Most rows removed by one retention transaction.
pub const CHANGE_LOG_PRUNE_BATCH: usize = 10_000;

/// The current state a log row asks a client to load.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChannelChangeKind {
    /// A message, including its reactions or thread state, changed.
    Message(Uuid),
    /// A system activity shown by the channel timeline was recorded.
    Activity(Uuid),
    /// The channel history was rewritten in bulk.
    Reset,
}

/// Persistence boundary for pruning channel change history.
pub trait ChannelChangeLogPruner: Send + Sync + 'static {
    /// Remove at most `batch` rows older than `cutoff`, oldest first.
    fn prune_channel_change_log(
        &self,
        cutoff: DateTime<Utc>,
        batch: usize,
    ) -> impl Future<Output = Result<usize, MessageError>> + Send;
}

/// Removes old channel changes without resetting their monotonic counters.
pub struct ChannelChangeLogRetention<R> {
    repository: R,
}

impl<R: ChannelChangeLogPruner> ChannelChangeLogRetention<R> {
    /// Construct a retention job from its persistence port.
    pub fn new(repository: R) -> Self {
        Self { repository }
    }

    /// Prune everything older than retention as of `now`, in bounded batches.
    #[tracing::instrument(name = "messages.prune_channel_changes", skip_all, fields(removed = tracing::field::Empty), err)]
    pub async fn run_once(&self, now: DateTime<Utc>) -> Result<usize, MessageError> {
        let cutoff = now - CHANGE_LOG_RETENTION;
        let mut removed = 0;
        loop {
            let batch = self
                .repository
                .prune_channel_change_log(cutoff, CHANGE_LOG_PRUNE_BATCH)
                .await?;
            removed += batch;
            if batch < CHANGE_LOG_PRUNE_BATCH {
                tracing::Span::current()
                    .record("removed", i64::try_from(removed).unwrap_or(i64::MAX));
                return Ok(removed);
            }
        }
    }
}

