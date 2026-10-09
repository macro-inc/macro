//! Maintained fragment views over the existing predicate index.
//!
//! The engine retains row projections and their dependencies. Writes invalidate
//! only dependent rows; projection changes reevaluate indexed membership. A read
//! publishes one coherent delta, including rollback, at the engine revision.

use super::*;
use serde::Serialize;
use std::{collections::VecDeque, sync::Arc};

const VIEW_CAPACITY: usize = 32;
const JOURNAL_CAPACITY: usize = 128;

pub(super) type RowDependencies = BTreeMap<EntityKey<'static>, BTreeSet<EntityKey<'static>>>;

/// A bounded server baseline plus a locally executable filter and projection.
#[derive(Clone, PartialEq, Eq)]
pub struct LiveQuerySpec {
    /// Validated filtering, ordering, and candidate limit.
    pub query: ValidatedIndexQuery,
    /// Positive membership evidence for this exact server query.
    pub baseline: Vec<PredicateBaselineEntry>,
    /// Selected fields, including nested normalized records.
    pub selection: Arc<RecordSelection>,
}

/// Changes since the subscriber's last accepted view revision.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveQueryUpdate {
    /// Exact engine revision observed by this atomic read.
    pub revision: String,
    /// The subscriber must discard previous rows (first read, eviction or gap).
    pub reset: bool,
    /// New display order; omitted when membership and order did not change.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub keys: Option<Vec<PredicateRecordKey>>,
    /// Changed or newly materialized rows. Unchanged projections are omitted.
    pub upserts: Vec<SelectedRecord>,
    /// Field changes within already materialized rows, using response paths.
    pub patches: Vec<LiveRowPatch>,
    /// Previously materialized rows that no longer have a complete projection.
    pub removed: Vec<EntityKey<'static>>,
    /// Baseline members whose current predicate cannot be evaluated safely.
    pub retained_keys: Vec<PredicateRecordKey>,
    /// Whether optimistic projection state contributes to membership.
    pub optimistic: bool,
}

/// A response object property or list index (aliases are already resolved).
#[derive(Debug, Clone, Serialize)]
#[serde(untagged)]
pub enum ResponsePathSegment {
    /// Object property.
    Field(String),
    /// Array position.
    Index(usize),
}

/// Replacement of one value inside a selected record.
#[derive(Debug, Serialize)]
pub struct LiveFieldPatch {
    /// Path relative to the selected record; empty replaces the whole record.
    pub path: Vec<ResponsePathSegment>,
    /// Current effective value after all optimistic layers.
    pub value: Json,
}

/// Field and identity metadata changes for one already-visible record.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveRowPatch {
    /// Canonical normalized key.
    pub record_key: EntityKey<'static>,
    /// Replacements applied atomically in response order.
    pub fields: Vec<LiveFieldPatch>,
    /// Current queue identity metadata.
    pub identity: identity::IdentityStatus,
}

fn diff_fields(
    before: &Json,
    after: &Json,
    path: &mut Vec<ResponsePathSegment>,
    out: &mut Vec<LiveFieldPatch>,
) {
    if before == after {
        return;
    }
    match (before, after) {
        (Json::Object(before), Json::Object(after))
            if before.keys().all(|key| after.contains_key(key)) =>
        {
            for (key, value) in after {
                path.push(ResponsePathSegment::Field(key.clone()));
                if let Some(previous) = before.get(key) {
                    diff_fields(previous, value, path, out);
                } else {
                    out.push(LiveFieldPatch {
                        path: path.clone(),
                        value: value.clone(),
                    });
                }
                path.pop();
            }
        }
        (Json::Array(before), Json::Array(after))
            if before.len() == after.len()
                && before
                    .iter()
                    .zip(after)
                    .all(|(a, b)| a.get("id") == b.get("id")) =>
        {
            for (index, (a, b)) in before.iter().zip(after).enumerate() {
                path.push(ResponsePathSegment::Index(index));
                diff_fields(a, b, path, out);
                path.pop();
            }
        }
        _ => out.push(LiveFieldPatch {
            path: path.clone(),
            value: after.clone(),
        }),
    }
}

