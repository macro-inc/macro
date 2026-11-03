//! Conservative invalidation proofs for displayed predicate windows.
//!
//! This uses the same complete record/projection journal as maintained views.
//! Search bucket hints are deliberately irrelevant: property and nested-record
//! changes must participate even when they do not affect search.
use super::*;
use crate::value::CacheValue;

pub(super) struct WindowObservation {
    revision: CacheRevision,
    query: ValidatedIndexQuery,
    keys: BTreeSet<EntityKey<'static>>,
    boundary: Option<(i64, PredicateRecordKey)>,
    dependencies: BTreeSet<EntityKey<'static>>,
    bound: BTreeSet<EntityKey<'static>>,
    fields: BTreeMap<(EntityKey<'static>, String), Option<CacheValue>>,
}

pub(super) struct WindowObservations {
    windows: LruCache<String, WindowObservation>,
    next_id: u64,
    instance: Uuid,
}

impl Default for WindowObservations {
    fn default() -> Self {
        Self {
            windows: LruCache::new(NonZeroUsize::new(64).expect("nonzero observation capacity")),
            next_id: 0,
            instance: Uuid::new_v4(),
        }
    }
}

impl<S: Storage> Engine<S> {
    /// Registers a displayed indexed window. The boundary must be a proven
    /// full-window cutoff; omit it for partial or uncertain membership.
    /// Selection reads bind recursive record dependencies before proofs apply.
    pub fn observe_predicate_window(
        &mut self,
        query: ValidatedIndexQuery,
        keys: &[PredicateRecordKey],
        boundary: Option<(i64, PredicateRecordKey)>,
        dependencies: BTreeSet<EntityKey<'static>>,
    ) -> String {
        let id = self.next_window_id();
        self.install_window_observation(id.clone(), query, keys, boundary, dependencies, false);
        id
    }

    /// Adds a field-level input to the window's compiled predicate. Unrelated
    /// fields of a catalog record must not invalidate that predicate. Bind the
    /// exact compile-input value before releasing the engine for another write.
    pub fn observe_window_field(
        &mut self,
        id: &str,
        key: EntityKey<'static>,
        field: String,
        value: Option<CacheValue>,
    ) {
        if let Some(window) = self.window_observations.windows.get_mut(id) {
            window.fields.insert((key, field), value);
        }
    }

    fn next_window_id(&mut self) -> String {
        self.window_observations.next_id += 1;
        format!(
            "{}:{}",
            self.window_observations.instance, self.window_observations.next_id
        )
    }

    fn install_window_observation(
        &mut self,
        id: String,
        query: ValidatedIndexQuery,
        keys: &[PredicateRecordKey],
        boundary: Option<(i64, PredicateRecordKey)>,
        dependencies: BTreeSet<EntityKey<'static>>,
        bound: bool,
    ) {
        self.window_observations.windows.put(
            id,
            WindowObservation {
                revision: self.revision,
                query,
                keys: keys
                    .iter()
                    .map(|key| EntityKey(key.as_str().to_owned().into()))
                    .collect(),
                boundary,
                dependencies,
                fields: BTreeMap::new(),
                bound: if bound {
                    keys.iter()
                        .map(|key| EntityKey(key.as_str().to_owned().into()))
                        .collect()
                } else {
                    BTreeSet::new()
                },
            },
        );
    }

