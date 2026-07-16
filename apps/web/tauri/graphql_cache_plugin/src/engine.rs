//! Engine host: the cache engine + SQLite storage behind an async mutex.
//!
//! `cache-core`'s `Storage` futures are `MaybeSend` — `Send` on native
//! targets — so the engine is driven directly from the tauri/tokio runtime;
//! the async mutex serializes commands the same way the browser worker's
//! queue does. SQLite work completes immediately (blocking IO is the point
//! of the native host), so holding a runtime thread through it is fine.
//!
//! Operation ids cross the IPC boundary as strings (`"{clientId}:{urqlKey}"`)
//! so multiple webviews can register operations against the one shared
//! engine without collisions; they're interned to the engine's `u64` ids
//! internally — the same scheme as the `cache-wasm` shell.

use cache_core::deps::OpId;
use cache_core::engine::{BeginOptimisticWrite, Engine, ReadResult, WriteResult};
use cache_core::link_patch::{OptimisticLinkPatch, QueryRevalidation};
use cache_core::query_inspection::{CachedQueryInstance, QueryInspection};
use cache_core::queue::{ClaimedMutation, MutationClaimRequest, MutationClaimToken};
use cache_core::value::EntityKey;
use cache_sqlite::SqliteStorage;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

/// Mirrors `ReadResult` in `apps/web/src/lib/graphql-cache/protocol.ts`.
#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ReadResultWire {
    /// Fully answerable from cache.
    Hit {
        /// Denormalized response data.
        data: serde_json::Value,
    },
    /// Not answerable; the exchange forwards to the network.
    Miss,
}

/// Mirrors `WriteResult` in `apps/web/src/lib/graphql-cache/protocol.ts`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteResultWire {
    /// Entity keys whose records changed.
    pub changed: Vec<String>,
    /// Registered operation ids affected by the change (origin excluded).
    pub affected_ops: Vec<String>,
    /// True when the identity witness wiped and rebound the cache before
    /// this write (silent restart).
    pub reset: bool,
    /// Queries to fetch after successful optimistic settlement.
    pub revalidations: Vec<QueryRevalidation>,
}

/// Mirrors `OptimisticWriteResult` in
/// `apps/web/src/lib/graphql-cache/protocol.ts`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OptimisticWriteResultWire {
    /// Engine-assigned id; settle with commit/rollback. A string because JS
    /// numbers lose precision past 2^53 (same as the wasm shell).
    pub transaction_id: String,
    /// Visible (composed-view) changes — nothing is durable until commit.
    #[serde(flatten)]
    pub result: WriteResultWire,
}

/// Claimed queue head returned to the JavaScript mutation runner.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimedMutationWire {
    /// Durable mutation id.
    pub transaction_id: String,
    /// Claim generation required for settlement.
    pub lease_generation: String,
    /// GraphQL mutation document.
    pub query: String,
    /// Selected operation name.
    pub operation_name: Option<String>,
    /// Variables parsed from their durable canonical JSON representation.
    pub variables: serde_json::Value,
    /// Identity witness captured when the mutation was enqueued.
    pub identity: Option<String>,
    /// Number of network attempts including this claim.
    pub attempt_count: u32,
}

impl TryFrom<ClaimedMutation> for ClaimedMutationWire {
    type Error = String;

    fn try_from(claimed: ClaimedMutation) -> Result<Self, Self::Error> {
        let request = claimed.queued.mutation.request;
        Ok(Self {
            transaction_id: claimed.queued.id.to_string(),
            lease_generation: claimed.lease_generation.to_string(),
            query: request.query,
            operation_name: request.operation_name,
            variables: serde_json::from_str(&request.variables_json).map_err(|e| e.to_string())?,
            identity: request.identity,
            attempt_count: claimed.queued.mutation.attempt_count,
        })
    }
}

/// Interns host-side string operation ids to engine `u64` ids.
#[derive(Default)]
struct OpInterner {
    by_name: HashMap<String, OpId>,
    by_id: HashMap<OpId, String>,
    next: OpId,
}

impl OpInterner {
    fn intern(&mut self, name: &str) -> OpId {
        if let Some(id) = self.by_name.get(name) {
            return *id;
        }
        self.next += 1;
        let id = self.next;
        self.by_name.insert(name.to_string(), id);
        self.by_id.insert(id, name.to_string());
        id
    }

