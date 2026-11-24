//! Local channel timeline reads, commits and eviction.

use super::channel_write::Refused;
use super::{ComposedChanges, Engine, EngineError, WriteResult, effective_records, layer_keys};
use crate::channel_timeline::{
    ChannelEviction, ChannelStamps, ChannelTimelineCommit, ChannelTimelineRequest,
    ChannelTimelineResult, ChannelTimelineRow, ChannelTimelineStats, ChannelTimelineStorage,
    MESSAGE_TYPENAME, compose_channel_window, project_channel_timeline,
};
use crate::normalize::RecordUpdates;
use crate::revision::Revisioned;
use crate::value::EntityKey;
use std::collections::{BTreeSet, HashMap};

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
        let overlay = self.optimistic_channel_overlay().await?;
        let snapshot = self
            .storage
            .query_channel_timeline(request, overlay.len())
            .await
            .map_err(EngineError::Storage)?;
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

    /// Applies a commit that comes with no response: a touch, dropped threads,
    /// removed entries or a reset.
    pub async fn channel_timeline_commit(
        &mut self,
        commit: &ChannelTimelineCommit,
    ) -> Result<WriteResult, EngineError<S::Error>> {
        commit.validate()?;
        self.ensure_revision_can_advance()?;
        self.hydrate_optimistic().await?;
        let mut updates = RecordUpdates::new();
        let admission = self
            .admit_channel_entries(
                &mut updates,
                &ChannelStamps::new(),
                Some(commit),
                Refused::Drop,
            )
            .await?;
        let ComposedChanges {
            persisted,
            visible_changed,
        } = self
            .persist_composed(updates, admission, Vec::new())
            .await?;
        Ok(WriteResult {
            affected_ops: self
                .deps
                .ops_for_changes(&visible_changed, &persisted.viewer_fields),
            field_changes: Some(persisted.field_changes),
            identity_errors: Vec::new(),
            unwritable_response: None,
            channel: persisted.channel,
            mutation_uuid: None,
            revision: persisted.revision,
            revision_advanced: persisted.revision_advanced,
            search_changed_buckets: Some(persisted.search_changed_buckets),
            changed: persisted.changed,
            reset: false,
            revalidations: Vec::new(),
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
