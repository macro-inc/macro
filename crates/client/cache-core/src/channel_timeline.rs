//! Local channel timeline projection.
//!
//! Cached channel messages and timeline activity are projected into compact
//! rows ordered by the server's sort key, so a timeline page (latest, older,
//! newer, or around a message) can be answered without the network. A
//! coverage map records which stretches of each timeline were fully fetched,
//! and a per-channel watermark records how far the channel's change sequence
//! has been applied to those stretches.

mod coverage;
mod window;

pub use coverage::{covering_span, merge_spans};
pub use window::{WindowPlan, anchor_root_key, compose_channel_window, plan_window};

use crate::identity::{ALIAS_FIELD, DELETED_FIELD};
use crate::store::Storage;
use crate::value::{CacheNumber, CacheValue, EntityKey, Record};
use maybe_send::MaybeSend;
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use thiserror::Error;

/// Normalized typename of one channel message, root or reply.
pub const MESSAGE_TYPENAME: &str = "GraphqlChannelMessage";
/// Normalized typename of one system row in a channel timeline.
pub const ACTIVITY_TYPENAME: &str = "GraphqlChannelTimelineActivity";

/// Coverage bound below every sort key: the first entry of a timeline.
pub const TIMELINE_START: &str = "";
/// Coverage bound above every sort key: the live end of a timeline. Server
/// sort keys are ASCII, so this code point sorts after all of them.
pub const TIMELINE_HEAD: &str = "\u{10FFFF}";

/// Revision of the derived timeline rows. Storage adapters rebuild existing
/// rows from normalized records when this changes; records, coverage and
/// watermarks stay valid.
pub const CHANNEL_TIMELINE_PROJECTION_VERSION: u32 = 1;

/// Largest page one read returns.
pub const MAX_TIMELINE_PAGE: u16 = 100;
/// Maximum number of spans, keys and thread roots accepted by one commit.
pub const MAX_CHANNEL_COMMIT_ITEMS: usize = 5_000;
/// Most channels one eviction pass removes.
pub const MAX_EVICTED_CHANNELS: u16 = 200;

/// The ordered list an entry belongs to.
#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum TimelineScope {
    /// The channel's root messages and system rows.
    Channel(String),
    /// The replies of one thread, named by its root message id.
    Thread(String),
}

impl TimelineScope {
    /// Stable value persisted by relational storage.
    pub fn storage_key(&self) -> String {
        match self {
            Self::Channel(channel_id) => format!("c:{channel_id}"),
            Self::Thread(root_id) => format!("t:{root_id}"),
        }
    }
}

/// Compact projection of one cached message or system row.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ChannelTimelineRow {
    /// Normalized record key.
    pub record_key: EntityKey<'static>,
    /// Channel that owns the entry.
    pub channel_id: String,
    /// The list the entry is ordered in.
    pub scope: TimelineScope,
    /// Server position within the scope; compares bytewise in display order.
    pub sort_key: String,
    /// Whether timeline reads leave the entry out: a deleted reply, or a
    /// deleted root with no live reply. The row is kept so a channel reset or
    /// eviction still finds the record.
    pub hidden: bool,
}

