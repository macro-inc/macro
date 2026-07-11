use tracing::trace;

use crate::timeit;

use super::super::snapshot::SnapshotStorage;
use worker::Bucket;

pub struct R2Storage {
    inner: Bucket,
    pub document_id: String,
}

impl R2Storage {
    pub fn new(inner: Bucket, document_id: String) -> Self {
        Self { inner, document_id }
    }

    pub async fn get<T>(&self, key: &str) -> worker::Result<T>
    where
        T: serde::de::DeserializeOwned,
    {
        let bytes = self.get_raw(key).await?;

        serde_json::from_slice::<T>(&bytes)
            .map_err(|e| worker::Error::from(format!("Deserialization error: {e}")))
    }

    pub async fn get_raw(&self, key: &str) -> worker::Result<Vec<u8>> {
        self.inner
            .get(key)
            .execute()
            .await?
            .ok_or_else(|| worker::Error::from("response not found"))?
            .body()
            .ok_or_else(|| worker::Error::from("response body not found"))?
            .bytes()
            .await
    }

    pub async fn put<T>(&self, key: &str, value: T) -> worker::Result<()>
    where
        T: serde::Serialize,
    {
        let bytes = serde_json::to_vec(&value)
            .map_err(|e| worker::Error::from(format!("Serialization error: {e}")))?;

        self.put_raw(key, bytes).await
    }

    pub async fn put_raw(&self, key: &str, bytes: Vec<u8>) -> worker::Result<()> {
        self.inner
            .put(key, bytes)
            .execute()
            .await
            .map(|_| ())
            .map_err(|e| worker::Error::from(format!("failed to put key {key} in bucket: {e}")))
    }

    pub async fn has(&self, key: &str) -> worker::Result<bool> {
        let object = self.inner.head(key).await?;
        Ok(object.is_some())
    }
}

impl SnapshotStorage for R2Storage {
    async fn store_snapshot(&self, snapshot: Vec<u8>) -> worker::Result<()> {
        let key = format!("{}/{}.snapshot", self.document_id, self.document_id);
        self.put_raw(&key, snapshot).await?;

        Ok(())
    }

    async fn get_snapshot(&self) -> worker::Result<Vec<u8>> {
        let (snapshot, elapsed) = timeit!({
            let key = format!("{}/{}.snapshot", self.document_id, self.document_id);
            self.get_raw(&key).await?
        });
        trace!(
            duration_ms = elapsed.as_millis(),
            document_id = self.document_id,
            snapshot_size = snapshot.len(),
            "kv::get_snapshot"
        );
        Ok(snapshot)
    }

    async fn has_snapshot(&self) -> worker::Result<bool> {
        let key = format!("{}/{}.snapshot", self.document_id, self.document_id);
        let has = self.has(&key).await?;
        Ok(has)
    }
}
