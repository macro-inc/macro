use backends::Storage;
use snapshot::SnapshotStorage;
use tracing::trace;
use worker::{Env, Error, Result, State};

use crate::{
    state::DocumentState, storage::backends::durable_kv::DurableKVStorage, timeit, timeit_log,
};

pub mod backends;
pub mod op_log;
pub mod snapshot;

pub struct SessionStorage {
    snapshot_storage: Storage,
    oplog: DurableKVStorage,
}

impl SessionStorage {
    pub fn new(snapshot_storage: Storage, oplog: DurableKVStorage) -> Self {
        Self {
            snapshot_storage,
            oplog,
        }
    }

    /// Load document state and apply any pending ops
    pub async fn load_document_state(&self) -> Result<DocumentState> {
        let snapshot = self.get_snapshot().await;
        let state = match (snapshot, cfg!(feature = "create-default-state")) {
            (Ok(snapshot), _) => DocumentState::try_from_snapshot(snapshot.as_slice()),
            (Err(_e), true) => {
                let state = DocumentState::new();
                timeit_log!("ensure_initialized new store_snapshot", {
                    self.store_snapshot(&state).await?;
                });
                Ok(state)
            }
            (Err(e), false) => {
                return Err(Error::from(format!("document snapshot not found: {e}")));
            }
        }?;
        self.oplog
            .cmp_vv_with_last_snapshot_vv(&state.loro_doc.oplog_vv())
            .await?;
        self.oplog.apply_pending_ops(&state).await?;
        Ok(state)
    }

    pub async fn get_pending_operations(&self) -> Result<Vec<Result<(String, Vec<u8>)>>> {
        self.oplog.get_pending_operations().await
    }

    pub async fn debug_do_kv_get(&self, key: &str) -> Result<Option<Vec<u8>>> {
        self.oplog.get_key(key).await
    }

    pub async fn debug_list_do_kv(&self, prefix: &str) -> Result<Vec<Result<(String, Vec<u8>)>>> {
        self.oplog.list_do_kv(prefix).await
    }

    /// Get the current snapshot from the snapshot storage
    pub async fn get_snapshot(&self) -> Result<Vec<u8>> {
        let (res, elap) = timeit!(self.snapshot_storage.get_snapshot().await?);
        trace!(
            num_bytes = res.len(),
            duration_ms = elap.as_millis(),
            "get_snapshot"
        );
        Ok(res)
    }

    /// Store a new snapshot in the snapshot storage
    pub async fn store_snapshot(&self, doc_state: &DocumentState) -> Result<()> {
        let snapshot = doc_state.export_snapshot(None)?;
        let num_bytes = snapshot.len();
        let (res, elap) = timeit!(self.snapshot_storage.store_snapshot(&snapshot).await?);
        trace!(
            num_bytes = num_bytes,
            duration_ms = elap.as_millis(),
            "store_snapshot"
        );
        self.oplog
            .store_version_vector(&doc_state.loro_doc.oplog_vv())
            .await?;
        Ok(res)
    }

    /// append a new pending operation to the operation log
    pub async fn append_pending_operation(
        &self,
        operation: &[u8],
        document_state: &DocumentState,
    ) -> Result<()> {
        self.oplog.apply_op(document_state, operation).await?;
        Ok(())
    }

    pub async fn clear_applied_ops(&self) -> Result<()> {
        self.oplog.clear_applied_ops().await?;
        Ok(())
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
