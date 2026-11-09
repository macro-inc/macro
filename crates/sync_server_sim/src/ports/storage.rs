//! Logical room storage over atomically persisted physical operation chunks.
use super::*;
use sync_server_core::domain::{
    document::DocumentAttribution,
    migration::{SourceState, TargetState},
    operation_chunks::{CHUNK_BYTES, FORMAT_MARKER_KEY, FORMAT_MARKER_VALUE, Manifest, chunk_key},
};

impl SimPorts {
    fn read_operation(&self, key: &str) -> Result<Option<Vec<u8>>, SimError> {
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
    fn put_operation(&self, key: &str, update: &[u8]) -> Result<(), SimError> {
        let previous = self
            .read::<Vec<u8>>(key)?
            .map(|bytes| Manifest::decode(&bytes))
            .transpose()
            .map_err(|e| SimError::Failure(e.to_string()))?
            .flatten();
        let mut writes = Vec::new();
        if let Some(header) = Manifest::for_update(update) {
            for (index, chunk) in update.chunks(CHUNK_BYTES).enumerate() {
                writes.push((chunk_key(key, index), json!(chunk)));
            }
            writes.push((key.to_owned(), json!(header.encode())));
            writes.push((FORMAT_MARKER_KEY.to_owned(), json!(FORMAT_MARKER_VALUE)));
        } else {
            writes.push((key.to_owned(), json!(update)));
        }
        let mut state = self.0.borrow_mut();
        if let Some(previous) = previous {
            for index in 0..previous.count() {
                state.data.values.remove(&chunk_key(key, index));
            }
        }
        for (key, value) in writes {
            state.data.values.insert(key, Rc::new(value));
        }
        state.write();
        let generation = state.generation;
        // Output-gate facts describe logical successful writes, not physical rows.
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
        let keys: Vec<_> = self
            .0
            .borrow()
            .data
            .values
            .keys()
            .filter(|key| key.starts_with("o/") && key.as_str() != FORMAT_MARKER_KEY)
            .cloned()
            .collect();
        let mut operations = Vec::new();
        for key in keys {
            let bytes = match self.read::<Vec<u8>>(&key) {
                Ok(Some(bytes)) => bytes,
                Ok(None) => return Err(SimError::Failure("missing operation".into())),
                // H8 legacy unreadable entries remain individually skippable.
                Err(error) => {
                    operations.push(Err(error));
                    continue;
                }
            };
            let update =
                match Manifest::decode(&bytes).map_err(|e| SimError::Failure(e.to_string()))? {
                    Some(_) => self
                        .read_operation(&key)?
                        .ok_or_else(|| SimError::Failure("missing operation".into()))?,
                    None => bytes,
                };
            operations.push(Ok(PendingOperation {
                id: OperationId::new(key[2..].to_owned()),
                update,
            }));
        }
        Ok(operations)
    }

    async fn put_pending_operation(&self, id: &OperationId, update: &[u8]) -> Result<(), SimError> {
        let key = format!("o/{}", id.as_str());
        self.enter("storage.put", json!({"key":key,"value":update}))
            .await?;
        self.put_operation(&key, update)
    }
    async fn put_archived_operation(
        &self,
        id: &OperationId,
        update: &[u8],
    ) -> Result<(), SimError> {
        let key = format!("a/{}", id.as_str());
        self.enter("storage.put", json!({"key":key,"value":update}))
            .await?;
        self.put_operation(&key, update)
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
        self.enter("storage.delete_multiple", json!(keys)).await?;
        let mut chunk_keys = Vec::new();
        for key in &keys {
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
