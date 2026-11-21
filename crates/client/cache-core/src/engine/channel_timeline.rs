//! Local channel timeline reads, commits and eviction.

use super::{Engine, EngineError, WriteResult, effective_records, layer_keys};
use crate::channel_timeline::{
    ChannelEviction, ChannelTimelineCommit, ChannelTimelineRequest, ChannelTimelineResult,
    ChannelTimelineRow, ChannelTimelineStats, ChannelTimelineStorage, MESSAGE_TYPENAME,
    compose_channel_window, project_channel_timeline,
};
use crate::revision::Revisioned;
use crate::value::EntityKey;
use std::collections::{BTreeSet, HashMap};

/// Result of one channel commit.
#[derive(Debug)]
pub struct ChannelCommitResult {
    /// Records the commit deleted, as an ordinary cache write.
    pub write: WriteResult,
    /// Applied change sequence of the channel after the commit, as a decimal
    /// string. A caller that asked to advance from another sequence sees the
    /// unchanged value here and must fetch the changes in between.
    pub seq: Option<String>,
}

/// Result of one eviction pass.
#[derive(Debug)]
pub struct ChannelEvictionResult {
    /// Records the pass deleted, as an ordinary cache write.
    pub write: WriteResult,
    /// Channels removed from the device.
    pub channel_ids: Vec<String>,
    /// Whether more channels older than the bound remain.
    pub has_more: bool,
}

impl<S: ChannelTimelineStorage> Engine<S> {
    /// Answers one timeline page from cached messages.
    ///
    /// Authoritative rows come from the storage timeline index. Messages
    /// touched by an active optimistic layer are projected from their
    /// composed records and replace their authoritative rows, so a pending
    /// send or delete shows before the mutation settles.
    pub async fn channel_timeline(
        &mut self,
        request: &ChannelTimelineRequest,
    ) -> Result<Revisioned<ChannelTimelineResult>, EngineError<S::Error>> {
        request.validate()?;
        self.hydrate_optimistic().await?;
        let snapshot = self
            .storage
            .query_channel_timeline(request)
            .await
            .map_err(EngineError::Storage)?;
        let overlay = self.optimistic_channel_overlay().await?;
        Ok(self.revisioned(compose_channel_window(request, snapshot, &overlay)))
    }

    async fn optimistic_channel_overlay(
        &mut self,
    ) -> Result<HashMap<EntityKey<'static>, Option<ChannelTimelineRow>>, EngineError<S::Error>>
    {
        let keys = layer_keys(&self.optimistic)
            .into_iter()
            .filter(|key| key.typename() == Some(MESSAGE_TYPENAME))
            .collect::<BTreeSet<_>>();
        if keys.is_empty() {
            return Ok(HashMap::new());
        }
        let bases = self.load_bases(&keys).await?;
        Ok(effective_records(&bases, &self.optimistic, &keys)
            .into_iter()
            .map(|(key, record)| {
                let row = record.and_then(|record| project_channel_timeline(&key, &record));
                (key, row)
            })
            .collect())
    }

    /// Atomically applies coverage, deletions and the applied sequence of one
    /// channel. Records the commit deletes are evicted and reported as changed.
    pub async fn channel_timeline_commit(
        &mut self,
        commit: &ChannelTimelineCommit,
    ) -> Result<ChannelCommitResult, EngineError<S::Error>> {
        commit.validate()?;
        self.ensure_revision_can_advance()?;
        let outcome = self
            .storage
            .channel_timeline_commit(commit)
            .await
            .map_err(EngineError::Storage)?;
        Ok(ChannelCommitResult {
            write: self.record_deletions(outcome.deleted_keys)?,
            seq: outcome.seq.map(|seq| seq.to_string()),
        })
    }

    /// Removes the channels touched longest ago, with their messages.
    pub async fn channel_timeline_evict(
        &mut self,
        eviction: &ChannelEviction,
    ) -> Result<ChannelEvictionResult, EngineError<S::Error>> {
        eviction.validate()?;
        self.ensure_revision_can_advance()?;
        let outcome = self
            .storage
            .channel_timeline_evict(eviction)
            .await
            .map_err(EngineError::Storage)?;
        Ok(ChannelEvictionResult {
            write: self.record_deletions(outcome.deleted_keys)?,
            channel_ids: outcome.channel_ids,
            has_more: outcome.has_more,
        })
    }

    /// Counts the channels and entries the timeline index holds.
    pub async fn channel_timeline_stats(
        &self,
    ) -> Result<ChannelTimelineStats, EngineError<S::Error>> {
        self.storage
            .channel_timeline_stats()
            .await
            .map_err(EngineError::Storage)
    }
}
