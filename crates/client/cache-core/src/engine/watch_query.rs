//! Incremental projections of ordinary GraphQL queries. The read compiler owns
//! aliases, arguments and concrete fragment types; transports only apply paths.
//!
//! Field bindings patch leaf edits without reading. When they cannot (a link,
//! list, tombstone or type change, or a journal barrier), the query is re-read
//! and diffed against the retained response, which is the subscriber's base.

use super::*;
use crate::denormalize::QueryProjection;
use crate::engine::live_query::LiveFieldPatch;
use serde::Serialize;

mod diff;

const WATCH_CAPACITY: usize = 64;
// Diff bases add about a fifth to the bindings' estimate. The budget grows to
// match, so as many large watches stay resident as with bindings alone.
const WATCH_BYTES: usize = 20 * 1024 * 1024;
// Subscribers apply a patch that replaces a large subtree (a compacted list)
// slower than a complete result, so beyond this share of the response a
// re-read publishes a replacement instead. Small responses always patch.
const MAX_REPLACED_SHARE: usize = 8;
const MIN_REPLACED_BYTES: usize = 16 * 1024;

/// An atomic query read. A patch is applicable only to the exact revision the
/// subscriber supplied; eviction, spec changes and revision mismatches reset it.
#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum QueryUpdate {
    /// Complete replacement, also establishing a new patch base.
    Hit { data: Json, revision: String },
    /// Selected field replacements, including an empty update for no change.
    Patch {
        patches: Vec<LiveFieldPatch>,
        revision: String,
    },
    /// Required data is missing; the caller must use its normal network policy.
    Miss { revision: String },
}

#[derive(PartialEq, Eq)]
struct QuerySpec {
    query: String,
    operation_name: Option<String>,
    variables: serde_json::Map<String, Json>,
    entity_resolvers: Vec<EntityResolver>,
}

struct QueryWatch {
    spec: QuerySpec,
    projection: QueryProjection,
    base: Base,
    revision: CacheRevision,
    bytes: usize,
}

/// The subscriber's result at the watch revision: the base for re-read diffs.
struct Base {
    data: Json,
    bytes: usize,
}

impl QueryWatch {
    fn new(
        spec: QuerySpec,
        projection: QueryProjection,
        base: Base,
        revision: CacheRevision,
    ) -> Self {
        let bytes = spec.query.len()
            + serde_json::to_vec(&spec.variables).map_or(0, |json| json.len())
            + projection.retained_bytes()
            + base.bytes;
        Self {
            spec,
            projection,
            base,
            revision,
            bytes,
        }
    }

    /// Frees the stale bindings before a re-read compiles new ones, so both are
    /// never resident together.
    fn into_base(self) -> Base {
        self.base
    }
}

pub(super) struct QueryWatches {
    views: LruCache<OpId, QueryWatch>,
    bytes: usize,
}

impl Default for QueryWatches {
    fn default() -> Self {
        Self {
            views: LruCache::new(NonZeroUsize::new(WATCH_CAPACITY).unwrap()),
            bytes: 0,
        }
    }
}

impl QueryWatches {
    fn pop(&mut self, op: OpId) -> Option<QueryWatch> {
        let view = self.views.pop(&op)?;
        self.bytes -= view.bytes;
        Some(view)
    }

    pub(super) fn remove(&mut self, op: OpId) {
        self.pop(op);
    }

    fn put(&mut self, op: OpId, view: QueryWatch) {
        if view.bytes > WATCH_BYTES {
            return;
        }
        while self.bytes + view.bytes > WATCH_BYTES || self.views.len() == WATCH_CAPACITY {
            let Some((_, old)) = self.views.pop_lru() else {
                break;
            };
            self.bytes -= old.bytes;
        }
        self.bytes += view.bytes;
        self.views.put(op, view);
    }
}

