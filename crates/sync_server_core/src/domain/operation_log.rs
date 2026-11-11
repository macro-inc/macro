//! Pending-operation durability and snapshot replay policy.
use super::{
    document::DocumentAttribution,
    ports::{Clock, OperationAppendError, RoomStorage, SnapshotReadError, SnapshotStore},
    state::{DocumentState, ImportedUpdate},
    state_error::{ResultExt, StateError},
    types::{OperationArchive, OperationId, PendingOperation, SessionKey},
};
use loro::VersionVector;
use macro_sync_service_jwt::session::SessionKind;
use std::{
    collections::{BTreeMap, BTreeSet},
    error::Error,
    future::Future,
};
use tracing::{error, trace, warn};

/// Failure while updating the operation log.
#[derive(Debug, thiserror::Error)]
pub enum OperationError<E: Error + 'static> {
    /// The storage adapter failed.
    #[error(transparent)]
    Storage(E),
    /// The imported document rejected an update.
    #[error(transparent)]
    State(StateError),
    /// Reading pending entries failed before replay.
    #[error("get_pending_operations failed : {0:?}")]
    PendingRead(E),
    /// Importing the readable pending entries failed.
    #[error("failed applying pending ops : {0}")]
    Replay(StateError),
}

/// Failure while loading or saving a session snapshot.
#[derive(Debug, thiserror::Error)]
pub enum SnapshotError<S: Error + 'static, T: Error + 'static> {
    /// The operation log failed.
    #[error(transparent)]
    Operation(OperationError<S>),
    /// No usable snapshot was available and default creation is disabled.
    #[error("document snapshot not found: {0}")]
    Unavailable(SnapshotReadError<T>),
    /// The snapshot adapter failed to persist the new snapshot.
    #[error(transparent)]
    Write(T),
}

/// Generates the legacy lexically ordered wall-time and counter identifiers.
#[derive(Debug, Default)]
pub struct OrderedIds {
    counter: usize,
}
impl OrderedIds {
    /// Allocate an identifier using the adapter's exact wall-clock reading.
    pub fn next(&mut self, unix_nanos: u128) -> OperationId {
        let counter = self.counter;
        self.counter = self.counter.wrapping_add(1);
        OperationId::new(format!("{unix_nanos:016x}.{counter:08x}"))
    }
}

/// In-memory operation IDs applied since the last snapshot.
#[derive(Debug)]
pub struct OperationLog {
    key: SessionKey,
    kind: SessionKind,
    ids: OrderedIds,
    applied: BTreeSet<OperationId>,
    unresolved: BTreeMap<OperationId, VersionVector>,
    archive_debt: BTreeMap<OperationId, PendingOperation>,
    fanout_debt: Option<super::fanout::FanoutDebt>,
}
impl OperationLog {
    /// Start a fresh log for a session identity.
    pub fn new(key: SessionKey, kind: SessionKind) -> Self {
        Self {
            key,
            kind,
            ids: OrderedIds::default(),
            applied: BTreeSet::new(),
            unresolved: BTreeMap::new(),
            archive_debt: BTreeMap::new(),
            fanout_debt: None,
        }
    }

    /// Whether this activation log belongs to the requested session.
    pub(crate) fn is_for(&self, key: &SessionKey) -> bool {
        self.key == *key
    }

