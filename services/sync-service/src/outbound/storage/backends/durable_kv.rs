use crate::error::ResultExt;
use serde::{Deserialize, Serialize, Serializer};
use std::{cell::Cell, rc::Rc};
use sync_server_core::domain::{
    connection::{ConnectionMetadata, SurfaceLifecycle},
    document::DocumentAttribution,
    migration::{SourceState, TargetState},
    operation_chunks::{
        CHUNK_BYTES, ChunkBytes, CompleteInline, FORMAT_MARKER_KEY, FORMAT_MARKER_VALUE,
        INLINE_BYTES, INLINE_COMPLETE_TAG, Manifest, chunk_key,
    },
    ports::{OperationAppendError, RoomStorage},
    socket::WebSocketId,
    types::{
        OPERATION_ARCHIVE_PREFIX, OperationArchive, OperationId, PendingOperation, SessionKey,
        operation_archive_key,
    },
};
use wasm_bindgen::{JsCast, JsValue};
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
    archive_statuses: Rc<Cell<bool>>,
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

#[derive(Deserialize)]
#[serde(transparent)]
struct RawStorageValue(#[serde(with = "serde_wasm_bindgen::preserve")] JsValue);

fn inline_receipt(value: &JsValue) -> Result<Option<Vec<u8>>> {
    if !js_sys::Array::is_array(value) {
        return Ok(None);
    }
    let tag = Reflect::get_u32(value, 0)?.as_f64();
    let namespace = f64::from(INLINE_COMPLETE_TAG & 0xffff_0000);
    if tag != Some(f64::from(INLINE_COMPLETE_TAG)) {
        if tag.is_some_and(|tag| tag >= namespace && tag < namespace + 65536.0) {
            return Err(worker::Error::RustError(
                "invalid inline operation receipt version".into(),
            ));
        }
        return Ok(None);
    }
    let data = Reflect::get_u32(value, 1)?;
    if Reflect::get(value, &"length".into())?.as_f64() != Some(2.0)
        || !data.is_instance_of::<js_sys::Uint8Array>()
    {
        return Err(worker::Error::RustError(
            "invalid inline operation receipt".into(),
        ));
    }
    let bytes = js_sys::Uint8Array::new(&data).to_vec();
    if bytes.is_empty() || bytes.len() > INLINE_BYTES {
        return Err(worker::Error::RustError(
            "invalid inline operation receipt length".into(),
        ));
    }
    Ok(Some(bytes))
}

// Preserve a native object so put_multiple uses the single-argument storage API,
// not a serde Map whose entries are not enumerable record properties.
struct InlineOperationValues(js_sys::Object);
impl Serialize for InlineOperationValues {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        serde_wasm_bindgen::preserve::serialize(&self.0, serializer)
    }
}

fn manifest(bytes: &[u8]) -> Result<Option<Manifest>> {
    Manifest::decode(bytes).map_err(|error| worker::Error::RustError(error.to_string()))
}

async fn put_transaction_operation(
    transaction: &worker::Transaction,
    key: &str,
    update: &[u8],
    header: Option<&Manifest>,
    cleanup_chunks: bool,
    archive_complete: bool,
) -> Result<()> {
    if cleanup_chunks {
        let existing = transaction.get_multiple(vec![key]).await?.get(&key.into());
        if !existing.is_undefined() {
            let bytes = js_sys::Uint8Array::new(&existing).to_vec();
            if let Some(previous) = manifest(&bytes)? {
                for index in 0..previous.count() {
                    transaction.delete(&chunk_key(key, index)).await?;
                }
            }
        }
    }
    if let Some(header) = header {
        for (index, chunk) in update.chunks(CHUNK_BYTES).enumerate() {
            transaction
                .put(&chunk_key(key, index), ChunkBytes(chunk))
                .await?;
        }
        let header = if archive_complete {
            header.clone().with_archive_complete()
        } else {
            header.clone()
        };
        transaction.put(key, ChunkBytes(&header.encode())).await?;
    } else if archive_complete {
        transaction.put(key, CompleteInline(update)).await?;
    } else {
        transaction.put(key, update).await?;
    }
    Ok(())
}