#[derive(Default)]
pub(super) struct Changes {
    pub records: BTreeSet<EntityKey<'static>>,
    pub projections: BTreeSet<PredicateRecordKey>,
}

struct View {
    spec: LiveQuerySpec,
    revision: CacheRevision,
    membership: PredicateReconciliation,
    rows: BTreeMap<EntityKey<'static>, SelectedRecord>,
    dependencies: RowDependencies,
    dependents: BTreeMap<EntityKey<'static>, BTreeSet<EntityKey<'static>>>,
}

impl View {
    fn replace_dependencies(
        &mut self,
        root: &EntityKey<'static>,
        next: Option<BTreeSet<EntityKey<'static>>>,
    ) {
        if let Some(previous) = self.dependencies.remove(root) {
            for key in previous {
                if let Some(roots) = self.dependents.get_mut(&key) {
                    roots.remove(root);
                    if roots.is_empty() {
                        self.dependents.remove(&key);
                    }
                }
            }
        }
        if let Some(next) = next {
            for key in &next {
                self.dependents
                    .entry(key.clone())
                    .or_default()
                    .insert(root.clone());
            }
            self.dependencies.insert(root.clone(), next);
        }
    }
}

pub(super) struct LiveQueries {
    views: LruCache<String, View>,
    // None is a conservative barrier (reset, external invalidation, or a write
    // that failed after advancing its revision). Never infer an empty change.
    journal: VecDeque<(CacheRevision, Option<Changes>)>,
}

impl Default for LiveQueries {
    fn default() -> Self {
        Self {
            views: LruCache::new(NonZeroUsize::new(VIEW_CAPACITY).unwrap()),
            journal: VecDeque::new(),
        }
    }
}

impl LiveQueries {
    pub(super) fn advance(&mut self, revision: CacheRevision) {
        self.journal.push_back((revision, None));
        if self.journal.len() > JOURNAL_CAPACITY {
            self.journal.pop_front();
        }
    }

    pub(super) fn record(&mut self, revision: CacheRevision, changes: Changes) {
        if let Some((last, entry)) = self.journal.back_mut()
            && *last == revision
        {
            *entry = Some(changes);
        }
    }

    pub(super) fn extend(
        &mut self,
        revision: CacheRevision,
        records: impl IntoIterator<Item = EntityKey<'static>>,
        projections: impl IntoIterator<Item = PredicateRecordKey>,
    ) {
        if let Some((last, Some(entry))) = self.journal.back_mut()
            && *last == revision
        {
            entry.records.extend(records);
            entry.projections.extend(projections);
        }
    }

    pub(super) fn changes_since(
        &self,
        since: CacheRevision,
        now: CacheRevision,
    ) -> Option<Changes> {
        let mut cursor = since;
        let mut changes = Changes::default();
        for (revision, entry) in self
            .journal
            .iter()
            .filter(|(revision, _)| *revision > since)
        {
            if cursor.checked_successor()? != *revision {
                return None;
            }
            let entry = entry.as_ref()?;
            changes.records.extend(entry.records.iter().cloned());
            changes
                .projections
                .extend(entry.projections.iter().cloned());
            cursor = *revision;
        }
        (cursor == now).then_some(changes)
    }
}

