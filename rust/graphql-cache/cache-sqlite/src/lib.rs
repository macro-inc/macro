//! SQLite [`Storage`] backend for the Tauri native host.
//!
//! One database file per cache; the `meta` table pins the cache namespace
//! (scope + schema hash + format version, see
//! [`cache_core::codec::cache_namespace`]). On mismatch the store is wiped
//! and rebuilt — the cache is disposable by design, never migrated.
//!
//! rusqlite is synchronous; the async [`Storage`] methods complete
//! immediately. That's fine for the Tauri host, which runs the engine on a
//! dedicated thread (blocking IO is the point of the native host).

use cache_core::codec::{cache_namespace, decode_record, encode_record};
use cache_core::store::Storage;
use cache_core::value::{EntityKey, Record};
use rusqlite::{params, Connection, OptionalExtension};
use std::path::Path;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum SqliteStorageError {
    #[error("sqlite: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error(transparent)]
    Codec(#[from] cache_core::codec::CodecError),
}

pub struct SqliteStorage {
    conn: Connection,
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

    fn init(conn: Connection, scope: &str) -> Result<Self, SqliteStorageError> {
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
             CREATE TABLE IF NOT EXISTS records (key TEXT PRIMARY KEY, value BLOB NOT NULL);",
        )?;

        let expected = cache_namespace(scope);
        let stored: Option<String> = conn
            .query_row("SELECT v FROM meta WHERE k = 'namespace'", [], |row| {
                row.get(0)
            })
            .optional()?;
        if stored.as_deref() != Some(expected.as_str()) {
            // Different user, schema or format → disposable rebuild.
            conn.execute("DELETE FROM records", [])?;
            conn.execute(
                "INSERT INTO meta (k, v) VALUES ('namespace', ?1)
                 ON CONFLICT(k) DO UPDATE SET v = excluded.v",
                params![expected],
            )?;
        }
        Ok(SqliteStorage { conn })
    }

    /// Total number of stored records (diagnostics/GC).
    pub fn record_count(&self) -> Result<u64, SqliteStorageError> {
        Ok(self
            .conn
            .query_row("SELECT COUNT(*) FROM records", [], |row| row.get(0))?)
    }
}

impl Storage for SqliteStorage {
    type Error = SqliteStorageError;

    async fn get_batch(&self, keys: &[EntityKey]) -> Result<Vec<Option<Record>>, Self::Error> {
        let mut stmt = self
            .conn
            .prepare_cached("SELECT value FROM records WHERE key = ?1")?;
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
        let tx = self.conn.transaction()?;
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
        let tx = self.conn.transaction()?;
        {
            let mut stmt = tx.prepare_cached("DELETE FROM records WHERE key = ?1")?;
            for key in keys {
                stmt.execute(params![key.0])?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    async fn clear(&mut self) -> Result<(), Self::Error> {
        self.conn.execute("DELETE FROM records", [])?;
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
                soup(input: $input) { nextCursor hasMore items { id } }
            }"#;
            let serde_json::Value::Object(vars) = serde_json::json!({"input": {"limit": 1}}) else {
                unreachable!()
            };
            let data = serde_json::json!({
                "soup": { "nextCursor": null, "hasMore": false, "items": [{"id": "doc-1"}] }
            });
            engine
                .write_query(None, query, Some("Soup"), &vars, &data)
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
