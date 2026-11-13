//! Channel timeline page reads, commits and eviction over the native index.

use super::{EngineHandle, EngineState, WriteResultWire, wire_write_result};
use cache_core::channel_timeline::{
    ChannelEviction, ChannelTimelineCommit, ChannelTimelineRequest, ChannelTimelineResult,
    ChannelTimelineStats,
};
use serde::Serialize;

/// Mirrors the `page` variant of `ChannelTimelineCacheResult` in
/// `apps/web/src/lib/graphql-cache/protocol.ts`.
#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ChannelTimelineResultWire {
    /// The engine answered, or reported that the window is not held.
    Page {
        /// Revision observed by the read.
        revision: String,
        /// Coverage, keys, cursors and the applied change sequence.
        #[serde(flatten)]
        result: ChannelTimelineResult,
    },
}

/// Mirrors `ChannelTimelineCommitResult` in the frontend protocol.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelCommitResultWire {
    /// Records the commit deleted, as an ordinary write.
    #[serde(flatten)]
    pub write: WriteResultWire,
    /// Applied change sequence of the channel after the commit.
    pub channel_seq: Option<String>,
}

/// Mirrors `ChannelTimelineEvictResult` in the frontend protocol.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelEvictionResultWire {
    /// Records the pass deleted, as an ordinary write.
    #[serde(flatten)]
    pub write: WriteResultWire,
    /// Channels removed from the device.
    pub channel_ids: Vec<String>,
    /// Whether more channels older than the bound remain.
    pub has_more: bool,
}

impl EngineHandle {
    /// Answers one channel or thread page from cached messages.
    pub async fn channel_timeline(
        &self,
        request: ChannelTimelineRequest,
    ) -> Result<ChannelTimelineResultWire, String> {
        self.inner
            .lock()
            .await
            .engine
            .channel_timeline(&request)
            .await
            .map(|result| ChannelTimelineResultWire::Page {
                revision: result.revision.to_string(),
                result: result.value,
            })
            .map_err(|error| error.to_string())
    }

    /// Applies a channel commit atomically. Callers await message hydration
    /// before publishing coverage.
    pub async fn channel_timeline_commit(
        &self,
        commit: ChannelTimelineCommit,
    ) -> Result<ChannelCommitResultWire, String> {
        let mut state = self.inner.write().await;
        let EngineState { engine, ops, .. } = &mut *state;
        let result = engine
            .channel_timeline_commit(&commit)
            .await
            .map_err(|error| error.to_string())?;
        let unchanged_views = engine
            .unchanged_observed_windows()
            .await
            .unwrap_or_default();
        let mut write = wire_write_result(ops, result.write);
        write.unchanged_views = Some(unchanged_views);
        Ok(ChannelCommitResultWire {
            write,
            channel_seq: result.seq,
        })
    }

    /// Removes the channels touched longest ago with their messages.
    pub async fn channel_timeline_evict(
        &self,
        eviction: ChannelEviction,
    ) -> Result<ChannelEvictionResultWire, String> {
        let mut state = self.inner.write().await;
        let EngineState { engine, ops, .. } = &mut *state;
        let result = engine
            .channel_timeline_evict(&eviction)
            .await
            .map_err(|error| error.to_string())?;
        let unchanged_views = engine
            .unchanged_observed_windows()
            .await
            .unwrap_or_default();
        let mut write = wire_write_result(ops, result.write);
        write.unchanged_views = Some(unchanged_views);
        Ok(ChannelEvictionResultWire {
            write,
            channel_ids: result.channel_ids,
            has_more: result.has_more,
        })
    }

    /// Counts the channels and entries the timeline index holds.
    pub async fn channel_timeline_stats(&self) -> Result<ChannelTimelineStats, String> {
        self.inner
            .lock()
            .await
            .engine
            .channel_timeline_stats()
            .await
            .map_err(|error| error.to_string())
    }
}
