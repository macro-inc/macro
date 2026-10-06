//! Dependency index: which active operations depend on which records.
//!
//! Operation ids are assigned by the host (the urql exchange uses urql's
//! operation keys). When a write changes records, the engine reports the
//! affected active operations so the host can re-execute them.

use crate::value::EntityKey;
use std::collections::{BTreeSet, HashMap, HashSet};

mod viewer;
pub use viewer::DependencyTracker;
pub(crate) use viewer::{
    QueryDependencies, ViewerFieldUpdate, ViewerFields, changed_viewer_fields,
};

pub type OpId = u64;

#[derive(Debug, Default)]
pub struct DepIndex {
    by_op: HashMap<OpId, BTreeSet<EntityKey<'static>>>,
    by_key: HashMap<EntityKey<'static>, HashSet<OpId>>,
    viewer_fields: HashMap<OpId, ViewerFields>,
    broad_ops: BTreeSet<OpId>,
}

impl DepIndex {
    pub fn new() -> Self {
        Self::default()
    }

    /// Replaces the dependency set of an active operation.
    pub fn set_op_deps(&mut self, op: OpId, deps: BTreeSet<EntityKey<'static>>) {
        // A record-only registration must discard any prior field-level proof,
        // even when its record set is unchanged.
        self.viewer_fields.remove(&op);
        if !self.broad_ops.contains(&op) && self.by_op.get(&op) == Some(&deps) {
            return;
        }
        self.remove_op(op);
        for key in &deps {
            self.by_key.entry(key.clone()).or_default().insert(op);
        }
        self.by_op.insert(op, deps);
    }

    /// Installs viewer-field proof alongside ordinary record dependencies.
    pub(crate) fn set_query_deps(&mut self, op: OpId, deps: QueryDependencies) {
        self.set_op_deps(op, deps.records);
        self.viewer_fields.insert(op, deps.viewer_fields);
    }

    /// Registers an operation conservatively against every visible change.
    pub fn set_op_broad(&mut self, op: OpId) {
        self.remove_op(op);
        self.broad_ops.insert(op);
        self.by_op.insert(op, BTreeSet::new());
    }

    /// Unregisters an operation (urql teardown).
    pub fn remove_op(&mut self, op: OpId) {
        self.broad_ops.remove(&op);
        self.viewer_fields.remove(&op);
        if let Some(old) = self.by_op.remove(&op) {
            for key in old {
                if let Some(set) = self.by_key.get_mut(&key) {
                    set.remove(&op);
                    if set.is_empty() {
                        self.by_key.remove(&key);
                    }
                }
            }
        }
    }

    /// Active operations depending on any of `keys`.
    pub fn ops_for_keys<'a>(
        &self,
        keys: impl IntoIterator<Item = &'a EntityKey<'static>>,
    ) -> BTreeSet<OpId> {
        let mut out = BTreeSet::new();
        let mut saw_key = false;
        for key in keys {
            saw_key = true;
            if let Some(ops) = self.by_key.get(key) {
                out.extend(ops.iter().copied());
            }
        }
        if saw_key {
            out.extend(self.broad_ops.iter().copied());
        }
        out
    }

    /// Narrows viewer changes only when both the reader and writer have field
    /// proof. Missing records, legacy registrations and optimistic mutations
    /// retain the record-wide fallback through `ops_for_keys`.
    pub(crate) fn ops_for_changes(
        &self,
        keys: &BTreeSet<EntityKey<'static>>,
        viewer_changes: &ViewerFields,
    ) -> BTreeSet<OpId> {
        let mut out = BTreeSet::new();
        for key in keys {
            for op in self.by_key.get(key).into_iter().flatten() {
                let watched = self
                    .viewer_fields
                    .get(op)
                    .and_then(|fields| fields.get(key));
                let affected = match (watched, viewer_changes.get(key)) {
                    (Some(watched), Some(changed)) => !watched.is_disjoint(changed),
                    _ => true,
                };
                if affected {
                    out.insert(*op);
                }
            }
        }
        if !keys.is_empty() {
            out.extend(&self.broad_ops);
        }
        out
    }

    /// Keys pinned by at least one active operation (future: eviction).
    pub fn pinned(&self) -> impl Iterator<Item = &EntityKey<'static>> {
        self.by_key.keys()
    }

    pub fn active_ops(&self) -> usize {
        self.by_op.len()
    }

    /// All registered operation ids (cache reset → everything re-executes).
    pub fn all_ops(&self) -> BTreeSet<OpId> {
        self.by_op.keys().copied().collect()
    }
}

#[cfg(test)]
mod test;
