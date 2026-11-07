use crate::outbound::room_ports::WorkerClock;
use crate::{
    error::ResultExt,
    state::{DocumentState, ImportedUpdate},
    storage::backends::durable_kv::DurableKVStorage,
};
use backends::Storage;
use macro_sync_service_jwt::session::SessionKind;
use std::{cell::RefCell, rc::Rc};
use sync_server_core::domain::{
    document::DocumentAttribution,
    operation_log::{OperationError, OperationLog, SnapshotError},
    ports::{SnapshotReadError, SnapshotStore},
    types::SessionKey,
};
use worker::{Env, Error, Result, State};

pub mod backends;
pub mod op_log;
pub mod room_snapshot;
pub mod snapshot;
use room_snapshot::WorkerSnapshots;

pub struct SessionStorage {
    snapshots: WorkerSnapshots,
    storage: DurableKVStorage,
    operations: RefCell<OperationLog>,
    key: SessionKey,
}

fn operation_error(error: OperationError<worker::Error>) -> worker::Error {
    match error {
        OperationError::Storage(error) => error,
        OperationError::State(error) => Error::from(error.to_string()),
        OperationError::PendingRead(error) => Err::<(), _>(error)
            .context("get_pending_operations failed")
            .unwrap_err(),
        OperationError::Replay(error) => Err::<(), _>(Error::from(error.to_string()))
            .context("failed applying pending ops")
            .unwrap_err(),
    }
}
fn snapshot_error(error: SnapshotError<worker::Error, worker::Error>) -> worker::Error {
    match error {
        SnapshotError::Operation(error) => operation_error(error),
        SnapshotError::Write(error) => error,
        SnapshotError::Unavailable(error) => {
            Error::from(format!("document snapshot not found: {error}"))
        }
    }
}
fn snapshot_read_error(error: SnapshotReadError<worker::Error>) -> worker::Error {
    match error {
        SnapshotReadError::Storage(error) => error,
        SnapshotReadError::Missing => Error::from("no snapshot is stored"),
    }
}

/// Outbound adapter for atomic document updates, sharing the websocket log.
pub struct DocumentUpdateStorage<'a> {
    pub document_state: &'a DocumentState,
    pub storage: &'a SessionStorage,
    pub attribution: Option<&'a DocumentAttribution>,
}
impl crate::domain::document::DocumentUpdatePort for DocumentUpdateStorage<'_> {
    fn document(&self) -> &loro::LoroDoc {
        &self.document_state.loro_doc
    }
    async fn apply_and_persist(
        &self,
        update: &[u8],
    ) -> std::result::Result<(), crate::domain::document::DocumentError> {
        self.storage
            .apply_with_attribution(update, self.document_state, self.attribution)
            .await
            .map(|_| ())
            .map_err(|error| {
                tracing::error!(error = ?error, "failed to persist document update");
                crate::domain::document::DocumentError::Persistence
            })
    }
}

impl SessionStorage {
    pub fn new(
        snapshot_storage: Storage,
        storage: DurableKVStorage,
        kind: SessionKind,
        key: String,
        state: Rc<State>,
    ) -> Self {
        let snapshots = WorkerSnapshots::fixed(snapshot_storage, state);
        let key = SessionKey::new(key);
        Self {
            snapshots,
            storage,
            operations: RefCell::new(OperationLog::new(key.clone(), kind)),
            key,
        }
    }
    /// Load document state and apply any pending operations.
    pub async fn load_document_state(&self) -> Result<DocumentState> {
        self.operations
            .borrow_mut()
            .load_document_state(
                &self.storage,
                &self.snapshots,
                cfg!(feature = "create-default-state"),
            )
            .await
            .map(DocumentState::from_core)
            .map_err(snapshot_error)
    }
    pub async fn get_pending_operations(&self) -> Result<Vec<Result<(String, Vec<u8>)>>> {
        self.storage.get_pending_operations().await
    }
    pub async fn debug_do_kv_get(&self, key: &str) -> Result<Option<Vec<u8>>> {
        self.storage.get_key(key).await
    }
    pub async fn debug_list_do_kv(&self, prefix: &str) -> Result<Vec<Result<(String, Vec<u8>)>>> {
        self.storage.list_do_kv(prefix).await
    }
    pub async fn get_snapshot(&self) -> Result<Vec<u8>> {
        self.snapshots
            .get(&self.key)
            .await
            .map_err(snapshot_read_error)
    }
    pub async fn store_snapshot(&self, state: &DocumentState) -> Result<()> {
        let operations = self.operations.borrow();
        let pending = {
            let document = state.core();
            operations.store_snapshot(&self.storage, &self.snapshots, &document)
        };
        pending.await.map_err(snapshot_error)
    }
    pub async fn append_pending_operation(
        &self,
        update: &[u8],
        state: &DocumentState,
    ) -> Result<ImportedUpdate> {
        self.apply_with_attribution(update, state, None).await
    }
    pub async fn apply_with_attribution(
        &self,
        update: &[u8],
        state: &DocumentState,
        attribution: Option<&DocumentAttribution>,
    ) -> Result<ImportedUpdate> {
        let mut operations = self.operations.borrow_mut();
        let pending = {
            let mut document = state.core_mut();
            operations.apply(
                &self.storage,
                &mut document,
                update,
                attribution,
                &WorkerClock,
            )
        };
        pending.await.map_err(operation_error)
    }
    pub async fn clear_applied_ops(&self) -> Result<()> {
        self.operations
            .borrow_mut()
            .clear_applied(&self.storage)
            .await
            .map_err(operation_error)
    }
}

pub fn get_snapshot_storage(
    _env: &Env,
    _state: &State,
    document_id: String,
) -> worker::Result<Storage> {
    #[cfg(all(feature = "kv-snapshot-storage", feature = "r2-snapshot-storage"))]
    {
        compile_error!("features `kv-snapshot-storage` and `r2-snapshot-storage` are incompatible")
    }
    #[cfg(feature = "do-sqlite-snapshot-storage")]
    {
        crate::storage::backends::combined_sql_kv::Storage::new(_env, _state.storage(), document_id)
    }
    #[cfg(feature = "kv-snapshot-storage")]
    {
        crate::storage::backends::kv::Kv::from_env(_env, document_id)
    }
    #[cfg(feature = "r2-snapshot-storage")]
    {
        const DOCUMENT_STATE_BUCKET: &str = "DOCUMENT_SNAPSHOT_BUCKET";
        let bucket = _env.bucket(DOCUMENT_STATE_BUCKET)?;
        Ok(crate::storage::backends::r2::R2Storage::new(
            bucket,
            document_id,
        ))
    }
}
