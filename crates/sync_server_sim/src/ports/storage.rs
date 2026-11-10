//! Logical room storage over atomically persisted physical operation chunks.
use super::*;
use base64::{Engine, engine::general_purpose::STANDARD};
use sync_server_core::domain::{
    document::DocumentAttribution,
    migration::{SourceState, TargetState},
    operation_chunks::{
        CHUNK_BYTES, FORMAT_MARKER_KEY, FORMAT_MARKER_VALUE, INLINE_BYTES, INLINE_COMPLETE_TAG,
        Manifest, chunk_key,
    },
};

pub(crate) fn inline_receipt(value: &Value) -> Result<Option<Vec<u8>>, SimError> {
    let Some(values) = value.as_array() else {
        return Ok(None);
    };
    let tag = values.first().and_then(Value::as_f64);
    let namespace = f64::from(INLINE_COMPLETE_TAG & 0xffff_0000);
    if tag != Some(f64::from(INLINE_COMPLETE_TAG)) {
        if tag.is_some_and(|tag| tag >= namespace && tag < namespace + 65536.0) {
            return Err(SimError::Failure(
                "invalid inline operation receipt version".into(),
            ));
        }
        return Ok(None);
    }
    if values.len() != 2 {
        return Err(SimError::Failure("invalid inline operation receipt".into()));
    }
    let body = values[1]
        .as_object()
        .filter(|body| body.len() == 1)
        .and_then(|body| body.get("bytes_b64"))
        .and_then(Value::as_str)
        .ok_or_else(|| SimError::Failure("invalid inline operation byte buffer".into()))?;
    let bytes = STANDARD
        .decode(body)
        .map_err(|e| SimError::Failure(e.to_string()))?;
    if bytes.is_empty() || bytes.len() > INLINE_BYTES {
        return Err(SimError::Failure(
            "invalid inline operation receipt length".into(),
        ));
    }
    Ok(Some(bytes))
}

/// Physical mutations applied together as one simulator durability generation.
struct OperationPlan {
    remove: Vec<String>,
    writes: Vec<(String, Value)>,
}

impl SimPorts {
    fn inline_operation(&self, key: &str) -> Result<Option<Vec<u8>>, SimError> {
        let state = self.0.borrow();
        match state.data.values.get(key) {
            Some(value) => inline_receipt(value),
            None => Ok(None),
        }
    }
    fn read_operation(&self, key: &str) -> Result<Option<Vec<u8>>, SimError> {
        if let Some(bytes) = self.inline_operation(key)? {
            return Ok(Some(bytes));
        }
        let Some(bytes) = self.read::<Vec<u8>>(key)? else {
            return Ok(None);
        };
        let Some(header) =
            Manifest::decode(&bytes).map_err(|e| SimError::Failure(e.to_string()))?
        else {
            return Ok(Some(bytes));
        };
        let chunks = (0..header.count())
            .map(|index| {
                self.read::<Vec<u8>>(&chunk_key(key, index))?
                    .ok_or_else(|| SimError::Failure("missing operation chunk".into()))
            })
            .collect::<Result<Vec<_>, _>>()?;
        header
            .assemble(&chunks)
            .map(Some)
            .map_err(|e| SimError::Failure(e.to_string()))
    }
    /// Validate the actual physical records for a completed logical write.
    /// Empty sizes identify the deployed inline representation.
    pub fn operation_storage_proof(
        &self,
        key: &str,
        expected: &[u8],
    ) -> Result<(Vec<usize>, bool), SimError> {
        if let Some(bytes) = self.inline_operation(key)? {
            return Ok((Vec::new(), bytes == expected));
        }
        let bytes = self
            .read::<Vec<u8>>(key)?
            .ok_or_else(|| SimError::Failure("missing operation".into()))?;
        let mut sizes = Vec::new();
        if let Some(header) =
            Manifest::decode(&bytes).map_err(|e| SimError::Failure(e.to_string()))?
        {
            for index in 0..header.count() {
                let chunk = self
                    .read::<Vec<u8>>(&chunk_key(key, index))?
                    .ok_or_else(|| SimError::Failure("missing operation chunk".into()))?;
                sizes.push(chunk.len());
            }
        }
        Ok((
            sizes,
            self.read_operation(key)?.as_deref() == Some(expected),
        ))
    }
    fn operation_plan(
        &self,
        key: &str,
        update: &[u8],
        archive_complete: bool,
    ) -> Result<OperationPlan, SimError> {
        let previous = if self.inline_operation(key)?.is_some() {
            None
        } else {
            self.read::<Vec<u8>>(key)?
                .map(|bytes| Manifest::decode(&bytes))
                .transpose()
                .map_err(|e| SimError::Failure(e.to_string()))?
                .flatten()
        };
        let remove = previous
            .map(|header| {
                (0..header.count())
                    .map(|index| chunk_key(key, index))
                    .collect()
            })
            .unwrap_or_default();
        let mut writes = Vec::new();
        if let Some(header) = Manifest::for_update(update) {
            for (index, chunk) in update.chunks(CHUNK_BYTES).enumerate() {
                writes.push((chunk_key(key, index), json!(chunk)));
            }
            let header = if archive_complete {
                header.with_archive_complete()
            } else {
                header
            };
            writes.push((key.to_owned(), json!(header.encode())));
            writes.push((FORMAT_MARKER_KEY.to_owned(), json!(FORMAT_MARKER_VALUE)));
        } else {
            writes.push((
                key.to_owned(),
                if archive_complete {
                    json!([INLINE_COMPLETE_TAG,{"bytes_b64":STANDARD.encode(update)}])
                } else {
                    json!(update)
                },
            ));
        }
        Ok(OperationPlan { remove, writes })
    }
    fn put_operation(
        &self,
        key: &str,
        update: &[u8],
        archive: Option<OperationArchive>,
    ) -> Result<(), SimError> {
        let OperationPlan { remove, mut writes } = self.operation_plan(key, update, false)?;
        if let Some(archive) = archive {
            let id = OperationId::new(key[2..].to_owned());
            let bytes =
                serde_json::to_vec(&archive).map_err(|e| SimError::Failure(e.to_string()))?;
            writes.push((operation_archive_key(&id), json!(bytes)));
        }
        let mut state = self.0.borrow_mut();
        for key in remove {
            state.data.values.remove(&key);
        }
        for (key, value) in writes {
            state.data.values.insert(key, Rc::new(value));
        }
        state.write();
        let generation = state.generation;
        state
            .completed_puts
            .push((key.to_owned(), json!(update), generation));
        Ok(())
    }
}

