//! In-memory channel timeline projection used by engine tests.

use super::InMemoryStorage;
use crate::channel_timeline::{
    ChannelEntries, ChannelEntryState, ChannelEviction, ChannelEvictionOutcome, ChannelGuard,
    ChannelGuardQuery, ChannelRowWrite, ChannelSync, ChannelTimelineRequest, ChannelTimelineRow,
    ChannelTimelineSnapshot, ChannelTimelineStats, ChannelTimelineStorage, ChannelTombstone,
    ChannelWrite, TimelineScope, TimelineSpan, anchor_root_key, is_channel_entry, plan_window,
    project_channel_timeline,
};
use crate::identity::DELETED_FIELD;
use crate::value::{CacheValue, EntityKey, Record};
use std::collections::{BTreeMap, BTreeSet, HashMap};

/// The channel tables.
#[derive(Clone, Debug, Default)]
pub(super) struct InMemoryChannels {
    rows: HashMap<EntityKey<'static>, ChannelRowWrite>,
    removed: HashMap<EntityKey<'static>, ChannelTombstone>,
    coverage: BTreeMap<(String, TimelineScope), Vec<TimelineSpan>>,
    sync: BTreeMap<String, ChannelSync>,
}

impl InMemoryChannels {
    /// Keeps the row of a written record current. Only [`Self::apply`] makes
    /// one: a record of an entry without a row has no known sequence.
    pub(super) fn write_record(&mut self, key: &EntityKey<'static>, record: &Record) {
        if !is_channel_entry(key) {
            return;
        }
        let Some(held) = self.rows.get_mut(key) else {
            return;
        };
        if let Some(row) = project_channel_timeline(key, record) {
            held.row = row;
        } else if record.fields.get(DELETED_FIELD) == Some(&CacheValue::Bool(true)) {
            let channel_id = held.row.channel_id.clone();
            let watermark = self.sync.get(&channel_id).and_then(|sync| sync.seq);
            let seq = watermark.map_or(held.seq, |watermark| watermark.max(held.seq));
            self.rows.remove(key);
            self.removed.insert(
                key.clone(),
                ChannelTombstone {
                    record_key: key.clone(),
                    channel_id,
                    seq,
                },
            );
        } else {
            self.drop_row(key);
        }
    }

    /// Deletes a row outside a channel write. The list it was in lacks an
    /// entry from now on, so its coverage goes too.
    pub(super) fn drop_row(&mut self, key: &EntityKey<'static>) {
        if let Some(held) = self.rows.remove(key) {
            self.coverage.remove(&(held.row.channel_id, held.row.scope));
        }
    }

    pub(super) fn guard(&self, query: &ChannelGuardQuery) -> ChannelGuard {
        let state = |key: &EntityKey<'static>| {
            let held = self.rows.get(key).map(|held| ChannelEntryState {
                channel_id: held.row.channel_id.clone(),
                seq: held.seq,
                removed: false,
            });
            held.or_else(|| {
                self.removed.get(key).map(|tombstone| ChannelEntryState {
                    channel_id: tombstone.channel_id.clone(),
                    seq: tombstone.seq,
                    removed: true,
                })
            })
        };
        ChannelGuard {
            entries: query
                .keys
                .iter()
                .filter_map(|key| Some((key.clone(), state(key)?)))
                .collect(),
            sync: query
                .channels
                .iter()
                .filter_map(|id| Some((id.clone(), self.sync.get(id)?.clone())))
                .collect(),
            coverage: query
                .coverage
                .iter()
                .filter_map(|list| Some((list.clone(), self.coverage.get(list)?.clone())))
                .collect(),
        }
    }

    pub(super) fn entries(
        &self,
        channel_id: &str,
        entries: ChannelEntries<'_>,
    ) -> Vec<EntityKey<'static>> {
        let held = self.rows.values().filter(|held| {
            held.row.channel_id == channel_id
                && match entries {
                    ChannelEntries::All => true,
                    ChannelEntries::HeldBelow(seq) => held.seq < seq,
                    ChannelEntries::Thread(root_id) => {
                        held.row.scope == TimelineScope::Thread(root_id.to_owned())
                    }
                    ChannelEntries::TombstonesThrough(_) => false,
                }
        });
        let removed = self.removed.values().filter(|tombstone| {
            tombstone.channel_id == channel_id
                && match entries {
                    ChannelEntries::All => true,
                    ChannelEntries::TombstonesThrough(seq) => tombstone.seq <= seq,
                    ChannelEntries::HeldBelow(_) | ChannelEntries::Thread(_) => false,
                }
        });
        held.map(|held| held.row.record_key.clone())
            .chain(removed.map(|tombstone| tombstone.record_key.clone()))
            .collect()
    }

    /// Applies everything of `write` but the records it deletes.
    fn apply(&mut self, write: &ChannelWrite) {
        for key in &write.deleted {
            self.rows.remove(key);
            self.removed.remove(key);
        }
        self.coverage
            .retain(|(channel_id, _), _| !write.uncovered.contains(channel_id));
        for tombstone in &write.tombstones {
            self.rows.remove(&tombstone.record_key);
            self.removed
                .insert(tombstone.record_key.clone(), tombstone.clone());
        }
        for row in &write.rows {
            self.removed.remove(&row.row.record_key);
            self.rows.insert(row.row.record_key.clone(), row.clone());
            let channel_id = &row.row.channel_id;
            self.sync
                .entry(channel_id.clone())
                .or_insert_with(|| ChannelSync {
                    channel_id: channel_id.clone(),
                    ..ChannelSync::default()
                });
        }
        for coverage in &write.coverage {
            let list = (coverage.channel_id.clone(), coverage.scope.clone());
            if coverage.spans.is_empty() {
                self.coverage.remove(&list);
            } else {
                self.coverage.insert(list, coverage.spans.clone());
            }
        }
        for sync in &write.sync {
            self.sync.insert(sync.channel_id.clone(), sync.clone());
        }
    }
}

