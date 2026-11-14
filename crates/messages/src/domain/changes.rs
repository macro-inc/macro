//! A channel's change sequence: what a reader who holds a sequence number
//! missed, and when it has to start over instead.
//!
//! Every write to a channel's messages takes the channel's next sequence
//! number in the same transaction, so the numbers follow commit order and a
//! reader who has applied everything up to `N` is current once it applies
//! everything after `N`.

use std::collections::HashSet;

use chrono::{DateTime, Utc};
use uuid::Uuid;

#[cfg(test)]
mod test;

/// Log rows one read walks. A reader further behind pages with `has_more`.
pub const MAX_CHANGE_ROWS: usize = 200;
/// A reader this many changes behind starts over: reading the latest page
/// again costs less than replaying the log.
pub const CHANGE_RESET_BACKLOG: i64 = 2_000;
/// How long log rows are kept. A reader whose sequence number is older than
/// the oldest kept row starts over.
pub const CHANGE_LOG_RETENTION: chrono::Duration = chrono::Duration::days(30);
/// Rows one retention pass removes.
pub const CHANGE_LOG_PRUNE_BATCH: usize = 10_000;

/// One logged change to a channel.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChannelChangeOp {
    /// A message was created, edited, deleted or reacted to.
    Message {
        /// The changed message.
        message_id: Uuid,
        /// Its thread root; the message itself when it is a root.
        root_id: Uuid,
    },
    /// Older messages were imported; every reader starts over.
    HistoryImported,
    /// A timeline fact (rename, join, ended call) was recorded.
    Activity(Uuid),
}

/// A logged change and its position in the channel's sequence.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ChannelChange {
    /// Position in the channel's sequence.
    pub seq: i64,
    /// What changed.
    pub op: ChannelChangeOp,
}

/// A slice of a channel's log read in one snapshot.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ChannelChangeLog {
    /// The channel's latest sequence number; zero before its first change.
    pub counter: i64,
    /// Changes after the reader's sequence number, oldest first. Empty when
    /// retention removed the change right after that number: the reader
    /// cannot be caught up from the log.
    pub changes: Vec<ChannelChange>,
}

/// What a reader has to load to apply a slice of the log.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ChannelChangePlan {
    /// The reader cannot be caught up and reads the channel again from
    /// `seq`.
    pub reset: bool,
    /// The reader's sequence number once it applies this plan.
    pub seq: i64,
    /// More changes follow `seq`.
    pub has_more: bool,
    /// Roots whose message, reactions or thread summary changed, oldest
    /// change first.
    pub roots: Vec<Uuid>,
    /// Replies that changed, oldest change first.
    pub replies: Vec<Uuid>,
    /// Timeline facts recorded, oldest first.
    pub activities: Vec<Uuid>,
}

impl ChannelChangePlan {
    /// Decide what a reader at `since` does with `log`, a slice read with at
    /// most `limit` rows after `since`.
    pub fn new(since: i64, log: &ChannelChangeLog, limit: usize) -> Self {
        let reset = Self {
            reset: true,
            seq: log.counter,
            ..Self::default()
        };
        // A number the channel never issued belongs to another channel or a
        // restored database.
        if since < 0 || since > log.counter {
            return reset;
        }
        // Numbers have no gaps, so a reader behind the counter is followed
        // by `since + 1` unless retention removed it.
        let next = log.changes.first().map(|change| change.seq);
        if since < log.counter && next != since.checked_add(1) {
            return reset;
        }
        if log.counter - since > CHANGE_RESET_BACKLOG {
            return reset;
        }
        if log
            .changes
            .iter()
            .any(|change| change.op == ChannelChangeOp::HistoryImported)
        {
            return reset;
        }
        let mut plan = Self {
            seq: since,
            ..Self::default()
        };
        // Messages and activities are separate id spaces: a message may carry
        // the id of an activity.
        let mut seen = HashSet::new();
        let mut seen_activities = HashSet::new();
        for change in &log.changes {
            match change.op {
                ChannelChangeOp::Message {
                    message_id,
                    root_id,
                } => {
                    if seen.insert(root_id) {
                        plan.roots.push(root_id);
                    }
                    if message_id != root_id && seen.insert(message_id) {
                        plan.replies.push(message_id);
                    }
                }
                ChannelChangeOp::Activity(id) => {
                    if seen_activities.insert(id) {
                        plan.activities.push(id);
                    }
                }
                ChannelChangeOp::HistoryImported => {}
            }
            plan.seq = change.seq;
        }
        // A short slice is the end of the log as of its snapshot.
        if log.changes.len() < limit {
            plan.seq = log.counter;
        }
        plan.has_more = plan.seq < log.counter;
        plan
    }
}

