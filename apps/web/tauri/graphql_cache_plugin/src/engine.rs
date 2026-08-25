//! Engine host: the cache engine + Turso storage behind an async mutex.
//!
//! `cache-core`'s `Storage` futures are `MaybeSend` — `Send` on native
//! targets — so the engine is driven directly from the tauri/tokio runtime;
//! the async mutex serializes commands the same way the browser worker's
//! queue does. Turso work completes immediately on its native synchronous IO
//! driver, so holding a runtime thread through it is fine.
//!
//! Operation ids cross the IPC boundary as strings (`"{clientId}:{urqlKey}"`)
//! so multiple webviews can register operations against the one shared
//! engine without collisions; they're interned to the engine's `u64` ids
//! internally — the same scheme as the `cache-wasm` shell.

use cache_core::deps::OpId;
use cache_core::engine::{
    BeginOptimisticWrite, Engine, InitialClaimOutcome, NetworkWrite, QueryRegistration, ReadResult,
    WriteResult,
};
use cache_core::entity_resolver::EntityResolver;
use cache_core::link_patch::{OptimisticLinkPatch, QueryRevalidation};
use cache_core::query_inspection::{CachedQueryInstance, CachedQueryVariant, QueryInspection};
use cache_core::queue::{ClaimedMutation, MutationClaimRequest, MutationClaimToken};
use cache_core::record_selection::{RecordSelection, SelectedRecord};
use cache_core::revision::CacheRevision;
use cache_core::search::{SearchPage, SearchRequest};
use cache_core::value::EntityKey;
use cache_turso::{TursoStorage, TursoStorageCloseOutcome};
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
    /// Effective-view revision installed by this logical mutation.
    pub revision: String,
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

/// Internal hydration result used to fan out changes before returning only
/// the caller-visible projection across IPC.
pub struct HydrationWriteResultWire {
    /// Cache changes required for host notifications.
    pub write_result: WriteResultWire,
    /// Fields not marked `@cacheOnly`, or `None` when there are none.
    pub data: Option<serde_json::Value>,
}

/// Revision-qualified normalized record selection result.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordSelectionResultWire {
    /// Revision observed by record selection.
    pub revision: String,
    /// Selected normalized records.
    pub records: Vec<SelectedRecord>,
}

/// Revision-qualified affected operation ids.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AffectedOperationsResultWire {
    /// Revision installed by the invalidation or deletion.
    pub revision: String,
    /// Registered operation ids affected by the change.
    pub affected_ops: Vec<String>,
}

/// Result of durably enqueueing an optimistic mutation and attempting to
/// claim the strict queue head.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnqueueOptimisticMutationResultWire {
    /// Engine-assigned id; settle with commit/rollback. A string because JS
    /// numbers lose precision past 2^53 (same as the wasm shell).
    pub transaction_id: String,
    /// Visible composed-view changes caused by the new optimistic layer.
    #[serde(flatten)]
    pub result: WriteResultWire,
    /// Claim outcome determined before cache-change events are emitted.
    pub initial_claim: InitialMutationClaimWire,
}

/// Tagged outcome of the initial strict-head claim attempt.
#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum InitialMutationClaimWire {
    /// The strict queue head was durably leased.
    Claimed {
        /// Mutation request and lease metadata for the claimed head.
        mutation: ClaimedMutationWire,
    },
    /// The queue head is currently leased, deferred, or absent.
    NotRunnable,
    /// Enqueue succeeded, but the claim attempt failed.
    Failed {
        /// Diagnostic claim error.
        error: String,
    },
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

/// Optional active-query registration installed by a network write.
pub struct WriteRegistration {
    /// Host operation id.
    pub op_id: String,
    /// Synthetic read relations used by the query.
    pub entity_resolvers: Vec<EntityResolver>,
}

/// Owned inputs for a network response write.
pub struct WriteRequest {
    /// Origin operation excluded from immediate invalidation.
    pub origin_op_id: Option<String>,
    /// Active query registration to install.
    pub registration: Option<WriteRegistration>,
    /// GraphQL document.
    pub query: String,
    /// Selected operation name.
    pub operation_name: Option<String>,
    /// Operation variables.
    pub variables: Variables,
    /// GraphQL response data.
    pub data: serde_json::Value,
    /// Opaque identity witness.
    pub identity: Option<String>,
}

