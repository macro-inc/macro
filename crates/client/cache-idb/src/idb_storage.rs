use cache_core::codec::{
    CodecError, cache_database_name, cache_namespace, decode_optimistic_layer, decode_record,
    decode_stored_mutation, encode_optimistic_layer, encode_record, encode_stored_mutation,
};
use cache_core::entity_index::{
    EntityBucket, EntityIndexEntry, EntityIndexQuery, ParseEntityBucketError, record_index_metadata,
};
use cache_core::queue::{
    ClaimedMutation, MutationClaimRequest, MutationClaimToken, MutationId, NewQueuedMutation,
    QueuedMutation,
};
use cache_core::store::Storage;
use cache_core::value::{EntityKey, Record};
use idb::{
    CursorDirection, Database, DatabaseEvent, Factory, Index, IndexParams, KeyPath, KeyRange,
    ObjectStoreParams, Query, TransactionMode,
};
use thiserror::Error;
use wasm_bindgen::{JsCast, JsValue};

const META_STORE: &str = "meta";
const RECORDS_STORE: &str = "records";
const MUTATION_QUEUE_STORE: &str = "mutation_queue";
const OPTIMISTIC_LAYERS_STORE: &str = "optimistic_layers";
const RECORDS_BY_SORT_INDEX: &str = "records_by_sort";
const RECORDS_BY_BUCKET_SORT_INDEX: &str = "records_by_bucket_sort";
const DB_VERSION: u32 = 2;
const SCOPE_META_KEY: &str = "scope";
const NAMESPACE_META_KEY: &str = "namespace";