/// Projects a fully merged message or activity record into its timeline row.
///
/// `None` means the record is not a timeline entry (another type, deleted,
/// aliased, or missing a field the projection needs). Storage deletes any old
/// row in that case, in the same transaction as the record.
pub fn project_channel_timeline(
    key: &EntityKey<'_>,
    record: &Record,
) -> Option<ChannelTimelineRow> {
    let is_message = match key.typename() {
        Some(MESSAGE_TYPENAME) => true,
        Some(ACTIVITY_TYPENAME) => false,
        _ => return None,
    };
    if matches!(
        record.fields.get(DELETED_FIELD),
        Some(CacheValue::Bool(true))
    ) || record.fields.contains_key(ALIAS_FIELD)
    {
        return None;
    }
    let channel_id = string_field(record, "channelId")?;
    let sort_key = string_field(record, "sortKey")?;
    if !is_sort_key(sort_key) {
        return None;
    }

    let thread_root = string_field(record, "threadId").filter(|_| is_message);
    let deleted = is_message && string_field(record, "deletedAt").is_some();
    let (scope, hidden) = match thread_root {
        Some(root_id) => (TimelineScope::Thread(root_id.to_owned()), deleted),
        None => (
            TimelineScope::Channel(channel_id.to_owned()),
            is_message && root_is_hidden(record, deleted),
        ),
    };
    Some(ChannelTimelineRow {
        record_key: key.clone().into_owned(),
        channel_id: channel_id.to_owned(),
        scope,
        sort_key: sort_key.to_owned(),
        hidden,
    })
}

/// A root leaves the timeline when its whole thread was deleted, or when it
/// was deleted itself and no live reply keeps the thread visible. This is the
/// server's timeline predicate for channel parents.
fn root_is_hidden(record: &Record, deleted: bool) -> bool {
    let Some(CacheValue::Object(thread)) = record.fields.get("thread") else {
        return deleted;
    };
    if matches!(thread.get("deletedAt"), Some(CacheValue::String(_))) {
        return true;
    }
    let has_live_reply = match thread.get("replyCount") {
        Some(CacheValue::Number(CacheNumber::PosInt(count))) => *count > 0,
        _ => false,
    };
    deleted && !has_live_reply
}

fn string_field<'a>(record: &'a Record, field: &str) -> Option<&'a str> {
    match record.fields.get(field) {
        Some(CacheValue::String(value)) if !value.is_empty() => Some(value),
        _ => None,
    }
}

/// Whether `value` can be a server sort key: non-empty printable ASCII, so it
/// sorts strictly between [`TIMELINE_START`] and [`TIMELINE_HEAD`].
pub fn is_sort_key(value: &str) -> bool {
    !value.is_empty() && value.len() <= 128 && value.bytes().all(|byte| byte.is_ascii_graphic())
}

/// A fully fetched stretch of one scope, both ends inclusive.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineSpan {
    /// Oldest covered position, or [`TIMELINE_START`].
    pub start: String,
    /// Newest covered position, or [`TIMELINE_HEAD`].
    pub end: String,
}

/// One timeline page read.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelTimelineRequest {
    /// Channel whose timeline is read.
    pub channel_id: String,
    /// Reads the replies of this root instead of the channel's roots.
    #[serde(default)]
    pub thread_root_id: Option<String>,
    /// Page size, 1 to [`MAX_TIMELINE_PAGE`].
    pub limit: u16,
    /// Entries strictly older than this sort key.
    #[serde(default)]
    pub before: Option<String>,
    /// Entries strictly newer than this sort key.
    #[serde(default)]
    pub after: Option<String>,
    /// A window centred on this message. In a channel read, a reply resolves
    /// to its root.
    #[serde(default)]
    pub around: Option<EntityKey<'static>>,
}

impl ChannelTimelineRequest {
    /// The list this request reads.
    pub fn scope(&self) -> TimelineScope {
        match &self.thread_root_id {
            Some(root_id) => TimelineScope::Thread(root_id.clone()),
            None => TimelineScope::Channel(self.channel_id.clone()),
        }
    }

    /// Rejects empty ids, out-of-range limits, malformed cursors, and more
    /// than one of `before`, `after` and `around`.
    pub fn validate(&self) -> Result<(), ChannelTimelineError> {
        if self.channel_id.is_empty() || self.thread_root_id.as_deref() == Some("") {
            return Err(ChannelTimelineError::InvalidKey);
        }
        if self.limit == 0 || self.limit > MAX_TIMELINE_PAGE {
            return Err(ChannelTimelineError::InvalidLimit);
        }
        let anchors = usize::from(self.before.is_some())
            + usize::from(self.after.is_some())
            + usize::from(self.around.is_some());
        if anchors > 1 {
            return Err(ChannelTimelineError::InvalidWindow);
        }
        if [&self.before, &self.after]
            .into_iter()
            .flatten()
            .any(|cursor| !is_sort_key(cursor))
        {
            return Err(ChannelTimelineError::InvalidWindow);
        }
        if self
            .around
            .as_ref()
            .is_some_and(|key| key.typename() != Some(MESSAGE_TYPENAME))
        {
            return Err(ChannelTimelineError::InvalidKey);
        }
        Ok(())
    }
}

