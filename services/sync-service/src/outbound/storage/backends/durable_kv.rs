use crate::error::ResultExt;
use std::rc::Rc;
use sync_server_core::domain::{
    connection::{ConnectionMetadata, SurfaceLifecycle},
    document::DocumentAttribution,
    migration::{SourceState, TargetState},
    ports::RoomStorage,
    socket::WebSocketId,
    types::{OperationId, PendingOperation, SessionKey},
};
use worker::{
    ListOptions, Result, Storage,
    js_sys::{self, Reflect},
    wasm_bindgen::JsCast,
};

const LAST_VERSION_VECTOR_KEY: &str = "LAST_VERSION_VECTOR";
const DOCUMENT_ID_KEY: &str = "DOCUMENT_ID";
const LIFECYCLE_KEY: &str = "SURFACE_LIFECYCLE";
const SOURCE_KEY: &str = "SURFACE_MIGRATION_SOURCE";
const TARGET_KEY: &str = "SURFACE_MIGRATION_TARGET";
const PENDING_OP_PREFIX: &str = "o/";
const ALL_OP_PREFIX: &str = "a/";
const ATTRIBUTION_PREFIX: &str = "actor/";

/// Typed access to the Durable Object's existing structured-clone storage.
#[derive(Clone)]
pub struct DurableKVStorage {
    inner: Rc<Storage>,
}

fn do_kv_result_to_result_opt<T>(res: Result<Option<T>>) -> Result<Option<T>> {
    res
}

impl DurableKVStorage {
    pub fn new(inner: Storage) -> Self {
        Self {
            inner: Rc::new(inner),
        }
    }
    pub(in crate::outbound::storage) async fn get_key(&self, key: &str) -> Result<Option<Vec<u8>>> {
        do_kv_result_to_result_opt(self.inner.get(key).await)
    }

    pub(in crate::outbound::storage) async fn list_do_kv(
        &self,
        prefix: &str,
    ) -> Result<Vec<Result<(String, Vec<u8>)>>> {
        Ok(self
            .inner
            .list_with_options(ListOptions::new().prefix(prefix))
            .await?
            .entries()
            .into_iter()
            .map(|res| {
                let entry = res.context("Error getting entry")?;
                let key: String = Reflect::get_u32(&entry, 0)
                    .context("failed to get key")?
                    .as_string()
                    .context("Key is not a string")?;

                let value = Reflect::get_u32(&entry, 1).context("failed to get value")?;

                let bytes = if value.is_instance_of::<js_sys::Uint8Array>() {
                    js_sys::Uint8Array::unchecked_from_js_ref(&value).to_vec()
                } else {
                    js_sys::Uint8Array::new(&value).to_vec()
                };

                Ok((key, bytes))
            })
            .collect())
    }

    /// get pending operations from the operation log
    pub(crate) async fn get_pending_operations(&self) -> Result<Vec<Result<(String, Vec<u8>)>>> {
        self.list_do_kv(PENDING_OP_PREFIX).await
    }
}

impl RoomStorage for DurableKVStorage {
    type Error = worker::Error;
    async fn session_key(&self) -> Result<Option<SessionKey>> {
        Ok(self
            .inner
            .get::<String>(DOCUMENT_ID_KEY)
            .await?
            .map(SessionKey::new))
    }
    async fn put_session_key(&self, key: &SessionKey) -> Result<()> {
        self.inner
            .put(DOCUMENT_ID_KEY, key.as_str().to_owned())
            .await
    }
    async fn connection(&self, id: &WebSocketId) -> Result<Option<ConnectionMetadata>> {
        self.inner.get(id.as_str()).await
    }
    async fn put_connection(&self, id: &WebSocketId, metadata: &ConnectionMetadata) -> Result<()> {
        self.inner.put(id.as_str(), metadata).await
    }
    async fn delete_connection(&self, id: &WebSocketId) -> Result<()> {
        self.inner.delete(id.as_str()).await.map(|_| ())
    }
    async fn surface_lifecycle(&self) -> Result<Option<SurfaceLifecycle>> {
        self.inner.get(LIFECYCLE_KEY).await
    }
    async fn put_surface_lifecycle(&self, lifecycle: SurfaceLifecycle) -> Result<()> {
        self.inner.put(LIFECYCLE_KEY, lifecycle).await
    }
    async fn source_migration(&self) -> Result<Option<SourceState>> {
        self.inner.get(SOURCE_KEY).await
    }
    async fn put_source_migration(&self, state: &SourceState) -> Result<()> {
        self.inner.put(SOURCE_KEY, state).await
    }
    async fn target_migration(&self) -> Result<Option<TargetState>> {
        self.inner.get(TARGET_KEY).await
    }
    async fn put_target_migration(&self, state: &TargetState) -> Result<()> {
        self.inner.put(TARGET_KEY, state).await
    }
    async fn saved_version_vector(&self) -> Result<Option<Vec<u8>>> {
        self.inner.get(LAST_VERSION_VECTOR_KEY).await
    }
    async fn put_saved_version_vector(&self, encoded: &[u8]) -> Result<()> {
        self.inner
            .put(LAST_VERSION_VECTOR_KEY, encoded.to_vec())
            .await
    }
    async fn pending_operations(&self) -> Result<Vec<Result<PendingOperation>>> {
        Ok(self
            .get_pending_operations()
            .await?
            .into_iter()
            .map(|entry| {
                entry.map(|(key, update)| PendingOperation {
                    id: OperationId::new(
                        key.strip_prefix(PENDING_OP_PREFIX)
                            .unwrap_or(&key)
                            .to_owned(),
                    ),
                    update,
                })
            })
            .collect())
    }
    async fn put_pending_operation(&self, id: &OperationId, update: &[u8]) -> Result<()> {
        self.inner
            .put(&format!("{PENDING_OP_PREFIX}{}", id.as_str()), update)
            .await
    }
    async fn put_archived_operation(&self, id: &OperationId, update: &[u8]) -> Result<()> {
        self.inner
            .put(&format!("{ALL_OP_PREFIX}{}", id.as_str()), update)
            .await
    }
    async fn put_operation_attribution(
        &self,
        id: &OperationId,
        attribution: &DocumentAttribution,
    ) -> Result<()> {
        let metadata = serde_json::to_vec(attribution)
            .context("failed to serialize signed document attribution")?;
        self.inner
            .put(&format!("{ATTRIBUTION_PREFIX}{}", id.as_str()), metadata)
            .await
    }
    async fn delete_pending_operations(&self, ids: &[OperationId]) -> Result<usize> {
        self.inner
            .delete_multiple(
                ids.iter()
                    .map(|id| format!("{PENDING_OP_PREFIX}{}", id.as_str()))
                    .collect::<Vec<_>>(),
            )
            .await
    }
    async fn delete_all(&self) -> Result<()> {
        self.inner.delete_all().await.map(|_| ())
    }
}
