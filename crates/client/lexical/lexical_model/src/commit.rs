//! Snapshot transitions and mutation reporting.
use crate::collections::{IndexMap, IndexSet};
use crate::*;
use std::sync::Arc;

/// Monotonic identity of a commit in one editor.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct CommitId(pub u64);
/// Per-record transition.
#[derive(Clone, Copy, Debug, PartialEq, Eq, strum::Display)]
#[strum(serialize_all = "lowercase")]
pub enum Mutation {
    /// Present only in the new state.
    Created,
    /// Present in both with different record identity.
    Updated,
    /// Present only in the old state.
    Destroyed,
}
/// Dirty records and their observed changes, in processing order.
#[derive(Clone, Debug, Default)]
pub struct Changes {
    /// Leaf dirty marks.
    pub dirty_leaves: IndexSet<NodeKey>,
    /// Element dirty marks and their intent.
    pub dirty_elements: IndexMap<NodeKey, DirtyIntent>,
    /// Changes computed before view cache writes.
    pub mutations: IndexMap<NodeKey, Mutation>,
}
impl Changes {
    /// Whether the update marked any nodes dirty.
    pub fn is_empty(&self) -> bool {
        self.dirty_leaves.is_empty() && self.dirty_elements.is_empty()
    }
}
/// Deterministic work counters, available only in instrumented builds.
#[cfg(feature = "bench-counters")]
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct WorkCounters {
    /// Records visited by model processing.
    pub nodes_visited: u64,
    /// Node records cloned by writes.
    pub nodes_cloned: u64,
    /// Emitted diff operations (filled by the diff layer).
    pub diff_ops: u64,
    /// Known payload bytes allocated by processing.
    pub bytes_allocated: u64,
}
/// An atomically published state transition.
#[derive(Clone)]
pub struct Commit {
    /// Monotonic commit identity.
    pub id: CommitId,
    /// Previous state.
    pub prev: EditorState,
    /// Current state.
    pub next: EditorState,
    /// Dirty marks and record mutations.
    pub changes: Changes,
    /// Accumulated update tags.
    pub tags: TagSet,
    /// Keys merged away or into, in merge order.
    pub normalized: IndexSet<NodeKey>,
    /// Whether the selection was changed or explicitly marked dirty.
    pub selection_changed: bool,
    /// Composition node after the commit.
    pub composition_key: Option<NodeKey>,
    /// Whether composition ownership changed.
    pub composition_changed: bool,
    /// Whether all records were compared.
    pub full_reconcile: bool,
    /// Instrumented model work.
    #[cfg(feature = "bench-counters")]
    pub work: WorkCounters,
}
impl Commit {
    /// Nothing dirty and no selection change.
    pub fn is_noop(&self) -> bool {
        self.changes.is_empty() && !self.selection_changed
    }
    /// Lazy, memoized root-text comparison.
    pub fn text_content_changed(&self) -> bool {
        self.prev.root_text_content() != self.next.root_text_content()
    }
    /// Exact-type mutations, following the registered replacement chain.
    pub fn mutations_of<Node: NodeType>(&self) -> impl Iterator<Item = (NodeKey, Mutation)> + '_ {
        let resolved = self
            .next
            .registry
            .index_of::<Node>()
            .and_then(|index| self.next.registry.resolve_replacements(index));
        self.changes
            .mutations
            .iter()
            .filter_map(move |(key, mutation)| {
                let state = if *mutation == Mutation::Destroyed {
                    &self.prev
                } else {
                    &self.next
                };
                (state
                    .view()
                    .type_index(*key)
                    .is_some_and(|index| Some(index) == resolved))
                .then_some((*key, *mutation))
            })
    }
}
impl Transaction<'_> {
    /// Flush pending writes and publish atomically; any error leaves the editor unchanged.
    pub fn commit(mut self) -> Result<Commit, Error> {
        if self.dirty_since_flush {
            self.flush()?;
        }
        let prev = self.editor.state.clone();
        let selection_changed = self.pending.selection != prev.selection;
        let mut changes = Changes {
            dirty_leaves: self.dirty_leaves.clone(),
            dirty_elements: self.dirty_elements.clone(),
            mutations: IndexMap::default(),
        };
        for key in changes
            .dirty_leaves
            .iter()
            .chain(changes.dirty_elements.keys())
        {
            #[cfg(feature = "bench-counters")]
            {
                self.work.nodes_visited += 1;
            }
            let mutation = match (prev.nodes.get(key), self.pending.nodes.get(key)) {
                (None, Some(_)) => Some(Mutation::Created),
                (Some(_), None) => Some(Mutation::Destroyed),
                (Some(a), Some(b)) if !Arc::ptr_eq(a, b) => Some(Mutation::Updated),
                _ => None,
            };
            if let Some(mutation) = mutation {
                changes.mutations.insert(*key, mutation);
            }
        }
        crate::pipeline::apply_model_caches(&mut self);
        let dirty = !changes.is_empty();
        if dirty || selection_changed {
            self.editor.state = self.pending;
        }
        self.editor.carried_tags = if !dirty && selection_changed {
            self.options.tags.clone()
        } else {
            TagSet::default()
        };
        self.editor.commit_counter = self
            .editor
            .commit_counter
            .checked_add(1)
            .ok_or(Error::KeySpaceExhausted)?;
        let composition_changed = self.editor.composition_key != self.composition_key;
        self.editor.composition_key = self.composition_key;
        Ok(Commit {
            id: CommitId(self.editor.commit_counter),
            prev,
            next: self.editor.state.clone(),
            changes,
            tags: self.options.tags,
            normalized: self.normalized,
            selection_changed,
            composition_key: self.composition_key,
            composition_changed,
            full_reconcile: false,
            #[cfg(feature = "bench-counters")]
            work: self.work,
        })
    }
}
