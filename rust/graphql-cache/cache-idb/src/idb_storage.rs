use cache_core::codec::{cache_namespace, decode_record, encode_record, CodecError};
use cache_core::store::Storage;
use cache_core::value::{EntityKey, Record};
use idb::{Database, DatabaseEvent, Factory, ObjectStoreParams, TransactionMode};
use thiserror::Error;
use wasm_bindgen::{JsCast, JsValue};

const RECORDS_STORE: &str = "records";
const DB_VERSION: u32 = 1;

#[derive(Debug, Error)]
pub enum IdbStorageError {
    #[error("indexeddb: {0}")]
    Idb(#[from] idb::Error),
    #[error(transparent)]
    Codec(#[from] CodecError),
    #[error("stored value is not a Uint8Array")]
    NotBytes,
}

pub struct IdbStorage {
    db: Database,
}

impl IdbStorage {
    /// Opens the cache database for `scope`. A schema or format change
    /// yields a different database name, i.e. an implicitly fresh cache
    /// (stale namespaces are garbage-collected via [`Self::destroy`] by the
    /// host, or eventually by the browser under storage pressure).
    pub async fn open(scope: &str) -> Result<Self, IdbStorageError> {
        let name = cache_namespace(scope);
        let factory = Factory::new()?;
        let mut request = factory.open(&name, Some(DB_VERSION))?;
        request.on_upgrade_needed(|event| {
            let database = event.database().expect("upgrade event has database");
            // Out-of-line string keys (the entity key), Uint8Array values.
            let _ = database.create_object_store(RECORDS_STORE, ObjectStoreParams::new());
        });
        let db = request.await?;
        Ok(IdbStorage { db })
    }

    /// Deletes the database for `scope` (logout / stale-namespace cleanup).
    pub async fn destroy(scope: &str) -> Result<(), IdbStorageError> {
        let factory = Factory::new()?;
        factory.delete(&cache_namespace(scope))?.await?;
        Ok(())
    }

    pub fn close(self) {
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
                Some(js) => {
                    let bytes: js_sys::Uint8Array =
                        js.dyn_into().map_err(|_| IdbStorageError::NotBytes)?;
                    Some(decode_record(&bytes.to_vec())?)
                }
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
            let bytes = encode_record(record);
            let value: JsValue = js_sys::Uint8Array::from(bytes.as_slice()).into();
            store.put(&value, Some(&JsValue::from_str(&key.0)))?;
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

    async fn clear(&mut self) -> Result<(), Self::Error> {
        let tx = self
            .db
            .transaction(&[RECORDS_STORE], TransactionMode::ReadWrite)?;
        tx.object_store(RECORDS_STORE)?.clear()?;
        tx.commit()?.await?;
        Ok(())
    }
}
