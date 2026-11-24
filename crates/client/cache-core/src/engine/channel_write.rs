//! Admission of channel content, and the channel half of a record write.

use super::{Engine, EngineError, Storage};
use crate::channel_timeline::{
    ChannelCommitOutcome, ChannelCommitStatus, ChannelEntries, ChannelGuard, ChannelGuardQuery,
    ChannelRowWrite, ChannelStamps, ChannelSync, ChannelTimelineCommit, ChannelTombstone,
    ChannelWrite, TOMBSTONE_REPLAY, admits, coverage_writes, entry_channel_id, is_channel_entry,
    project_channel_timeline,
};
use crate::identity::{ALIAS_FIELD, DELETED_FIELD, MUTATION_UUID_FIELD};
use crate::normalize::RecordUpdates;
use crate::value::{CacheValue, EntityKey, Record};
use std::collections::{BTreeSet, HashMap};

/// What a write keeps of an entry it may not store.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Refused {
    /// Nothing.
    Drop,
    /// The identity a settled mutation leaves on a held entry.
    KeepIdentity,
}

/// An entry whose content a write stores.
struct Admitted {
    seq: i64,
    /// The sequence of its row before, if it had one.
    held: Option<i64>,
}

/// The channel half of a write: which entries it may store, decided before
/// the records are merged, and what it changes beside them.
#[derive(Default)]
pub(super) struct ChannelAdmission {
    pub(super) write: ChannelWrite,
    pub(super) outcome: Option<ChannelCommitOutcome>,
    /// Records the write deletes that a read could see.
    pub(super) deleted: BTreeSet<EntityKey<'static>>,
    /// Whether timeline reads may change beyond the records written.
    pub(super) changes_reads: bool,
    stamped: HashMap<EntityKey<'static>, Admitted>,
    /// Records written whole: nothing they held before is merged into.
    replaced: BTreeSet<EntityKey<'static>>,
    /// Records of removed entries, written only over one that is held.
    tombstones: BTreeSet<EntityKey<'static>>,
}

impl ChannelAdmission {
    /// Merges `update` into what is held of `key`, with whether that changes
    /// the record. `None` writes nothing.
    pub(super) fn merge(
        &self,
        key: &EntityKey<'static>,
        existing: Option<Record>,
        update: Record,
    ) -> Option<(Record, bool)> {
        match existing {
            Some(existing) if self.replaced.contains(key) => {
                let changed = existing != update;
                Some((update, changed))
            }
            Some(mut existing) => {
                let changed = existing.merge(update);
                Some((existing, changed))
            }
            None if self.tombstones.contains(key) => None,
            None => Some((update, true)),
        }
    }

    /// Whether `key` is written only when a record of it is held.
    pub(super) fn only_over_held(&self, key: &EntityKey<'static>) -> bool {
        self.tombstones.contains(key)
    }

    /// Whether `key` is written without merging into what is held.
    pub(super) fn replaces(&self, key: &EntityKey<'static>) -> bool {
        self.replaced.contains(key)
    }

    /// Takes the row of a merged entry the write stores.
    pub(super) fn note_record(&mut self, key: &EntityKey<'static>, record: &Record, changed: bool) {
        let Some(admitted) = self.stamped.get(key) else {
            return;
        };
        let seq = admitted.seq;
        if !changed && admitted.held == Some(seq) {
            return;
        }
        match project_channel_timeline(key, record) {
            Some(row) => {
                self.changes_reads |= admitted.held.is_none();
                self.write.rows.push(ChannelRowWrite { row, seq });
            }
            None => {
                if is_deleted(record)
                    && let Some(channel_id) = entry_channel_id(record)
                {
                    self.changes_reads = true;
                    self.write.tombstones.push(ChannelTombstone {
                        record_key: key.clone(),
                        channel_id: channel_id.to_owned(),
                        seq,
                    });
                }
            }
        }
    }
}

fn is_deleted(record: &Record) -> bool {
    record.fields.get(DELETED_FIELD) == Some(&CacheValue::Bool(true))
}

/// The record of a removed entry. List fields leave it out, so a thread that
/// still names it stays readable.
fn tombstone_record(key: &EntityKey<'static>) -> Record {
    let mut record = super::identity_record(key);
    record
        .fields
        .insert(DELETED_FIELD.into(), CacheValue::Bool(true));
    record
}

