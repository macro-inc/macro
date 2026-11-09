use crate::error::ResultExt;
use serde::{Serialize, Serializer};
use std::{cell::Cell, rc::Rc};
use sync_server_core::domain::{
    connection::{ConnectionMetadata, SurfaceLifecycle},
    document::DocumentAttribution,
    migration::{SourceState, TargetState},
    operation_chunks::{CHUNK_BYTES, FORMAT_MARKER_KEY, FORMAT_MARKER_VALUE, Manifest, chunk_key},
    ports::RoomStorage,
    socket::WebSocketId,
    types::{OperationId, PendingOperation, SessionKey},
};
use worker::{
    ListOptions, Result, Storage,
    js_sys::{self, Reflect},
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
    operation_writes: OperationWrites,
    // Durable activation is rediscovered by the existing pending-prefix read,
    // including after every pending row was compacted and an archive ID repeats.
    chunked: Rc<Cell<bool>>,
}

/// Reader support is unconditional; activation is a separate, default-off build.
#[derive(Clone, Copy)]
enum OperationWrites {
    Legacy,
    Chunked,
}
impl OperationWrites {
    fn configured() -> Self {
        if cfg!(feature = "chunked-operation-writes") {
            Self::Chunked
        } else {
            Self::Legacy
        }
    }
}

// Vec<u8> serializes as a JS number array. Physical chunks must instead use
// byte buffers so structured-clone overhead cannot exceed the SQLite row limit.
struct ChunkBytes<'a>(&'a [u8]);
impl Serialize for ChunkBytes<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        serializer.serialize_bytes(self.0)
    }
}
fn manifest(bytes: &[u8]) -> Result<Option<Manifest>> {
    Manifest::decode(bytes).map_err(|error| worker::Error::RustError(error.to_string()))
}

impl DurableKVStorage {
    pub fn new(inner: Storage) -> Self {
        Self {
            inner: Rc::new(inner),
            operation_writes: OperationWrites::configured(),
            chunked: Rc::default(),
        }
    }
    pub(crate) async fn get_key(&self, key: &str) -> Result<Option<Vec<u8>>> {
        match self.inner.get::<Vec<u8>>(key).await? {
            Some(bytes) => self.resolve_operation(key, bytes).await.map(Some),
            None => Ok(None),
        }
    }

    pub(crate) async fn list_do_kv(&self, prefix: &str) -> Result<Vec<Result<(String, Vec<u8>)>>> {
        let entries = self
            .inner
            .list_with_options(ListOptions::new().prefix(prefix))
            .await?;
        let mut result = Vec::new();
        for entry in entries.entries().into_iter() {
            let parsed = entry.context("Error getting entry").and_then(|entry| {
                let key = Reflect::get_u32(&entry, 0)
                    .context("failed to get key")?
                    .as_string()
                    .context("Key is not a string")?;
                let value = Reflect::get_u32(&entry, 1).context("failed to get value")?;
                Ok((key, js_sys::Uint8Array::new(&value).to_vec()))
            });
            let (key, bytes) = match parsed {
                Ok(entry) => entry,
                Err(error) => {
                    result.push(Err(error));
                    continue;
                }
            };
            // A corrupt/incomplete committed manifest is a storage failure for
            // the whole load, not an ignorable row yielding a partial document.
            let bytes = self.resolve_operation(&key, bytes).await?;
            result.push(Ok((key, bytes)));
        }
        Ok(result)
    }

    async fn resolve_operation(&self, key: &str, bytes: Vec<u8>) -> Result<Vec<u8>> {
        if key == FORMAT_MARKER_KEY {
            if bytes != FORMAT_MARKER_VALUE {
                return Err(worker::Error::RustError(
                    "invalid operation format marker".into(),
                ));
            }
            self.chunked.set(true);
            return Ok(bytes);
        }
        if !(key.starts_with(PENDING_OP_PREFIX) || key.starts_with(ALL_OP_PREFIX)) {
            return Ok(bytes);
        }
        let Some(header) = manifest(&bytes)? else {
            return Ok(bytes);
        };
        let mut chunks = Vec::new();
        let keys: Vec<_> = (0..header.count())
            .map(|index| chunk_key(key, index))
            .collect();
        // Read byte buffers through the JS bulk API. Deserializing Vec<u8> from
        // Uint8Array crosses the WASM boundary per element and stalls cold loads.
        for batch in keys.chunks(128) {
            let values = self.inner.get_multiple(batch.to_vec()).await?;
            for key in batch {
                let value = values.get(&key.into());
                if value.is_undefined() {
                    return Err(worker::Error::RustError("missing operation chunk".into()));
                }
                chunks.push(js_sys::Uint8Array::new(&value).to_vec());
            }
        }
        let bytes = header
            .assemble(&chunks)
            .map_err(|error| worker::Error::RustError(error.to_string()))?;
        self.chunked.set(true);
        Ok(bytes)
    }

