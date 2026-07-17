//! SQLite [`Storage`] backend for the Tauri native host.
//!
//! One database file per cache; the `meta` table pins the cache namespace
//! (scope + schema hash + format version, see
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
use cache_core::store::Storage;
use cache_core::value::{EntityKey, Record};
use rusqlite::{Connection, OptionalExtension, Transaction, params, params_from_iter};
use std::path::Path;
use std::sync::{Mutex, MutexGuard};
use thiserror::Error;

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

        let tx = conn.transaction()?;
        if stored_scope.as_deref() != Some(scope) {
            // Scope changes are identity changes: queued user intent must not
            // cross the boundary. `None` is the one-time upgrade from the
            // pre-queue schema, where no durable mutations existed.
            tx.execute("DELETE FROM optimistic_layers", [])?;
            tx.execute("DELETE FROM mutation_queue", [])?;
            tx.execute("DELETE FROM records", [])?;
        } else if stored_namespace.as_deref() != Some(expected_namespace.as_str()) {
            // Record schema/format changes only invalidate disposable records.
            // The queue retains source GraphQL + optimistic JSON so the engine
            // can re-normalize it against the current schema.
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

    async fn get_batch(&self, keys: &[EntityKey]) -> Result<Vec<Option<Record>>, Self::Error> {
        let conn = self.conn();
        let mut stmt = conn.prepare_cached("SELECT value FROM records WHERE key = ?1")?;
        let mut out = Vec::with_capacity(keys.len());
        for key in keys {
            let bytes: Option<Vec<u8>> = stmt
                .query_row(params![key.0], |row| row.get(0))
                .optional()?;
            out.push(match bytes {
                Some(b) => Some(decode_record(&b)?),
                None => None,
            });
        }
        Ok(out)
    }

    async fn put_batch(&mut self, entries: Vec<(EntityKey, Record)>) -> Result<(), Self::Error> {
        let mut conn = self.conn();
        let tx = conn.transaction()?;
        {
            let mut stmt = tx.prepare_cached(
                "INSERT INTO records (key, value) VALUES (?1, ?2)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            )?;
            for (key, record) in &entries {
                stmt.execute(params![key.0, encode_record(record)])?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    async fn delete_batch(&mut self, keys: &[EntityKey]) -> Result<(), Self::Error> {
        let mut conn = self.conn();
        let tx = conn.transaction()?;
        {
            let mut stmt = tx.prepare_cached("DELETE FROM records WHERE key = ?1")?;
            for key in keys {
                stmt.execute(params![key.0])?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    async fn scan_records(
        &self,
        type_names: &[String],
        after: Option<&EntityKey>,
        limit: usize,
    ) -> Result<Vec<(EntityKey, Record)>, Self::Error> {
        if type_names.is_empty() || limit == 0 {
            return Ok(Vec::new());
        }

        let mut sql = String::from("SELECT key, value FROM records WHERE ");
        let mut values = Vec::<rusqlite::types::Value>::new();
        if let Some(after) = after {
            sql.push_str("key > ? AND ");
            values.push(after.0.clone().into());
        }
        sql.push('(');
        for (index, type_name) in type_names.iter().enumerate() {
            if index > 0 {
                sql.push_str(" OR ");
            }
            sql.push_str("(key >= ? AND key < ?)");
            values.push(format!("{type_name}:").into());
            values.push(format!("{type_name};").into());
        }
        sql.push_str(") ORDER BY key ASC LIMIT ?");
        values.push(i64::try_from(limit).unwrap_or(i64::MAX).into());

        let conn = self.conn();
        let mut statement = conn.prepare(&sql)?;
        let rows = statement.query_map(params_from_iter(values.iter()), |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, Vec<u8>>(1)?))
        })?;
        let mut records = Vec::new();
        for row in rows {
            let (key, value) = row?;
            records.push((EntityKey(key), decode_record(&value)?));
        }
        Ok(records)
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
        entries: Vec<(EntityKey, Record)>,
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
                stmt.execute(params![key.0, encode_record(record)])?;
            }
        }
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

    fn key(s: &str) -> EntityKey {
        EntityKey(s.to_string())
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
    fn scans_selected_record_types_in_key_order() {
        block_on(async {
            let mut storage = SqliteStorage::open_in_memory("user-1").unwrap();
            storage
                .put_batch(vec![
                    (key("TypeB:2"), record("b2")),
                    (key("Other:1"), record("other")),
                    (key("TypeA:2"), record("a2")),
                    (key("TypeA:1"), record("a1")),
                ])
                .await
                .unwrap();

            let first = storage
                .scan_records(&["TypeB".into(), "TypeA".into()], None, 2)
                .await
                .unwrap();
            assert_eq!(
                first
                    .iter()
                    .map(|(key, _)| key.0.as_str())
                    .collect::<Vec<_>>(),
                vec!["TypeA:1", "TypeA:2"]
            );
            let second = storage
                .scan_records(&["TypeA".into(), "TypeB".into()], Some(&first[1].0), 2)
                .await
                .unwrap();
            assert_eq!(
                second
                    .iter()
                    .map(|(key, _)| key.0.as_str())
                    .collect::<Vec<_>>(),
                vec!["TypeB:2"]
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
    fn namespace_change_wipes() {
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
                user { id soup(input: $input) { nextCursor hasMore items { id } } }
            }"#;
            let serde_json::Value::Object(vars) = serde_json::json!({"input": {"limit": 1}}) else {
                unreachable!()
            };
            let data = serde_json::json!({
                "user": { "id": "user-1", "soup": { "nextCursor": null, "hasMore": false, "items": [{"id": "doc-1"}] } }
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