struct EngineState {
    engine: Engine<TursoStorage>,
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
        revision: result.revision.to_string(),
        changed: result
            .changed
            .into_iter()
            .map(|key| key.0.into_owned())
            .collect(),
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
    pub fn new(storage: TursoStorage, hot_capacity: Option<u32>) -> Self {
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

    /// Consumes the sole handle and explicitly closes native Turso storage.
    pub fn shutdown(self) -> Result<(), String> {
        let mutex = Arc::try_unwrap(self.inner)
            .map_err(|_| "graphql cache still has active command handles".to_string())?;
        let state = mutex.into_inner();
        let outcome = state
            .engine
            .into_storage()
            .try_close()
            .map_err(|error| error.to_string())?;
        match outcome {
            TursoStorageCloseOutcome::Healthy | TursoStorageCloseOutcome::ResetRequired(_) => {
                Ok(())
            }
        }
    }

    /// Returns the current in-memory cache revision.
    pub async fn current_revision(&self) -> CacheRevision {
        self.inner.lock().await.engine.current_revision()
    }

    /// Cache read; registers `op_id` as active when given.
    pub async fn read(
        &self,
        op_id: Option<String>,
        query: String,
        operation_name: Option<String>,
        variables: Variables,
        entity_resolvers: Vec<EntityResolver>,
    ) -> Result<ReadResultWire, String> {
        let mut state = self.inner.lock().await;
        let EngineState { engine, ops } = &mut *state;
        let op = op_id.map(|name| ops.intern(&name));
        engine
            .read_query_with_entity_resolvers(
                op,
                &query,
                operation_name.as_deref(),
                &variables,
                &entity_resolvers,
            )
            .await
            .map(|result| match result {
                ReadResult::Hit { data } => ReadResultWire::Hit { data },
                ReadResult::Miss => ReadResultWire::Miss,
            })
            .map_err(|e| e.to_string())
    }

    /// Projects explicit normalized entity keys without scanning storage.
    pub async fn read_records_by_keys(
        &self,
        document: String,
        fragment_name: String,
        keys: Vec<String>,
    ) -> Result<RecordSelectionResultWire, String> {
        let selection =
            RecordSelection::parse(&document, &fragment_name).map_err(|error| error.to_string())?;
        let keys: Vec<_> = keys.into_iter().map(|key| EntityKey(key.into())).collect();
        self.inner
            .lock()
            .await
            .engine
            .read_records_by_keys(&selection, &keys)
            .await
            .map(|result| RecordSelectionResultWire {
                revision: result.revision.to_string(),
                records: result.value,
            })
            .map_err(|error| error.to_string())
    }

    /// Searches the compact materialized projection without record scans.
    pub async fn search(&self, request: SearchRequest) -> Result<SearchPage, String> {
        self.inner
            .lock()
            .await
            .engine
            .search(&request)
            .await
            .map_err(|error| error.to_string())
    }

    /// Recovers cached query variables without materializing each variant.
    pub async fn inspect_query_variants(
        &self,
        query: String,
        operation_name: Option<String>,
        path: Vec<String>,
    ) -> Result<Vec<CachedQueryVariant>, String> {
        self.inner
            .lock()
            .await
            .engine
            .inspect_query_variants(&QueryInspection {
                query,
                operation_name,
                path,
                variable_filters: Vec::new(),
            })
            .await
            .map_err(|error| error.to_string())
    }

    /// Enumerates and materializes cached variants of one generated query field.
    pub async fn inspect_query(
        &self,
        query: String,
        operation_name: Option<String>,
        path: Vec<String>,
        variable_filters: Vec<serde_json::Map<String, serde_json::Value>>,
    ) -> Result<Vec<CachedQueryInstance>, String> {
        self.inner
            .lock()
            .await
            .engine
            .inspect_query(&QueryInspection {
                query,
                operation_name,
                path,
                variable_filters,
            })
            .await
            .map_err(|error| error.to_string())
    }

    /// Normalizes and stores a network response.
    pub async fn write(&self, request: WriteRequest) -> Result<WriteResultWire, String> {
        let WriteRequest {
            origin_op_id,
            registration,
            query,
            operation_name,
            variables,
            data,
            identity,
        } = request;
        let mut state = self.inner.lock().await;
        let EngineState { engine, ops } = &mut *state;
        let origin = origin_op_id.map(|name| ops.intern(&name));
        let registration = registration.map(|registration| {
            let op_id = ops.intern(&registration.op_id);
            (op_id, registration.entity_resolvers)
        });
        engine
            .write_query_with_registration(
                origin,
                registration
                    .as_ref()
                    .map(|(op_id, entity_resolvers)| QueryRegistration {
                        op_id: *op_id,
                        entity_resolvers,
                    }),
                NetworkWrite {
                    query: &query,
                    operation_name: operation_name.as_deref(),
                    variables: &variables,
                    data: &data,
                    identity: identity.as_deref(),
                },
            )
            .await
            .map(|result| wire_write_result(ops, result))
            .map_err(|e| e.to_string())
    }

    /// Stores a query response and returns only fields not marked
    /// `@cacheOnly`.
    pub async fn hydrate_query(
        &self,
        query: String,
        operation_name: Option<String>,
        variables: Variables,
        data: serde_json::Value,
        identity: Option<String>,
    ) -> Result<HydrationWriteResultWire, String> {
        let mut state = self.inner.lock().await;
        let EngineState { engine, ops } = &mut *state;
        engine
            .hydrate_query(
                &query,
                operation_name.as_deref(),
                &variables,
                &data,
                identity.as_deref(),
            )
            .await
            .map(|result| HydrationWriteResultWire {
                write_result: wire_write_result(ops, result.write_result),
                data: result.data,
            })
            .map_err(|error| error.to_string())
    }

    /// Durably queues a mutation and its optimistic layer, then attempts to
    /// claim the strict queue head while retaining the same engine lock.
    #[allow(clippy::too_many_arguments)]
    pub async fn enqueue_optimistic_mutation(
        &self,
        origin_op_id: Option<String>,
        query: String,
        operation_name: Option<String>,
        variables: Variables,
        data: serde_json::Value,
        link_patches: Vec<OptimisticLinkPatch>,
        revalidations: Vec<QueryRevalidation>,
        created_at_ms: i64,
        lease_owner: String,
        now_ms: i64,
        lease_expires_at_ms: i64,
    ) -> Result<EnqueueOptimisticMutationResultWire, String> {
        let mut state = self.inner.lock().await;
        let EngineState { engine, ops } = &mut *state;
        let origin = origin_op_id.map(|name| ops.intern(&name));
        let result = engine
            .enqueue_optimistic_mutation(
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
                MutationClaimRequest {
                    owner: lease_owner,
                    now_ms,
                    lease_expires_at_ms,
                },
            )
            .await
            .map_err(|error| error.to_string())?;
        let initial_claim = match result.initial_claim {
            InitialClaimOutcome::Claimed(claimed) => InitialMutationClaimWire::Claimed {
                mutation: ClaimedMutationWire::try_from(*claimed)?,
            },
            InitialClaimOutcome::NotRunnable => InitialMutationClaimWire::NotRunnable,
            InitialClaimOutcome::Failed(error) => InitialMutationClaimWire::Failed {
                error: error.to_string(),
            },
        };
        Ok(EnqueueOptimisticMutationResultWire {
            transaction_id: result.transaction_id.to_string(),
            result: wire_write_result(ops, result.write_result),
            initial_claim,
        })
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
    pub async fn invalidate(
        &self,
        keys: Vec<String>,
    ) -> Result<AffectedOperationsResultWire, String> {
        let keys: Vec<EntityKey<'static>> =
            keys.into_iter().map(|key| EntityKey(key.into())).collect();
        let mut state = self.inner.lock().await;
        let EngineState { engine, ops } = &mut *state;
        let affected = engine
            .invalidate_keys(keys.iter())
            .map_err(|error| error.to_string())?;
        Ok(AffectedOperationsResultWire {
            revision: affected.revision.to_string(),
            affected_ops: ops.names(affected.value),
        })
    }

    /// Deletes stale records from durable and hot storage and returns the
    /// registered operations that traversed them.
    pub async fn delete_records(
        &self,
        keys: Vec<String>,
    ) -> Result<AffectedOperationsResultWire, String> {
        let keys: Vec<EntityKey<'static>> =
            keys.into_iter().map(|key| EntityKey(key.into())).collect();
        let mut state = self.inner.lock().await;
        let EngineState { engine, ops } = &mut *state;
        let affected = engine.delete_keys(&keys).await.map_err(|e| e.to_string())?;
        Ok(AffectedOperationsResultWire {
            revision: affected.revision.to_string(),
            affected_ops: ops.names(affected.value),
        })
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
    pub async fn clear(&self) -> Result<CacheRevision, String> {
        let mut state = self.inner.lock().await;
        state.engine.clear().await.map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod test;
