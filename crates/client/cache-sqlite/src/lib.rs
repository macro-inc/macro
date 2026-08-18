//! SQLite [`Storage`] backend for the Tauri native host.
//!
//! One database file per cache; the `meta` table pins the cache namespace
//! (scope + schema compatibility epoch + format version, see
//! [`cache_core::codec::cache_namespace`]). On mismatch the store is wiped
//! and rebuilt — the cache is disposable by design, never migrated.
//!
//! rusqlite is synchronous; the async [`Storage`] methods complete
//! immediately (blocking IO is the point of the native host). The
//! connection sits behind a `Mutex` so `&self` futures are `Send`
//! (`Storage` futures are `MaybeSend`), letting the Tauri host drive the
//! engine directly from its multi-threaded runtime.

#![deny(missing_docs)]

use cache_core::codec::{
    cache_namespace, decode_record, decode_record_updates, encode_record, encode_record_updates,
};
use cache_core::queue::{
    ClaimedMutation, MutationClaimRequest, MutationClaimToken, MutationId, MutationRequest,
    NewQueuedMutation, PersistedOptimisticLayer, QueuedMutation, StoredMutation,
};
use cache_core::search::{SearchCursor, SearchDocument, SearchProfile, project_search_documents};
use cache_core::store::{QueueDiagnostics, QueueDiagnosticsAvailability, Storage};
use cache_core::value::{EntityKey, Record};
use rusqlite::{Connection, OptionalExtension, Transaction, params};
use std::path::Path;
use std::sync::{Mutex, MutexGuard};
use thiserror::Error;

/// Version of the disposable native search projection schema.
const NATIVE_SEARCH_SCHEMA_VERSION: u32 = 4;

