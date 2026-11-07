//! Pending-operation durability and snapshot replay policy.
use super::{
    document::DocumentAttribution,
    ports::{Clock, RoomStorage, SnapshotReadError, SnapshotStore},
    state::{DocumentState, ImportedUpdate},
    state_error::StateError,
    types::{OperationId, SessionKey},
};
use loro::VersionVector;
use macro_sync_service_jwt::session::SessionKind;
use std::{collections::BTreeSet, error::Error, future::Future};
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
}
impl OperationLog {
    /// Start a fresh log, including the legacy exists/initialize reset behavior.
    pub fn new(key: SessionKey, kind: SessionKind) -> Self {
        Self {
            key,
            kind,
            ids: OrderedIds::default(),
            applied: BTreeSet::new(),
        }
    }

    /// Identity of the document or surface whose operations this log owns.
    pub fn key(&self) -> &SessionKey {
        &self.key
    }

    /// Import synchronously, then persist pending bytes, archive and attribution
    /// in that order. The returned future deliberately does not borrow `document`.
    pub fn apply<'a, S: RoomStorage, C: Clock>(
        &'a mut self,
        storage: &'a S,
        document: &mut DocumentState,
        update: &'a [u8],
        attribution: Option<&'a DocumentAttribution>,
        clock: &C,
    ) -> impl Future<Output = Result<ImportedUpdate, OperationError<S::Error>>> + use<'a, S, C>
    {
        let id = self.ids.next(clock.unix_nanos());
        let imported = document.import_with_clock(update, || clock.monotonic());
        async move {
            let imported = imported.map_err(OperationError::State)?;
            storage
                .put_pending_operation(&id, update)
                .await
                .map_err(OperationError::Storage)?;
            self.applied.insert(id.clone());
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

    /// Replay every readable pending entry together, retaining all applied IDs.
    pub async fn replay_pending<S: RoomStorage>(
        &mut self,
        storage: &S,
        document: &mut DocumentState,
    ) -> Result<(), OperationError<S::Error>> {
        let pending = storage
            .pending_operations()
            .await
            .map_err(OperationError::PendingRead)?;
        trace!(
            pending_ops_len = pending.len(),
            "Applying [{}] pending ops",
            pending.len()
        );
        let mut failures = Vec::new();
        let mut updates = Vec::new();
        let mut ids = Vec::new();
        for entry in pending {
            match entry {
                Ok(entry) => {
                    ids.push(entry.id);
                    updates.push(entry.update);
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
        self.applied.extend(ids);
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
        let ids: Vec<_> = self.applied.iter().cloned().collect();
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

#[cfg(test)]
mod test;