/// Authoritative storage state for one page read, taken in one read transaction.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ChannelTimelineSnapshot {
    /// The fetched stretch holding the window's anchor; `None` when the
    /// anchor lies outside everything fetched.
    pub span: Option<TimelineSpan>,
    /// The entry an `around` read centres on.
    pub anchor: Option<ChannelTimelineRow>,
    /// Visible rows older than the anchor inside `span`, newest first, at
    /// most one more than the page size.
    pub older: Vec<ChannelTimelineRow>,
    /// Visible rows newer than the anchor inside `span`, oldest first, at
    /// most one more than the page size.
    pub newer: Vec<ChannelTimelineRow>,
    /// Applied change sequence of the channel.
    pub seq: Option<i64>,
}

/// Result of one local page read.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelTimelineResult {
    /// Whether the cache holds the requested window. When false the page
    /// must come from the server and `keys` is empty.
    pub covered: bool,
    /// Entry keys of the page, newest first.
    pub keys: Vec<EntityKey<'static>>,
    /// Sort key to continue towards older entries; `None` at the first entry.
    pub older_cursor: Option<String>,
    /// Sort key to continue towards newer entries; `None` at the live end.
    pub newer_cursor: Option<String>,
    /// Applied change sequence of the channel as a decimal string, or `None`
    /// before the first commit carrying one.
    pub seq: Option<String>,
    /// Whether a pending optimistic mutation shaped this result.
    pub optimistic: bool,
}

/// How a commit moves a channel's applied change sequence.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ChannelSeqUpdate {
    /// A fetched page was read at `seq`. Everything held for the channel is
    /// only known current to the lower of this and the stored sequence.
    Lower {
        /// Channel sequence read before the page, as a decimal string.
        seq: String,
    },
    /// Changes `from + 1 ..= to` were written. Applied only when the stored
    /// sequence is exactly `from`, so a gap is never skipped.
    Advance {
        /// Sequence the changes continue from, as a decimal string.
        from: String,
        /// Sequence the changes reach, as a decimal string.
        to: String,
    },
}

impl ChannelSeqUpdate {
    fn parsed(&self) -> Option<ParsedSeqUpdate> {
        let parse = |value: &str| value.parse::<i64>().ok().filter(|seq| *seq >= 0);
        match self {
            Self::Lower { seq } => parse(seq).map(ParsedSeqUpdate::Lower),
            Self::Advance { from, to } => {
                let (from, to) = (parse(from)?, parse(to)?);
                (to >= from).then_some(ParsedSeqUpdate::Advance { from, to })
            }
        }
    }
}

enum ParsedSeqUpdate {
    Lower(i64),
    Advance { from: i64, to: i64 },
}

/// A fetched stretch of the channel's timeline or of one of its threads.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelCoverage {
    /// Thread root whose replies were fetched; `None` for the channel's roots.
    #[serde(default)]
    pub thread_root_id: Option<String>,
    /// The fetched stretch.
    #[serde(flatten)]
    pub span: TimelineSpan,
}