impl RoomStorage for SimPorts {
    type Error = SimError;
    async fn session_key(&self) -> Result<Option<SessionKey>, SimError> {
        self.enter("storage.get", json!("DOCUMENT_ID")).await?;
        self.read("DOCUMENT_ID")
            .map(|value: Option<String>| value.map(SessionKey::new))
    }
    async fn surface_lifecycle(&self) -> Result<Option<SurfaceLifecycle>, SimError> {
        self.enter("storage.get", json!("SURFACE_LIFECYCLE"))
            .await?;
        self.read("SURFACE_LIFECYCLE")
    }
    async fn source_migration(&self) -> Result<Option<SourceState>, SimError> {
        self.enter("storage.get", json!("SURFACE_MIGRATION_SOURCE"))
            .await?;
        self.read("SURFACE_MIGRATION_SOURCE")
    }
    async fn target_migration(&self) -> Result<Option<TargetState>, SimError> {
        self.enter("storage.get", json!("SURFACE_MIGRATION_TARGET"))
            .await?;
        self.read("SURFACE_MIGRATION_TARGET")
    }
    async fn saved_version_vector(&self) -> Result<Option<Vec<u8>>, SimError> {
        self.enter("storage.get", json!("LAST_VERSION_VECTOR"))
            .await?;
        self.read("LAST_VERSION_VECTOR")
    }
    async fn put_session_key(&self, key: &SessionKey) -> Result<(), SimError> {
        self.enter(
            "storage.put",
            json!({"key":"DOCUMENT_ID","value":key.as_str()}),
        )
        .await?;
        self.put("DOCUMENT_ID", key.as_str())
    }
    async fn put_surface_lifecycle(&self, lifecycle: SurfaceLifecycle) -> Result<(), SimError> {
        self.enter(
            "storage.put",
            json!({"key":"SURFACE_LIFECYCLE","value":lifecycle}),
        )
        .await?;
        self.put("SURFACE_LIFECYCLE", lifecycle)
    }
    async fn put_source_migration(&self, state: &SourceState) -> Result<(), SimError> {
        self.enter(
            "storage.put",
            json!({"key":"SURFACE_MIGRATION_SOURCE","value":state}),
        )
        .await?;
        self.put("SURFACE_MIGRATION_SOURCE", state)
    }
    async fn put_target_migration(&self, state: &TargetState) -> Result<(), SimError> {
        self.enter(
            "storage.put",
            json!({"key":"SURFACE_MIGRATION_TARGET","value":state}),
        )
        .await?;
        self.put("SURFACE_MIGRATION_TARGET", state)
    }
    async fn put_saved_version_vector(&self, encoded: &[u8]) -> Result<(), SimError> {
        self.enter(
            "storage.put",
            json!({"key":"LAST_VERSION_VECTOR","value":encoded}),
        )
        .await?;
        self.put("LAST_VERSION_VECTOR", encoded)
    }
    async fn connection(&self, id: &WebSocketId) -> Result<Option<ConnectionMetadata>, SimError> {
        self.enter("storage.get", json!(id.as_str())).await?;
        self.read(id.as_str())
    }
    async fn put_connection(
        &self,
        id: &WebSocketId,
        metadata: &ConnectionMetadata,
    ) -> Result<(), SimError> {
        self.enter("storage.put", json!({"key":id.as_str(),"value":metadata}))
            .await?;
        self.put(id.as_str(), metadata)
    }
    async fn delete_connection(&self, id: &WebSocketId) -> Result<(), SimError> {
        self.enter("storage.delete", json!(id.as_str())).await?;
        let mut s = self.0.borrow_mut();
        s.data.values.remove(id.as_str());
        s.write();
        Ok(())
    }
    async fn pending_operations(
        &self,
    ) -> Result<Vec<Result<PendingOperation, SimError>>, SimError> {
        self.enter("storage.list", json!("o/")).await?;
        if let Some(marker) = self.read::<Vec<u8>>(FORMAT_MARKER_KEY)?
            && marker != FORMAT_MARKER_VALUE
        {
            return Err(SimError::Failure("invalid operation format marker".into()));
        }
        // Validate every receipt, including orphan sidecars, before exposing any
        // logical row. Match the unconditional Worker reader's fail-closed load.
        let status_keys: Vec<_> = self
            .0
            .borrow()
            .data
            .values
            .keys()
            .filter(|key| key.starts_with(OPERATION_ARCHIVE_PREFIX))
            .cloned()
            .collect();
        let mut statuses = BTreeMap::new();
        for key in status_keys {
            let bytes = self
                .read::<Vec<u8>>(&key)?
                .ok_or_else(|| SimError::Failure("missing operation archive status".into()))?;
            let status: OperationArchive =
                serde_json::from_slice(&bytes).map_err(|e| SimError::Failure(e.to_string()))?;
            if matches!(&status, OperationArchive::Legacy) {
                return Err(SimError::Failure(
                    "legacy archive status must be absent".into(),
                ));
            }
            statuses.insert(key[OPERATION_ARCHIVE_PREFIX.len()..].to_owned(), status);
        }
        let keys: Vec<_> = self
            .0
            .borrow()
            .data
            .values
            .keys()
            .filter(|key| {
                key.starts_with("o/")
                    && key.as_str() != FORMAT_MARKER_KEY
                    && !key.starts_with(OPERATION_ARCHIVE_PREFIX)
            })
            .cloned()
            .collect();
        let mut operations = Vec::new();
        for key in keys {
            if let Some(update) = self.inline_operation(&key)? {
                operations.push(Ok(PendingOperation {
                    id: OperationId::new(key[2..].to_owned()),
                    update,
                    archive: statuses
                        .remove(&key[2..])
                        .unwrap_or(OperationArchive::Complete),
                }));
                continue;
            }
            let bytes = match self.read::<Vec<u8>>(&key) {
                Ok(Some(bytes)) => bytes,
                Ok(None) => return Err(SimError::Failure("missing operation".into())),
                // H8 legacy unreadable entries remain individually skippable.
                Err(error) => {
                    operations.push(Err(error));
                    continue;
                }
            };
            let header = Manifest::decode(&bytes).map_err(|e| SimError::Failure(e.to_string()))?;
            let archive_complete = header.as_ref().is_some_and(Manifest::archive_complete);
            let update = match header {
                Some(_) => self
                    .read_operation(&key)?
                    .ok_or_else(|| SimError::Failure("missing operation".into()))?,
                None => bytes,
            };
            operations.push(Ok(PendingOperation {
                id: OperationId::new(key[2..].to_owned()),
                update,
                archive: statuses.remove(&key[2..]).unwrap_or(if archive_complete {
                    OperationArchive::Complete
                } else {
                    OperationArchive::Legacy
                }),
            }));
        }
        Ok(operations)
    }

