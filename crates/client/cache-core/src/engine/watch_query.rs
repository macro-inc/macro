//! Incremental projections of ordinary GraphQL queries. The read compiler owns
//! aliases, arguments and concrete fragment types; transports only apply paths.
//!
//! Field bindings patch leaf edits without reading. When they cannot (a link,
//! list, tombstone or type change, or a journal barrier), the query is re-read
//! and diffed against the retained response, which is the subscriber's base.

use super::*;
use crate::denormalize::QueryProjection;
use crate::engine::live_query::{LiveFieldPatch, ResponsePathSegment};
use serde::Serialize;
use std::sync::Arc;

mod diff;

const WATCH_CAPACITY: usize = 64;
const WATCH_BYTES: usize = 16 * 1024 * 1024;
// A patch replacing most of the response (a compacted page) saves subscribers
// little, while the engine must copy every replaced value into it. Beyond this
// share a re-read publishes the shared result instead. Small ones always patch.
const MAX_REPLACED_SHARE: usize = 2;
const MIN_REPLACED_BYTES: usize = 16 * 1024;

/// An atomic query read. A patch is applicable only to the exact revision the
/// subscriber supplied; eviction, spec changes and revision mismatches reset it.
#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum QueryUpdate {
    /// Complete replacement, also establishing a new patch base. The watch
    /// shares it as its diff base; serialization is that of the plain JSON.
    Hit {
        #[serde(serialize_with = "serialize_shared")]
        data: Arc<Json>,
        revision: String,
        /// A derived list kept its server evidence because its membership
        /// could not be decided locally; a refetch would settle it.
        #[serde(
            rename = "membershipUnknown",
            skip_serializing_if = "std::ops::Not::not"
        )]
        membership_unknown: bool,
    },
    /// Ordered edits, including an empty update for no change.
    Patch {
        patches: Vec<QueryPatch>,
        revision: String,
        /// As for [`QueryUpdate::Hit`], for the patched result.
        #[serde(
            rename = "membershipUnknown",
            skip_serializing_if = "std::ops::Not::not"
        )]
        membership_unknown: bool,
    },
    /// Required data is missing; the caller must use its normal network policy.
    Miss { revision: String },
}

/// One edit of a watched response. Patches apply in order; a path refers to
/// the response as edited by the preceding patches.
#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum QueryPatch {
    /// Replaces the value at an existing path.
    Set(LiveFieldPatch),
    /// Edits a keyed list in place. Sent only to subscribers that opted in.
    Splice(ListSplice),
}

impl QueryPatch {
    /// Response path of the replaced value or edited list.
    pub fn path(&self) -> &[ResponsePathSegment] {
        match self {
            Self::Set(patch) => &patch.path,
            Self::Splice(splice) => &splice.path,
        }
    }

    /// JSON values carried to the subscriber, for transport checks.
    pub fn values(&self) -> impl Iterator<Item = &Json> {
        let (value, inserted) = match self {
            Self::Set(patch) => (Some(&patch.value), &[][..]),
            Self::Splice(splice) => (None, &splice.splice[..]),
        };
        value
            .into_iter()
            .chain(inserted.iter().filter_map(|op| match op {
                SpliceOp::Insert { value, .. } => Some(value),
                _ => None,
            }))
    }
}

/// In-place edits of the list at `path`. Surviving items keep their response
/// objects, so subscribers retain row state; later patches use new indices.
#[derive(Debug, Serialize)]
pub struct ListSplice {
    /// Path of an existing list.
    pub path: Vec<ResponsePathSegment>,
    /// Operations applied in order.
    pub splice: Vec<SpliceOp>,
}

/// One keyed list operation. Indices refer to the list as already edited.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(untagged)]
pub enum SpliceOp {
    /// Removes the item at `remove`.
    Remove {
        /// Index of the removed item.
        remove: usize,
    },
    /// Inserts `value` at `insert`.
    Insert {
        /// Index the new item takes.
        insert: usize,
        /// Complete selected value of the new item.
        value: Json,
    },
    /// Removes the item at `move`, then inserts it at `to`.
    Move {
        /// Index of the moved item.
        #[serde(rename = "move")]
        from: usize,
        /// Index the item takes after its removal.
        to: usize,
    },
}

/// Capabilities of a watch subscriber.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct WatchOptions {
    /// The subscriber applies [`QueryPatch::Splice`]. Without it, a keyed list
    /// whose membership or order changed is replaced at its own path.
    pub splices: bool,
}

fn serialize_shared<S: serde::Serializer>(
    data: &Arc<Json>,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    data.as_ref().serialize(serializer)
}