struct OperationBytes {
    bytes: Vec<u8>,
    archive_complete: bool,
}
struct OperationEntry {
    key: String,
    update: Vec<u8>,
    archive_complete: bool,
}

impl DurableKVStorage {
    pub fn new(inner: Storage) -> Self {
        Self {
            inner: Rc::new(inner),
            operation_writes: OperationWrites::configured(),
            chunked: Rc::default(),
            archive_statuses: Rc::default(),
        }
    }
    pub(crate) async fn get_key(&self, key: &str) -> Result<Option<Vec<u8>>> {
        match self.inner.get::<RawStorageValue>(key).await? {
            Some(value) => {
                let inline = inline_receipt(&value.0)?;
                let complete = inline.is_some();
                let bytes = match inline {
                    Some(bytes) => bytes,
                    None => serde_wasm_bindgen::from_value(value.0)
                        .map_err(|error| worker::Error::RustError(error.to_string()))?,
                };
                self.resolve_operation(key, bytes, complete)
                    .await
                    .map(|entry| Some(entry.bytes))
            }
            None => Ok(None),
        }
    }

    pub(crate) async fn list_do_kv(&self, prefix: &str) -> Result<Vec<Result<(String, Vec<u8>)>>> {
        Ok(self
            .operation_entries(prefix)
            .await?
            .into_iter()
            .map(|entry| entry.map(|entry| (entry.key, entry.update)))
            .collect())
    }