/// Keeps what a settled mutation proves about the identity of an entry whose
/// content is out of date.
fn retain_identity(record: &mut Record, removed: bool) {
    record.fields.retain(|field, value| match field.as_str() {
        "id" | "__typename" | ALIAS_FIELD | MUTATION_UUID_FIELD => true,
        DELETED_FIELD => !removed && *value == CacheValue::Bool(true),
        _ => false,
    });
}

impl<S: Storage> Engine<S> {
    /// Decides which channel entries of `updates` a response may store, takes
    /// the others out, and adds what `commit` changes beside them.
    pub(super) async fn admit_channel_entries(
        &mut self,
        updates: &mut RecordUpdates,
        stamps: &ChannelStamps,
        commit: Option<&ChannelTimelineCommit>,
        refused: Refused,
    ) -> Result<ChannelAdmission, EngineError<S::Error>> {
        if let Some(commit) = commit {
            commit.validate()?;
        }
        let entries = updates
            .keys()
            .filter(|key| is_channel_entry(key))
            .cloned()
            .collect::<Vec<_>>();
        if entries.is_empty() && commit.is_none() {
            return Ok(ChannelAdmission::default());
        }
        let guard = self
            .storage
            .load_channel_guard(&guard_query(&entries, updates, stamps, commit))
            .await
            .map_err(EngineError::Storage)?;
        let mut admission = ChannelAdmission::default();
        let moved = commit
            .map(|commit| {
                let held = guard.watermark(&commit.channel_id);
                let (after, status) = commit.parsed_watermark()?.apply(held);
                Ok::<_, EngineError<S::Error>>((commit, held, after, status))
            })
            .transpose()?;
        for key in entries {
            let stamp = stamps.get(&key).copied();
            let state = guard.entries.get(&key);
            let Some(record) = updates.get_mut(&key) else {
                continue;
            };
            let channel_id = entry_channel_id(record)
                .or(state.map(|state| state.channel_id.as_str()))
                .or(commit.map(|commit| commit.channel_id.as_str()));
            let committed =
                moved.filter(|(commit, ..)| Some(commit.channel_id.as_str()) == channel_id);
            let reset = committed.is_some_and(|(commit, ..)| commit.reset);
            // A reset keeps no entry its response does not date.
            let state = state.filter(|_| !reset || stamp.is_none());
            let watermark = match committed {
                Some((_, _, after, _)) => after,
                None => channel_id.and_then(|channel_id| guard.watermark(channel_id)),
            };
            let unheld = stamp.is_some()
                && committed.is_some_and(|(.., status)| status == ChannelCommitStatus::Unheld);
            if !unheld && admits(state, stamp, watermark) {
                if reset {
                    admission.replaced.insert(key.clone());
                }
                if state.is_some_and(|state| state.removed) {
                    record
                        .fields
                        .entry(DELETED_FIELD.into())
                        .or_insert(CacheValue::Bool(false));
                }
                if let Some(seq) = stamp {
                    let held = state.filter(|state| !state.removed).map(|state| state.seq);
                    admission.stamped.insert(key, Admitted { seq, held });
                }
                continue;
            }
            match (refused, state) {
                (Refused::KeepIdentity, Some(state)) => retain_identity(record, state.removed),
                (Refused::KeepIdentity, None) | (Refused::Drop, _) => {
                    updates.remove(&key);
                }
            }
        }
        if let Some((commit, held, after, status)) = moved {
            self.admit_channel_commit(&mut admission, updates, &guard, commit, (held, after))
                .await?;
            admission.outcome = Some(ChannelCommitOutcome {
                channel_id: commit.channel_id.clone(),
                seq: after.map(|seq| seq.to_string()),
                outcome: status,
            });
        }
        Ok(admission)
    }

