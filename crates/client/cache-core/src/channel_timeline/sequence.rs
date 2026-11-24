//! Which channel content a write may store, by its server sequence.
//!
//! Every sequence the server sends is a floor: the answer is at least as new
//! as it. An entry keeps the sequence of the write that stored it, a removed
//! one keeps the sequence of its removal, and the channel's watermark says up
//! to where its changes were applied to everything held. A write below those
//! carries content the device already knows is out of date.

use super::commit::ParsedWatermark;
use super::{
    ChannelCommitStatus, ChannelTimelineCommit, ChannelTimelineRow, TimelineScope, TimelineSpan,
    merge_spans,
};
use crate::value::EntityKey;
use std::collections::{BTreeMap, BTreeSet, HashMap};

/// How many changes the server replays. A tombstone further behind the
/// watermark guards against nothing a catch-up could still bring.
pub const TOMBSTONE_REPLAY: i64 = 1_000;

/// What the device holds of one entry.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ChannelEntryState {
    /// Channel that owns the entry.
    pub channel_id: String,
    /// Sequence of the write that stored it, or of its removal.
    pub seq: i64,
    /// Whether it was removed and only its tombstone is left.
    pub removed: bool,
}

/// Sync state of one channel.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ChannelSync {
    /// Channel the state belongs to.
    pub channel_id: String,
    /// Sequence up to which changes were applied to everything held.
    pub seq: Option<i64>,
    /// When the channel was last opened or prewarmed, in Unix milliseconds.
    pub touched_at_ms: i64,
}

/// What a channel write has to know before it decides.
#[derive(Clone, Debug, Default)]
pub struct ChannelGuardQuery {
    /// Entries whose state is read.
    pub keys: BTreeSet<EntityKey<'static>>,
    /// Channels whose sync state is read.
    pub channels: BTreeSet<String>,
    /// Lists whose fetched stretches are read, by channel.
    pub coverage: BTreeSet<(String, TimelineScope)>,
}

/// Answer to a [`ChannelGuardQuery`], taken in one read.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ChannelGuard {
    /// The entries held or removed.
    pub entries: HashMap<EntityKey<'static>, ChannelEntryState>,
    /// The channels with sync state.
    pub sync: BTreeMap<String, ChannelSync>,
    /// The lists with fetched stretches.
    pub coverage: BTreeMap<(String, TimelineScope), Vec<TimelineSpan>>,
}

impl ChannelGuard {
    pub(crate) fn watermark(&self, channel_id: &str) -> Option<i64> {
        self.sync.get(channel_id).and_then(|sync| sync.seq)
    }
}

/// Entries of one channel a write removes as a set.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ChannelEntries<'a> {
    /// Held entries and tombstones.
    All,
    /// Held entries stored below a sequence.
    HeldBelow(i64),
    /// Held replies of one thread.
    Thread(&'a str),
    /// Tombstones at or below a sequence.
    TombstonesThrough(i64),
}

/// A timeline row with the sequence of the write that stores it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ChannelRowWrite {
    /// The row.
    pub row: ChannelTimelineRow,
    /// Sequence of its content.
    pub seq: i64,
}

/// A removed entry.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ChannelTombstone {
    /// Key of the entry's record.
    pub record_key: EntityKey<'static>,
    /// Channel that owned the entry.
    pub channel_id: String,
    /// Sequence of the removal.
    pub seq: i64,
}

/// The fetched stretches a list has after a write; none drops its coverage.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ChannelCoverageWrite {
    /// Channel that owns the list.
    pub channel_id: String,
    /// The list.
    pub scope: TimelineScope,
    /// Its stretches.
    pub spans: Vec<TimelineSpan>,
}

/// The decided channel half of a record write, applied in its transaction,
/// in field order, before the records are written.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ChannelWrite {
    /// Entries leaving the device: records, rows and tombstones.
    pub deleted: Vec<EntityKey<'static>>,
    /// Channels whose coverage is dropped whole.
    pub uncovered: Vec<String>,
    /// Entries whose row becomes a tombstone.
    pub tombstones: Vec<ChannelTombstone>,
    /// Entries whose row is stored, replacing a tombstone. A channel of one
    /// without sync state gets an empty one, so eviction finds it.
    pub rows: Vec<ChannelRowWrite>,
    /// Lists whose fetched stretches change.
    pub coverage: Vec<ChannelCoverageWrite>,
    /// Sync state that changes.
    pub sync: Vec<ChannelSync>,
}

impl ChannelWrite {
    /// Whether there is nothing to apply.
    pub fn is_empty(&self) -> bool {
        *self == Self::default()
    }
}

/// Whether a write may store an entry the device has as `state`, given the
/// `stamp` the response puts on it and its channel's `watermark`.
///
/// Content without a stamp has no known age, so it only fills what nothing
/// dates. An entry the device does not hold is known not to exist as of the
/// watermark, so an older answer that has it is out of date.
pub fn admits(
    state: Option<&ChannelEntryState>,
    stamp: Option<i64>,
    watermark: Option<i64>,
) -> bool {
    match (state, stamp) {
        (None, None) => true,
        (Some(_), None) => false,
        (Some(state), Some(stamp)) => stamp >= state.seq,
        (None, Some(stamp)) => watermark.is_none_or(|watermark| stamp >= watermark),
    }
}

impl ParsedWatermark {
    /// The watermark after a commit, from the one held before it, and what
    /// that makes of the commit.
    pub(crate) fn apply(self, held: Option<i64>) -> (Option<i64>, ChannelCommitStatus) {
        use ChannelCommitStatus::{Applied, Gap, Stale, Unheld};
        match (self, held) {
            (Self::Keep, held) => (held, Applied),
            (Self::Reset(seq), _) => (Some(seq), Applied),
            (Self::Lower(seq), held) => (Some(held.map_or(seq, |held| held.min(seq))), Applied),
            (Self::Advance { .. }, None) => (None, Unheld),
            (Self::Advance { to, .. }, Some(held)) if to <= held => (Some(held), Stale),
            (Self::Advance { from, .. }, Some(held)) if from > held => (Some(held), Gap),
            (Self::Advance { to, .. }, Some(_)) => (Some(to), Applied),
        }
    }
}

/// The coverage `commit` leaves its lists with, over what the guard read.
pub(crate) fn coverage_writes(
    commit: &ChannelTimelineCommit,
    guard: &ChannelGuard,
) -> Vec<ChannelCoverageWrite> {
    let mut scopes = commit
        .dropped_thread_root_ids
        .iter()
        .map(|root_id| (TimelineScope::Thread(root_id.clone()), Vec::new()))
        .collect::<BTreeMap<_, _>>();
    for (scope, spans) in commit.coverage_by_scope() {
        let fresh = commit.reset || scopes.contains_key(&scope);
        let held = guard
            .coverage
            .get(&(commit.channel_id.clone(), scope.clone()))
            .filter(|_| !fresh);
        let spans = merge_spans(held.into_iter().flatten().cloned().chain(spans));
        if held != Some(&spans) {
            scopes.insert(scope, spans);
        }
    }
    scopes
        .into_iter()
        .map(|(scope, spans)| ChannelCoverageWrite {
            channel_id: commit.channel_id.clone(),
            scope,
            spans,
        })
        .collect()
}

#[cfg(test)]
mod test;