    fn remove(&mut self, name: &str) -> Option<OpId> {
        let id = self.by_name.remove(name)?;
        self.by_id.remove(&id);
        Some(id)
    }

    fn names(&self, ids: impl IntoIterator<Item = OpId>) -> Vec<String> {
        ids.into_iter()
            .filter_map(|id| self.by_id.get(&id).cloned())
            .collect()
    }
}

type Variables = serde_json::Map<String, serde_json::Value>;

struct EngineState {
    engine: Engine<SqliteStorage>,
    ops: OpInterner,
}

/// Cheaply-clonable handle to the shared engine. All methods serialize
/// through the async mutex; errors are stringified for the IPC boundary
/// (the JS host rejects the pending call, and the exchange degrades to the
/// network).
#[derive(Clone)]
pub struct EngineHandle {
    inner: Arc<Mutex<EngineState>>,
}

fn wire_write_result(ops: &OpInterner, result: WriteResult) -> WriteResultWire {
    WriteResultWire {
        changed: result.changed.into_iter().map(|k| k.0).collect(),
        affected_ops: ops.names(result.affected_ops),
        reset: result.reset,
        revalidations: result.revalidations,
    }
}

fn parse_u64(value: &str, label: &str) -> Result<u64, String> {
    value
        .parse::<u64>()
        .map_err(|_| format!("invalid {label} `{value}`"))
}

fn parse_transaction_id(id: &str) -> Result<u64, String> {
    parse_u64(id, "optimistic transaction id")
}

impl EngineHandle {
    /// Wraps an opened storage backend. A `hot_capacity` of 0 is treated as
    /// unset (engine default).
    pub fn new(storage: SqliteStorage, hot_capacity: Option<u32>) -> Self {
        let engine = match hot_capacity.filter(|c| *c > 0) {
            Some(cap) => Engine::with_capacity(storage, cap as usize),
            None => Engine::new(storage),
        };
        EngineHandle {
            inner: Arc::new(Mutex::new(EngineState {
                engine,
                ops: OpInterner::default(),
            })),
        }
    }

    /// Cache read; registers `op_id` as active when given.
    pub async fn read(
        &self,
        op_id: Option<String>,
        query: String,
        operation_name: Option<String>,
        variables: Variables,
    ) -> Result<ReadResultWire, String> {
        let mut state = self.inner.lock().await;
        let EngineState { engine, ops } = &mut *state;
        let op = op_id.map(|name| ops.intern(&name));
        engine
            .read_query(op, &query, operation_name.as_deref(), &variables)
            .await
            .map(|result| match result {
                ReadResult::Hit { data } => ReadResultWire::Hit { data },
                ReadResult::Miss => ReadResultWire::Miss,
            })
            .map_err(|e| e.to_string())
    }

    /// Enumerates cached variants of one generated query field.
    pub async fn inspect_query(
        &self,
        query: String,
        operation_name: Option<String>,
        path: Vec<String>,
    ) -> Result<Vec<CachedQueryInstance>, String> {
        self.inner
            .lock()
            .await
            .engine
            .inspect_query(&QueryInspection {
                query,
                operation_name,
                path,
            })
            .await
            .map_err(|error| error.to_string())
    }

    /// Normalizes and stores a network response.
    pub async fn write(
        &self,
        origin_op_id: Option<String>,
        query: String,
        operation_name: Option<String>,
        variables: Variables,
        data: serde_json::Value,
        identity: Option<String>,
    ) -> Result<WriteResultWire, String> {
        let mut state = self.inner.lock().await;
        let EngineState { engine, ops } = &mut *state;
        let origin = origin_op_id.map(|name| ops.intern(&name));
        engine
            .write_query(
                origin,
                &query,
                operation_name.as_deref(),
                &variables,
                &data,
                identity.as_deref(),
            )
            .await
            .map(|result| wire_write_result(ops, result))
            .map_err(|e| e.to_string())
    }

    /// Durably queues a mutation and its optimistic layer.
    pub async fn begin_optimistic_write(
        &self,
        origin_op_id: Option<String>,
        query: String,
        operation_name: Option<String>,
        variables: Variables,
        data: serde_json::Value,
        link_patches: Vec<OptimisticLinkPatch>,
        revalidations: Vec<QueryRevalidation>,
        created_at_ms: i64,
    ) -> Result<OptimisticWriteResultWire, String> {
        let mut state = self.inner.lock().await;
        let EngineState { engine, ops } = &mut *state;
        let origin = origin_op_id.map(|name| ops.intern(&name));
        engine
            .begin_optimistic_write(
                origin,
                BeginOptimisticWrite {
                    query: &query,
                    operation_name: operation_name.as_deref(),
                    variables: &variables,
                    data: &data,
                    link_patches: &link_patches,
                    revalidations: &revalidations,
                    created_at_ms,
                },
            )
            .await
            .map(|(transaction, result)| OptimisticWriteResultWire {
                transaction_id: transaction.to_string(),
                result: wire_write_result(ops, result),
            })
            .map_err(|e| e.to_string())
    }

