use tracing::trace;
use worker::{Error, Result, SqlStorage, SqlStorageValue, Storage};

use crate::{storage::snapshot::SnapshotStorage, timeit};

/// Chunked key-value storage backend using Durable Object SQL storage.
/// Automatically chunks values larger than CHUNK_SIZE to work within SQLite limits.
pub struct DurableSQLStorage {
    document_id: String,
    storage: Storage,
}

/// Maximum size per chunk (1.5 MB)
const CHUNK_SIZE: usize = 1_572_864; // 1.5 * 1024 * 1024

impl DurableSQLStorage {
    pub fn new(storage: Storage, document_id: String) -> Result<Self> {
        storage.sql().exec(
            "CREATE TABLE IF NOT EXISTS kv_store (
                    id TEXT NOT NULL,
                    chunk INTEGER NOT NULL,
                    data BLOB,
                    PRIMARY KEY (id, chunk)
                )",
            None,
        )?;
        Ok(Self {
            document_id,
            storage,
        })
    }

    /// Store a key-value pair, chunking large values automatically
    pub fn put(&self, key: &str, value: &[u8]) -> Result<()> {
        // I broke this out bc I'm trying to figure out how to wrap it in a transaction
        fn put_impl(sql: &SqlStorage, key: &str, value: &[u8]) -> Result<()> {
            sql.exec(
                "DELETE FROM kv_store WHERE id = ?1",
                Some(vec![SqlStorageValue::from(key)]),
            )?;

            // If value is empty, we're done (effectively a delete)
            if value.is_empty() {
                return Ok(());
            }

            let chunks: Vec<&[u8]> = value.chunks(CHUNK_SIZE).collect();

            for (chunk_num, chunk_data) in chunks.iter().enumerate() {
                sql.exec(
                    "INSERT INTO kv_store (id, chunk, data) VALUES (?1, ?2, ?3)",
                    Some(vec![
                        SqlStorageValue::from(key),
                        SqlStorageValue::from(chunk_num as i64),
                        SqlStorageValue::from(chunk_data.to_vec()),
                    ]),
                )?;
            }

            Ok(())
        }

        put_impl(&self.storage.sql(), key, value)
    }

    /// Retrieve a value by key, reassembling chunks if necessary
    pub fn get(&self, key: &str) -> Result<Option<Vec<u8>>> {
        let cursor = self.storage.sql().exec(
            "SELECT chunk, data FROM kv_store WHERE id = ?1 ORDER BY chunk",
            Some(vec![SqlStorageValue::from(key)]),
        )?;

        // Reassemble chunks in order
        let mut reassembled = Vec::new();
        let mut expected_chunk = 0i64;

        for row in cursor.raw() {
            let (chunk, data) = chunk_data_from_row(row?)?;
            if chunk != expected_chunk {
                return Err(worker::Error::from(format!(
                    "Missing chunk #[{expected_chunk}] for key [{key}]. Got chunk #[{chunk}]"
                )));
            }
            reassembled.extend_from_slice(&data);
            expected_chunk += 1;
        }
        if expected_chunk == 0 {
            return Ok(None);
        }

        Ok(Some(reassembled))
    }

    /// Check if a key exists
    pub fn exists(&self, key: &str) -> Result<bool> {
        let cursor = self.storage.sql().exec(
            "SELECT 1 FROM kv_store WHERE id = ?1 LIMIT 1",
            Some(vec![SqlStorageValue::from(key)]),
        )?;

        let results: Vec<serde_json::Value> = cursor.to_array()?;
        Ok(!results.is_empty())
    }

    /// Delete a key and all its chunks
    #[expect(unused, reason = "We could use this in place of DO KV")]
    pub fn delete(&self, key: &str) -> Result<bool> {
        let cursor = self.storage.sql().exec(
            "DELETE FROM kv_store WHERE id = ?1",
            Some(vec![SqlStorageValue::from(key)]),
        )?;

        Ok(cursor.rows_written() > 0)
    }

    /// List all keys in the storage
    #[expect(unused, reason = "We could use this in place of DO KV")]
    pub fn list_keys(&self) -> Result<Vec<String>> {
        let cursor = self
            .storage
            .sql()
            .exec("SELECT DISTINCT id FROM kv_store ORDER BY id", None)?;

        let results: Vec<serde_json::Value> = cursor.to_array()?;
        let mut keys = Vec::new();

        for row in results {
            if let Some(key) = row.get("id").and_then(|v| v.as_str()) {
                keys.push(key.to_string());
            }
        }

        Ok(keys)
    }

    /// Get storage statistics
    #[expect(unused, reason = "For debugging")]
    pub fn stats(&self) -> Result<StorageStats> {
        let cursor = self.storage.sql().exec(
            "SELECT COUNT(DISTINCT id) as key_count, COUNT(*) as chunk_count, SUM(LENGTH(data)) as total_size FROM kv_store",
            None
        )?;

        let results: Vec<serde_json::Value> = cursor.to_array()?;

        if let Some(row) = results.first() {
            let key_count = row
                .get("key_count")
                .and_then(|v| v.as_i64())
                .map(|f| f as u64)
                .unwrap_or(0);

            let chunk_count = row
                .get("chunk_count")
                .and_then(|v| v.as_i64())
                .map(|f| f as u64)
                .unwrap_or(0);

            let total_size = row
                .get("total_size")
                .and_then(|v| v.as_i64())
                .map(|f| f as u64)
                .unwrap_or(0);

            Ok(StorageStats {
                key_count,
                chunk_count,
                total_size,
            })
        } else {
            Ok(StorageStats::default())
        }
    }
}

#[expect(unused, reason = "For debugging")]
#[derive(Debug, Default)]
pub struct StorageStats {
    pub key_count: u64,
    pub chunk_count: u64,
    pub total_size: u64,
}

impl SnapshotStorage for DurableSQLStorage {
    /// Stores a snapshot in the storage
    async fn store_snapshot(&self, snapshot: &[u8]) -> worker::Result<()> {
        self.put(&self.document_id, snapshot)
    }
    /// Retrieves a snpashot from the storage
    async fn get_snapshot(&self) -> worker::Result<Vec<u8>> {
        let (res, elapsed) = timeit!(self.get(&self.document_id));
        match res {
            Ok(Some(x)) => {
                trace!(
                    duration_ms = elapsed.as_millis(),
                    document_id = self.document_id,
                    snapshot_size = x.len(),
                    "do_sql::get_snapshot"
                );
                Ok(x)
            }
            Ok(None) => Err(Error::from(format!(
                "No snapshot for document_id = [{}]",
                self.document_id
            ))),
            Err(e) => Err(e)?,
        }
    }
    /// Checks if a snapshot exists in the storage
    async fn has_snapshot(&self) -> worker::Result<bool> {
        self.exists(&self.document_id)
    }
}

fn chunk_data_from_row(row: Vec<SqlStorageValue>) -> Result<(i64, Vec<u8>)> {
    let mut row = row.into_iter();
    let Some(SqlStorageValue::Integer(chunk)) = row.next() else {
        todo!()
    };
    let Some(SqlStorageValue::Blob(data)) = row.next() else {
        todo!()
    };
    debug_assert!(row.next().is_none());
    Ok((chunk, data))
}
