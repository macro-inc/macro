//! Incremental projections of ordinary GraphQL queries. The read compiler owns
//! aliases, arguments and concrete fragment types; transports only apply paths.

use super::*;
use crate::denormalize::QueryProjection;
use crate::engine::live_query::LiveFieldPatch;
use serde::Serialize;

const WATCH_CAPACITY: usize = 64;
const WATCH_BYTES: usize = 16 * 1024 * 1024;

/// An atomic query read. A patch is applicable only to the exact revision the
/// subscriber supplied; eviction, structural edits and revision gaps reset it.
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
    revision: CacheRevision,
    bytes: usize,
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
        let previous = self.query_watches.pop(op_id);
        if let Some(mut view) = previous
            && view.spec == spec
            && Some(view.revision) == since
            && let Some(changes) = self
                .live_queries
                .changes_since(view.revision, self.revision)
        {
            let keys = changes
                .records
                .into_iter()
                .filter(|key| view.projection.records.contains_key(key))
                .collect();
            let bases = self.load_bases(&keys).await?;
            let effective = effective_records(&bases, &self.optimistic, &keys);
            if let Some((patches, byte_delta)) = view.projection.update(&effective) {
                view.revision = self.revision;
                // Values (especially opaque scalars) may grow between reads.
                view.bytes = view.bytes.saturating_add_signed(byte_delta);
                self.query_watches.put(op_id, view);
                return Ok(QueryUpdate::Patch {
                    patches,
                    revision: self.revision.to_string(),
                });
            }
        }
        let (result, projection) = self
            .read_query_tracked(
                Some(op_id),
                query,
                operation_name,
                variables,
                entity_resolvers,
                true,
            )
            .await?;
        let revision = self.revision.to_string();
        match result {
            ReadResult::Hit { data } => {
                if let Some(projection) = projection {
                    let bytes = projection.retained_bytes()
                        + spec.query.len()
                        + serde_json::to_vec(&spec.variables).map_or(0, |json| json.len());
                    self.query_watches.put(
                        op_id,
                        QueryWatch {
                            spec,
                            projection,
                            revision: self.revision,
                            bytes,
                        },
                    );
                }
                Ok(QueryUpdate::Hit { data, revision })
            }
            ReadResult::Miss => Ok(QueryUpdate::Miss { revision }),
        }
    }
}

#[cfg(test)]
mod test;