impl InMemoryStorage {
    pub(super) fn apply_channel_write(&mut self, write: &ChannelWrite) {
        self.channel.apply(write);
        for key in &write.deleted {
            self.remove_record(key);
        }
    }

    fn channel_window_rows(
        &self,
        scope: &TimelineScope,
        include: impl Fn(&str) -> bool,
    ) -> Vec<ChannelTimelineRow> {
        let mut rows = self
            .channel
            .rows
            .values()
            .map(|held| &held.row)
            .filter(|row| !row.hidden && row.scope == *scope && include(&row.sort_key))
            .cloned()
            .collect::<Vec<_>>();
        rows.sort_by(|left, right| left.sort_key.cmp(&right.sort_key));
        rows
    }
}

impl ChannelTimelineStorage for InMemoryStorage {
    async fn query_channel_timeline(
        &self,
        request: &ChannelTimelineRequest,
        pending: usize,
    ) -> Result<ChannelTimelineSnapshot, Self::Error> {
        let sync = self.channel.sync.get(&request.channel_id);
        let seq = sync.and_then(|sync| sync.seq);
        let scope = request.scope();
        let row = |key: &EntityKey<'static>| self.channel.rows.get(key).map(|held| &held.row);
        let anchor =
            request.around.as_ref().and_then(row).and_then(|anchor| {
                match anchor_root_key(request, anchor) {
                    Some(root_key) => row(&root_key),
                    None => Some(anchor),
                }
            });
        let spans = self
            .channel
            .coverage
            .get(&(request.channel_id.clone(), scope.clone()))
            .map_or(&[][..], Vec::as_slice);
        let Some(plan) = plan_window(request, anchor, spans, pending) else {
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

    async fn channel_timeline_evict(
        &mut self,
        eviction: &ChannelEviction,
    ) -> Result<ChannelEvictionOutcome, Self::Error> {
        let mut stale = self
            .channel
            .sync
            .values()
            .filter(|sync| sync.touched_at_ms < eviction.touched_before_ms)
            .map(|sync| (sync.touched_at_ms, sync.channel_id.clone()))
            .collect::<Vec<_>>();
        stale.sort();
        let has_more = stale.len() > usize::from(eviction.max_channels);
        stale.truncate(usize::from(eviction.max_channels));
        let channel_ids = stale
            .into_iter()
            .map(|(_, channel_id)| channel_id)
            .collect::<Vec<_>>();
        let deleted = channel_ids
            .iter()
            .flat_map(|channel_id| self.channel.entries(channel_id, ChannelEntries::All))
            .collect::<BTreeSet<_>>();
        let deleted_keys = deleted
            .iter()
            .filter(|key| self.records.contains_key(*key))
            .cloned()
            .collect();
        self.apply_channel_write(&ChannelWrite {
            deleted: deleted.into_iter().collect(),
            uncovered: channel_ids.clone(),
            ..ChannelWrite::default()
        });
        for channel_id in &channel_ids {
            self.channel.sync.remove(channel_id);
        }
        Ok(ChannelEvictionOutcome {
            channel_ids,
            deleted_keys,
            has_more,
        })
    }

    async fn channel_timeline_stats(&self) -> Result<ChannelTimelineStats, Self::Error> {
        Ok(ChannelTimelineStats {
            channels: self.channel.sync.len() as u64,
            entries: self.channel.rows.len() as u64,
        })
    }
}
