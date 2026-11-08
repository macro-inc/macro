//! Independent flat-row transaction model and reusable adapter contract cases.
//! Browser database identity, async Web Lock waits and real process termination still
//! require the later S8 browser tier. These cases establish the shared data contract.
use crate::{Failure, StoreImage};
use doc_sync_core::*;
use std::collections::{BTreeMap, BTreeSet};

mod cases;
pub use cases::storage_cases;

/// One portable contract action; hosts drive their executor to completion for Execute.
#[derive(Clone, Debug)]
pub enum ContractAction {
    /// Execute exactly one storage operation with an explicit wall clock.
    Execute(StorageOp, UnixMillis),
    /// Grant the simulated owner lease before executing its storage effects.
    Acquire(SyncDocId, SessionId),
    /// Release the lease without deleting its rows.
    Release(SyncDocId, SessionId),
    /// Terminate the process after all preceding completions; durable data survives.
    ProcessDeath,
    /// Apply conservative cache eviction (never corrupt-snapshot recovery).
    Evict(SyncDocId),
}
/// Normalized completion, independent of the executor's correlation ids.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ContractReply {
    /// Loaded snapshot, orphan and assist rows.
    Loaded(LocalState),
    /// Completed mutation or lease/process action.
    Done,
    /// Number of atomically moved rows.
    Adopted(u32),
    /// Whether the conservative eviction was allowed.
    Evicted(bool),
}
/// Test-only adapter interface reusable by native and browser executor harnesses.
/// Construct an isolated adapter from StorageCase.initial before running a case.
pub trait StorageContract {
    /// Run the action to completion, including its durable transaction boundary.
    fn action(&mut self, action: &ContractAction) -> Result<ContractReply, StorageFailure>;
    /// Observe committed rows and snapshots without mutating them.
    fn image(&self) -> StoreImage;
}
/// Portable initial state and literal action sequence for one storage contract.
#[derive(Clone, Debug)]
pub struct StorageCase {
    /// Contract property described by this case.
    pub name: &'static str,
    /// Exact initial rows/snapshots to install in an isolated test database.
    pub initial: StoreImage,
    /// Explicit orphan TTL shared by model and executor host.
    pub retention: Millis,
    /// Ordered operations and lifecycle boundaries.
    pub actions: Vec<ContractAction>,
}
/// Compare every completion and committed image against an independent model.
pub fn check_storage_case(
    case: &StorageCase,
    adapter: &mut impl StorageContract,
) -> Result<(), Failure> {
    let mut model = IndexedDbModel::new(case.initial.clone(), case.retention);
    if adapter.image() != case.initial {
        return Err(Failure::new(
            "storage_contract",
            format!("{}: initial image differs", case.name),
        ));
    }
    for (index, action) in case.actions.iter().enumerate() {
        let expected = model.action(action);
        let actual = adapter.action(action);
        if actual != expected || adapter.image() != model.image() {
            return Err(Failure::new(
                "storage_contract",
                format!(
                    "{} action{index} {action:?}: expected={expected:?}, actual={actual:?}, expected image={:?}, actual image={:?}",
                    case.name,
                    model.image(),
                    adapter.image()
                ),
            ));
        }
    }
    Ok(())
}
#[derive(Clone)]
struct Row {
    doc: SyncDocId,
    owner: WalOwner,
    stored: StoredWalRecord,
}
/// Flat-row IndexedDB transaction reference, independent of SimStorage's indexed mutations.
#[derive(Clone)]
pub struct IndexedDbModel {
    rows: Vec<Row>,
    snapshots: BTreeMap<SyncDocId, StoredSnapshot>,
    leases: BTreeSet<(SyncDocId, SessionId)>,
    retention: Millis,
}
impl IndexedDbModel {
    /// Install an isolated durable image with explicit retention and no live leases.
    pub fn new(image: StoreImage, retention: Millis) -> Self {
        Self {
            rows: image
                .entries
                .into_iter()
                .map(|((doc, owner, _), stored)| Row { doc, owner, stored })
                .collect(),
            snapshots: image.snapshots,
            leases: BTreeSet::new(),
            retention,
        }
    }
    fn leased(&self, doc: &SyncDocId, owner: WalOwner) -> bool {
        match owner {
            WalOwner::Session(owner) => self.leases.contains(&(doc.clone(), owner)),
            WalOwner::Legacy => false,
        }
    }
    fn loaded(
        &self,
        doc: &SyncDocId,
        owner: SessionId,
        user: &UserKey,
        wall: UnixMillis,
    ) -> LocalState {
        let mut orphans: BTreeMap<WalOwner, Vec<StoredWalRecord>> = BTreeMap::new();
        let mut assist: BTreeMap<WalOwner, Vec<StoredWalRecord>> = BTreeMap::new();
        let before = wall
            .0
            .saturating_sub(i64::try_from(self.retention.0).unwrap_or(i64::MAX));
        let mut rows = self
            .rows
            .iter()
            .filter(|row| &row.doc == doc && row.owner != WalOwner::Session(owner))
            .collect::<Vec<_>>();
        rows.sort_by_key(|row| (row.owner, row.stored.record.seq));
        for row in rows {
            let leased = self.leased(doc, row.owner);
            let mut value = row.stored.clone();
            if &value.record.user != user {
                if leased || value.delivered || value.record.created_at.0 >= before {
                    continue;
                }
                value.record.bytes.clear();
            } else if leased {
                if !value.delivered {
                    assist.entry(row.owner).or_default().push(value);
                }
                continue;
            }
            orphans.entry(row.owner).or_default().push(value);
        }
        LocalState {
            snapshot: self
                .snapshots
                .get(doc)
                .filter(|snapshot| !snapshot.bytes.is_empty())
                .cloned(),
            orphans: orphans
                .into_iter()
                .map(|(owner, records)| OrphanWal { owner, records })
                .collect(),
            assist: assist
                .into_iter()
                .map(|(owner, records)| OrphanWal { owner, records })
                .collect(),
        }
    }
    fn execute(
        &mut self,
        op: &StorageOp,
        wall: UnixMillis,
    ) -> Result<ContractReply, StorageFailure> {
        match op {
            StorageOp::Load { doc, owner, user } | StorageOp::LoadOrphans { doc, owner, user } => {
                return Ok(ContractReply::Loaded(self.loaded(doc, *owner, user, wall)));
            }
            StorageOp::WalAppend {
                doc, owner, record, ..
            } => {
                if !self.rows.iter().any(|row| {
                    &row.doc == doc
                        && row.owner == WalOwner::Session(*owner)
                        && row.stored.record.seq == record.seq
                }) {
                    self.rows.push(Row {
                        doc: doc.clone(),
                        owner: WalOwner::Session(*owner),
                        stored: StoredWalRecord {
                            record: record.clone(),
                            delivered: false,
                        },
                    });
                }
            }
            StorageOp::WalMarkDelivered {
                doc,
                owner,
                through,
            } => {
                for row in &mut self.rows {
                    if &row.doc == doc
                        && row.owner == WalOwner::Session(*owner)
                        && row.stored.record.seq <= *through
                    {
                        row.stored.delivered = true;
                    }
                }
            }
            StorageOp::WalPrune {
                doc,
                owner,
                through,
            } => {
                let cover = self
                    .snapshots
                    .get(doc)
                    .and_then(|snapshot| snapshot.covers)
                    .filter(|(id, _)| id == owner)
                    .map(|(_, seq)| seq);
                self.rows.retain(|row| {
                    !(&row.doc == doc
                        && row.owner == WalOwner::Session(*owner)
                        && row.stored.delivered
                        && row.stored.record.seq <= *through
                        && cover.is_some_and(|seq| row.stored.record.seq <= seq))
                });
            }
            StorageOp::WalAdopt {
                doc,
                from,
                to,
                first_seq,
                ..
            } => {
                if self.leased(doc, *from) {
                    return Err(StorageFailure::Other);
                }
                let cover = self
                    .snapshots
                    .get(doc)
                    .and_then(|snapshot| snapshot.covers)
                    .filter(|(id, _)| WalOwner::Session(*id) == *from)
                    .map(|(_, seq)| seq)
                    .unwrap_or(WalSeq(0));
                let mut selected = self
                    .rows
                    .iter()
                    .filter(|row| {
                        &row.doc == doc
                            && row.owner == *from
                            && (!row.stored.delivered || row.stored.record.seq > cover)
                    })
                    .cloned()
                    .collect::<Vec<_>>();
                selected.sort_by_key(|row| row.stored.record.seq);
                for (offset, row) in selected.iter_mut().enumerate() {
                    let seq = first_seq
                        .0
                        .checked_add(u64::try_from(offset).map_err(|_| StorageFailure::Other)?)
                        .ok_or(StorageFailure::Other)?;
                    if self.rows.iter().any(|row| {
                        &row.doc == doc
                            && row.owner == WalOwner::Session(*to)
                            && row.stored.record.seq == WalSeq(seq)
                    }) {
                        return Err(StorageFailure::Other);
                    }
                    row.owner = WalOwner::Session(*to);
                    row.stored.record.seq = WalSeq(seq);
                }
                let count = u32::try_from(selected.len()).map_err(|_| StorageFailure::Other)?;
                self.rows
                    .retain(|row| &row.doc != doc || row.owner != *from);
                self.rows.extend(selected);
                return Ok(ContractReply::Adopted(count));
            }
            StorageOp::WalDropExpired { doc, from, before } => {
                if self.leased(doc, *from) {
                    return Err(StorageFailure::Other);
                }
                self.rows.retain(|row| {
                    !(&row.doc == doc
                        && row.owner == *from
                        && !row.stored.delivered
                        && row.stored.record.created_at < *before)
                });
            }
            StorageOp::WalQuarantine { doc, owner, seq } => {
                for row in &mut self.rows {
                    if &row.doc == doc
                        && row.owner == WalOwner::Session(*owner)
                        && row.stored.record.seq == *seq
                    {
                        row.stored.record.quarantined = true;
                    }
                }
            }
            StorageOp::SnapshotSave { doc, bytes, covers } => {
                self.snapshots.insert(
                    doc.clone(),
                    StoredSnapshot {
                        bytes: bytes.clone(),
                        covers: *covers,
                    },
                );
            }
            StorageOp::SnapshotDelete { doc } => {
                self.snapshots.remove(doc);
            }
        }
        Ok(ContractReply::Done)
    }
}
impl StorageContract for IndexedDbModel {
    fn action(&mut self, action: &ContractAction) -> Result<ContractReply, StorageFailure> {
        match action {
            ContractAction::Execute(op, wall) => {
                // Transaction abort cannot retain a partially renumbered adoption.
                let mut transaction = self.clone();
                let reply = transaction.execute(op, *wall)?;
                *self = transaction;
                Ok(reply)
            }
            ContractAction::Acquire(doc, owner) => {
                self.leases.insert((doc.clone(), *owner));
                Ok(ContractReply::Done)
            }
            ContractAction::Release(doc, owner) => {
                self.leases.remove(&(doc.clone(), *owner));
                Ok(ContractReply::Done)
            }
            ContractAction::ProcessDeath => {
                self.leases.clear();
                Ok(ContractReply::Done)
            }
            ContractAction::Evict(doc) => {
                let allowed = !self
                    .rows
                    .iter()
                    .any(|row| &row.doc == doc && !row.stored.delivered);
                if allowed {
                    self.snapshots.remove(doc);
                }
                Ok(ContractReply::Evicted(allowed))
            }
        }
    }
    fn image(&self) -> StoreImage {
        StoreImage {
            entries: self
                .rows
                .iter()
                .map(|row| {
                    (
                        (row.doc.clone(), row.owner, row.stored.record.seq),
                        row.stored.clone(),
                    )
                })
                .collect(),
            snapshots: self.snapshots.clone(),
        }
    }
}

#[cfg(test)]
mod test;