    pub(super) fn bind_window_dependencies(
        &mut self,
        keys: &[EntityKey<'static>],
        dependencies: &live_query::RowDependencies,
    ) {
        for (_, window) in self.window_observations.windows.iter_mut() {
            for key in keys {
                if !window.keys.contains(key) {
                    continue;
                }
                window.bound.insert(key.clone());
                window.dependencies.insert(key.clone());
                if let Some(read) = dependencies.get(key) {
                    window.dependencies.extend(read.iter().cloned());
                }
            }
        }
    }
}

impl<S: PredicateIndexStorage> Engine<S> {
    /// IDs whose displayed membership and selected-record dependencies are
    /// proven unchanged. Missing IDs always mean unknown, never unchanged.
    pub async fn unchanged_observed_windows(
        &mut self,
    ) -> Result<Vec<String>, EngineError<S::Error>> {
        // Optimistic composition can shadow authoritative facts. Keep its
        // existing conservative invalidations rather than checking bare bases.
        if !self.optimistic.is_empty() {
            return Ok(Vec::new());
        }
        let mut candidates = Vec::new();
        let mut projection_keys = BTreeSet::new();
        let mut record_keys = BTreeSet::new();
        for (id, window) in &self.window_observations.windows {
            if !window.keys.is_subset(&window.bound) {
                continue;
            }
            let Some(changes) = self
                .live_queries
                .changes_since(window.revision, self.revision)
            else {
                continue;
            };
            if changes
                .records
                .iter()
                .any(|key| window.dependencies.contains(key))
                || changes.projections.iter().any(|key| {
                    window
                        .keys
                        .contains(&EntityKey(key.as_str().to_owned().into()))
                        || window
                            .dependencies
                            .contains(&EntityKey(key.as_str().to_owned().into()))
                })
            {
                continue;
            }
            record_keys.extend(
                window
                    .fields
                    .keys()
                    .filter_map(|(key, _)| changes.records.contains(key).then_some(key.clone())),
            );
            projection_keys.extend(changes.projections.iter().cloned());
            candidates.push((id, window, changes));
        }
        let projection_keys: Vec<_> = projection_keys.into_iter().collect();
        let states = if projection_keys.is_empty() {
            Vec::new()
        } else {
            self.storage
                .load_projection_states(&projection_keys)
                .await
                .map_err(EngineError::Storage)?
        };
        let states: HashMap<_, _> = projection_keys.into_iter().zip(states).collect();
        let record_keys: Vec<_> = record_keys.into_iter().collect();
        let records = if record_keys.is_empty() {
            Vec::new()
        } else {
            self.storage
                .get_batch(&record_keys)
                .await
                .map_err(EngineError::Storage)?
        };
        let records: HashMap<_, _> = record_keys.into_iter().zip(records).collect();
        let unchanged: Vec<_> = candidates
            .into_iter()
            .filter_map(|(id, window, changes)| {
                let field_changed = window.fields.iter().any(|((key, field), value)| {
                    if !changes.records.contains(key) {
                        return false;
                    }
                    let Some(Some(record)) = records.get(key) else {
                        return true;
                    };
                    record.fields.get(field) != value.as_ref()
                });
                if field_changed {
                    return None;
                }
                let may_enter = changes.projections.iter().any(|key| {
                    let Some(state) = states.get(key) else {
                        return true;
                    };
                    let Some(state) = state else {
                        return false;
                    };
                    if !window
                        .query
                        .includes_scope(state.profile(), state.partition())
                    {
                        return false;
                    }
                    let ProjectionState::Complete(document) = state else {
                        return true;
                    };
                    let query = window.query.as_query();
                    if !query.partitions.iter().any(|part| {
                        part.partition == document.partition && document.matches(&part.predicate)
                    }) {
                        return false;
                    }
                    let value = document
                        .sort_facts
                        .iter()
                        .find(|fact| fact.attribute == query.sort_attribute)
                        .map(|fact| fact.value);
                    match (value, &window.boundary) {
                        (Some(value), Some((edge, edge_key))) => {
                            !window.query.sorts_after((value, key), (*edge, edge_key))
                        }
                        _ => true,
                    }
                });
                (!may_enter).then(|| id.clone())
            })
            .collect();
        for id in &unchanged {
            if let Some(window) = self.window_observations.windows.get_mut(id) {
                window.revision = self.revision;
            }
        }
        Ok(unchanged)
    }

    pub(super) async fn observe_live_query_window(
        &mut self,
        spec: &live_query::LiveQuerySpec,
        membership: &PredicateReconciliation,
        dependencies: &live_query::RowDependencies,
    ) -> Result<String, EngineError<S::Error>> {
        let mut boundary = None;
        if membership.retained_keys.is_empty()
            && membership.keys.len() >= usize::from(spec.query.as_query().limit)
            && let Some(key) = membership.keys.last()
        {
            let states = self
                .storage
                .load_projection_states(std::slice::from_ref(key))
                .await
                .map_err(EngineError::Storage)?;
            if let Some(Some(ProjectionState::Complete(document))) = states.first() {
                boundary = document
                    .sort_facts
                    .iter()
                    .find(|fact| fact.attribute == spec.query.as_query().sort_attribute)
                    .map(|fact| (fact.value, key.clone()));
            }
        }
        let id = self.next_window_id();
        self.install_window_observation(
            id.clone(),
            spec.query.clone(),
            &membership.keys,
            boundary,
            dependencies
                .values()
                .flatten()
                .cloned()
                .chain(
                    membership
                        .keys
                        .iter()
                        .map(|key| EntityKey(key.as_str().to_owned().into())),
                )
                .chain(
                    spec.baseline
                        .iter()
                        .map(|entry| EntityKey(entry.record_key.as_str().to_owned().into())),
                )
                .collect(),
            true,
        );
        Ok(id)
    }
}