/// One atomic change to a channel's coverage, cached entries and sync state.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelTimelineCommit {
    /// Channel the commit applies to.
    pub channel_id: String,
    /// Stretches whose entries were fully fetched and written.
    #[serde(default)]
    pub coverage: Vec<ChannelCoverage>,
    /// Entries that no longer exist on the server at all.
    #[serde(default)]
    pub removed_keys: Vec<EntityKey<'static>>,
    /// Threads whose cached replies and coverage are dropped.
    #[serde(default)]
    pub dropped_thread_root_ids: Vec<String>,
    /// Change to the applied sequence, after the deletions.
    #[serde(default)]
    pub seq: Option<ChannelSeqUpdate>,
    /// When the channel was last opened or prewarmed, in Unix milliseconds.
    /// Eviction removes the channels touched longest ago.
    #[serde(default)]
    pub touched_at_ms: Option<i64>,
    /// Deletes every cached entry, all coverage and the applied sequence of
    /// the channel before applying the rest of the commit.
    #[serde(default)]
    pub reset: bool,
}

impl ChannelTimelineCommit {
    /// Validates ids, keys, spans and sequence values before storage is touched.
    pub fn validate(&self) -> Result<(), ChannelTimelineError> {
        if self.channel_id.is_empty() {
            return Err(ChannelTimelineError::InvalidKey);
        }
        let items =
            self.coverage.len() + self.removed_keys.len() + self.dropped_thread_root_ids.len();
        if items > MAX_CHANNEL_COMMIT_ITEMS {
            return Err(ChannelTimelineError::TooLarge);
        }
        for coverage in &self.coverage {
            let span = &coverage.span;
            let start_ok = span.start == TIMELINE_START || is_sort_key(&span.start);
            let end_ok = span.end == TIMELINE_HEAD || is_sort_key(&span.end);
            if !start_ok || !end_ok || span.start > span.end {
                return Err(ChannelTimelineError::InvalidSpan);
            }
            if coverage.thread_root_id.as_deref() == Some("") {
                return Err(ChannelTimelineError::InvalidKey);
            }
        }
        let is_entry = |key: &EntityKey<'_>| {
            matches!(key.typename(), Some(MESSAGE_TYPENAME | ACTIVITY_TYPENAME))
                && key.id().is_some_and(|id| !id.is_empty())
        };
        if !self.removed_keys.iter().all(is_entry)
            || self.dropped_thread_root_ids.iter().any(String::is_empty)
        {
            return Err(ChannelTimelineError::InvalidKey);
        }
        if self.seq.as_ref().is_some_and(|seq| seq.parsed().is_none()) {
            return Err(ChannelTimelineError::InvalidSeq);
        }
        Ok(())
    }

    /// The scope a coverage entry of this commit belongs to.
    pub fn coverage_scope(&self, coverage: &ChannelCoverage) -> TimelineScope {
        match &coverage.thread_root_id {
            Some(root_id) => TimelineScope::Thread(root_id.clone()),
            None => TimelineScope::Channel(self.channel_id.clone()),
        }
    }
}

/// Applied sequence after `commit`, given the `stored` one.
pub fn next_seq(stored: Option<i64>, commit: &ChannelTimelineCommit) -> Option<i64> {
    let base = if commit.reset { None } else { stored };
    match commit.seq.as_ref().and_then(ChannelSeqUpdate::parsed) {
        None => base,
        Some(ParsedSeqUpdate::Lower(seq)) => Some(base.map_or(seq, |stored| stored.min(seq))),
        Some(ParsedSeqUpdate::Advance { from, to }) => match base {
            Some(stored) if stored == from => Some(to),
            // A reset leaves nothing the skipped changes could have touched.
            None if commit.reset => Some(to),
            other => other,
        },
    }
}

/// What one channel commit left behind.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ChannelCommitOutcome {
    /// Normalized records deleted from storage.
    pub deleted_keys: Vec<EntityKey<'static>>,
    /// Applied sequence of the channel after the commit.
    pub seq: Option<i64>,
}

/// Removes the channels nobody opened for longest.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelEviction {
    /// Channels last touched before this Unix millisecond are removed.
    pub touched_before_ms: i64,
    /// Most channels removed by this pass, 1 to [`MAX_EVICTED_CHANNELS`].
    pub max_channels: u16,
}