    fn operation_archive_writes(&self) -> bool {
        self.0.borrow().operation_archive_writes
    }
    async fn complete_operation_archive(&self, id: &OperationId) -> Result<(), SimError> {
        if self.operation_archive_writes() {
            let key = operation_archive_key(id);
            let value = serde_json::to_vec(&OperationArchive::Complete)
                .map_err(|e| SimError::Failure(e.to_string()))?;
            self.enter("storage.put", json!({"key":key,"value":value}))
                .await?;
            self.put(&key, &value)?;
        }
        Ok(())
    }
    async fn put_complete_operation(
        &self,
        id: &OperationId,
        update: &[u8],
        attribution: Option<&DocumentAttribution>,
    ) -> Result<(), OperationAppendError<SimError>> {
        let pending = format!("o/{}", id.as_str());
        let archive = format!("a/{}", id.as_str());
        self.enter(
            "storage.operation.put",
            json!({"key":pending,"value":update,"attribution":attribution}),
        )
        .await
        .map_err(OperationAppendError::Pending)?;
        let OperationPlan {
            mut remove,
            mut writes,
        } = self
            .operation_plan(&pending, update, true)
            .map_err(OperationAppendError::Pending)?;
        let OperationPlan {
            remove: archive_remove,
            writes: archive_writes,
        } = self
            .operation_plan(&archive, update, false)
            .map_err(OperationAppendError::Archive)?;
        remove.extend(archive_remove);
        writes.extend(archive_writes);
        if let Some(attribution) = attribution {
            let bytes = serde_json::to_vec(attribution)
                .map_err(|e| OperationAppendError::Archive(SimError::Failure(e.to_string())))?;
            writes.push((format!("actor/{}", id.as_str()), json!(bytes)));
        }
        let mut state = self.0.borrow_mut();
        for key in remove {
            state.data.values.remove(&key);
        }
        for (key, value) in writes {
            state.data.values.insert(key, Rc::new(value));
        }
        state.write();
        let generation = state.generation;
        state
            .completed_puts
            .push((pending, json!(update), generation));
        state
            .completed_puts
            .push((archive, json!(update), generation));
        Ok(())
    }
    async fn put_pending_operation(
        &self,
        id: &OperationId,
        update: &[u8],
        attribution: Option<&DocumentAttribution>,
    ) -> Result<(), SimError> {
        let key = format!("o/{}", id.as_str());
        let archive = self
            .operation_archive_writes()
            .then(|| OperationArchive::Incomplete {
                attribution: attribution.cloned(),
            });
        if let Some(status) = &archive {
            let bytes = serde_json::to_vec(status).map_err(|e| SimError::Failure(e.to_string()))?;
            self.enter(
                "storage.pending.put",
                json!({"key":key,"value":update,"archive":bytes}),
            )
            .await?;
        } else {
            self.enter("storage.put", json!({"key":key,"value":update}))
                .await?;
        }
        self.put_operation(&key, update, archive)
    }
    async fn put_archived_operation(
        &self,
        id: &OperationId,
        update: &[u8],
    ) -> Result<(), SimError> {
        let key = format!("a/{}", id.as_str());
        self.enter("storage.put", json!({"key":key,"value":update}))
            .await?;
        self.put_operation(&key, update, None)
    }
    async fn put_operation_attribution(
        &self,
        id: &OperationId,
        attribution: &DocumentAttribution,
    ) -> Result<(), SimError> {
        let key = format!("actor/{}", id.as_str());
        self.enter("storage.put", json!({"key":key,"value":attribution}))
            .await?;
        self.put(&key, attribution)
    }
    async fn delete_pending_operations(&self, ids: &[OperationId]) -> Result<usize, SimError> {
        let keys: Vec<_> = ids.iter().map(|id| format!("o/{}", id.as_str())).collect();
        let has_status = ids.iter().any(|id| {
            self.0
                .borrow()
                .data
                .values
                .contains_key(&operation_archive_key(id))
        });
        let operation = if has_status {
            "storage.pending.delete_multiple"
        } else {
            "storage.delete_multiple"
        };
        self.enter(operation, json!(keys)).await?;
        let mut chunk_keys = Vec::new();
        for key in &keys {
            if self.inline_operation(key)?.is_some() {
                continue;
            }
            if let Some(bytes) = self.read::<Vec<u8>>(key)?
                && let Some(header) =
                    Manifest::decode(&bytes).map_err(|e| SimError::Failure(e.to_string()))?
            {
                chunk_keys.extend((0..header.count()).map(|index| chunk_key(key, index)));
            }
        }
        let mut s = self.0.borrow_mut();
        let count = keys
            .iter()
            .filter(|key| s.data.values.remove(*key).is_some())
            .count();
        for id in ids {
            s.data.values.remove(&operation_archive_key(id));
        }
        for key in chunk_keys {
            s.data.values.remove(&key);
        }
        s.write();
        Ok(count)
    }

    async fn delete_all(&self) -> Result<(), SimError> {
        self.enter("storage.delete_all", Value::Null).await?;
        let mut s = self.0.borrow_mut();
        s.data.values.clear();
        s.data.snapshots.clear();
        s.write();
        Ok(())
    }
}
