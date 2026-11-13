//! In-memory channel timeline projection used by engine tests.

use super::InMemoryStorage;
use crate::channel_timeline::{
    ChannelCommitOutcome, ChannelEviction, ChannelEvictionOutcome, ChannelTimelineCommit,
    ChannelTimelineRequest, ChannelTimelineRow, ChannelTimelineSnapshot, ChannelTimelineStats,
    ChannelTimelineStorage, TimelineScope, TimelineSpan, anchor_root_key, commit_coverage_by_scope,
    merge_spans, next_seq, plan_window,
};
use crate::value::EntityKey;
use std::collections::{BTreeMap, BTreeSet};

/// Sync state and fetched stretches of one channel.
#[derive(Clone, Debug, Default)]
pub(super) struct ChannelTimelineState {
    seq: Option<i64>,
    touched_at_ms: i64,
    coverage: BTreeMap<TimelineScope, Vec<TimelineSpan>>,
}

impl InMemoryStorage {
    fn channel_window_rows(
        &self,
        scope: &TimelineScope,
        include: impl Fn(&str) -> bool,
    ) -> Vec<ChannelTimelineRow> {
        let mut rows = self
            .channel_rows
            .values()
            .filter(|row| !row.hidden && row.scope == *scope && include(&row.sort_key))
            .cloned()
            .collect::<Vec<_>>();
        rows.sort_by(|left, right| left.sort_key.cmp(&right.sort_key));
        rows
    }

    fn remove_channel_records(
        &mut self,
        deleted: BTreeSet<EntityKey<'static>>,
    ) -> Vec<EntityKey<'static>> {
        let deleted_keys = deleted
            .into_iter()
            .filter(|key| self.records.contains_key(key))
            .collect::<Vec<_>>();
        for key in &deleted_keys {
            self.remove_record(key);
        }
        deleted_keys
    }
}

impl ChannelTimelineStorage for InMemoryStorage {
    async fn query_channel_timeline(
        &self,
        request: &ChannelTimelineRequest,
    ) -> Result<ChannelTimelineSnapshot, Self::Error> {
        let state = self.channel_state.get(&request.channel_id);
        let seq = state.and_then(|state| state.seq);
        let scope = request.scope();
        let anchor = request
            .around
            .as_ref()
            .and_then(|key| self.channel_rows.get(key))
            .and_then(|row| match anchor_root_key(request, row) {
                Some(root_key) => self.channel_rows.get(&root_key),
                None => Some(row),
            });
        let spans = state
            .and_then(|state| state.coverage.get(&scope))
            .map_or(&[][..], Vec::as_slice);
        let Some(plan) = plan_window(request, anchor, spans) else {
            return Ok(ChannelTimelineSnapshot {
                seq,
                ..ChannelTimelineSnapshot::default()
            });
        };
        let (start, end, position) = (
            plan.span.start.as_str(),
            plan.span.end.as_str(),
            plan.position.as_str(),
        );
        let mut older = Vec::new();
        if plan.read_older {
            older = self.channel_window_rows(&scope, |key| key >= start && key < position);
            older.reverse();
            older.truncate(plan.read_limit);
        }
        let mut newer = Vec::new();
        if plan.read_newer {
            newer = self.channel_window_rows(&scope, |key| key > position && key <= end);
            newer.truncate(plan.read_limit);
        }
        Ok(ChannelTimelineSnapshot {
            anchor: anchor.cloned(),
            older,
            newer,
            seq,
            span: Some(plan.span),
        })
    }

    async fn channel_timeline_commit(
        &mut self,
        commit: &ChannelTimelineCommit,
    ) -> Result<ChannelCommitOutcome, Self::Error> {
        let mut deleted = BTreeSet::new();
        let mut state = self
            .channel_state
            .remove(&commit.channel_id)
            .unwrap_or_default();
        if commit.reset {
            deleted.extend(
                self.channel_rows
                    .values()
                    .filter(|row| row.channel_id == commit.channel_id)
                    .map(|row| row.record_key.clone()),
            );
            state.coverage.clear();
        }
        deleted.extend(commit.removed_keys.iter().cloned());
        for root_id in &commit.dropped_thread_root_ids {
            let scope = TimelineScope::Thread(root_id.clone());
            deleted.extend(
                self.channel_rows
                    .values()
                    .filter(|row| row.scope == scope)
                    .map(|row| row.record_key.clone()),
            );
            state.coverage.remove(&scope);
        }
        let deleted_keys = self.remove_channel_records(deleted);
        for (scope, spans) in commit_coverage_by_scope(commit) {
            let held = state.coverage.remove(&scope).unwrap_or_default();
            state
                .coverage
                .insert(scope, merge_spans(held.into_iter().chain(spans)));
        }
        state.seq = next_seq(state.seq, commit);
        if let Some(touched_at_ms) = commit.touched_at_ms {
            state.touched_at_ms = state.touched_at_ms.max(touched_at_ms);
        }
        let seq = state.seq;
        self.channel_state.insert(commit.channel_id.clone(), state);
        Ok(ChannelCommitOutcome { deleted_keys, seq })
    }

    async fn channel_timeline_evict(
        &mut self,
        eviction: &ChannelEviction,
    ) -> Result<ChannelEvictionOutcome, Self::Error> {
        let mut stale = self
            .channel_state
            .iter()
            .filter(|(_, state)| state.touched_at_ms < eviction.touched_before_ms)
            .map(|(channel_id, state)| (state.touched_at_ms, channel_id.clone()))
            .collect::<Vec<_>>();
        stale.sort();
        let has_more = stale.len() > usize::from(eviction.max_channels);
        stale.truncate(usize::from(eviction.max_channels));
        let channel_ids = stale
            .into_iter()
            .map(|(_, channel_id)| channel_id)
            .collect::<Vec<_>>();
        let evicted = channel_ids.iter().collect::<BTreeSet<_>>();
        let deleted = self
            .channel_rows
            .values()
            .filter(|row| evicted.contains(&row.channel_id))
            .map(|row| row.record_key.clone())
            .collect();
        for channel_id in &channel_ids {
            self.channel_state.remove(channel_id);
        }
        let deleted_keys = self.remove_channel_records(deleted);
        Ok(ChannelEvictionOutcome {
            channel_ids,
            deleted_keys,
            has_more,
        })
    }

    async fn channel_timeline_stats(&self) -> Result<ChannelTimelineStats, Self::Error> {
        Ok(ChannelTimelineStats {
            channels: self.channel_state.len() as u64,
            entries: self.channel_rows.len() as u64,
        })
    }
}
