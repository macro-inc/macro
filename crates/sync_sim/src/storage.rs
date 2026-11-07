//! Browser-process storage: completion is durability, adoption is conditional and atomic.
use crate::{clock::delay, *};
use doc_sync_core::*;
use rand::Rng;
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};

/// Durable rows and covering snapshots retained across tab/process lifetimes.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub struct StoreImage {
    /// Per-document, owner and sequence rows; append never replaces an existing row.
    pub entries: BTreeMap<(SyncDocId, WalOwner, WalSeq), StoredWalRecord>,
    /// Last completed covering snapshot per document.
    pub snapshots: BTreeMap<SyncDocId, StoredSnapshot>,
}
pub(crate) struct PendingWrite {
    pub client: ClientName,
    pub session: SessionId,
    pub id: StorageOpId,
    pub op: StorageOp,
}
pub(crate) struct Completion {
    pub client: ClientName,
    pub session: SessionId,
    pub event: StorageEvent,
    pub facts: Vec<Fact>,
}
struct DurableWrite {
    at: u64,
    before: StoreImage,
    appended: Option<(SessionId, WalSeq)>,
}
/// One browser's durable store, outstanding transactions and live/frozen leases.
pub struct SimStorage {
    pub(crate) durable: StoreImage,
    pub(crate) pending: BTreeMap<u64, PendingWrite>,
    pub(crate) leases: BTreeSet<(SyncDocId, SessionId)>,
    pub(crate) user: String,
    pub(crate) seeded_docs: BTreeSet<SyncDocId>,
    recent: Vec<DurableWrite>,
    next_id: u64,
    tails: BTreeMap<SyncDocId, u64>,
    latency: (crate::Millis, crate::Millis),
    base_latency: (crate::Millis, crate::Millis),
    fail_writes: bool,
    fail_load: bool,
    quota: Option<u64>,
    written: u64,
    uncertain: u8,
    retention: doc_sync_core::Millis,
}
impl SimStorage {
    /// Empty profile with independent storage and leases.
    pub fn new(profile: StorageProfile) -> Self {
        Self::with_retention(profile, WalPolicy::default().ttl)
    }
    /// Empty profile with the host's explicit orphan retention policy.
    pub fn with_retention(profile: StorageProfile, retention: doc_sync_core::Millis) -> Self {
        Self {
            durable: StoreImage::default(),
            pending: BTreeMap::new(),
            leases: BTreeSet::new(),
            user: "user-0".into(),
            seeded_docs: BTreeSet::new(),
            recent: Vec::new(),
            next_id: 0,
            tails: BTreeMap::new(),
            latency: profile.latency,
            base_latency: profile.latency,
            fail_writes: false,
            fail_load: false,
            quota: None,
            written: 0,
            uncertain: 0,
            retention,
        }
    }
    /// Inspect committed state only.
    pub fn image(&self) -> &StoreImage {
        &self.durable
    }
    /// Conservative cache eviction, distinct from a core-requested corrupt snapshot delete.
    /// Returns false while any undelivered WAL row still needs this document's cache.
    pub fn evict_snapshot(&mut self, doc: &SyncDocId) -> bool {
        if self
            .durable
            .entries
            .iter()
            .any(|((key, _, _), row)| key == doc && !row.delivered)
        {
            return false;
        }
        self.durable.snapshots.remove(doc);
        true
    }
    /// Change adapter failure behavior; never mutate client state directly.
    pub fn fault(&mut self, fault: StorageFault) {
        match fault {
            StorageFault::FailWrites => self.fail_writes = true,
            StorageFault::Heal => {
                self.fail_writes = false;
                self.fail_load = false;
                self.quota = None;
                self.uncertain = 0;
                self.latency = self.base_latency;
            }
            StorageFault::Latency(low, high) => self.latency = (low, high),
            StorageFault::Quota { after_bytes } => {
                self.quota = Some(self.written.saturating_add(after_bytes))
            }
            StorageFault::FailLoad => self.fail_load = true,
            StorageFault::CorruptSnapshot => {
                if let Some(snapshot) = self.durable.snapshots.values_mut().next() {
                    snapshot.bytes = vec![0];
                }
            }
            StorageFault::CorruptRow => {
                if let Some(row) = self.durable.entries.values_mut().next() {
                    row.record.bytes = vec![0];
                }
            }
            StorageFault::Uncertain { next } => self.uncertain = next,
        }
    }
    pub(crate) fn issue(
        &mut self,
        write: PendingWrite,
        now: u64,
        rng: &mut impl Rng,
    ) -> (u64, u64) {
        let doc = document(&write.op).clone();
        let at = now
            .saturating_add(delay(self.latency, rng))
            .max(self.tails.get(&doc).copied().unwrap_or(0).saturating_add(1));
        self.tails.insert(doc, at);
        let id = self.next_id;
        self.next_id = self.next_id.saturating_add(1);
        self.pending.insert(id, write);
        (id, at)
    }
    fn load(
        &self,
        doc: &SyncDocId,
        owner: SessionId,
        user: &UserKey,
        wall: UnixMillis,
    ) -> LocalState {
        let mut orphaned: BTreeMap<WalOwner, Vec<StoredWalRecord>> = BTreeMap::new();
        let mut assist: BTreeMap<WalOwner, Vec<StoredWalRecord>> = BTreeMap::new();
        for ((row_doc, row_owner, _), row) in &self.durable.entries {
            if row_doc != doc || *row_owner == WalOwner::Session(owner) {
                continue;
            }
            let leased = match row_owner {
                WalOwner::Session(id) => self.leases.contains(&(doc.clone(), *id)),
                WalOwner::Legacy => false,
            };
            // S7 O-2 permits only expired orphan metadata from other users for TTL
            // cleanup. Never expose their payload, unexpired rows or leased rows.
            if row.record.user != *user {
                let before = wall
                    .0
                    .saturating_sub(i64::try_from(self.retention.0).unwrap_or(i64::MAX));
                if !leased && !row.delivered && row.record.created_at.0 < before {
                    let mut metadata = row.clone();
                    metadata.record.bytes.clear();
                    orphaned.entry(*row_owner).or_default().push(metadata);
                }
                continue;
            }
            if leased && !row.delivered {
                assist.entry(*row_owner).or_default().push(row.clone());
            } else if !leased {
                orphaned.entry(*row_owner).or_default().push(row.clone());
            }
        }
        LocalState {
            snapshot: self
                .durable
                .snapshots
                .get(doc)
                .filter(|snapshot| !snapshot.bytes.is_empty())
                .cloned(),
            orphans: orphaned
                .into_iter()
                .map(|(owner, records)| OrphanWal { owner, records })
                .collect(),
            assist: assist
                .into_iter()
                .map(|(owner, records)| OrphanWal { owner, records })
                .collect(),
        }
    }
    pub(crate) fn complete(
        &mut self,
        token: u64,
        profile: &ProfileName,
        now: u64,
        wall: UnixMillis,
    ) -> Option<Completion> {
        let write = self.pending.remove(&token)?;
        let mut facts = Vec::new();
        let event = match &write.op {
            StorageOp::Load { doc, owner, user } | StorageOp::LoadOrphans { doc, owner, user } => {
                let result = if std::mem::take(&mut self.fail_load) {
                    Err(StorageFailure::Unavailable)
                } else {
                    Ok(self.load(doc, *owner, user, wall))
                };
                StorageEvent::Loaded {
                    id: write.id,
                    result,
                }
            }
            _ => {
                let bytes = match &write.op {
                    StorageOp::WalAppend { record, .. } => {
                        u64::try_from(record.bytes.len()).unwrap_or(u64::MAX)
                    }
                    StorageOp::SnapshotSave { bytes, .. } => {
                        u64::try_from(bytes.len()).unwrap_or(u64::MAX)
                    }
                    _ => 0,
                };
                let failure = if self.fail_writes {
                    Some(StorageFailure::Unavailable)
                } else if self
                    .quota
                    .is_some_and(|quota| self.written.saturating_add(bytes) > quota)
                {
                    Some(StorageFailure::QuotaExceeded)
                } else {
                    self.adoption_failure(&write.op)
                };
                let result = if let Some(failure) = failure {
                    Err(failure)
                } else {
                    let before = self.durable.clone();
                    let count = self.apply(&write.op, profile, &mut facts);
                    let appended = match &write.op {
                        StorageOp::WalAppend { owner, record, .. } => Some((*owner, record.seq)),
                        _ => None,
                    };
                    self.recent.push(DurableWrite {
                        at: now,
                        before,
                        appended,
                    });
                    self.written = self.written.saturating_add(bytes);
                    if matches!(write.op, StorageOp::WalAppend { .. }) && self.uncertain > 0 {
                        self.uncertain -= 1;
                        Err(StorageFailure::Uncertain)
                    } else {
                        Ok(count)
                    }
                };
                if matches!(write.op, StorageOp::WalAdopt { .. }) {
                    StorageEvent::Adopted {
                        id: write.id,
                        result,
                    }
                } else {
                    StorageEvent::Done {
                        id: write.id,
                        result: result.map(|_| ()),
                    }
                }
            }
        };
        Some(Completion {
            client: write.client,
            session: write.session,
            event,
            facts,
        })
    }
    fn adoption_failure(&self, op: &StorageOp) -> Option<StorageFailure> {
        if let StorageOp::WalDropExpired {
            doc,
            from: WalOwner::Session(owner),
            ..
        } = op
            && self.leases.contains(&(doc.clone(), *owner))
        {
            return Some(StorageFailure::Other);
        }
        let StorageOp::WalAdopt {
            doc,
            from,
            to,
            first_seq,
            ..
        } = op
        else {
            return None;
        };
        if let WalOwner::Session(owner) = from
            && self.leases.contains(&(doc.clone(), *owner))
        {
            return Some(StorageFailure::Other);
        }
        let covers = self
            .durable
            .snapshots
            .get(doc)
            .and_then(|snapshot| snapshot.covers)
            .filter(|(owner, _)| *from == WalOwner::Session(*owner))
            .map(|(_, seq)| seq)
            .unwrap_or(WalSeq(0));
        let count = self
            .durable
            .entries
            .iter()
            .filter(|((row_doc, owner, seq), row)| {
                row_doc == doc && owner == from && (!row.delivered || *seq > covers)
            })
            .count();
        for offset in 0..count {
            let Ok(offset) = u64::try_from(offset) else {
                return Some(StorageFailure::Other);
            };
            let Some(seq) = first_seq.0.checked_add(offset).map(WalSeq) else {
                return Some(StorageFailure::Other);
            };
            if self
                .durable
                .entries
                .contains_key(&(doc.clone(), WalOwner::Session(*to), seq))
            {
                return Some(StorageFailure::Other);
            }
        }
        None
    }
    fn apply(&mut self, op: &StorageOp, profile: &ProfileName, facts: &mut Vec<Fact>) -> u32 {
        match op {
            StorageOp::WalAppend {
                doc, owner, record, ..
            } => {
                let key = (doc.clone(), WalOwner::Session(*owner), record.seq);
                if let std::collections::btree_map::Entry::Vacant(entry) =
                    self.durable.entries.entry(key)
                {
                    entry.insert(StoredWalRecord {
                        record: record.clone(),
                        delivered: false,
                    });
                    facts.push(Fact::WalDurable {
                        profile: profile.clone(),
                        session: *owner,
                        seq: record.seq,
                    });
                }
            }
            StorageOp::WalMarkDelivered {
                doc,
                owner,
                through,
            } => {
                for ((row_doc, row_owner, seq), row) in &mut self.durable.entries {
                    if row_doc == doc && *row_owner == WalOwner::Session(*owner) && seq <= through {
                        row.delivered = true;
                    }
                }
            }
            StorageOp::WalPrune {
                doc,
                owner,
                through,
            } => {
                let covers = self
                    .durable
                    .snapshots
                    .get(doc)
                    .and_then(|snapshot| snapshot.covers)
                    .filter(|(id, _)| id == owner)
                    .map(|(_, seq)| seq);
                let mut removed = Vec::new();
                self.durable
                    .entries
                    .retain(|(row_doc, row_owner, seq), row| {
                        let prune = row_doc == doc
                            && *row_owner == WalOwner::Session(*owner)
                            && seq <= through
                            && covers.is_some_and(|cover| *seq <= cover)
                            && row.delivered;
                        if prune {
                            removed.push(*seq);
                        }
                        !prune
                    });
                if !removed.is_empty() {
                    facts.push(Fact::WalPruned {
                        profile: profile.clone(),
                        doc: doc.clone(),
                        owner: *owner,
                        seqs: removed,
                    });
                }
            }
            StorageOp::WalAdopt {
                doc,
                from,
                to,
                first_seq,
                covers: _,
            } => {
                let covers = self
                    .durable
                    .snapshots
                    .get(doc)
                    .and_then(|snapshot| snapshot.covers)
                    .filter(|(owner, _)| *from == WalOwner::Session(*owner))
                    .map(|(_, seq)| seq)
                    .unwrap_or(WalSeq(0));
                // All removals and conditional inserts are one completion event.
                let keys: Vec<_> = self
                    .durable
                    .entries
                    .keys()
                    .filter(|(row_doc, owner, _)| row_doc == doc && owner == from)
                    .cloned()
                    .collect();
                let mut map = Vec::new();
                let mut removed = Vec::new();
                for key in keys {
                    if let Some(mut row) = self.durable.entries.remove(&key) {
                        removed.push(key.2);
                        if row.delivered && key.2 <= covers {
                            continue;
                        }
                        let seq = WalSeq(
                            first_seq
                                .0
                                .saturating_add(u64::try_from(map.len()).unwrap_or(u64::MAX)),
                        );
                        row.record.seq = seq;
                        self.durable
                            .entries
                            .insert((doc.clone(), WalOwner::Session(*to), seq), row);
                        map.push((key.2, seq));
                    }
                }
                let count = u32::try_from(map.len()).unwrap_or(u32::MAX);
                facts.push(Fact::WalAdopted {
                    profile: profile.clone(),
                    doc: doc.clone(),
                    removed,
                    from: *from,
                    to: *to,
                    map,
                });
                return count;
            }
            StorageOp::WalDropExpired { doc, from, before } => {
                let mut seqs = Vec::new();
                self.durable.entries.retain(|(row_doc, owner, seq), row| {
                    let drop = row_doc == doc
                        && owner == from
                        && !row.delivered
                        && row.record.created_at < *before;
                    if drop {
                        seqs.push(*seq)
                    }
                    !drop
                });
                facts.push(Fact::WalExpired {
                    profile: profile.clone(),
                    doc: doc.clone(),
                    owner: *from,
                    seqs,
                });
            }
            StorageOp::WalQuarantine { doc, owner, seq } => {
                if let Some(row) =
                    self.durable
                        .entries
                        .get_mut(&(doc.clone(), WalOwner::Session(*owner), *seq))
                {
                    row.record.quarantined = true;
                }
            }
            StorageOp::SnapshotSave { doc, bytes, covers } => {
                self.durable.snapshots.insert(
                    doc.clone(),
                    StoredSnapshot {
                        bytes: bytes.clone(),
                        covers: *covers,
                    },
                );
            }
            StorageOp::SnapshotDelete { doc } => {
                self.durable.snapshots.remove(doc);
            }
            StorageOp::Load { .. } | StorageOp::LoadOrphans { .. } => {}
        }
        0
    }
    pub(crate) fn crash(&mut self, mode: &CrashMode, profile: &ProfileName, now: u64) -> Vec<Fact> {
        self.pending.clear();
        self.leases.clear();
        self.tails.clear();
        let mut facts = Vec::new();
        if let CrashMode::PowerLoss { window } = mode {
            let delivered_before = self
                .durable
                .entries
                .iter()
                .filter(|(_, row)| row.delivered)
                .map(|(key, _)| key.clone())
                .collect::<Vec<_>>();
            let cutoff = now.saturating_sub(window.0);
            while self.recent.last().is_some_and(|write| write.at >= cutoff) {
                if let Some(write) = self.recent.pop() {
                    self.durable = write.before;
                    if let Some((session, seq)) = write.appended {
                        facts.push(Fact::WalWriteLost {
                            profile: profile.clone(),
                            session,
                            seq,
                        });
                    }
                }
            }
            let mut lost = BTreeMap::<_, Vec<_>>::new();
            for key in delivered_before {
                if !self
                    .durable
                    .entries
                    .get(&key)
                    .is_some_and(|row| row.delivered)
                {
                    lost.entry((key.0, key.1)).or_default().push(key.2);
                }
            }
            facts.extend(
                lost.into_iter()
                    .map(|((doc, owner), seqs)| Fact::WalDeliveryLost {
                        profile: profile.clone(),
                        doc,
                        owner,
                        seqs,
                    }),
            );
        }
        facts
    }
}
pub(crate) fn document(op: &StorageOp) -> &SyncDocId {
    match op {
        StorageOp::Load { doc, .. }
        | StorageOp::LoadOrphans { doc, .. }
        | StorageOp::WalAppend { doc, .. }
        | StorageOp::WalMarkDelivered { doc, .. }
        | StorageOp::WalPrune { doc, .. }
        | StorageOp::WalAdopt { doc, .. }
        | StorageOp::WalDropExpired { doc, .. }
        | StorageOp::WalQuarantine { doc, .. }
        | StorageOp::SnapshotSave { doc, .. }
        | StorageOp::SnapshotDelete { doc } => doc,
    }
}

#[cfg(test)]
mod test;