#[derive(Debug, Error)]
pub enum IdbStorageError {
    #[error("indexeddb: {0}")]
    Idb(#[from] idb::Error),
    #[error(transparent)]
    Codec(#[from] CodecError),
    #[error("stored value is not a Uint8Array")]
    NotBytes,
    #[error("stored record envelope is invalid")]
    InvalidRecordEnvelope,
    #[error("stored metadata is not a string")]
    NotString,
    #[error("mutation queue key is not a safe positive integer")]
    InvalidMutationId,
    #[error("mutation queue and optimistic layer stores are inconsistent")]
    InconsistentQueue,
    #[error(transparent)]
    InvalidEntityBucket(#[from] ParseEntityBucketError),
}

pub struct IdbStorage {
    db: Database,
}

fn bytes_to_js(bytes: &[u8]) -> JsValue {
    js_sys::Uint8Array::from(bytes).into()
}

fn bytes_from_js(value: JsValue) -> Result<Vec<u8>, IdbStorageError> {
    let bytes: js_sys::Uint8Array = value.dyn_into().map_err(|_| IdbStorageError::NotBytes)?;
    Ok(bytes.to_vec())
}

fn set_envelope_property(
    envelope: &js_sys::Object,
    name: &str,
    value: &JsValue,
) -> Result<(), IdbStorageError> {
    js_sys::Reflect::set(envelope, &JsValue::from_str(name), value)
        .map_err(|_| IdbStorageError::InvalidRecordEnvelope)?;
    Ok(())
}

fn record_envelope_to_js(key: &EntityKey, record: &Record) -> Result<JsValue, IdbStorageError> {
    let envelope = js_sys::Object::new();
    set_envelope_property(&envelope, "entityKey", &JsValue::from_str(&key.0))?;
    set_envelope_property(&envelope, "value", &bytes_to_js(&encode_record(record)))?;

    if let Some(metadata) = record_index_metadata(key, record) {
        set_envelope_property(
            &envelope,
            "bucket",
            &JsValue::from_str(metadata.bucket.as_str()),
        )?;
        set_envelope_property(
            &envelope,
            "sortTimestamp",
            &JsValue::from_f64(metadata.sort_timestamp as f64),
        )?;
        set_envelope_property(
            &envelope,
            "sortKey",
            &JsValue::from_f64(-(metadata.sort_timestamp as f64)),
        )?;
    }

    Ok(envelope.into())
}

fn record_bytes_from_envelope(value: &JsValue) -> Result<Vec<u8>, IdbStorageError> {
    if !value.is_object() {
        return Err(IdbStorageError::InvalidRecordEnvelope);
    }
    let bytes = js_sys::Reflect::get(value, &JsValue::from_str("value"))
        .map_err(|_| IdbStorageError::InvalidRecordEnvelope)?;
    if bytes.is_undefined() {
        return Err(IdbStorageError::InvalidRecordEnvelope);
    }
    bytes_from_js(bytes)
}

fn envelope_property(value: &JsValue, name: &str) -> Result<JsValue, IdbStorageError> {
    if !value.is_object() {
        return Err(IdbStorageError::InvalidRecordEnvelope);
    }
    let property = js_sys::Reflect::get(value, &JsValue::from_str(name))
        .map_err(|_| IdbStorageError::InvalidRecordEnvelope)?;
    if property.is_undefined() {
        return Err(IdbStorageError::InvalidRecordEnvelope);
    }
    Ok(property)
}

fn index_entry_from_envelope(value: &JsValue) -> Result<EntityIndexEntry, IdbStorageError> {
    const MAX_SAFE_INTEGER: f64 = 9_007_199_254_740_991.0;

    let entity_key = envelope_property(value, "entityKey")?
        .as_string()
        .ok_or(IdbStorageError::InvalidRecordEnvelope)?;
    let bucket = envelope_property(value, "bucket")?
        .as_string()
        .ok_or(IdbStorageError::InvalidRecordEnvelope)?
        .parse::<EntityBucket>()?;
    let sort_timestamp = envelope_property(value, "sortTimestamp")?
        .as_f64()
        .filter(|value| {
            value.is_finite()
                && value.fract() == 0.0
                && (-MAX_SAFE_INTEGER..=MAX_SAFE_INTEGER).contains(value)
        })
        .ok_or(IdbStorageError::InvalidRecordEnvelope)? as i64;

    Ok(EntityIndexEntry {
        entity_key: EntityKey(entity_key),
        bucket,
        sort_timestamp,
    })
}

fn compound_key(values: impl IntoIterator<Item = JsValue>) -> JsValue {
    values.into_iter().collect::<js_sys::Array>().into()
}

fn index_cursor_key(sort_timestamp: i64, entity_key: &EntityKey) -> JsValue {
    compound_key([
        JsValue::from_f64(-(sort_timestamp as f64)),
        JsValue::from_str(&entity_key.0),
    ])
}

fn bucket_index_cursor_key(
    bucket: EntityBucket,
    sort_timestamp: i64,
    entity_key: &EntityKey,
) -> JsValue {
    compound_key([
        JsValue::from_str(bucket.as_str()),
        JsValue::from_f64(-(sort_timestamp as f64)),
        JsValue::from_str(&entity_key.0),
    ])
}

async fn collect_index_entries(
    index: &Index,
    range: Option<KeyRange>,
    limit: usize,
) -> Result<Vec<EntityIndexEntry>, IdbStorageError> {
    if limit == 0 {
        return Ok(Vec::new());
    }
    let Some(cursor) = index
        .open_cursor(range.map(Query::from), Some(CursorDirection::Next))?
        .await?
    else {
        return Ok(Vec::new());
    };
    let mut cursor = cursor.into_managed();
    let mut entries = Vec::with_capacity(limit);
    while entries.len() < limit {
        let Some(value) = cursor.value()? else {
            break;
        };
        entries.push(index_entry_from_envelope(&value)?);
        cursor.next(None).await?;
    }
    Ok(entries)
}

fn mutation_id_from_js(value: &JsValue) -> Result<MutationId, IdbStorageError> {
    const MAX_SAFE_INTEGER: f64 = 9_007_199_254_740_991.0;
    let Some(number) = value.as_f64() else {
        return Err(IdbStorageError::InvalidMutationId);
    };
    if !(1.0..=MAX_SAFE_INTEGER).contains(&number) || number.fract() != 0.0 {
        return Err(IdbStorageError::InvalidMutationId);
    }
    Ok(number as MutationId)
}

fn mutation_id_to_js(id: MutationId) -> Result<JsValue, IdbStorageError> {
    const MAX_SAFE_INTEGER: MutationId = 9_007_199_254_740_991;
    if id == 0 || id > MAX_SAFE_INTEGER {
        return Err(IdbStorageError::InvalidMutationId);
    }
    Ok(JsValue::from_f64(id as f64))
}

fn claim_matches(mutation: &cache_core::queue::StoredMutation, claim: &MutationClaimToken) -> bool {
    mutation.lease_owner.as_deref() == Some(&claim.owner)
        && mutation.lease_generation == claim.generation
}

impl IdbStorage {
    /// Opens the cache database for `scope` and initializes all stores.
    /// Record namespace changes clear only disposable records; a scope change
    /// also clears queued user intent.
    pub async fn open(scope: &str) -> Result<Self, IdbStorageError> {
        let name = cache_database_name(scope);
        let factory = Factory::new()?;
        let mut request = factory.open(&name, Some(DB_VERSION))?;
        request.on_upgrade_needed(|event| {
            let database = event.database().expect("upgrade event has database");
            let existing = database.store_names();

            // Normalized records are disposable. Recreate this store on
            // upgrades so legacy raw-byte values cannot coexist with the
            // indexable record envelope.
            if existing.iter().any(|store| store == RECORDS_STORE) {
                database
                    .delete_object_store(RECORDS_STORE)
                    .expect("delete legacy records object store");
            }
            let records = database
                .create_object_store(RECORDS_STORE, ObjectStoreParams::new())
                .expect("create records object store");
            records
                .create_index(
                    RECORDS_BY_SORT_INDEX,
                    KeyPath::new_array(["sortKey", "entityKey"]),
                    Some(IndexParams::new()),
                )
                .expect("create records sort index");
            records
                .create_index(
                    RECORDS_BY_BUCKET_SORT_INDEX,
                    KeyPath::new_array(["bucket", "sortKey", "entityKey"]),
                    Some(IndexParams::new()),
                )
                .expect("create records bucket sort index");

            for (name, params) in [
                (META_STORE, ObjectStoreParams::new()),
                (MUTATION_QUEUE_STORE, {
                    let mut params = ObjectStoreParams::new();
                    params.auto_increment(true);
                    params
                }),
                (OPTIMISTIC_LAYERS_STORE, ObjectStoreParams::new()),
            ] {
                if !existing.iter().any(|store| store == name) {
                    database
                        .create_object_store(name, params)
                        .unwrap_or_else(|_| panic!("create {name} object store"));
                }
            }
        });
        let mut db = request.await?;
        // Close immediately when another context needs this database gone or
        // upgraded (delete/upgrade requests block while connections are
        // open); without this, `destroy` from another tab can hang forever.
        db.on_version_change(|event: web_sys::Event| {
            if let Some(target) = event.target()
                && let Ok(db) = wasm_bindgen::JsCast::dyn_into::<web_sys::IdbDatabase>(target)
            {
                db.close();
            }
        });
        let mut storage = IdbStorage { db };
        storage.initialize_namespace(scope).await?;
        Ok(storage)
    }

    async fn initialize_namespace(&mut self, scope: &str) -> Result<(), IdbStorageError> {
        let tx = self.db.transaction(
            &[
                META_STORE,
                RECORDS_STORE,
                MUTATION_QUEUE_STORE,
                OPTIMISTIC_LAYERS_STORE,
            ],
            TransactionMode::ReadWrite,
        )?;
        let meta = tx.object_store(META_STORE)?;
        let scope_request = meta.get(JsValue::from_str(SCOPE_META_KEY))?;
        let namespace_request = meta.get(JsValue::from_str(NAMESPACE_META_KEY))?;
        let stored_scope = scope_request
            .await?
            .map(|value| value.as_string().ok_or(IdbStorageError::NotString))
            .transpose()?;
        let stored_namespace = namespace_request
            .await?
            .map(|value| value.as_string().ok_or(IdbStorageError::NotString))
            .transpose()?;
        let expected_namespace = cache_namespace(scope);

        if stored_scope.as_deref() != Some(scope) {
            tx.object_store(OPTIMISTIC_LAYERS_STORE)?.clear()?;
            tx.object_store(MUTATION_QUEUE_STORE)?.clear()?;
            tx.object_store(RECORDS_STORE)?.clear()?;
        } else if stored_namespace.as_deref() != Some(expected_namespace.as_str()) {
            tx.object_store(RECORDS_STORE)?.clear()?;
        }
        meta.put(
            &JsValue::from_str(scope),
            Some(&JsValue::from_str(SCOPE_META_KEY)),
        )?;
        meta.put(
            &JsValue::from_str(&expected_namespace),
            Some(&JsValue::from_str(NAMESPACE_META_KEY)),
        )?;
        tx.commit()?.await?;
        Ok(())
    }

    async fn query_global_index(
        &self,
        query: &EntityIndexQuery,
    ) -> Result<Vec<EntityIndexEntry>, IdbStorageError> {
        let tx = self
            .db
            .transaction(&[RECORDS_STORE], TransactionMode::ReadOnly)?;
        let index = tx
            .object_store(RECORDS_STORE)?
            .index(RECORDS_BY_SORT_INDEX)?;
        let range = query
            .cursor
            .as_ref()
            .map(|cursor| {
                KeyRange::lower_bound(
                    &index_cursor_key(cursor.sort_timestamp, &cursor.entity_key),
                    Some(true),
                )
            })
            .transpose()?;
        collect_index_entries(&index, range, query.bounded_storage_limit()).await
    }

    async fn query_bucket_index(
        &self,
        bucket: EntityBucket,
        query: &EntityIndexQuery,
    ) -> Result<Vec<EntityIndexEntry>, IdbStorageError> {
        let tx = self
            .db
            .transaction(&[RECORDS_STORE], TransactionMode::ReadOnly)?;
        let index = tx
            .object_store(RECORDS_STORE)?
            .index(RECORDS_BY_BUCKET_SORT_INDEX)?;
        let lower = match &query.cursor {
            Some(cursor) => {
                bucket_index_cursor_key(bucket, cursor.sort_timestamp, &cursor.entity_key)
            }
            None => compound_key([JsValue::from_str(bucket.as_str())]),
        };
        // IndexedDB keys order arrays after scalar values. Every stored
        // second component is numeric, so this bounds the requested bucket
        // without spilling into the next bucket string.
        let upper = compound_key([
            JsValue::from_str(bucket.as_str()),
            js_sys::Array::new().into(),
        ]);
        let range = KeyRange::bound(&lower, &upper, Some(query.cursor.is_some()), Some(true))?;
        collect_index_entries(&index, Some(range), query.bounded_storage_limit()).await
    }

    /// Deletes the database for `scope` (logout / stale-namespace cleanup).
    ///
    /// Connections opened by [`Self::open`] auto-close on `versionchange`,
    /// so this does not block on our own live handles. A `blocked` event
    /// (foreign connection without that handler) is logged for diagnosis
    /// instead of hanging silently.
    pub async fn destroy(scope: &str) -> Result<(), IdbStorageError> {
        let factory = Factory::new()?;
        let mut request = factory.delete(&cache_database_name(scope))?;
        request.on_blocked(|_| {
            web_sys::console::warn_1(
                &"graphql-cache: database deletion blocked by an open connection".into(),
            );
        });
        request.await?;
        Ok(())
    }

    /// Closes the underlying connection. Subsequent operations on this
    /// storage will fail; call right before dropping/destroying.
    pub fn close(&self) {
        self.db.close();
    }
}

impl Storage for IdbStorage {
    type Error = IdbStorageError;

    async fn get_batch(&self, keys: &[EntityKey]) -> Result<Vec<Option<Record>>, Self::Error> {
        let tx = self
            .db
            .transaction(&[RECORDS_STORE], TransactionMode::ReadOnly)?;
        let store = tx.object_store(RECORDS_STORE)?;

        // Dispatch all gets first (they execute concurrently within the
        // transaction), then await in order.
        let mut requests = Vec::with_capacity(keys.len());
        for key in keys {
            requests.push(store.get(JsValue::from_str(&key.0))?);
        }
        let mut out = Vec::with_capacity(keys.len());
        for request in requests {
            let value = request.await?;
            out.push(match value {
                None => None,
                Some(js) => Some(decode_record(&record_bytes_from_envelope(&js)?)?),
            });
        }
        Ok(out)
    }

    async fn put_batch(&mut self, entries: Vec<(EntityKey, Record)>) -> Result<(), Self::Error> {
        let tx = self
            .db
            .transaction(&[RECORDS_STORE], TransactionMode::ReadWrite)?;
        let store = tx.object_store(RECORDS_STORE)?;
        for (key, record) in &entries {
            store.put(
                &record_envelope_to_js(key, record)?,
                Some(&JsValue::from_str(&key.0)),
            )?;
        }
        // Committing the transaction is what makes the batch atomic.
        tx.commit()?.await?;
        Ok(())
    }

    async fn delete_batch(&mut self, keys: &[EntityKey]) -> Result<(), Self::Error> {
        let tx = self
            .db
            .transaction(&[RECORDS_STORE], TransactionMode::ReadWrite)?;
        let store = tx.object_store(RECORDS_STORE)?;
        for key in keys {
            store.delete(JsValue::from_str(&key.0))?;
        }
        tx.commit()?.await?;
        Ok(())
    }

    async fn query_entity_index(
        &self,
        query: &EntityIndexQuery,
    ) -> Result<Vec<EntityIndexEntry>, Self::Error> {
        if query.buckets.is_empty() {
            return self.query_global_index(query).await;
        }

        let buckets: std::collections::HashSet<_> = query.buckets.iter().copied().collect();
        let mut entries = Vec::new();
        for bucket in buckets {
            entries.extend(self.query_bucket_index(bucket, query).await?);
        }
        entries.sort_by(|left, right| {
            right
                .sort_timestamp
                .cmp(&left.sort_timestamp)
                .then_with(|| left.entity_key.cmp(&right.entity_key))
        });
        entries.truncate(query.bounded_storage_limit());
        Ok(entries)
    }

    async fn enqueue_mutation(
        &mut self,
        entry: NewQueuedMutation,
    ) -> Result<MutationId, Self::Error> {
        let tx = self.db.transaction(
            &[MUTATION_QUEUE_STORE, OPTIMISTIC_LAYERS_STORE],
            TransactionMode::ReadWrite,
        )?;
        let queue = tx.object_store(MUTATION_QUEUE_STORE)?;
        let mutation_bytes = encode_stored_mutation(&entry.mutation);
        let generated_key = queue.add(&bytes_to_js(&mutation_bytes), None)?.await?;
        let id = mutation_id_from_js(&generated_key)?;
        let optimistic_bytes = encode_optimistic_layer(&entry.optimistic);
        tx.object_store(OPTIMISTIC_LAYERS_STORE)?
            .put(&bytes_to_js(&optimistic_bytes), Some(&generated_key))?;
        tx.commit()?.await?;
        Ok(id)
    }

    async fn load_mutation_queue(&self) -> Result<Vec<QueuedMutation>, Self::Error> {
        let tx = self.db.transaction(
            &[MUTATION_QUEUE_STORE, OPTIMISTIC_LAYERS_STORE],
            TransactionMode::ReadOnly,
        )?;
        let queue = tx.object_store(MUTATION_QUEUE_STORE)?;
        let optimistic = tx.object_store(OPTIMISTIC_LAYERS_STORE)?;
        let queue_keys_request = queue.get_all_keys(None, None)?;
        let queue_values_request = queue.get_all(None, None)?;
        let optimistic_keys_request = optimistic.get_all_keys(None, None)?;
        let optimistic_values_request = optimistic.get_all(None, None)?;

        let queue_keys = queue_keys_request.await?;
        let queue_values = queue_values_request.await?;
        let optimistic_keys = optimistic_keys_request.await?;
        let optimistic_values = optimistic_values_request.await?;
        if queue_keys.len() != queue_values.len()
            || queue_keys.len() != optimistic_keys.len()
            || queue_keys.len() != optimistic_values.len()
        {
            return Err(IdbStorageError::InconsistentQueue);
        }

        let mut out = Vec::with_capacity(queue_keys.len());
        for (((queue_key, mutation), optimistic_key), layer) in queue_keys
            .into_iter()
            .zip(queue_values)
            .zip(optimistic_keys)
            .zip(optimistic_values)
        {
            let id = mutation_id_from_js(&queue_key)?;
            if mutation_id_from_js(&optimistic_key)? != id {
                return Err(IdbStorageError::InconsistentQueue);
            }
            out.push(QueuedMutation {
                id,
                mutation: decode_stored_mutation(&bytes_from_js(mutation)?)?,
                optimistic: decode_optimistic_layer(&bytes_from_js(layer)?)?,
            });
        }
        Ok(out)
    }

    async fn claim_next_mutation(
        &mut self,
        request: MutationClaimRequest,
    ) -> Result<Option<ClaimedMutation>, Self::Error> {
        let tx = self.db.transaction(
            &[MUTATION_QUEUE_STORE, OPTIMISTIC_LAYERS_STORE],
            TransactionMode::ReadWrite,
        )?;
        let queue = tx.object_store(MUTATION_QUEUE_STORE)?;
        let optimistic = tx.object_store(OPTIMISTIC_LAYERS_STORE)?;
        let queue_keys_request = queue.get_all_keys(None, Some(1))?;
        let queue_values_request = queue.get_all(None, Some(1))?;
        let optimistic_keys_request = optimistic.get_all_keys(None, Some(1))?;
        let optimistic_values_request = optimistic.get_all(None, Some(1))?;
        let queue_keys = queue_keys_request.await?;
        let queue_values = queue_values_request.await?;
        let optimistic_keys = optimistic_keys_request.await?;
        let optimistic_values = optimistic_values_request.await?;

        if queue_keys.is_empty() {
            if !queue_values.is_empty()
                || !optimistic_keys.is_empty()
                || !optimistic_values.is_empty()
            {
                return Err(IdbStorageError::InconsistentQueue);
            }
            tx.commit()?.await?;
            return Ok(None);
        }
        if queue_keys.len() != 1
            || queue_values.len() != 1
            || optimistic_keys.len() != 1
            || optimistic_values.len() != 1
        {
            return Err(IdbStorageError::InconsistentQueue);
        }
        let key = &queue_keys[0];
        let id = mutation_id_from_js(key)?;
        if mutation_id_from_js(&optimistic_keys[0])? != id {
            return Err(IdbStorageError::InconsistentQueue);
        }
        let mut mutation = decode_stored_mutation(&bytes_from_js(queue_values[0].clone())?)?;
        if mutation
            .next_attempt_at_ms
            .is_some_and(|next| next > request.now_ms)
            || mutation
                .lease_expires_at_ms
                .is_some_and(|expiry| expiry > request.now_ms)
        {
            tx.commit()?.await?;
            return Ok(None);
        }

        mutation.attempt_count = mutation.attempt_count.saturating_add(1);
        mutation.lease_generation = mutation.lease_generation.saturating_add(1);
        mutation.lease_owner = Some(request.owner);
        mutation.lease_expires_at_ms = Some(request.lease_expires_at_ms);
        mutation.next_attempt_at_ms = None;
        let generation = mutation.lease_generation;
        queue.put(&bytes_to_js(&encode_stored_mutation(&mutation)), Some(key))?;
        let layer = decode_optimistic_layer(&bytes_from_js(optimistic_values[0].clone())?)?;
        tx.commit()?.await?;
        Ok(Some(ClaimedMutation {
            queued: QueuedMutation {
                id,
                mutation,
                optimistic: layer,
            },
            lease_generation: generation,
        }))
    }

    async fn defer_mutation(
        &mut self,
        id: MutationId,
        claim: MutationClaimToken,
        next_attempt_at_ms: i64,
        error: String,
    ) -> Result<bool, Self::Error> {
        let key = mutation_id_to_js(id)?;
        let tx = self
            .db
            .transaction(&[MUTATION_QUEUE_STORE], TransactionMode::ReadWrite)?;
        let queue = tx.object_store(MUTATION_QUEUE_STORE)?;
        let Some(value) = queue.get(key.clone())?.await? else {
            tx.commit()?.await?;
            return Ok(false);
        };
        let mut mutation = decode_stored_mutation(&bytes_from_js(value)?)?;
        if !claim_matches(&mutation, &claim) {
            tx.commit()?.await?;
            return Ok(false);
        }
        mutation.next_attempt_at_ms = Some(next_attempt_at_ms);
        mutation.last_error = Some(error);
        mutation.lease_owner = None;
        mutation.lease_expires_at_ms = None;
        queue.put(&bytes_to_js(&encode_stored_mutation(&mutation)), Some(&key))?;
        tx.commit()?.await?;
        Ok(true)
    }

    async fn complete_mutation(
        &mut self,
        id: MutationId,
        claim: MutationClaimToken,
        entries: Vec<(EntityKey, Record)>,
    ) -> Result<bool, Self::Error> {
        let key = mutation_id_to_js(id)?;
        let tx = self.db.transaction(
            &[RECORDS_STORE, MUTATION_QUEUE_STORE, OPTIMISTIC_LAYERS_STORE],
            TransactionMode::ReadWrite,
        )?;
        let queue = tx.object_store(MUTATION_QUEUE_STORE)?;
        let Some(value) = queue.get(key.clone())?.await? else {
            tx.commit()?.await?;
            return Ok(false);
        };
        let mutation = decode_stored_mutation(&bytes_from_js(value)?)?;
        if !claim_matches(&mutation, &claim) {
            tx.commit()?.await?;
            return Ok(false);
        }
        let records = tx.object_store(RECORDS_STORE)?;
        for (record_key, record) in &entries {
            records.put(
                &record_envelope_to_js(record_key, record)?,
                Some(&JsValue::from_str(&record_key.0)),
            )?;
        }
        queue.delete(key.clone())?;
        tx.object_store(OPTIMISTIC_LAYERS_STORE)?.delete(key)?;
        tx.commit()?.await?;
        Ok(true)
    }

    async fn discard_mutation(
        &mut self,
        id: MutationId,
        claim: MutationClaimToken,
    ) -> Result<bool, Self::Error> {
        let key = mutation_id_to_js(id)?;
        let tx = self.db.transaction(
            &[MUTATION_QUEUE_STORE, OPTIMISTIC_LAYERS_STORE],
            TransactionMode::ReadWrite,
        )?;
        let queue = tx.object_store(MUTATION_QUEUE_STORE)?;
        let Some(value) = queue.get(key.clone())?.await? else {
            tx.commit()?.await?;
            return Ok(false);
        };
        let mutation = decode_stored_mutation(&bytes_from_js(value)?)?;
        if !claim_matches(&mutation, &claim) {
            tx.commit()?.await?;
            return Ok(false);
        }
        queue.delete(key.clone())?;
        tx.object_store(OPTIMISTIC_LAYERS_STORE)?.delete(key)?;
        tx.commit()?.await?;
        Ok(true)
    }

    async fn clear(&mut self) -> Result<(), Self::Error> {
        let tx = self.db.transaction(
            &[RECORDS_STORE, MUTATION_QUEUE_STORE, OPTIMISTIC_LAYERS_STORE],
            TransactionMode::ReadWrite,
        )?;
        tx.object_store(OPTIMISTIC_LAYERS_STORE)?.clear()?;
        tx.object_store(MUTATION_QUEUE_STORE)?.clear()?;
        tx.object_store(RECORDS_STORE)?.clear()?;
        tx.commit()?.await?;
        Ok(())
    }
}