#[derive(PartialEq, Eq)]
struct QuerySpec {
    query: String,
    operation_name: Option<String>,
    variables: serde_json::Map<String, Json>,
    entity_resolvers: Vec<EntityResolver>,
    options: WatchOptions,
}

struct QueryWatch {
    spec: QuerySpec,
    projection: QueryProjection,
    base: Base,
    revision: CacheRevision,
    bytes: usize,
    /// The base kept evidence for a list whose membership was unknown.
    membership_unknown: bool,
}

/// The subscriber's result at the watch revision: the base for re-read diffs.
struct Base {
    /// Shared with the last `Hit`; hosts drop theirs once it is encoded.
    data: Arc<Json>,
    bytes: usize,
}

impl QueryWatch {
    fn new(
        spec: QuerySpec,
        projection: QueryProjection,
        base: Base,
        revision: CacheRevision,
        membership_unknown: bool,
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
            membership_unknown,
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
        self.watch_query_with_options(
            op_id,
            query,
            operation_name,
            variables,
            entity_resolvers,
            since,
            WatchOptions::default(),
        )
        .await
    }

    /// [`Self::watch_query`] for a subscriber with the given capabilities.
    #[expect(
        clippy::too_many_arguments,
        reason = "the ordinary query request plus subscriber capabilities"
    )]
    pub async fn watch_query_with_options(
        &mut self,
        op_id: OpId,
        query: &str,
        operation_name: Option<&str>,
        variables: &serde_json::Map<String, Json>,
        entity_resolvers: &[EntityResolver],
        since: Option<CacheRevision>,
        options: WatchOptions,
    ) -> Result<QueryUpdate, EngineError<S::Error>> {
        self.hydrate_optimistic().await?;
        let spec = QuerySpec {
            query: query.to_owned(),
            operation_name: operation_name.map(str::to_owned),
            variables: variables.clone(),
            entity_resolvers: entity_resolvers.to_vec(),
            options,
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
        // A derived list can gain members the bindings have never seen, and
        // can reorder through a bound leaf; re-read before patching leaves.
        if changes
            .records
            .iter()
            .any(|key| view.projection.derives_from(key))
        {
            return self.read_watched(op_id, spec, Some(view.into_base())).await;
        }
        let keys = changes
            .records
            .into_iter()
            .filter(|key| view.projection.binds(key))
            .collect();
        let bases = self.load_bases(&keys).await?;
        let effective = effective_records(&bases, &self.optimistic, &keys);
        let Some((patches, binding_delta)) = view.projection.update(&effective) else {
            return self.read_watched(op_id, spec, Some(view.into_base())).await;
        };
        let Some(data_delta) = diff::apply_patches(Arc::make_mut(&mut view.base.data), &patches)
        else {
            // A binding path missing from the base would desynchronize diffs.
            return self.read_watched(op_id, spec, None).await;
        };
        view.revision = self.revision;
        // Values (especially opaque scalars) may grow between reads.
        view.base.bytes = view.base.bytes.saturating_add_signed(data_delta);
        view.bytes = view.bytes.saturating_add_signed(binding_delta + data_delta);
        let membership_unknown = view.membership_unknown;
        self.query_watches.put(op_id, view);
        Ok(QueryUpdate::Patch {
            patches: patches.into_iter().map(QueryPatch::Set).collect(),
            revision: self.revision.to_string(),
            membership_unknown,
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
        let TrackedRead {
            result,
            projection,
            membership_unknown,
        } = self
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
            return Ok(QueryUpdate::Hit {
                data: Arc::new(data),
                revision,
                membership_unknown,
            });
        };
        let diff = base.and_then(|base| {
            let budget = (base.bytes / MAX_REPLACED_SHARE).max(MIN_REPLACED_BYTES);
            diff::diff_response(&base.data, &data, budget, spec.options.splices)
                .map(|diff| (diff, base.bytes))
        });
        let data = Arc::new(data);
        let (update, bytes) = match diff {
            Some((diff, bytes)) => (
                QueryUpdate::Patch {
                    patches: diff.patches,
                    revision,
                    membership_unknown,
                },
                bytes.saturating_add_signed(diff.byte_delta),
            ),
            None => (
                QueryUpdate::Hit {
                    data: Arc::clone(&data),
                    revision,
                    membership_unknown,
                },
                diff::json_bytes(&data),
            ),
        };
        let base = Base { data, bytes };
        self.query_watches.put(
            op_id,
            QueryWatch::new(spec, projection, base, self.revision, membership_unknown),
        );
        Ok(update)
    }
}

#[cfg(test)]
mod test;