    /// Adds what `commit` removes, covers and syncs, with the watermark it
    /// found and the one it leaves.
    async fn admit_channel_commit(
        &mut self,
        admission: &mut ChannelAdmission,
        updates: &mut RecordUpdates,
        guard: &ChannelGuard,
        commit: &ChannelTimelineCommit,
        (held, after): (Option<i64>, Option<i64>),
    ) -> Result<(), EngineError<S::Error>> {
        let channel_id = commit.channel_id.as_str();
        let seq = commit.parsed_seq()?;
        let pruned_through = after.map(|after| after.saturating_sub(TOMBSTONE_REPLAY));
        if let Some(seq) = seq {
            for key in commit.removed_keys() {
                let state = guard.entries.get(&key).filter(|_| !commit.reset);
                let newer = state
                    .is_some_and(|state| seq < state.seq || (state.removed && seq == state.seq));
                let forgotten =
                    state.is_none() && pruned_through.is_none_or(|through| seq <= through);
                if newer || forgotten || admission.stamped.contains_key(&key) {
                    continue;
                }
                updates.insert(key.clone(), tombstone_record(&key));
                admission.replaced.insert(key.clone());
                admission.tombstones.insert(key.clone());
                admission.changes_reads |= state.is_some_and(|state| !state.removed);
                admission.write.tombstones.push(ChannelTombstone {
                    record_key: key,
                    channel_id: channel_id.to_owned(),
                    seq,
                });
            }
        }

        let mut sets = Vec::new();
        if commit.reset {
            sets.push(ChannelEntries::All);
            admission.write.uncovered.push(channel_id.to_owned());
        } else if let (None, Some(after)) = (held, after) {
            // Nobody followed the changes since these were stored, so one the
            // page does not list may be gone.
            sets.push(ChannelEntries::HeldBelow(after));
        }
        sets.extend(
            commit
                .dropped_thread_root_ids
                .iter()
                .map(|root_id| ChannelEntries::Thread(root_id)),
        );
        for entries in sets {
            let keys = self.channel_entries(channel_id, entries).await?;
            admission.deleted.extend(
                keys.into_iter().filter(|key| {
                    !admission.stamped.contains_key(key) && !updates.contains_key(key)
                }),
            );
        }
        let mut doomed = admission.deleted.clone();
        if let Some(through) = pruned_through.filter(|_| !commit.reset) {
            let keys = self
                .channel_entries(channel_id, ChannelEntries::TombstonesThrough(through))
                .await?;
            doomed.extend(keys.into_iter().filter(|key| !updates.contains_key(key)));
        }
        admission.write.deleted = doomed.into_iter().collect();

        admission.write.coverage = coverage_writes(commit, guard);
        let stored = guard.sync.get(channel_id);
        let touched = stored.map_or(0, |sync| sync.touched_at_ms);
        let sync = ChannelSync {
            channel_id: channel_id.to_owned(),
            seq: after,
            touched_at_ms: commit.touched_at_ms.map_or(touched, |at| at.max(touched)),
        };
        let keeps_state = after.is_some() || commit.touched_at_ms.is_some();
        if keeps_state && stored != Some(&sync) {
            admission.write.sync.push(sync);
        }
        admission.changes_reads |= held != after
            || commit.reset
            || !admission.write.coverage.is_empty()
            || !admission.deleted.is_empty();
        Ok(())
    }

    async fn channel_entries(
        &self,
        channel_id: &str,
        entries: ChannelEntries<'_>,
    ) -> Result<Vec<EntityKey<'static>>, EngineError<S::Error>> {
        self.storage
            .load_channel_entries(channel_id, entries)
            .await
            .map_err(EngineError::Storage)
    }
}

fn guard_query(
    entries: &[EntityKey<'static>],
    updates: &RecordUpdates,
    stamps: &ChannelStamps,
    commit: Option<&ChannelTimelineCommit>,
) -> ChannelGuardQuery {
    let mut query = ChannelGuardQuery {
        keys: entries.iter().cloned().collect(),
        ..ChannelGuardQuery::default()
    };
    query.channels = entries
        .iter()
        .filter(|key| stamps.contains_key(*key))
        .filter_map(|key| entry_channel_id(updates.get(key)?))
        .map(str::to_owned)
        .collect();
    if let Some(commit) = commit {
        query.keys.extend(commit.removed_keys());
        query.channels.insert(commit.channel_id.clone());
        query.coverage = commit
            .coverage_by_scope()
            .into_keys()
            .map(|scope| (commit.channel_id.clone(), scope))
            .collect();
    }
    query
}