impl ChannelEviction {
    /// Rejects an out-of-range channel bound.
    pub fn validate(&self) -> Result<(), ChannelTimelineError> {
        if self.max_channels == 0 || self.max_channels > MAX_EVICTED_CHANNELS {
            return Err(ChannelTimelineError::InvalidLimit);
        }
        Ok(())
    }
}

/// Channels and records removed by one eviction pass.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ChannelEvictionOutcome {
    /// Channels whose entries, coverage and sequence were removed.
    pub channel_ids: Vec<String>,
    /// Normalized records deleted from storage.
    pub deleted_keys: Vec<EntityKey<'static>>,
    /// Whether more channels older than the bound remain.
    pub has_more: bool,
}

/// How much the timeline index holds.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelTimelineStats {
    /// Channels with an applied sequence or a touch time.
    pub channels: u64,
    /// Indexed messages and system rows.
    pub entries: u64,
}

/// Channel timeline request validation errors.
#[derive(Clone, Copy, Debug, Error, PartialEq, Eq)]
pub enum ChannelTimelineError {
    /// A span starts after it ends or uses a malformed bound.
    #[error("channel timeline span is malformed")]
    InvalidSpan,
    /// An id is empty or a key names the wrong typename.
    #[error("invalid channel timeline key")]
    InvalidKey,
    /// A page size or eviction bound is out of range.
    #[error("channel timeline limit is out of range")]
    InvalidLimit,
    /// More than one of before, after and around, or a malformed cursor.
    #[error("channel timeline window is malformed")]
    InvalidWindow,
    /// A sequence value is not a non-negative decimal.
    #[error("invalid channel change sequence")]
    InvalidSeq,
    /// The commit exceeds [`MAX_CHANNEL_COMMIT_ITEMS`].
    #[error("channel timeline commit has more than {MAX_CHANNEL_COMMIT_ITEMS} items")]
    TooLarge,
}

/// Records every scope of `commit` whose coverage changes, with the spans to add.
pub fn commit_coverage_by_scope(
    commit: &ChannelTimelineCommit,
) -> Vec<(TimelineScope, Vec<TimelineSpan>)> {
    let scopes = commit
        .coverage
        .iter()
        .map(|coverage| commit.coverage_scope(coverage))
        .collect::<BTreeSet<_>>();
    scopes
        .into_iter()
        .map(|scope| {
            let spans = commit
                .coverage
                .iter()
                .filter(|coverage| commit.coverage_scope(coverage) == scope)
                .map(|coverage| coverage.span.clone())
                .collect();
            (scope, spans)
        })
        .collect()
}

/// Storage capability for the channel timeline projection.
///
/// Implementations write timeline rows in the same transaction as every
/// normalized record write and delete, exactly like calendar ranges.
pub trait ChannelTimelineStorage: Storage {
    /// Reads the window's rows, its covering span and the channel's applied
    /// sequence in one read transaction.
    fn query_channel_timeline(
        &self,
        request: &ChannelTimelineRequest,
    ) -> impl Future<Output = Result<ChannelTimelineSnapshot, Self::Error>> + MaybeSend;

    /// Applies a validated commit in one write transaction.
    fn channel_timeline_commit(
        &mut self,
        commit: &ChannelTimelineCommit,
    ) -> impl Future<Output = Result<ChannelCommitOutcome, Self::Error>> + MaybeSend;

    /// Removes the least recently touched channels in one write transaction.
    fn channel_timeline_evict(
        &mut self,
        eviction: &ChannelEviction,
    ) -> impl Future<Output = Result<ChannelEvictionOutcome, Self::Error>> + MaybeSend;

    /// Counts what the index holds.
    fn channel_timeline_stats(
        &self,
    ) -> impl Future<Output = Result<ChannelTimelineStats, Self::Error>> + MaybeSend;
}

#[cfg(test)]
mod test;