    /// Claims the strict mutation queue head when it is runnable.
    pub async fn claim_next_mutation(
        &self,
        owner: String,
        now_ms: i64,
        lease_expires_at_ms: i64,
    ) -> Result<Option<ClaimedMutationWire>, String> {
        let mut state = self.inner.lock().await;
        state
            .engine
            .claim_next_mutation(MutationClaimRequest {
                owner,
                now_ms,
                lease_expires_at_ms,
            })
            .await
            .map_err(|e| e.to_string())?
            .map(ClaimedMutationWire::try_from)
            .transpose()
    }

    /// Retains a retryable mutation and releases its claim.
    pub async fn defer_optimistic_write(
        &self,
        transaction_id: String,
        lease_owner: String,
        lease_generation: String,
        next_attempt_at_ms: i64,
        error: String,
    ) -> Result<(), String> {
        let transaction = parse_transaction_id(&transaction_id)?;
        let claim = MutationClaimToken {
            owner: lease_owner,
            generation: parse_u64(&lease_generation, "lease generation")?,
        };
        self.inner
            .lock()
            .await
            .engine
            .defer_optimistic_write(transaction, claim, next_attempt_at_ms, error)
            .await
            .map_err(|e| e.to_string())
    }

    /// Replaces a claimed optimistic layer with the real network response.
    pub async fn commit_optimistic_write(
        &self,
        transaction_id: String,
        lease_owner: String,
        lease_generation: String,
        query: String,
        operation_name: Option<String>,
        variables: Variables,
        data: serde_json::Value,
    ) -> Result<WriteResultWire, String> {
        let transaction = parse_transaction_id(&transaction_id)?;
        let claim = MutationClaimToken {
            owner: lease_owner,
            generation: parse_u64(&lease_generation, "lease generation")?,
        };
        let mut state = self.inner.lock().await;
        let EngineState { engine, ops } = &mut *state;
        engine
            .commit_optimistic_write(
                transaction,
                claim,
                &query,
                operation_name.as_deref(),
                &variables,
                &data,
            )
            .await
            .map(|result| wire_write_result(ops, result))
            .map_err(|e| e.to_string())
    }

    /// Permanently fails a claimed mutation and drops its optimistic layer.
    pub async fn rollback_optimistic_write(
        &self,
        transaction_id: String,
        lease_owner: String,
        lease_generation: String,
    ) -> Result<WriteResultWire, String> {
        let transaction = parse_transaction_id(&transaction_id)?;
        let claim = MutationClaimToken {
            owner: lease_owner,
            generation: parse_u64(&lease_generation, "lease generation")?,
        };
        let mut state = self.inner.lock().await;
        let EngineState { engine, ops } = &mut *state;
        engine
            .rollback_optimistic_write(transaction, claim)
            .await
            .map(|result| wire_write_result(ops, result))
            .map_err(|e| e.to_string())
    }

    /// Evicts records by entity key; returns the affected registered op ids.
    pub async fn invalidate(&self, keys: Vec<String>) -> Result<Vec<String>, String> {
        let keys: Vec<EntityKey> = keys.into_iter().map(EntityKey).collect();
        let mut state = self.inner.lock().await;
        let EngineState { engine, ops } = &mut *state;
        let affected = engine.invalidate_keys(keys.iter());
        Ok(ops.names(affected))
    }

    /// Unregisters an operation (urql teardown).
    pub async fn teardown(&self, op_id: String) -> Result<(), String> {
        let mut state = self.inner.lock().await;
        let EngineState { engine, ops } = &mut *state;
        if let Some(id) = ops.remove(&op_id) {
            engine.teardown_operation(id);
        }
        Ok(())
    }

    /// Drops all cached state (logout).
    pub async fn clear(&self) -> Result<(), String> {
        let mut state = self.inner.lock().await;
        state.engine.clear().await.map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod test;
