//! The cache engine: ties documents, normalization, the hot tier, storage
//! and dependency tracking together behind the API the hosts (wasm worker /
//! Tauri) expose over RPC.

use crate::denormalize::{denormalize, DenormalizeError, ReadOutcome, RecordSource};
use crate::deps::{DepIndex, OpId};
use crate::document::{Document, DocumentError};
use crate::normalize::{normalize, NormalizeError};
use crate::store::Storage;
use crate::value::{EntityKey, Record};
use lru::LruCache;
use serde_json::Value as Json;
use std::collections::{BTreeSet, HashMap};
use std::num::NonZeroUsize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum EngineError<S: std::error::Error + 'static> {
    #[error(transparent)]
    Document(#[from] DocumentError),
    #[error(transparent)]
    Normalize(#[from] NormalizeError),
    #[error(transparent)]
    Denormalize(#[from] DenormalizeError),
    #[error("storage: {0}")]
    Storage(#[source] S),
}

/// Result of a cache read.
#[derive(Debug)]
pub enum ReadResult {
    /// Fully answerable from cache.
    Hit { data: Json },
    /// Not answerable; forward to the network.
    Miss,
}

/// Result of writing a network response.
#[derive(Debug)]
pub struct WriteResult {
    /// Records whose contents changed.
    pub changed: BTreeSet<EntityKey>,
    /// Active operations depending on changed records (host re-executes
    /// these). Excludes the operation that performed the write.
    pub affected_ops: BTreeSet<OpId>,
}

/// Default hot-tier capacity (records, not bytes — byte budgets are a
/// hardening-phase refinement).
pub const DEFAULT_HOT_CAPACITY: usize = 10_000;

pub struct Engine<S: Storage> {
    storage: S,
    hot: LruCache<EntityKey, Record>,
    docs: HashMap<String, Document>,
    deps: DepIndex,
}

impl<S: Storage> Engine<S> {
    pub fn new(storage: S) -> Self {
        Self::with_capacity(storage, DEFAULT_HOT_CAPACITY)
    }

    pub fn with_capacity(storage: S, hot_capacity: usize) -> Self {
        Engine {
            storage,
            hot: LruCache::new(NonZeroUsize::new(hot_capacity).expect("capacity > 0")),
            docs: HashMap::new(),
            deps: DepIndex::new(),
        }
    }

    /// Attempts to answer a query from cache. When `op_id` is given the
    /// operation is registered as active with the dependencies it touched
    /// (hit *or* miss — a miss still re-executes when its records change).
    pub async fn read_query(
        &mut self,
        op_id: Option<OpId>,
        query: &str,
        operation_name: Option<&str>,
        variables: &serde_json::Map<String, Json>,
    ) -> Result<ReadResult, EngineError<S::Error>> {
        let doc = Self::document(&mut self.docs, query)?;
        let op = doc.operation(operation_name)?;

        let mut overlay: HashMap<EntityKey, Record> = HashMap::new();
        let mut known_absent: BTreeSet<EntityKey> = BTreeSet::new();
        let mut deps = BTreeSet::new();

        let outcome = loop {
            deps.clear();
            let source = EngineSource {
                hot: &self.hot,
                overlay: &overlay,
            };
            match denormalize(op, variables, &source, &mut deps)? {
                ReadOutcome::Complete(data) => break ReadResult::Hit { data },
                ReadOutcome::Miss { .. } => break ReadResult::Miss,
                ReadOutcome::NeedRecords(missing) => {
                    let to_fetch: Vec<EntityKey> = missing
                        .into_iter()
                        .filter(|k| !known_absent.contains(k) && !overlay.contains_key(k))
                        .collect();
                    if to_fetch.is_empty() {
                        // Everything missing is genuinely absent → miss.
                        break ReadResult::Miss;
                    }
                    let fetched = self
                        .storage
                        .get_batch(&to_fetch)
                        .await
                        .map_err(EngineError::Storage)?;
                    for (key, record) in to_fetch.into_iter().zip(fetched) {
                        match record {
                            Some(r) => {
                                overlay.insert(key, r);
                            }
                            None => {
                                known_absent.insert(key);
                            }
                        }
                    }
                }
            }
        };

        // Promote overlay records into the hot tier and refresh recency of
        // everything this operation touched.
        for (key, record) in overlay {
            self.hot.put(key, record);
        }
        for key in &deps {
            let _ = self.hot.get(key);
        }
        if let Some(op_id) = op_id {
            self.deps.set_op_deps(op_id, deps);
        }
        Ok(outcome)
    }

    /// Normalizes and stores a network response. Returns changed records and
    /// the affected active operations (excluding `origin_op`).
    pub async fn write_query(
        &mut self,
        origin_op: Option<OpId>,
        query: &str,
        operation_name: Option<&str>,
        variables: &serde_json::Map<String, Json>,
        data: &Json,
    ) -> Result<WriteResult, EngineError<S::Error>> {
        let doc = Self::document(&mut self.docs, query)?;
        let op = doc.operation(operation_name)?;
        let updates = normalize(op, variables, data)?;

        // Load current values (hot tier, then storage) so merges detect real
        // changes.
        let keys: Vec<EntityKey> = updates.keys().cloned().collect();
        let mut missing_from_hot: Vec<EntityKey> = Vec::new();
        for key in &keys {
            if !self.hot.contains(key) {
                missing_from_hot.push(key.clone());
            }
        }
        if !missing_from_hot.is_empty() {
            let fetched = self
                .storage
                .get_batch(&missing_from_hot)
                .await
                .map_err(EngineError::Storage)?;
            for (key, record) in missing_from_hot.into_iter().zip(fetched) {
                if let Some(r) = record {
                    self.hot.put(key, r);
                }
            }
        }

        let mut changed = BTreeSet::new();
        let mut to_persist: Vec<(EntityKey, Record)> = Vec::new();
        for (key, update) in updates {
            let merged = match self.hot.get_mut(&key) {
                Some(existing) => {
                    if existing.merge(update) {
                        changed.insert(key.clone());
                    }
                    existing.clone()
                }
                None => {
                    changed.insert(key.clone());
                    self.hot.put(key.clone(), update.clone());
                    update
                }
            };
            to_persist.push((key, merged));
        }

        // Persist every touched record (idempotent for unchanged ones —
        // keeps storage authoritative even if the hot tier evicted them
        // between loads).
        self.storage
            .put_batch(to_persist)
            .await
            .map_err(EngineError::Storage)?;

        let mut affected_ops = self.deps.ops_for_keys(changed.iter());
        if let Some(origin) = origin_op {
            affected_ops.remove(&origin);
        }
        Ok(WriteResult {
            changed,
            affected_ops,
        })
    }

    /// Unregisters an active operation (urql teardown).
    pub fn teardown_operation(&mut self, op_id: OpId) {
        self.deps.remove_op(op_id);
    }

    /// Handles records changed *outside* this engine instance (another tab's
    /// engine in the dedicated-worker fallback topology, or push-driven
    /// invalidation): evicts them from the hot tier so the next read hits
    /// storage, and returns the local active operations that depend on them.
    pub fn invalidate_keys<'k>(
        &mut self,
        keys: impl IntoIterator<Item = &'k EntityKey>,
    ) -> BTreeSet<OpId> {
        let mut affected = BTreeSet::new();
        for key in keys {
            self.hot.pop(key);
            affected.extend(self.deps.ops_for_keys([key]));
        }
        affected
    }

    /// Drops all cached state (logout, schema-hash mismatch).
    pub async fn clear(&mut self) -> Result<(), EngineError<S::Error>> {
        self.hot.clear();
        self.deps = DepIndex::new();
        self.storage.clear().await.map_err(EngineError::Storage)
    }

    pub fn active_ops(&self) -> usize {
        self.deps.active_ops()
    }

    /// Memoized document parse. Takes the map (not `&mut self`) so callers
    /// can keep the returned borrow while using other engine fields.
    fn document<'d>(
        docs: &'d mut HashMap<String, Document>,
        query: &str,
    ) -> Result<&'d Document, DocumentError> {
        use std::collections::hash_map::Entry;
        match docs.entry(query.to_string()) {
            Entry::Occupied(e) => Ok(e.into_mut()),
            Entry::Vacant(e) => Ok(e.insert(Document::parse(query)?)),
        }
    }
}

/// Read view over hot tier + per-read overlay. Uses `peek` (no recency
/// mutation) — recency is refreshed once per read from the dep set.
struct EngineSource<'a> {
    hot: &'a LruCache<EntityKey, Record>,
    overlay: &'a HashMap<EntityKey, Record>,
}

impl RecordSource for EngineSource<'_> {
    fn get(&self, key: &EntityKey) -> Option<&Record> {
        self.overlay.get(key).or_else(|| self.hot.peek(key))
    }
}
