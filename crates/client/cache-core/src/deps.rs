//! Dependency index: which active operations depend on which records.
//!
//! Operation ids are assigned by the host (the urql exchange uses urql's
//! operation keys). When a write changes records, the engine reports the
//! affected active operations so the host can re-execute them.

use crate::value::EntityKey;
use std::collections::{BTreeSet, HashMap, HashSet};

pub type OpId = u64;

#[derive(Debug, Default)]
pub struct DepIndex {
    by_op: HashMap<OpId, BTreeSet<EntityKey>>,
    by_key: HashMap<EntityKey, HashSet<OpId>>,
}

impl DepIndex {
    pub fn new() -> Self {
        Self::default()
    }

    /// Replaces the dependency set of an active operation.
    pub fn set_op_deps(&mut self, op: OpId, deps: BTreeSet<EntityKey>) {
        self.remove_op(op);
        for key in &deps {
            self.by_key.entry(key.clone()).or_default().insert(op);
        }
        self.by_op.insert(op, deps);
    }

    /// Unregisters an operation (urql teardown).
    pub fn remove_op(&mut self, op: OpId) {
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
        keys: impl IntoIterator<Item = &'a EntityKey>,
    ) -> BTreeSet<OpId> {
        let mut out = BTreeSet::new();
        for key in keys {
            if let Some(ops) = self.by_key.get(key) {
                out.extend(ops.iter().copied());
            }
        }
        out
    }

    /// Keys pinned by at least one active operation (future: eviction).
    pub fn pinned(&self) -> impl Iterator<Item = &EntityKey> {
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
mod tests {
    use super::*;

    fn key(s: &str) -> EntityKey {
        EntityKey(s.to_string())
    }

    #[test]
    fn tracks_and_removes() {
        let mut idx = DepIndex::new();
        idx.set_op_deps(1, [key("A"), key("B")].into());
        idx.set_op_deps(2, [key("B"), key("C")].into());

        assert_eq!(idx.ops_for_keys(&[key("A")]), [1].into());
        assert_eq!(idx.ops_for_keys(&[key("B")]), [1, 2].into());
        assert_eq!(idx.ops_for_keys(&[key("C"), key("A")]), [1, 2].into());

        // Re-registration replaces deps.
        idx.set_op_deps(1, [key("C")].into());
        assert!(idx.ops_for_keys(&[key("A")]).is_empty());

        idx.remove_op(1);
        idx.remove_op(2);
        assert_eq!(idx.active_ops(), 0);
        assert!(idx.ops_for_keys(&[key("B"), key("C")]).is_empty());
    }
}