/// Removes log rows past retention.
pub trait ChannelChangeLogPruner: Send + Sync + 'static {
    /// Delete up to `batch` rows created before `cutoff`. Returns the number
    /// of rows removed.
    fn prune_change_log(
        &self,
        cutoff: DateTime<Utc>,
        batch: usize,
    ) -> impl Future<Output = Result<usize, super::ports::MessageError>> + Send;
}

/// Appends timeline facts to a channel's log once they are stored.
pub trait ChannelActivityLog: Send + Sync + 'static {
    /// Log `activity_ids` as one block and return the sequence number of the
    /// last one, or `None` when the channel no longer exists.
    fn record_activities(
        &self,
        channel_id: Uuid,
        activity_ids: &[Uuid],
    ) -> impl Future<Output = Result<Option<i64>, super::ports::MessageError>> + Send;
}

/// Hourly retention for the channel change log.
pub struct ChannelChangeLogRetention<R> {
    repository: R,
}

impl<R: ChannelChangeLogPruner> ChannelChangeLogRetention<R> {
    /// Retention over `repository`.
    pub fn new(repository: R) -> Self {
        Self { repository }
    }

    /// Remove every row past retention as of `now`, a batch at a time.
    /// Returns the number of rows removed.
    #[tracing::instrument(name = "messages.prune_channel_change_log", skip(self), err(Debug))]
    pub async fn run_once(&self, now: DateTime<Utc>) -> Result<usize, super::ports::MessageError> {
        let cutoff = now - CHANGE_LOG_RETENTION;
        let mut removed = 0;
        loop {
            let batch = self
                .repository
                .prune_change_log(cutoff, CHANGE_LOG_PRUNE_BATCH)
                .await?;
            removed += batch;
            if batch < CHANGE_LOG_PRUNE_BATCH {
                return Ok(removed);
            }
        }
    }
}

/// Why recording activity failed.
#[derive(Debug, thiserror::Error)]
pub enum SequencedActivityError<E: std::error::Error + Send + Sync + 'static> {
    /// The activity store refused the rows.
    #[error(transparent)]
    Store(E),
    /// The rows are stored but a channel's change log did not take them. The
    /// caller retries the whole batch; both writes are idempotent for readers.
    #[error("failed to log timeline activity for channel {channel_id}")]
    Log {
        /// The channel whose log failed.
        channel_id: Uuid,
        /// The log's error.
        #[source]
        source: super::ports::MessageError,
    },
}

/// An activity store that adds each stored channel timeline fact to that
/// channel's change sequence, so readers catching up from a sequence number
/// receive renames and joins like any other change.
///
/// The log append follows the store's commit. A crash between them replays
/// the source batch, which stores nothing new and logs the facts again;
/// readers apply a fact by id, so a repeat changes nothing.
pub struct ChannelSequencedActivities<R, L> {
    store: R,
    log: L,
}

impl<R, L> ChannelSequencedActivities<R, L> {
    /// Log what `store` records in `log`.
    pub fn new(store: R, log: L) -> Self {
        Self { store, log }
    }
}

impl<R, L> activity::domain::ports::ActivityRepo for ChannelSequencedActivities<R, L>
where
    R: activity::domain::ports::ActivityRepo + Send + Sync,
    L: ChannelActivityLog,
{
    type Err = SequencedActivityError<R::Err>;

    #[tracing::instrument(
        name = "messages.record_channel_activity",
        skip_all,
        fields(activities = activities.len()),
        err
    )]
    async fn insert_activities(&self, activities: &[activity::Activity]) -> Result<(), Self::Err> {
        self.store
            .insert_activities(activities)
            .await
            .map_err(SequencedActivityError::Store)?;
        let mut channels: Vec<(Uuid, Vec<Uuid>)> = Vec::new();
        for fact in activities {
            let Some(super::models::MessageParent::Channel(channel_id)) =
                super::ports::timeline_parent(fact)
            else {
                continue;
            };
            match channels.iter_mut().find(|(id, _)| *id == channel_id) {
                Some((_, ids)) => ids.push(fact.id),
                None => channels.push((channel_id, vec![fact.id])),
            }
        }
        for (channel_id, ids) in channels {
            self.log
                .record_activities(channel_id, &ids)
                .await
                .map_err(|source| SequencedActivityError::Log { channel_id, source })?;
        }
        Ok(())
    }

    async fn purge_entities(
        &self,
        entities: &[(activity::EntityType, String)],
    ) -> Result<(), Self::Err> {
        self.store
            .purge_entities(entities)
            .await
            .map_err(SequencedActivityError::Store)
    }
}
