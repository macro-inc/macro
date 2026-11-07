use crate::storage::backends::durable_kv::DurableKVStorage;
use backends::Storage;
use worker::{Env, Result, State};
pub mod backends;
pub mod op_log;
pub mod room_snapshot;
pub mod snapshot;
/// Temporary debug transport handle, removed with the callback shim.
pub struct SessionStorage {
    storage: DurableKVStorage,
}
impl SessionStorage {
    pub fn new(storage: DurableKVStorage) -> Self {
        Self { storage }
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