    async fn operation_entries(&self, prefix: &str) -> Result<Vec<Result<OperationEntry>>> {
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
                Ok((key, value))
            });
            let (key, value) = match parsed {
                Ok(entry) => entry,
                Err(error) => {
                    result.push(Err(error));
                    continue;
                }
            };
            let inline = inline_receipt(&value)?;
            let complete = inline.is_some();
            let bytes = inline.unwrap_or_else(|| js_sys::Uint8Array::new(&value).to_vec());
            // A corrupt/incomplete committed manifest is a storage failure for
            // the whole load, not an ignorable row yielding a partial document.
            let decoded = self.resolve_operation(&key, bytes, complete).await?;
            result.push(Ok(OperationEntry {
                key,
                update: decoded.bytes,
                archive_complete: decoded.archive_complete,
            }));
        }
        Ok(result)
    }

    async fn resolve_operation(
        &self,
        key: &str,
        bytes: Vec<u8>,
        inline_complete: bool,
    ) -> Result<OperationBytes> {
        if key.starts_with(OPERATION_ARCHIVE_PREFIX) {
            let status: OperationArchive =
                serde_json::from_slice(&bytes).context("invalid operation archive status")?;
            if matches!(status, OperationArchive::Legacy) {
                return Err(worker::Error::RustError(
                    "legacy archive status must be absent".into(),
                ));
            }
            self.archive_statuses.set(true);
            return Ok(OperationBytes {
                bytes,
                archive_complete: false,
            });
        }
        if key == FORMAT_MARKER_KEY {
            if bytes != FORMAT_MARKER_VALUE {
                return Err(worker::Error::RustError(
                    "invalid operation format marker".into(),
                ));
            }
            self.chunked.set(true);
            return Ok(OperationBytes {
                bytes,
                archive_complete: false,
            });
        }
        if !(key.starts_with(PENDING_OP_PREFIX) || key.starts_with(ALL_OP_PREFIX)) {
            return Ok(OperationBytes {
                bytes,
                archive_complete: false,
            });
        }
        if inline_complete {
            return Ok(OperationBytes {
                bytes,
                archive_complete: true,
            });
        }
        let Some(header) = manifest(&bytes)? else {
            return Ok(OperationBytes {
                bytes,
                archive_complete: false,
            });
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
        Ok(OperationBytes {
            bytes,
            archive_complete: header.archive_complete(),
        })
    }

    async fn put_operation(
        &self,
        key: String,
        update: &[u8],
        archive: Option<OperationArchive>,
    ) -> Result<()> {
        let chunked = matches!(self.operation_writes, OperationWrites::Chunked);
        let header = if chunked {
            Manifest::for_update(update)
        } else {
            None
        };
        if header.is_none() && archive.is_none() && !self.chunked.get() {
            return self.inner.put(&key, update).await;
        }
        let activated = header.is_some();
        let status_written = archive.is_some();
        let cleanup_chunks = self.chunked.get();
        let archive_status = archive
            .map(|status| serde_json::to_vec(&status))
            .transpose()
            .context("failed to encode operation archive status")?;
        let update = update.to_vec();
        self.inner
            .transaction(move |transaction| async move {
                if let Some(status) = archive_status {
                    let id = OperationId::new(
                        key.strip_prefix(PENDING_OP_PREFIX)
                            .context("archive status requires pending operation")?
                            .to_owned(),
                    );
                    transaction.put(&operation_archive_key(&id), status).await?;
                }
                put_transaction_operation(
                    &transaction,
                    &key,
                    &update,
                    header.as_ref(),
                    cleanup_chunks,
                    false,
                )
                .await?;
                if header.is_some() {
                    transaction
                        .put(FORMAT_MARKER_KEY, ChunkBytes(FORMAT_MARKER_VALUE))
                        .await?;
                }
                Ok(())
            })
            .await?;
        if activated {
            self.chunked.set(true);
        }
        if status_written {
            self.archive_statuses.set(true);
        }
        Ok(())
    }

    /// get pending operations from the operation log
    pub(crate) async fn get_pending_operations(&self) -> Result<Vec<Result<(String, Vec<u8>)>>> {
        Ok(self
            .list_do_kv(PENDING_OP_PREFIX)
            .await?
            .into_iter()
            .filter(|entry| !matches!(entry, Ok((key, _)) if key == FORMAT_MARKER_KEY || key.starts_with(OPERATION_ARCHIVE_PREFIX)))
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
        // Completion facts are scoped to this one authoritative prefix read;
        // retaining an ID cache would outlive pending GC and grow indefinitely.
        let entries = self.operation_entries(PENDING_OP_PREFIX).await?;
        let mut statuses = std::collections::BTreeMap::new();
        for entry in entries.iter().filter_map(|entry| entry.as_ref().ok()) {
            if let Some(id) = entry.key.strip_prefix(OPERATION_ARCHIVE_PREFIX) {
                let status = serde_json::from_slice::<OperationArchive>(&entry.update)
                    .context("invalid operation archive status")?;
                statuses.insert(id.to_owned(), status);
            }
        }
        Ok(entries.into_iter()
            .filter(|entry| !matches!(entry,Ok(entry) if entry.key==FORMAT_MARKER_KEY || entry.key.starts_with(OPERATION_ARCHIVE_PREFIX)))
            .map(|entry| entry.map(|entry| {
                let id=entry.key.strip_prefix(PENDING_OP_PREFIX).unwrap_or(&entry.key);
                PendingOperation { id:OperationId::new(id.to_owned()),update:entry.update,
                    archive:statuses.remove(id).unwrap_or(if entry.archive_complete {OperationArchive::Complete} else {OperationArchive::Legacy}),
                }
            })).collect())
    }
    fn operation_archive_writes(&self) -> bool {
        matches!(self.operation_writes, OperationWrites::Chunked)
    }
    async fn put_complete_operation(
        &self,
        id: &OperationId,
        update: &[u8],
        attribution: Option<&DocumentAttribution>,
    ) -> std::result::Result<(), OperationAppendError<worker::Error>> {
        let pending = format!("{PENDING_OP_PREFIX}{}", id.as_str());
        let archive = format!("{ALL_OP_PREFIX}{}", id.as_str());
        let attribution_key = format!("{ATTRIBUTION_PREFIX}{}", id.as_str());
        let attribution = attribution
            .map(serde_json::to_vec)
            .transpose()
            .context("failed to serialize signed document attribution")
            .map_err(OperationAppendError::Pending)?;
        let header = Manifest::for_update(update);
        let activated = header.is_some();
        let cleanup_chunks = self.chunked.get();
        if header.is_none() && !cleanup_chunks {
            let values = js_sys::Object::new();
            let update_value = serde_wasm_bindgen::to_value(&update).map_err(|e| {
                OperationAppendError::Pending(worker::Error::RustError(e.to_string()))
            })?;
            let pending_value =
                serde_wasm_bindgen::to_value(&CompleteInline(update)).map_err(|e| {
                    OperationAppendError::Pending(worker::Error::RustError(e.to_string()))
                })?;
            Reflect::set(&values, &pending.into(), &pending_value)
                .map_err(|e| OperationAppendError::Pending(worker::Error::from(e)))?;
            Reflect::set(&values, &archive.into(), &update_value)
                .map_err(|e| OperationAppendError::Pending(worker::Error::from(e)))?;
            if let Some(attribution) = attribution {
                let value = serde_wasm_bindgen::to_value(&attribution).map_err(|e| {
                    OperationAppendError::Pending(worker::Error::RustError(e.to_string()))
                })?;
                Reflect::set(&values, &attribution_key.into(), &value)
                    .map_err(|e| OperationAppendError::Pending(worker::Error::from(e)))?;
            }
            self.inner
                .put_multiple(InlineOperationValues(values))
                .await
                .map_err(OperationAppendError::Archive)?;
            return Ok(());
        }
        let update = update.to_vec();
        let pending_staged = Rc::new(Cell::new(false));
        let phase = pending_staged.clone();
        let result = self
            .inner
            .transaction(move |transaction| async move {
                put_transaction_operation(
                    &transaction,
                    &pending,
                    &update,
                    header.as_ref(),
                    cleanup_chunks,
                    true,
                )
                .await?;
                phase.set(true);
                put_transaction_operation(
                    &transaction,
                    &archive,
                    &update,
                    header.as_ref(),
                    cleanup_chunks,
                    false,
                )
                .await?;
                if let Some(attribution) = attribution {
                    transaction.put(&attribution_key, attribution).await?;
                }
                if header.is_some() {
                    transaction
                        .put(FORMAT_MARKER_KEY, ChunkBytes(FORMAT_MARKER_VALUE))
                        .await?;
                }
                Ok(())
            })
            .await;
        result.map_err(|error| {
            if pending_staged.get() {
                OperationAppendError::Archive(error)
            } else {
                OperationAppendError::Pending(error)
            }
        })?;
        if activated {
            self.chunked.set(true);
        }
        Ok(())
    }
    async fn put_pending_operation(
        &self,
        id: &OperationId,
        update: &[u8],
        attribution: Option<&DocumentAttribution>,
    ) -> Result<()> {
        let archive = self
            .operation_archive_writes()
            .then(|| OperationArchive::Incomplete {
                attribution: attribution.cloned(),
            });
        self.put_operation(
            format!("{PENDING_OP_PREFIX}{}", id.as_str()),
            update,
            archive,
        )
        .await
    }
    async fn complete_operation_archive(&self, id: &OperationId) -> Result<()> {
        if self.operation_archive_writes() {
            let status = serde_json::to_vec(&OperationArchive::Complete)
                .context("failed to encode operation archive status")?;
            self.inner.put(&operation_archive_key(id), status).await?;
            self.archive_statuses.set(true);
        }
        Ok(())
    }
    async fn put_archived_operation(&self, id: &OperationId, update: &[u8]) -> Result<()> {
        self.put_operation(format!("{ALL_OP_PREFIX}{}", id.as_str()), update, None)
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
        if !self.chunked.get() && !self.archive_statuses.get() {
            return self.inner.delete_multiple(keys).await;
        }
        let cleanup_chunks = self.chunked.get();
        let status_keys: Vec<_> = ids.iter().map(operation_archive_key).collect();
        let deleted = Rc::new(Cell::new(0));
        let count = deleted.clone();
        self.inner
            .transaction(move |transaction| async move {
                if !cleanup_chunks {
                    count.set(transaction.delete_multiple(keys).await?);
                    transaction.delete_multiple(status_keys).await?;
                    return Ok(());
                }
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
                    let id = OperationId::new(key[PENDING_OP_PREFIX.len()..].to_owned());
                    transaction.delete(&operation_archive_key(&id)).await?;
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
        self.archive_statuses.set(false);
        Ok(())
    }
}