    async fn put_operation(&self, key: String, update: &[u8]) -> Result<()> {
        let chunked = matches!(self.operation_writes, OperationWrites::Chunked);
        let header = if chunked {
            Manifest::for_update(update)
        } else {
            None
        };
        if header.is_none() && !self.chunked.get() {
            return self.inner.put(&key, update).await;
        }
        let activated = header.is_some();
        let update = update.to_vec();
        self.inner
            .transaction(move |transaction| async move {
                let existing = transaction
                    .get_multiple(vec![key.clone()])
                    .await?
                    .get(&key.clone().into());
                if !existing.is_undefined() {
                    let bytes = js_sys::Uint8Array::new(&existing).to_vec();
                    if let Some(previous) = manifest(&bytes)? {
                        for index in 0..previous.count() {
                            transaction.delete(&chunk_key(&key, index)).await?;
                        }
                    }
                }
                if let Some(header) = header {
                    for (index, chunk) in update.chunks(CHUNK_BYTES).enumerate() {
                        transaction
                            .put(&chunk_key(&key, index), ChunkBytes(chunk))
                            .await?;
                    }
                    transaction.put(&key, ChunkBytes(&header.encode())).await?;
                    transaction
                        .put(FORMAT_MARKER_KEY, ChunkBytes(FORMAT_MARKER_VALUE))
                        .await?;
                } else {
                    // Preserve the deployed small-row structured-clone representation.
                    transaction.put(&key, update).await?;
                }
                Ok(())
            })
            .await?;
        if activated {
            self.chunked.set(true);
        }
        Ok(())
    }

    /// get pending operations from the operation log
    pub(crate) async fn get_pending_operations(&self) -> Result<Vec<Result<(String, Vec<u8>)>>> {
        Ok(self
            .list_do_kv(PENDING_OP_PREFIX)
            .await?
            .into_iter()
            .filter(|entry| !matches!(entry, Ok((key, _)) if key == FORMAT_MARKER_KEY))
            .collect())
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
        self.put_operation(format!("{PENDING_OP_PREFIX}{}", id.as_str()), update)
            .await
    }
    async fn put_archived_operation(&self, id: &OperationId, update: &[u8]) -> Result<()> {
        self.put_operation(format!("{ALL_OP_PREFIX}{}", id.as_str()), update)
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
        let keys: Vec<_> = ids
            .iter()
            .map(|id| format!("{PENDING_OP_PREFIX}{}", id.as_str()))
            .collect();
        if !self.chunked.get() {
            return self.inner.delete_multiple(keys).await;
        }
        let deleted = Rc::new(Cell::new(0));
        let count = deleted.clone();
        self.inner
            .transaction(move |transaction| async move {
                let mut deleted = 0;
                for key in keys {
                    let existing = transaction
                        .get_multiple(vec![key.clone()])
                        .await?
                        .get(&key.clone().into());
                    if existing.is_undefined() {
                        continue;
                    }
                    let bytes = js_sys::Uint8Array::new(&existing).to_vec();
                    if let Some(header) = manifest(&bytes)? {
                        for index in 0..header.count() {
                            transaction.delete(&chunk_key(&key, index)).await?;
                        }
                    }
                    transaction.delete(&key).await?;
                    deleted += 1;
                }
                count.set(deleted);
                Ok(())
            })
            .await?;
        Ok(deleted.get())
    }

    async fn delete_all(&self) -> Result<()> {
        self.inner.delete_all().await?;
        self.chunked.set(false);
        Ok(())
    }
}
