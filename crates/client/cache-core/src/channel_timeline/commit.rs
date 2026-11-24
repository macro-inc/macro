//! What a host commits beside a channel answer.

use super::{
    ACTIVITY_TYPENAME, ChannelTimelineError, MAX_CHANNEL_COMMIT_ITEMS, MESSAGE_TYPENAME,
    TIMELINE_HEAD, TIMELINE_START, TimelineScope, TimelineSpan, is_sort_key, parse_seq,
};
use crate::value::EntityKey;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// How a commit moves a channel's watermark, the sequence up to which its
/// changes have been applied to what the device holds.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ChannelWatermark {
    /// A fetched page. Everything held for the channel is only known current
    /// to the lower of the page's sequence and the watermark.
    Lower,
    /// The changes after `from` were written. Applied only when the watermark
    /// lies between `from` and the commit's sequence, so a gap is never
    /// skipped.
    Advance {
        /// Sequence the changes continue from, as a decimal string.
        from: String,
    },
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

/// One change to a channel's coverage, removed entries and watermark, written
/// in the transaction of the response it was read from.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelTimelineCommit {
    /// Channel the commit applies to.
    pub channel_id: String,
    /// Sequence of the response, as a decimal string. Everything needs one but
    /// a touch and dropped threads.
    #[serde(default)]
    pub seq: Option<String>,
    /// Change to the watermark.
    #[serde(default)]
    pub watermark: Option<ChannelWatermark>,
    /// Stretches whose entries the response lists in full.
    #[serde(default)]
    pub coverage: Vec<ChannelCoverage>,
    /// Ids of messages and system rows that no longer exist on the server.
    #[serde(default)]
    pub removed_ids: Vec<String>,
    /// Threads whose cached replies and coverage are dropped.
    #[serde(default)]
    pub dropped_thread_root_ids: Vec<String>,
    /// Drops every cached entry, all coverage and the watermark of the channel
    /// before applying the response and the rest of the commit.
    #[serde(default)]
    pub reset: bool,
    /// When the channel was last opened or prewarmed, in Unix milliseconds.
    /// Eviction removes the channels touched longest ago.
    #[serde(default)]
    pub touched_at_ms: Option<i64>,
}

/// A commit's effect on the watermark, with every sequence parsed.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ParsedWatermark {
    Keep,
    Lower(i64),
    Advance { from: i64, to: i64 },
    Reset(i64),
}

impl ChannelTimelineCommit {
    /// Validates ids, spans and sequence values before storage is touched.
    pub fn validate(&self) -> Result<(), ChannelTimelineError> {
        let empty = |ids: &[String]| ids.iter().any(String::is_empty);
        if self.channel_id.is_empty()
            || empty(&self.removed_ids)
            || empty(&self.dropped_thread_root_ids)
        {
            return Err(ChannelTimelineError::InvalidKey);
        }
        let items =
            self.coverage.len() + self.removed_ids.len() + self.dropped_thread_root_ids.len();
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
        let watermark = self.parsed_watermark()?;
        if !self.removed_ids.is_empty() && self.parsed_seq()?.is_none() {
            return Err(ChannelTimelineError::InvalidSeq);
        }
        let read_at_once = matches!(
            watermark,
            ParsedWatermark::Lower(_) | ParsedWatermark::Reset(_)
        );
        if !self.coverage.is_empty() && !read_at_once {
            return Err(ChannelTimelineError::InvalidCommit);
        }
        Ok(())
    }

    /// The response's sequence, if the commit names one.
    pub(crate) fn parsed_seq(&self) -> Result<Option<i64>, ChannelTimelineError> {
        self.seq
            .as_deref()
            .map(|seq| parse_seq(seq).ok_or(ChannelTimelineError::InvalidSeq))
            .transpose()
    }

    pub(crate) fn parsed_watermark(&self) -> Result<ParsedWatermark, ChannelTimelineError> {
        let seq = self.parsed_seq()?;
        let required = || seq.ok_or(ChannelTimelineError::InvalidSeq);
        match (&self.watermark, self.reset) {
            (Some(ChannelWatermark::Advance { .. }), true) => {
                Err(ChannelTimelineError::InvalidCommit)
            }
            (_, true) => Ok(ParsedWatermark::Reset(required()?)),
            (None, false) => Ok(ParsedWatermark::Keep),
            (Some(ChannelWatermark::Lower), false) => Ok(ParsedWatermark::Lower(required()?)),
            (Some(ChannelWatermark::Advance { from }), false) => {
                let from = parse_seq(from).ok_or(ChannelTimelineError::InvalidSeq)?;
                let to = required()?;
                if from > to {
                    return Err(ChannelTimelineError::InvalidSeq);
                }
                Ok(ParsedWatermark::Advance { from, to })
            }
        }
    }

    /// The records a removed id may name: the server reports bare ids.
    pub(crate) fn removed_keys(&self) -> impl Iterator<Item = EntityKey<'static>> + '_ {
        self.removed_ids.iter().flat_map(|id| {
            [MESSAGE_TYPENAME, ACTIVITY_TYPENAME].map(|typename| EntityKey::entity(typename, &[id]))
        })
    }

    /// The fetched stretches, by the list they belong to.
    pub(crate) fn coverage_by_scope(&self) -> BTreeMap<TimelineScope, Vec<TimelineSpan>> {
        let mut scopes = BTreeMap::<_, Vec<_>>::new();
        for coverage in &self.coverage {
            let scope = match &coverage.thread_root_id {
                Some(root_id) => TimelineScope::Thread(root_id.clone()),
                None => TimelineScope::Channel(self.channel_id.clone()),
            };
            scopes.entry(scope).or_default().push(coverage.span.clone());
        }
        scopes
    }
}

/// What a commit did to the watermark.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ChannelCommitStatus {
    /// The commit took effect as asked.
    Applied,
    /// The watermark already covered the changes. Entries and removals were
    /// taken where they are newer than what is held. Also a page further behind
    /// the watermark than removals are remembered, which covers nothing.
    Stale,
    /// Changes before the commit's are missing. Entries and removals were
    /// taken, and the watermark stayed.
    Gap,
    /// The device holds no state of the channel for changes to continue, so
    /// none of the response's entries in it was stored.
    Unheld,
}

/// Answer to one commit.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelCommitOutcome {
    /// Channel the commit applied to.
    pub channel_id: String,
    /// Watermark after the commit, as a decimal string.
    pub seq: Option<String>,
    /// What the commit did.
    pub outcome: ChannelCommitStatus,
}

#[cfg(test)]
mod test;