    /// Import synchronously, then append pending bytes, archive and attribution.
    /// Activated appends are atomic with durable pending fallback on archive failure.
    /// The returned future deliberately does not borrow `document`.
    pub fn apply<'a, S: RoomStorage, C: Clock>(
        &'a mut self,
        storage: &'a S,
        document: &mut DocumentState,
        update: &'a [u8],
        attribution: Option<&'a DocumentAttribution>,
        clock: &C,
    ) -> impl Future<Output = Result<ImportedUpdate, OperationError<S::Error>>> + use<'a, S, C>
    {
        let nanos = clock.unix_nanos();
        // A cold replay may retain a pending key at this exact timestamp.
        // Never overwrite it before its missing dependencies become durable.
        let id = loop {
            let candidate = self.ids.next(nanos);
            if !self.applied.contains(&candidate) && !self.unresolved.contains_key(&candidate) {
                break candidate;
            }
        };
        let before = document.loro_doc.oplog_vv();
        let imported = document.import_with_clock(update, || clock.monotonic());
        let required = loro::LoroDoc::decode_import_blob_meta(update, false)
            .context("failed to read update metadata")
            .map(|meta| meta.partial_end_vv);
        let known = document.loro_doc.oplog_vv();
        let new_debt = if storage.operation_archive_writes()
            && self
                .unresolved
                .values()
                .any(|required| known.includes_vv(required))
        {
            (|| {
                let mut required = known.clone();
                if let Some(debt) = &self.fanout_debt {
                    required.merge(&debt.vectors()?.1);
                }
                Ok(Some(super::fanout::FanoutDebt {
                    base: self
                        .fanout_debt
                        .as_ref()
                        .map_or_else(|| before.encode(), |debt| debt.base.clone()),
                    required: required.encode(),
                }))
            })()
        } else {
            Ok(None)
        };
        let ready_delta = match &new_debt {
            Ok(new) => new
                .as_ref()
                .or(self.fanout_debt.as_ref())
                .map(|debt| {
                    let (base, _) = debt.vectors()?;
                    if !known.includes_vv(&base) {
                        return Err(StateError::InvalidSnapshot);
                    }
                    if known != base {
                        document.export_updates_since(&base).map(Some)
                    } else {
                        Ok(None)
                    }
                })
                .transpose()
                .map(Option::flatten),
            Err(_) => Ok(None), // The metadata error is returned before any storage write below.
        };
        async move {
            let mut imported = imported.map_err(OperationError::State)?;
            imported.resolved_pending = ready_delta.map_err(OperationError::State)?;
            if let Some(debt) = new_debt.map_err(OperationError::State)? {
                storage
                    .put_fanout_debt(&debt)
                    .await
                    .map_err(OperationError::Storage)?;
                self.fanout_debt = Some(debt);
            }
            let required = required.map_err(OperationError::State)?;
            // A causal-pending import may report unchanged while containing new
            // operations. Only coverage BEFORE import proves a duplicate.
            // Snapshot-origin history is already durable; only pending-origin
            // history carries archive debt. Do not invent archives for snapshots.
            if storage.operation_archive_writes() && covers(&before, &required) {
                self.repair_archives(storage).await?;
                return Ok(imported);
            }
            if storage.operation_archive_writes() {
                match storage
                    .put_complete_operation(&id, update, attribution)
                    .await
                {
                    Ok(()) => {
                        self.unresolved.insert(id, required);
                        self.mark_resolved(&known);
                        return Ok(imported);
                    }
                    Err(OperationAppendError::Pending(error)) => {
                        return Err(OperationError::Storage(error));
                    }
                    Err(OperationAppendError::Archive(error)) => {
                        // The fast transaction published nothing. Preserve the
                        // accepted bytes and original attribution for cold repair
                        // before exposing its failure; never ACK this path.
                        storage
                            .put_pending_operation(&id, update, attribution)
                            .await
                            .map_err(OperationError::Storage)?;
                        self.archive_debt.insert(
                            id.clone(),
                            PendingOperation {
                                id: id.clone(),
                                update: update.to_vec(),
                                archive: OperationArchive::Incomplete {
                                    attribution: attribution.cloned(),
                                },
                            },
                        );
                        self.unresolved.insert(id, required);
                        self.mark_resolved(&known);
                        return Err(OperationError::Storage(error));
                    }
                }
            }
            storage
                .put_pending_operation(&id, update, attribution)
                .await
                .map_err(OperationError::Storage)?;
            self.unresolved.insert(id.clone(), required);
            self.mark_resolved(&known);
            storage
                .put_archived_operation(&id, update)
                .await
                .map_err(OperationError::Storage)?;
            if let Some(attribution) = attribution {
                storage
                    .put_operation_attribution(&id, attribution)
                    .await
                    .map_err(OperationError::Storage)?;
            }
            Ok(imported)
        }
    }

    async fn repair_archives<S: RoomStorage>(
        &mut self,
        storage: &S,
    ) -> Result<(), OperationError<S::Error>> {
        // Retain debt through every failure. A duplicate receipt promises the
        // original archive, not just bytes recoverable from the pending log.
        while let Some((id, entry)) = self.archive_debt.first_key_value() {
            storage
                .put_archived_operation(id, &entry.update)
                .await
                .map_err(OperationError::Storage)?;
            if let OperationArchive::Incomplete {
                attribution: Some(attribution),
            } = &entry.archive
            {
                storage
                    .put_operation_attribution(id, attribution)
                    .await
                    .map_err(OperationError::Storage)?;
            }
            storage
                .complete_operation_archive(id)
                .await
                .map_err(OperationError::Storage)?;
            self.archive_debt.pop_first();
        }
        Ok(())
    }

    /// Read the applied portion of retained debt without importing or writing.
    pub fn pending_fanout(&self, document: &DocumentState) -> Result<Option<Vec<u8>>, StateError> {
        let Some(debt) = &self.fanout_debt else {
            return Ok(None);
        };
        let (base, _) = debt.vectors()?;
        let known = document.loro_doc.oplog_vv();
        if !known.includes_vv(&base) {
            return Err(StateError::InvalidSnapshot);
        }
        if known == base {
            return Ok(None);
        }
        document.export_updates_since(&base).map(Some)
    }

    /// Clear durable notification debt only after its full delta reached every socket.
    pub async fn complete_fanout<S: RoomStorage>(
        &mut self,
        storage: &S,
        known: &VersionVector,
    ) -> Result<(), OperationError<S::Error>> {
        if let Some(debt) = &self.fanout_debt {
            let (base, mut required) = debt.vectors().map_err(OperationError::State)?;
            if !known.includes_vv(&base) {
                return Err(OperationError::State(StateError::InvalidSnapshot));
            }
            if known.includes_vv(&required) {
                storage
                    .delete_fanout_debt()
                    .await
                    .map_err(OperationError::Storage)?;
                self.fanout_debt = None;
            } else {
                // A prior parent's write may still be unavailable. Publish the
                // independently durable progress without forgetting that debt,
                // then move the baseline so retries do not re-export it forever.
                required.merge(known);
                let advanced = super::fanout::FanoutDebt {
                    base: known.encode(),
                    required: required.encode(),
                };
                storage
                    .put_fanout_debt(&advanced)
                    .await
                    .map_err(OperationError::Storage)?;
                self.fanout_debt = Some(advanced);
            }
        }
        Ok(())
    }

    fn mark_resolved(&mut self, known: &VersionVector) {
        self.unresolved.retain(|id, required| {
            if matches!(
                known.partial_cmp(required),
                Some(std::cmp::Ordering::Equal | std::cmp::Ordering::Greater)
            ) {
                self.applied.insert(id.clone());
                false
            } else {
                true
            }
        });
    }

    /// Replay readable entries together; compact only entries covered by the oplog.
    pub async fn replay_pending<S: RoomStorage>(
        &mut self,
        storage: &S,
        document: &mut DocumentState,
    ) -> Result<(), OperationError<S::Error>> {
        let pending = storage
            .pending_operations()
            .await
            .map_err(OperationError::PendingRead)?;
        self.fanout_debt = pending.fanout;
        if let Some(debt) = &self.fanout_debt {
            debt.vectors().map_err(OperationError::Replay)?;
        }
        let pending = pending.entries;
        trace!(
            pending_ops_len = pending.len(),
            "Applying [{}] pending ops",
            pending.len()
        );
        let mut failures = Vec::new();
        let mut updates = Vec::new();
        let mut entries = Vec::new();
        for entry in pending {
            match entry {
                Ok(entry) => {
                    updates.push(entry.update);
                    entries.push((entry.id, entry.archive));
                }
                Err(error) => failures.push(error),
            }
        }
        if !failures.is_empty() {
            error!(errors = ?failures, "got [{}] invalid things from durable ojbect KV", failures.len());
        }
        document
            .replay_pending_operations(&updates)
            .map_err(OperationError::Replay)?;
        for ((id, archive), update) in entries.into_iter().zip(updates) {
            let required = loro::LoroDoc::decode_import_blob_meta(&update, false)
                .context("failed to read pending update metadata")
                .map_err(OperationError::Replay)?
                .partial_end_vv;
            let retain_debt = matches!(&archive, OperationArchive::Incomplete { .. })
                || (matches!(&archive, OperationArchive::Legacy)
                    && storage.operation_archive_writes());
            if retain_debt {
                self.archive_debt.insert(
                    id.clone(),
                    PendingOperation {
                        id: id.clone(),
                        update,
                        archive,
                    },
                );
            } else {
                self.archive_debt.remove(&id);
            }
            self.unresolved.insert(id, required);
        }
        self.mark_resolved(&document.loro_doc.oplog_vv());
        Ok(())
    }

    /// Delete applied pending entries, retaining the legacy count-mismatch behavior.
    pub async fn clear_applied<S: RoomStorage>(
        &mut self,
        storage: &S,
    ) -> Result<(), OperationError<S::Error>> {
        if self.applied.is_empty() {
            return Ok(());
        }
        if storage.operation_archive_writes() {
            self.repair_archives(storage).await?;
        }
        // A snapshot covering these bytes does not prove archive completion.
        // Reader-only rollback keeps incomplete rows until a writer can repair.
        let ids: Vec<_> = self
            .applied
            .iter()
            .filter(|id| !self.archive_debt.contains_key(*id))
            .cloned()
            .collect();
        if ids.is_empty() {
            return Ok(());
        }
        let deleted = storage
            .delete_pending_operations(&ids)
            .await
            .inspect_err(|error| {
                warn!(keys = ?ids, error = ?error, "error in kv.delete_multiple()");
            })
            .map_err(OperationError::Storage)?;
        if deleted != ids.len() {
            error!(n_deleted = deleted, keys_len = ids.len(), keys = ?ids,
                "\nWe have mystery key which we can't delete.\nWe must cycle through current keys and remove those we have not applied yet\nTODO\n");
        }
        for id in ids {
            self.applied.remove(&id);
        }
        Ok(())
    }

    /// Compare a loaded snapshot against the saved version vector without rejecting it.
    pub async fn compare_saved_vv<S: RoomStorage>(
        &self,
        storage: &S,
        loaded: &VersionVector,
    ) -> Result<(), OperationError<S::Error>> {
        let Some(bytes) = storage
            .saved_version_vector()
            .await
            .map_err(OperationError::Storage)?
        else {
            warn!("No version vector was saved the last time a snapshot was saved");
            return Ok(());
        };
        let saved = VersionVector::decode(&bytes).expect("TODO we wrote a bad vv???");
        match loaded.partial_cmp(&saved) {
            Some(std::cmp::Ordering::Less) => {
                error!("Loaded snapshot older than the last snapshot saved")
            }
            Some(std::cmp::Ordering::Equal) => {
                trace!("Loaded snapshot matches last snapshot saved")
            }
            Some(std::cmp::Ordering::Greater) => {
                warn!("Loaded snapshot was newer than the last snapshot saved")
            }
            None => warn!("Loaded snapshot that diverged from the last snapshot saved"),
        }
        Ok(())
    }

    /// Load the full snapshot, compare its saved vector and replay pending updates.
    pub async fn load_document_state<S: RoomStorage, T: SnapshotStore>(
        &mut self,
        storage: &S,
        snapshots: &T,
        create_default: bool,
    ) -> Result<DocumentState, SnapshotError<S::Error, T::Error>> {
        let snapshot = snapshots.get(&self.key).await;
        let allow_default = self.kind == SessionKind::Document && create_default;
        let mut state = match (snapshot, allow_default) {
            (Ok(bytes), _) => DocumentState::try_from_snapshot(&bytes)
                .map_err(|error| SnapshotError::Operation(OperationError::State(error)))?,
            (Err(_), true) => {
                let state = DocumentState::new();
                self.store_snapshot(storage, snapshots, &state).await?;
                trace!("ensure_initialized new store_snapshot");
                state
            }
            (Err(error), false) => return Err(SnapshotError::Unavailable(error)),
        };
        self.compare_saved_vv(storage, &state.loro_doc.oplog_vv())
            .await
            .map_err(SnapshotError::Operation)?;
        self.replay_pending(storage, &mut state)
            .await
            .map_err(SnapshotError::Operation)?;
        Ok(state)
    }

    /// Export synchronously, then store the full snapshot before its version vector.
    /// The returned future deliberately does not borrow `document`.
    pub fn store_snapshot<'a, S: RoomStorage, T: SnapshotStore>(
        &'a self,
        storage: &'a S,
        snapshots: &'a T,
        document: &DocumentState,
    ) -> impl Future<Output = Result<(), SnapshotError<S::Error, T::Error>>> + use<'a, S, T> {
        let snapshot = document.export_snapshot(None);
        let version_doc = document.loro_doc.clone();
        async move {
            let snapshot =
                snapshot.map_err(|error| SnapshotError::Operation(OperationError::State(error)))?;
            snapshots
                .put(&self.key, &snapshot)
                .await
                .map_err(SnapshotError::Write)?;
            storage
                .put_saved_version_vector(&version_doc.oplog_vv().encode())
                .await
                .map_err(|error| SnapshotError::Operation(OperationError::Storage(error)))?;
            Ok(())
        }
    }
}

fn covers(known: &VersionVector, required: &VersionVector) -> bool {
    matches!(
        known.partial_cmp(required),
        Some(std::cmp::Ordering::Equal | std::cmp::Ordering::Greater)
    )
}

#[cfg(test)]
mod archive_test;
#[cfg(test)]
mod test;
