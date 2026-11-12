//! A channel's committed message and timeline changes, and log retention.

use std::future::Future;

use activity::domain::timeline::TimelineActivity;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{
    models::*,
    ports::{CallEntryStatus, MessageError},
};

#[cfg(test)]
mod test;

/// Most log rows applied by one changes page.
pub const MAX_CHANNEL_CHANGE_ROWS: usize = 200;
/// Older clients reload instead of replaying more than this many changes.
pub const MAX_CHANNEL_CHANGE_LAG: usize = 1000;
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

/// One committed change in channel sequence order.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ChannelChange {
    /// Position starting at one, in commit order within the channel.
    pub seq: i64,
    /// The changed target.
    pub kind: ChannelChangeKind,
}

/// A counter, retention floor, and bounded log read in one snapshot.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ChannelChangeLog {
    /// The latest committed position, or zero before the first change.
    pub seq: i64,
    /// Highest position pruned; clients below it must reset.
    pub floor: i64,
    /// At most 1,001 changes after the requested position, in sequence order.
    pub changes: Vec<ChannelChange>,
}

/// A changed message in its current state, with roots carrying thread previews.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ChannelMessageChange {
    /// A changed root, or the root of a changed reply.
    Root {
        /// Root message and its current thread state, including tombstones.
        message: Box<MessageListItem>,
        /// Current call state when this root represents a call.
        call: Option<CallEntryStatus>,
    },
    /// A changed reply, including a tombstone.
    Reply {
        /// Current reply state.
        message: Box<Message>,
    },
}

impl ChannelMessageChange {
    /// Stable message identity for coalescing and missing-row detection.
    pub fn id(&self) -> Uuid {
        match self {
            Self::Root { message, .. } => message.message.id,
            Self::Reply { message } => message.id,
        }
    }
}

/// One bounded page of current states after a channel position.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct ChannelChanges {
    /// The client must drop this channel's cached state and reload it.
    pub reset_required: bool,
    /// Last log row covered by this page, or the current counter on reset.
    pub seq: i64,
    /// More committed rows follow this page's position.
    pub has_more: bool,
    /// Current changed messages, with each changed reply's root included.
    pub messages: Vec<ChannelMessageChange>,
    /// Current system rows shown in the channel timeline.
    pub activities: Vec<TimelineActivity>,
    /// Logged messages or activities that have been hard-deleted.
    pub removed_ids: Vec<Uuid>,
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

/// Positions outside retained history cannot safely advance incrementally.
pub(super) fn requires_reset(log: &ChannelChangeLog, after: i64) -> bool {
    after < log.floor
        || after > log.seq
        || log.seq.saturating_sub(after) > MAX_CHANNEL_CHANGE_LAG as i64
        || log
            .changes
            .iter()
            .any(|change| change.kind == ChannelChangeKind::Reset)
}
