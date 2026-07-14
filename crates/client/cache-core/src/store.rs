//! Storage abstraction: the cold tier behind the in-memory hot tier.
//!
//! Implementations: in-memory (tests, Phase 1), IndexedDB via the `idb`
//! crate (browser, Phase 2), SQLite (Tauri native, Phase 2). Futures are
//! [`MaybeSend`]: `Send` on native targets (so hosts can drive the engine
//! from a multi-threaded runtime), unbounded on wasm — wasm futures aren't
//! `Send`.

use crate::value::{EntityKey, Record};
use maybe_send::MaybeSend;
use std::collections::HashMap;
use std::convert::Infallible;

/// Async KV over normalized records. Batch-oriented by design: the engine
/// issues one `get_batch` per denormalization round, never per record.
pub trait Storage: MaybeSend {
    type Error: std::error::Error + MaybeSend + 'static;

    /// Fetches records; result is aligned with `keys` (`None` = absent).
    fn get_batch(
        &self,
        keys: &[EntityKey],
    ) -> impl Future<Output = Result<Vec<Option<Record>>, Self::Error>> + MaybeSend;

    /// Upserts records atomically (all-or-nothing per batch).
    fn put_batch(
        &mut self,
        entries: Vec<(EntityKey, Record)>,
    ) -> impl Future<Output = Result<(), Self::Error>> + MaybeSend;

    /// Deletes records (absent keys are ignored).
    fn delete_batch(
        &mut self,
        keys: &[EntityKey],
    ) -> impl Future<Output = Result<(), Self::Error>> + MaybeSend;

    /// Drops everything (logout / corruption rebuild).
    fn clear(&mut self) -> impl Future<Output = Result<(), Self::Error>> + MaybeSend;
}

/// Hash-map storage for tests and as the Phase 1 default.
#[derive(Debug, Default)]
pub struct InMemoryStorage {
    records: HashMap<EntityKey, Record>,
}

impl InMemoryStorage {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn len(&self) -> usize {
        self.records.len()
    }

    pub fn is_empty(&self) -> bool {
        self.records.is_empty()
    }
}

impl Storage for InMemoryStorage {
    type Error = Infallible;

    async fn get_batch(&self, keys: &[EntityKey]) -> Result<Vec<Option<Record>>, Self::Error> {
        Ok(keys.iter().map(|k| self.records.get(k).cloned()).collect())
    }

    async fn put_batch(&mut self, entries: Vec<(EntityKey, Record)>) -> Result<(), Self::Error> {
        for (k, v) in entries {
            self.records.insert(k, v);
        }
        Ok(())
    }

    async fn delete_batch(&mut self, keys: &[EntityKey]) -> Result<(), Self::Error> {
        for k in keys {
            self.records.remove(k);
        }
        Ok(())
    }

    async fn clear(&mut self) -> Result<(), Self::Error> {
        self.records.clear();
        Ok(())
    }
}