/// Errors produced by the SQLite storage backend.
#[derive(Debug, Error)]
pub enum SqliteStorageError {
    /// Underlying SQLite failure.
    #[error("sqlite: {0}")]
    Sqlite(#[from] rusqlite::Error),
    /// A stored cache value failed to decode.
    #[error(transparent)]
    Codec(#[from] cache_core::codec::CodecError),
    /// Durable queue metadata violated an invariant.
    #[error("invalid mutation queue state: {0}")]
    QueueInvariant(String),
    /// A search cursor did not contain a canonical entity key.
    #[error("invalid search cursor")]
    InvalidSearchCursor,
}

/// [`Storage`] backend over a SQLite database (Tauri native host).
pub struct SqliteStorage {
    /// `Connection` is `Send` but not `Sync`; the mutex makes the storage
    /// `Sync` so borrowing futures are `Send`. Never contended in practice —
    /// the engine serializes storage access.
    conn: Mutex<Connection>,
}

impl SqliteStorage {
    /// Opens (or wipes and rebuilds) the cache database at `path` for
    /// `scope` (user/workspace identifier).
    pub fn open(path: impl AsRef<Path>, scope: &str) -> Result<Self, SqliteStorageError> {
        let conn = Connection::open(path)?;
        Self::init(conn, scope)
    }

    /// In-memory database (tests).
    pub fn open_in_memory(scope: &str) -> Result<Self, SqliteStorageError> {
        Self::init(Connection::open_in_memory()?, scope)
    }

    fn init(mut conn: Connection, scope: &str) -> Result<Self, SqliteStorageError> {
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS meta (
                 k TEXT PRIMARY KEY,
                 v TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS records (
                 key TEXT PRIMARY KEY,
                 value BLOB NOT NULL
             );
             CREATE TABLE IF NOT EXISTS search_documents (
                 profile TEXT NOT NULL,
                 __typename TEXT NOT NULL,
                 id TEXT NOT NULL,
                 bucket TEXT NOT NULL,
                 search_text TEXT NOT NULL,
                 timestamp_ms INTEGER NOT NULL,
                 source_hash TEXT NOT NULL,
                 PRIMARY KEY(profile, __typename, id)
             );
             CREATE INDEX IF NOT EXISTS search_documents_browse_idx
                 ON search_documents(
                     profile, bucket, timestamp_ms DESC, __typename ASC, id ASC
                 );
             CREATE TABLE IF NOT EXISTS mutation_queue (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 query TEXT NOT NULL,
                 operation_name TEXT,
                 variables_json TEXT NOT NULL,
                 identity TEXT,
                 attempt_count INTEGER NOT NULL DEFAULT 0,
                 next_attempt_at_ms INTEGER,
                 lease_owner TEXT,
                 lease_generation INTEGER NOT NULL DEFAULT 0,
                 lease_expires_at_ms INTEGER,
                 last_error TEXT,
                 created_at_ms INTEGER NOT NULL
             );
             CREATE INDEX IF NOT EXISTS mutation_queue_created_at_ms_idx
                 ON mutation_queue(created_at_ms);
             CREATE TABLE IF NOT EXISTS optimistic_layers (
                 mutation_id INTEGER PRIMARY KEY,
                 optimistic_data_json TEXT NOT NULL,
                 normalized_updates BLOB NOT NULL,
                 FOREIGN KEY(mutation_id) REFERENCES mutation_queue(id) ON DELETE CASCADE
             );",
        )?;

        let expected_namespace = cache_namespace(scope);
        let stored_scope: Option<String> = conn
            .query_row("SELECT v FROM meta WHERE k = 'scope'", [], |row| row.get(0))
            .optional()?;
        let stored_namespace: Option<String> = conn
            .query_row("SELECT v FROM meta WHERE k = 'namespace'", [], |row| {
                row.get(0)
            })
            .optional()?;
        let stored_search_version: Option<String> = conn
            .query_row(
                "SELECT v FROM meta WHERE k = 'search_schema_version'",
                [],
                |row| row.get(0),
            )
            .optional()?;

        let expected_search_version = NATIVE_SEARCH_SCHEMA_VERSION.to_string();
        let search_schema_changed =
            stored_search_version.as_deref() != Some(expected_search_version.as_str());
        let tx = conn.transaction()?;
        // Existing projection schemas must be physically replaced before the
        // version marker advances. The cache is disposable and intentionally
        // does not backfill by scanning record blobs.
        if stored_search_version.is_some() && search_schema_changed {
            tx.execute_batch(
                "DROP TABLE search_documents;
                 CREATE TABLE search_documents (
                     profile TEXT NOT NULL,
                     __typename TEXT NOT NULL,
                     id TEXT NOT NULL,
                     bucket TEXT NOT NULL,
                     search_text TEXT NOT NULL,
                     timestamp_ms INTEGER NOT NULL,
                     source_hash TEXT NOT NULL,
                     PRIMARY KEY(profile, __typename, id)
                 );
                 CREATE INDEX search_documents_browse_idx
                     ON search_documents(
                         profile, bucket, timestamp_ms DESC, __typename ASC, id ASC
                     );",
            )?;
        }
        if stored_scope.as_deref() != Some(scope) {
            // Scope changes are identity changes: queued user intent must not
            // cross the boundary. `None` is the one-time upgrade from the
            // pre-queue schema, where no durable mutations existed.
            tx.execute("DELETE FROM optimistic_layers", [])?;
            tx.execute("DELETE FROM mutation_queue", [])?;
            tx.execute("DELETE FROM search_documents", [])?;
            tx.execute("DELETE FROM records", [])?;
        } else if stored_namespace.as_deref() != Some(expected_namespace.as_str()) {
            // Incompatible schema/cache-format changes only invalidate
            // disposable records. The queue retains source GraphQL +
            // optimistic JSON so the engine can re-normalize it against the
            // current schema.
            tx.execute("DELETE FROM search_documents", [])?;
            tx.execute("DELETE FROM records", [])?;
        } else if search_schema_changed {
            // The projection is derived from complete records, so a profile
            // change discards both rather than backfilling by blob scan.
            tx.execute("DELETE FROM search_documents", [])?;
            tx.execute("DELETE FROM records", [])?;
        }
        tx.execute(
            "INSERT INTO meta (k, v) VALUES ('scope', ?1)
             ON CONFLICT(k) DO UPDATE SET v = excluded.v",
            params![scope],
        )?;
        tx.execute(
            "INSERT INTO meta (k, v) VALUES ('namespace', ?1)
             ON CONFLICT(k) DO UPDATE SET v = excluded.v",
            params![expected_namespace],
        )?;
        tx.execute(
            "INSERT INTO meta (k, v) VALUES ('search_schema_version', ?1)
             ON CONFLICT(k) DO UPDATE SET v = excluded.v",
            params![expected_search_version],
        )?;
        tx.commit()?;

        Ok(SqliteStorage {
            conn: Mutex::new(conn),
        })
    }

    /// A poisoned mutex means a panic mid-statement; SQLite rolls back
    /// interrupted transactions on drop, so the connection stays usable.
    fn conn(&self) -> MutexGuard<'_, Connection> {
        self.conn.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Total number of stored records (diagnostics/GC).
    pub fn record_count(&self) -> Result<u64, SqliteStorageError> {
        Ok(self
            .conn()
            .query_row("SELECT COUNT(*) FROM records", [], |row| row.get(0))?)
    }

    /// Number of compact search documents.
    pub fn search_document_count(&self) -> Result<u64, SqliteStorageError> {
        Ok(self
            .conn()
            .query_row("SELECT COUNT(*) FROM search_documents", [], |row| {
                row.get(0)
            })?)
    }

    /// Number of mutations waiting for settlement.
    pub fn mutation_count(&self) -> Result<u64, SqliteStorageError> {
        Ok(self
            .conn()
            .query_row("SELECT COUNT(*) FROM mutation_queue", [], |row| row.get(0))?)
    }
}

fn mutation_id_from_sql(id: i64) -> Result<MutationId, SqliteStorageError> {
    id.try_into()
        .map_err(|_| SqliteStorageError::QueueInvariant(format!("negative mutation id {id}")))
}

fn mutation_id_to_sql(id: MutationId) -> Result<i64, SqliteStorageError> {
    id.try_into().map_err(|_| {
        SqliteStorageError::QueueInvariant(format!("mutation id {id} exceeds SQLite INTEGER"))
    })
}

fn row_stored_mutation(row: &rusqlite::Row<'_>, offset: usize) -> rusqlite::Result<StoredMutation> {
    let attempt_count: i64 = row.get(offset + 4)?;
    let lease_generation: i64 = row.get(offset + 7)?;
    Ok(StoredMutation {
        request: MutationRequest {
            query: row.get(offset)?,
            operation_name: row.get(offset + 1)?,
            variables_json: row.get(offset + 2)?,
            identity: row.get(offset + 3)?,
        },
        attempt_count: attempt_count.try_into().map_err(|e| {
            rusqlite::Error::FromSqlConversionFailure(
                offset + 4,
                rusqlite::types::Type::Integer,
                Box::new(e),
            )
        })?,
        next_attempt_at_ms: row.get(offset + 5)?,
        lease_owner: row.get(offset + 6)?,
        lease_generation: lease_generation.try_into().map_err(|e| {
            rusqlite::Error::FromSqlConversionFailure(
                offset + 7,
                rusqlite::types::Type::Integer,
                Box::new(e),
            )
        })?,
        lease_expires_at_ms: row.get(offset + 8)?,
        last_error: row.get(offset + 9)?,
        created_at_ms: row.get(offset + 10)?,
    })
}

fn entity_key_parts<'a>(key: &'a EntityKey<'_>) -> Option<(&'a str, &'a str)> {
    key.as_ref()
        .split_once(':')
        .filter(|(typename, _)| !typename.is_empty())
}

fn write_search_documents(
    tx: &Transaction<'_>,
    entries: &[(EntityKey<'static>, Record)],
) -> Result<(), rusqlite::Error> {
    let mut delete =
        tx.prepare_cached("DELETE FROM search_documents WHERE __typename = ?1 AND id = ?2")?;
    let mut upsert = tx.prepare_cached(
        "INSERT INTO search_documents (
             profile, __typename, id, bucket, search_text, timestamp_ms, source_hash
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(profile, __typename, id) DO UPDATE SET
             bucket = excluded.bucket,
             search_text = excluded.search_text,
             timestamp_ms = excluded.timestamp_ms,
             source_hash = excluded.source_hash",
    )?;
    for (key, record) in entries {
        let Some((typename, id)) = entity_key_parts(key) else {
            continue;
        };
        delete.execute(params![typename, id])?;
        for document in project_search_documents(key, record) {
            upsert.execute(params![
                document.profile.as_str(),
                typename,
                id,
                document.bucket,
                document.search_text,
                document.timestamp_ms,
                document.source_hash,
            ])?;
        }
    }
    Ok(())
}

fn row_search_document(
    row: &rusqlite::Row<'_>,
    profile: SearchProfile,
) -> rusqlite::Result<SearchDocument> {
    let typename: String = row.get(0)?;
    let id: String = row.get(1)?;
    Ok(SearchDocument {
        profile,
        record_key: EntityKey::entity(&typename, &[&id]),
        bucket: row.get(2)?,
        search_text: row.get(3)?,
        timestamp_ms: row.get(4)?,
        source_hash: row.get(5)?,
    })
}

fn claim_is_current(
    tx: &Transaction<'_>,
    id: i64,
    claim: &MutationClaimToken,
) -> Result<bool, rusqlite::Error> {
    let current: Option<(Option<String>, i64)> = tx
        .query_row(
            "SELECT lease_owner, lease_generation FROM mutation_queue WHERE id = ?1",
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    Ok(current.is_some_and(|(owner, generation)| {
        owner.as_deref() == Some(&claim.owner)
            && u64::try_from(generation).ok() == Some(claim.generation)
    }))
}

impl Storage for SqliteStorage {
    type Error = SqliteStorageError;

    async fn get_batch(&self, keys: &[EntityKey<'_>]) -> Result<Vec<Option<Record>>, Self::Error> {
        let conn = self.conn();
        let mut stmt = conn.prepare_cached("SELECT value FROM records WHERE key = ?1")?;
        let mut out = Vec::with_capacity(keys.len());
        for key in keys {
            let bytes: Option<Vec<u8>> = stmt
                .query_row(params![key.0.as_ref()], |row| row.get(0))
                .optional()?;
            out.push(match bytes {
                Some(b) => Some(decode_record(&b)?),
                None => None,
            });
        }
        Ok(out)
    }

    async fn put_batch(
        &mut self,
        entries: Vec<(EntityKey<'static>, Record)>,
    ) -> Result<(), Self::Error> {
        let mut conn = self.conn();
        let tx = conn.transaction()?;
        {
            let mut stmt = tx.prepare_cached(
                "INSERT INTO records (key, value) VALUES (?1, ?2)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            )?;
            for (key, record) in &entries {
                stmt.execute(params![key.0.as_ref(), encode_record(record)])?;
            }
        }
        write_search_documents(&tx, &entries)?;
        tx.commit()?;
        Ok(())
    }

    async fn delete_batch(&mut self, keys: &[EntityKey<'static>]) -> Result<(), Self::Error> {
        let mut conn = self.conn();
        let tx = conn.transaction()?;
        {
            let mut record_stmt = tx.prepare_cached("DELETE FROM records WHERE key = ?1")?;
            let mut search_stmt = tx
                .prepare_cached("DELETE FROM search_documents WHERE __typename = ?1 AND id = ?2")?;
            for key in keys {
                record_stmt.execute(params![key.0.as_ref()])?;
                if let Some((typename, id)) = entity_key_parts(key) {
                    search_stmt.execute(params![typename, id])?;
                }
            }
        }
        tx.commit()?;
        Ok(())
    }

    async fn load_search_documents(
        &self,
        profile: SearchProfile,
    ) -> Result<Vec<SearchDocument>, Self::Error> {
        let conn = self.conn();
        let mut statement = conn.prepare_cached(
            "SELECT __typename, id, bucket, search_text, timestamp_ms, source_hash
             FROM search_documents WHERE profile = ?1",
        )?;
        let rows = statement.query_map(params![profile.as_str()], |row| {
            row_search_document(row, profile)
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    async fn browse_search_documents(
        &self,
        profile: SearchProfile,
        bucket: &str,
        after: Option<&SearchCursor>,
        limit: usize,
    ) -> Result<Vec<SearchDocument>, Self::Error> {
        let conn = self.conn();
        let limit = i64::try_from(limit).unwrap_or(i64::MAX);
        let mut documents = Vec::new();
        if let Some(cursor) = after {
            let (cursor_typename, cursor_id) = entity_key_parts(&cursor.record_key)
                .ok_or(SqliteStorageError::InvalidSearchCursor)?;
            let mut statement = conn.prepare_cached(
                "SELECT __typename, id, bucket, search_text, timestamp_ms, source_hash
                 FROM search_documents
                 WHERE profile = ?1 AND bucket = ?2
                   AND (
                       timestamp_ms < ?3
                       OR (timestamp_ms = ?3 AND (
                           __typename > ?4 OR (__typename = ?4 AND id > ?5)
                       ))
                   )
                 ORDER BY timestamp_ms DESC, __typename ASC, id ASC LIMIT ?6",
            )?;
            let rows = statement.query_map(
                params![
                    profile.as_str(),
                    bucket,
                    cursor.timestamp_ms,
                    cursor_typename,
                    cursor_id,
                    limit
                ],
                |row| row_search_document(row, profile),
            )?;
            for row in rows {
                documents.push(row?);
            }
        } else {
            let mut statement = conn.prepare_cached(
                "SELECT __typename, id, bucket, search_text, timestamp_ms, source_hash
                 FROM search_documents
                 WHERE profile = ?1 AND bucket = ?2
                 ORDER BY timestamp_ms DESC, __typename ASC, id ASC LIMIT ?3",
            )?;
            let rows = statement.query_map(params![profile.as_str(), bucket, limit], |row| {
                row_search_document(row, profile)
            })?;
            for row in rows {
                documents.push(row?);
            }
        }
        Ok(documents)
    }

    async fn enqueue_mutation(
        &mut self,
        entry: NewQueuedMutation,
    ) -> Result<MutationId, Self::Error> {
        let mut conn = self.conn();
        let tx = conn.transaction()?;
        let mutation = &entry.mutation;
        tx.execute(
            "INSERT INTO mutation_queue (
                 query, operation_name, variables_json, identity,
                 attempt_count, next_attempt_at_ms, lease_owner,
                 lease_generation, lease_expires_at_ms, last_error, created_at_ms
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                mutation.request.query,
                mutation.request.operation_name,
                mutation.request.variables_json,
                mutation.request.identity,
                i64::from(mutation.attempt_count),
                mutation.next_attempt_at_ms,
                mutation.lease_owner,
                i64::try_from(mutation.lease_generation).map_err(|_| {
                    SqliteStorageError::QueueInvariant(
                        "lease generation exceeds SQLite INTEGER".to_string(),
                    )
                })?,
                mutation.lease_expires_at_ms,
                mutation.last_error,
                mutation.created_at_ms,
            ],
        )?;
        let sql_id = tx.last_insert_rowid();
        tx.execute(
            "INSERT INTO optimistic_layers (
                 mutation_id, optimistic_data_json, normalized_updates
             ) VALUES (?1, ?2, ?3)",
            params![
                sql_id,
                entry.optimistic.optimistic_data_json,
                encode_record_updates(&entry.optimistic.normalized_updates),
            ],
        )?;
        tx.commit()?;
        mutation_id_from_sql(sql_id)
    }

    async fn load_mutation_queue(&self) -> Result<Vec<QueuedMutation>, Self::Error> {
        let conn = self.conn();
        let mut stmt = conn.prepare_cached(
            "SELECT
                 m.id, m.query, m.operation_name, m.variables_json, m.identity,
                 m.attempt_count, m.next_attempt_at_ms, m.lease_owner,
                 m.lease_generation, m.lease_expires_at_ms, m.last_error,
                 m.created_at_ms, o.optimistic_data_json, o.normalized_updates
             FROM mutation_queue m
             INNER JOIN optimistic_layers o ON o.mutation_id = m.id
             ORDER BY m.id ASC",
        )?;
        let mut rows = stmt.query([])?;
        let mut out = Vec::new();
        while let Some(row) = rows.next()? {
            let id: i64 = row.get(0)?;
            let updates: Vec<u8> = row.get(13)?;
            out.push(QueuedMutation {
                id: mutation_id_from_sql(id)?,
                mutation: row_stored_mutation(row, 1)?,
                optimistic: PersistedOptimisticLayer {
                    optimistic_data_json: row.get(12)?,
                    normalized_updates: decode_record_updates(&updates)?,
                },
            });
        }
        Ok(out)
    }

    async fn queue_diagnostics(&self) -> Result<QueueDiagnostics, Self::Error> {
        let (depth, oldest_created_at_ms): (i64, Option<i64>) = self.conn().query_row(
            "SELECT COUNT(*), MIN(created_at_ms) FROM mutation_queue",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        let depth = u64::try_from(depth).map_err(|_| {
            SqliteStorageError::QueueInvariant("negative mutation queue depth".to_string())
        })?;
        if (depth == 0) != oldest_created_at_ms.is_none() {
            return Err(SqliteStorageError::QueueInvariant(
                "queue depth and oldest timestamp disagree".to_string(),
            ));
        }
        Ok(QueueDiagnostics {
            availability: QueueDiagnosticsAvailability::Available,
            depth,
            oldest_created_at_ms,
        })
    }

    async fn claim_next_mutation(
        &mut self,
        request: MutationClaimRequest,
    ) -> Result<Option<ClaimedMutation>, Self::Error> {
        let mut conn = self.conn();
        let tx = conn.transaction()?;
        let head: Option<(i64, StoredMutation)> = tx
            .query_row(
                "SELECT
                     id, query, operation_name, variables_json, identity,
                     attempt_count, next_attempt_at_ms, lease_owner,
                     lease_generation, lease_expires_at_ms, last_error,
                     created_at_ms
                 FROM mutation_queue
                 ORDER BY id ASC
                 LIMIT 1",
                [],
                |row| Ok((row.get(0)?, row_stored_mutation(row, 1)?)),
            )
            .optional()?;
        let Some((sql_id, mut mutation)) = head else {
            tx.commit()?;
            return Ok(None);
        };
        if mutation
            .next_attempt_at_ms
            .is_some_and(|next| next > request.now_ms)
            || mutation
                .lease_expires_at_ms
                .is_some_and(|expiry| expiry > request.now_ms)
        {
            tx.commit()?;
            return Ok(None);
        }

        mutation.attempt_count = mutation.attempt_count.saturating_add(1);
        mutation.lease_generation = mutation.lease_generation.saturating_add(1);
        mutation.lease_owner = Some(request.owner.clone());
        mutation.lease_expires_at_ms = Some(request.lease_expires_at_ms);
        mutation.next_attempt_at_ms = None;
        tx.execute(
            "UPDATE mutation_queue SET
                 attempt_count = ?2,
                 next_attempt_at_ms = NULL,
                 lease_owner = ?3,
                 lease_generation = ?4,
                 lease_expires_at_ms = ?5
             WHERE id = ?1",
            params![
                sql_id,
                i64::from(mutation.attempt_count),
                mutation.lease_owner,
                i64::try_from(mutation.lease_generation).map_err(|_| {
                    SqliteStorageError::QueueInvariant(
                        "lease generation exceeds SQLite INTEGER".to_string(),
                    )
                })?,
                mutation.lease_expires_at_ms,
            ],
        )?;
        let (optimistic_data_json, updates): (String, Vec<u8>) = tx.query_row(
            "SELECT optimistic_data_json, normalized_updates
             FROM optimistic_layers WHERE mutation_id = ?1",
            params![sql_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        let generation = mutation.lease_generation;
        let queued = QueuedMutation {
            id: mutation_id_from_sql(sql_id)?,
            mutation,
            optimistic: PersistedOptimisticLayer {
                optimistic_data_json,
                normalized_updates: decode_record_updates(&updates)?,
            },
        };
        tx.commit()?;
        Ok(Some(ClaimedMutation {
            queued,
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
        let sql_id = mutation_id_to_sql(id)?;
        let mut conn = self.conn();
        let tx = conn.transaction()?;
        if !claim_is_current(&tx, sql_id, &claim)? {
            tx.commit()?;
            return Ok(false);
        }
        tx.execute(
            "UPDATE mutation_queue SET
                 next_attempt_at_ms = ?2,
                 lease_owner = NULL,
                 lease_expires_at_ms = NULL,
                 last_error = ?3
             WHERE id = ?1",
            params![sql_id, next_attempt_at_ms, error],
        )?;
        tx.commit()?;
        Ok(true)
    }

    async fn complete_mutation(
        &mut self,
        id: MutationId,
        claim: MutationClaimToken,
        entries: Vec<(EntityKey<'static>, Record)>,
    ) -> Result<bool, Self::Error> {
        let sql_id = mutation_id_to_sql(id)?;
        let mut conn = self.conn();
        let tx = conn.transaction()?;
        if !claim_is_current(&tx, sql_id, &claim)? {
            tx.commit()?;
            return Ok(false);
        }
        {
            let mut stmt = tx.prepare_cached(
                "INSERT INTO records (key, value) VALUES (?1, ?2)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            )?;
            for (key, record) in &entries {
                stmt.execute(params![key.0.as_ref(), encode_record(record)])?;
            }
        }
        write_search_documents(&tx, &entries)?;
        tx.execute("DELETE FROM mutation_queue WHERE id = ?1", params![sql_id])?;
        tx.commit()?;
        Ok(true)
    }

    async fn discard_mutation(
        &mut self,
        id: MutationId,
        claim: MutationClaimToken,
    ) -> Result<bool, Self::Error> {
        let sql_id = mutation_id_to_sql(id)?;
        let mut conn = self.conn();
        let tx = conn.transaction()?;
        if !claim_is_current(&tx, sql_id, &claim)? {
            tx.commit()?;
            return Ok(false);
        }
        tx.execute("DELETE FROM mutation_queue WHERE id = ?1", params![sql_id])?;
        tx.commit()?;
        Ok(true)
    }

    async fn clear(&mut self) -> Result<(), Self::Error> {
        let mut conn = self.conn();
        let tx = conn.transaction()?;
        tx.execute("DELETE FROM optimistic_layers", [])?;
        tx.execute("DELETE FROM mutation_queue", [])?;
        tx.execute("DELETE FROM search_documents", [])?;
        tx.execute("DELETE FROM records", [])?;
        tx.commit()?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use cache_core::value::CacheValue;
    use pollster::block_on;

    fn record(name: &str) -> Record {
        let mut r = Record::default();
        r.fields
            .insert("name".into(), CacheValue::String(name.into()));
        r
    }

    fn key(s: &str) -> EntityKey<'static> {
        EntityKey(s.to_string().into())
    }

    #[test]
    fn put_get_delete_roundtrip() {
        block_on(async {
            let mut s = SqliteStorage::open_in_memory("user-1").unwrap();
            s.put_batch(vec![(key("A:1"), record("a")), (key("B:2"), record("b"))])
                .await
                .unwrap();

            let got = s
                .get_batch(&[key("A:1"), key("C:3"), key("B:2")])
                .await
                .unwrap();
            assert_eq!(got[0].as_ref().unwrap(), &record("a"));
            assert!(got[1].is_none());
            assert_eq!(got[2].as_ref().unwrap(), &record("b"));

            // Upsert overwrites.
            s.put_batch(vec![(key("A:1"), record("a2"))]).await.unwrap();
            let got = s.get_batch(&[key("A:1")]).await.unwrap();
            assert_eq!(got[0].as_ref().unwrap(), &record("a2"));

            s.delete_batch(&[key("A:1")]).await.unwrap();
            assert!(s.get_batch(&[key("A:1")]).await.unwrap()[0].is_none());

            s.clear().await.unwrap();
            assert_eq!(s.record_count().unwrap(), 0);
        });
    }

    #[test]
    fn search_projection_is_write_through_and_browse_uses_covering_order_index() {
        block_on(async {
            let mut storage = SqliteStorage::open_in_memory("search").unwrap();
            let mut document = Record::default();
            document.fields.insert(
                "__typename".into(),
                CacheValue::String("GraphqlSoupDocument".into()),
            );
            document
                .fields
                .insert("name".into(), CacheValue::String("Quarterly Plan".into()));
            document.fields.insert(
                "updatedAt".into(),
                CacheValue::Number(cache_core::value::CacheNumber::PosInt(123)),
            );
            storage
                .put_batch(vec![
                    (key("GraphqlSoupDocument:d1"), document.clone()),
                    (key("GraphqlSoupDocument:d2"), document),
                ])
                .await
                .unwrap();

            let columns = {
                let conn = storage.conn();
                let mut statement = conn
                    .prepare("PRAGMA table_info('search_documents')")
                    .unwrap();
                statement
                    .query_map([], |row| row.get::<_, String>(1))
                    .unwrap()
                    .collect::<Result<Vec<_>, _>>()
                    .unwrap()
            };
            assert_eq!(
                columns,
                [
                    "profile",
                    "__typename",
                    "id",
                    "bucket",
                    "search_text",
                    "timestamp_ms",
                    "source_hash",
                ]
            );

            let loaded = storage
                .load_search_documents(SearchProfile::QuickAccessV1)
                .await
                .unwrap();
            assert_eq!(loaded.len(), 2);
            assert!(
                loaded
                    .iter()
                    .all(|document| document.search_text == "quarterly plan")
            );
            let first = storage
                .browse_search_documents(SearchProfile::QuickAccessV1, "document", None, 1)
                .await
                .unwrap();
            assert_eq!(first[0].record_key.as_ref(), "GraphqlSoupDocument:d1");
            let cursor = SearchCursor {
                timestamp_ms: first[0].timestamp_ms,
                record_key: first[0].record_key.clone(),
            };
            let second = storage
                .browse_search_documents(SearchProfile::QuickAccessV1, "document", Some(&cursor), 1)
                .await
                .unwrap();
            assert_eq!(second[0].record_key.as_ref(), "GraphqlSoupDocument:d2");

            let details = {
                let conn = storage.conn();
                let mut plan = conn
                    .prepare(
                        "EXPLAIN QUERY PLAN SELECT __typename, id, bucket, search_text, timestamp_ms, source_hash FROM search_documents WHERE profile = 'quick-access-v1' AND bucket = 'document' ORDER BY timestamp_ms DESC, __typename ASC, id ASC LIMIT 25",
                    )
                    .unwrap();
                plan.query_map([], |row| row.get::<_, String>(3))
                    .unwrap()
                    .collect::<Result<Vec<_>, _>>()
                    .unwrap()
                    .join(" ")
            };
            assert!(
                details.contains("search_documents_browse_idx"),
                "browse query did not use projection index: {details}"
            );
            assert!(!details.contains("records"));

            storage
                .delete_batch(&[key("GraphqlSoupDocument:d2")])
                .await
                .unwrap();
            // Replacing the same base key with an unsearchable record deletes
            // the stale derived row in the same transaction.
            storage
                .put_batch(vec![(key("GraphqlSoupDocument:d1"), Record::default())])
                .await
                .unwrap();
            assert_eq!(storage.search_document_count().unwrap(), 0);
        });
    }

    #[test]
    fn previous_search_schema_is_replaced_without_blob_backfill() {
        let file = tempfile::NamedTempFile::new().unwrap();
        let path = file.path();
        {
            let storage = SqliteStorage::open(path, "search-upgrade").unwrap();
            let conn = storage.conn();
            conn.execute_batch(
                "DROP TABLE search_documents;
                 CREATE TABLE search_documents (
                     profile TEXT NOT NULL,
                     __typename TEXT NOT NULL,
                     id TEXT NOT NULL,
                     entity_type TEXT NOT NULL,
                     bucket TEXT NOT NULL,
                     search_text TEXT NOT NULL,
                     timestamp_ms INTEGER NOT NULL,
                     source_hash TEXT NOT NULL,
                     PRIMARY KEY(profile, __typename, id)
                 );
                 CREATE INDEX search_documents_browse_idx
                     ON search_documents(
                         profile, bucket, timestamp_ms DESC, __typename ASC, id ASC
                     );
                 UPDATE meta SET v = '2' WHERE k = 'search_schema_version';
                 INSERT INTO records(key, value) VALUES ('Thing:stale', X'00');",
            )
            .unwrap();
        }

        let storage = SqliteStorage::open(path, "search-upgrade").unwrap();
        assert_eq!(storage.record_count().unwrap(), 0);
        let columns = {
            let conn = storage.conn();
            let mut statement = conn
                .prepare("PRAGMA table_info('search_documents')")
                .unwrap();
            statement
                .query_map([], |row| row.get::<_, String>(1))
                .unwrap()
                .collect::<Result<Vec<_>, _>>()
                .unwrap()
        };
        assert!(columns.iter().all(|column| column != "record_key"));
        assert!(columns.iter().all(|column| column != "entity_type"));
        assert!(columns.iter().any(|column| column == "__typename"));
        assert!(columns.iter().any(|column| column == "id"));
    }

    #[test]
    fn queue_diagnostics_return_only_depth_and_oldest_timestamp() {
        block_on(async {
            let storage = SqliteStorage::open_in_memory("user-1").unwrap();
            assert_eq!(
                storage.queue_diagnostics().await.unwrap(),
                QueueDiagnostics {
                    availability: QueueDiagnosticsAvailability::Available,
                    depth: 0,
                    oldest_created_at_ms: None,
                }
            );
            storage
                .conn()
                .execute(
                    "INSERT INTO mutation_queue (query, variables_json, created_at_ms) VALUES ('mutation A { a }', '{}', 9), ('mutation B { b }', '{}', 4)",
                    [],
                )
                .unwrap();
            assert_eq!(
                storage.queue_diagnostics().await.unwrap(),
                QueueDiagnostics {
                    availability: QueueDiagnosticsAvailability::Available,
                    depth: 2,
                    oldest_created_at_ms: Some(4),
                }
            );
        });
    }

    #[test]
    fn queue_diagnostics_query_uses_covering_index_at_scale() {
        block_on(async {
            let storage = SqliteStorage::open_in_memory("queue-plan").unwrap();
            storage
                .conn()
                .execute(
                    "WITH RECURSIVE values_to_insert(value) AS (VALUES(1) UNION ALL SELECT value + 1 FROM values_to_insert WHERE value < 10000) INSERT INTO mutation_queue (query, variables_json, created_at_ms) SELECT 'mutation Scale { scale }', '{}', 10001 - value FROM values_to_insert",
                    [],
                )
                .unwrap();
            let details = {
                let conn = storage.conn();
                let mut plan = conn
                    .prepare(
                        "EXPLAIN QUERY PLAN SELECT COUNT(*), MIN(created_at_ms) FROM mutation_queue",
                    )
                    .unwrap();
                plan.query_map([], |row| row.get::<_, String>(3))
                    .unwrap()
                    .collect::<Result<Vec<_>, _>>()
                    .unwrap()
                    .join(" ")
            };
            assert!(
                details.contains("mutation_queue_created_at_ms_idx"),
                "diagnostics query did not use the timestamp index: {details}"
            );
            assert_eq!(
                storage.queue_diagnostics().await.unwrap(),
                QueueDiagnostics {
                    availability: QueueDiagnosticsAvailability::Available,
                    depth: 10_000,
                    oldest_created_at_ms: Some(1),
                }
            );
        });
    }

    #[test]
    fn persists_across_reopen_same_namespace() {
        block_on(async {
            let dir = tempfile::tempdir().unwrap();
            let path = dir.path().join("cache.db");

            let mut s = SqliteStorage::open(&path, "user-1").unwrap();
            s.put_batch(vec![(key("A:1"), record("a"))]).await.unwrap();
            drop(s);

            let s = SqliteStorage::open(&path, "user-1").unwrap();
            let got = s.get_batch(&[key("A:1")]).await.unwrap();
            assert_eq!(got[0].as_ref().unwrap(), &record("a"));
        });
    }

    #[test]
    fn compatibility_epoch_change_wipes_records() {
        block_on(async {
            let dir = tempfile::tempdir().unwrap();
            let path = dir.path().join("cache.db");

            let mut s = SqliteStorage::open(&path, "user-1").unwrap();
            s.put_batch(vec![(key("A:1"), record("a"))]).await.unwrap();
            s.conn()
                .execute(
                    "UPDATE meta SET v = 'graphql-cache:user-1:s0:v2' WHERE k = 'namespace'",
                    [],
                )
                .unwrap();
            drop(s);

            let s = SqliteStorage::open(&path, "user-1").unwrap();
            assert_eq!(s.record_count().unwrap(), 0);
        });
    }

    #[test]
    fn scope_change_wipes() {
        block_on(async {
            let dir = tempfile::tempdir().unwrap();
            let path = dir.path().join("cache.db");

            let mut s = SqliteStorage::open(&path, "user-1").unwrap();
            s.put_batch(vec![(key("A:1"), record("a"))]).await.unwrap();
            drop(s);

            // Different user → wiped.
            let s = SqliteStorage::open(&path, "user-2").unwrap();
            assert_eq!(s.record_count().unwrap(), 0);
        });
    }

    #[test]
    fn works_with_engine() {
        use cache_core::engine::{Engine, ReadResult};
        block_on(async {
            let storage = SqliteStorage::open_in_memory("user-1").unwrap();
            let mut engine = Engine::new(storage);
            let query = r#"query Soup($input: SoupInput!) {
                user { id soup(input: $input) { nextCursor items { __typename id } } }
            }"#;
            let serde_json::Value::Object(vars) = serde_json::json!({"input": {"limit": 1}}) else {
                unreachable!()
            };
            let data = serde_json::json!({
                "user": { "id": "user-1", "soup": { "nextCursor": null, "items": [{"__typename": "GraphqlSoupDocument", "id": "doc-1"}] } }
            });
            engine
                .write_query(None, query, Some("Soup"), &vars, &data, None)
                .await
                .unwrap();
            let ReadResult::Hit { data: cached } = engine
                .read_query(None, query, Some("Soup"), &vars)
                .await
                .unwrap()
            else {
                panic!("expected hit");
            };
            assert_eq!(cached, data);
        });
    }
}