impl<S: Storage> Engine<S> {
    /// Watch any cache-readable query using its ordinary document and variables.
    /// The caller owns `op_id` until `teardown_operation`. Retention is bounded;
    /// losing a plan only causes a replacement read, never a missed update.
    pub async fn watch_query(
        &mut self,
        op_id: OpId,
        query: &str,
        operation_name: Option<&str>,
        variables: &serde_json::Map<String, Json>,
        entity_resolvers: &[EntityResolver],
        since: Option<CacheRevision>,
    ) -> Result<QueryUpdate, EngineError<S::Error>> {
        self.hydrate_optimistic().await?;
        let spec = QuerySpec {
            query: query.to_owned(),
            operation_name: operation_name.map(str::to_owned),
            variables: variables.clone(),
            entity_resolvers: entity_resolvers.to_vec(),
        };
        let Some(mut view) = self
            .query_watches
            .pop(op_id)
            .filter(|view| view.spec == spec && Some(view.revision) == since)
        else {
            return self.read_watched(op_id, spec, None).await;
        };
        // A journal barrier cannot say what changed; only a re-read can.
        let Some(changes) = self
            .live_queries
            .changes_since(view.revision, self.revision)
        else {
            return self.read_watched(op_id, spec, Some(view.into_base())).await;
        };
        let keys = changes
            .records
            .into_iter()
            .filter(|key| view.projection.records.contains_key(key))
            .collect();
        let bases = self.load_bases(&keys).await?;
        let effective = effective_records(&bases, &self.optimistic, &keys);
        let Some((patches, binding_delta)) = view.projection.update(&effective) else {
            return self.read_watched(op_id, spec, Some(view.into_base())).await;
        };
        let Some(data_delta) = diff::apply_patches(&mut view.base.data, &patches) else {
            // A binding path missing from the base would desynchronize diffs.
            return self.read_watched(op_id, spec, None).await;
        };
        view.revision = self.revision;
        // Values (especially opaque scalars) may grow between reads.
        view.base.bytes = view.base.bytes.saturating_add_signed(data_delta);
        view.bytes = view.bytes.saturating_add_signed(binding_delta + data_delta);
        self.query_watches.put(op_id, view);
        Ok(QueryUpdate::Patch {
            patches,
            revision: self.revision.to_string(),
        })
    }

    /// Reads the whole query and recompiles its bindings. With the subscriber's
    /// base it publishes a diff, falling back to a replacement for a new root.
    async fn read_watched(
        &mut self,
        op_id: OpId,
        spec: QuerySpec,
        base: Option<Base>,
    ) -> Result<QueryUpdate, EngineError<S::Error>> {
        let (result, projection) = self
            .read_query_tracked(
                Some(op_id),
                &spec.query,
                spec.operation_name.as_deref(),
                &spec.variables,
                &spec.entity_resolvers,
                true,
            )
            .await?;
        let revision = self.revision.to_string();
        let ReadResult::Hit { data } = result else {
            return Ok(QueryUpdate::Miss { revision });
        };
        let Some(projection) = projection else {
            return Ok(QueryUpdate::Hit { data, revision });
        };
        let diff = base.and_then(|base| {
            let budget = (base.bytes / MAX_REPLACED_SHARE).max(MIN_REPLACED_BYTES);
            diff::diff_response(&base.data, &data, budget).map(|diff| (diff, base.bytes))
        });
        let (update, bytes) = match diff {
            Some((diff, bytes)) => (
                QueryUpdate::Patch {
                    patches: diff.patches,
                    revision,
                },
                bytes.saturating_add_signed(diff.byte_delta),
            ),
            None => (
                QueryUpdate::Hit {
                    data: data.clone(),
                    revision,
                },
                diff::json_bytes(&data),
            ),
        };
        let base = Base { data, bytes };
        self.query_watches.put(
            op_id,
            QueryWatch::new(spec, projection, base, self.revision),
        );
        Ok(update)
    }
}

#[cfg(test)]
mod test;