impl<S: PredicateIndexStorage> Engine<S> {
    /// Maintains an ordered fragment view under a caller-owned subscription id.
    ///
    /// Reusing an id with a different spec produces a full replacement. A stale
    /// subscriber revision also gets a replacement, never an inapplicable delta.
    /// Views are bounded and evictable; no correctness depends on their retention.
    pub async fn read_live_query(
        &mut self,
        id: &str,
        spec: LiveQuerySpec,
        since: Option<CacheRevision>,
    ) -> Result<LiveQueryUpdate, EngineError<S::Error>> {
        if id.len() > 128 || id.is_empty() {
            return Err(RecordSelectionError::InvalidKey.into());
        }
        self.hydrate_optimistic().await?;
        let old = self
            .live_queries
            .views
            .pop(id)
            .filter(|view| view.spec == spec);
        let changes = old.as_ref().and_then(|view| {
            self.live_queries
                .changes_since(view.revision, self.revision)
        });
        let reset = old.as_ref().is_none_or(|view| Some(view.revision) != since);
        let membership = if let (Some(old), Some(changes)) = (&old, &changes)
            && changes.projections.is_empty()
        {
            old.membership.clone()
        } else {
            self.reconcile_predicate_index(&spec.query, &spec.baseline)
                .await?
                .value
        };
        let order_changed = reset
            || old
                .as_ref()
                .is_none_or(|view| view.membership.keys != membership.keys);
        let mut view = old.unwrap_or_else(|| View {
            spec: spec.clone(),
            revision: self.revision,
            membership: membership.clone(),
            rows: BTreeMap::new(),
            dependencies: BTreeMap::new(),
            dependents: BTreeMap::new(),
        });
        let keys: BTreeSet<_> = membership
            .keys
            .iter()
            .map(|key| EntityKey(key.as_str().to_owned().into()))
            .collect();
        let mut dirty = BTreeSet::new();
        if let Some(changes) = &changes {
            for changed in &changes.records {
                dirty.extend(view.dependents.get(changed).into_iter().flatten().cloned());
            }
            // New members have never been projected, including members that
            // were formerly outside a bounded candidate page.
            dirty.extend(
                keys.iter()
                    .filter(|key| !view.dependencies.contains_key(*key))
                    .cloned(),
            );
        } else {
            dirty.extend(keys.iter().cloned());
        }
        dirty.retain(|key| keys.contains(key));
        let removed_members: Vec<_> = view
            .dependencies
            .keys()
            .filter(|key| !keys.contains(*key))
            .cloned()
            .collect();
        let mut removed = Vec::new();
        for key in removed_members {
            view.replace_dependencies(&key, None);
            if view.rows.remove(&key).is_some() {
                removed.push(key);
            }
        }
        let mut upserts = Vec::new();
        let mut patches = Vec::new();
        let dirty: Vec<_> = dirty.into_iter().collect();
        for chunk in dirty.chunks(MAX_RECORD_SELECTION_KEYS) {
            let (selected, mut tracked) = self.read_records_tracked(&spec.selection, chunk).await?;
            let mut selected: BTreeMap<_, _> = selected
                .into_iter()
                .map(|row| (row.record_key.clone(), row))
                .collect();
            for key in chunk {
                view.replace_dependencies(key, tracked.remove(key));
                match selected.remove(key) {
                    Some(row) => {
                        if view.rows.get(key) != Some(&row) {
                            if let Some(previous) = view.rows.get(key) {
                                let mut fields = Vec::new();
                                diff_fields(
                                    &previous.record,
                                    &row.record,
                                    &mut Vec::new(),
                                    &mut fields,
                                );
                                patches.push(LiveRowPatch {
                                    record_key: key.clone(),
                                    fields,
                                    identity: row.identity.clone(),
                                });
                            } else {
                                upserts.push(row.clone());
                            }
                            view.rows.insert(key.clone(), row);
                        }
                    }
                    None => {
                        if view.rows.remove(key).is_some() {
                            removed.push(key.clone());
                        }
                    }
                }
            }
        }
        if reset {
            upserts = view.rows.values().cloned().collect();
            removed.clear();
            patches.clear();
        }
        let result = LiveQueryUpdate {
            revision: self.revision.to_string(),
            reset,
            keys: order_changed.then(|| membership.keys.clone()),
            upserts,
            patches,
            removed,
            retained_keys: membership.retained_keys.clone(),
            optimistic: membership.optimistic,
        };
        view.membership = membership;
        view.revision = self.revision;
        self.live_queries.views.put(id.to_owned(), view);
        Ok(result)
    }

    /// Releases the in-memory view; persisted records and mutations are unaffected.
    pub fn release_live_query(&mut self, id: &str) {
        self.live_queries.views.pop(id);
    }
}

#[cfg(test)]
mod test;

pub(super) fn projection_keys(layers: &[OptimisticLayer]) -> BTreeSet<PredicateRecordKey> {
    layers
        .iter()
        .flat_map(|layer| &layer.projection_mutations)
        .map(|mutation| mutation.record_key().clone())
        .collect()
}
