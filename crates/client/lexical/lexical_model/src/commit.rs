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
/// Ordered dirty leaf identities borrowed by post-commit model plugins.
pub type DirtyLeaves = IndexSet<NodeKey>;
/// Dirty records and their observed changes, in processing order.
#[derive(Clone, Debug, Default)]
pub struct Changes {
    /// Leaf dirty marks.
    pub dirty_leaves: DirtyLeaves,
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
#[derive(Clone, Debug)]
pub struct Commit {
    /// Host default action was prevented.
    pub default_prevented: bool,
    /// Published follow-up transitions.
    pub following: Vec<Commit>,
    /// A failed follow-up round, leaving earlier commits intact.
    pub follow_up_error: Option<FollowUpError>,
    /// Typed host events in emission order.
    pub events: Vec<PluginEvent>,
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
    /// Earlier transition published by set_editor_state inside the update.
    pub preceding: Option<Box<Commit>>,
    /// Instrumented model work.
    #[cfg(feature = "bench-counters")]
    pub work: WorkCounters,
}
impl Commit {
    /// Nothing dirty and no selection change.
    pub fn is_noop(&self) -> bool {
        self.changes.is_empty() && !self.selection_changed && self.events.is_empty()
    }
    /// Lazy, memoized root-text comparison.
    pub fn text_content_changed(&self) -> bool {
        self.prev.root_text_content() != self.next.root_text_content()
    }
    /// Earlier published transitions followed by this one, in chronological order.
    pub fn chain(&self) -> impl Iterator<Item = &Commit> {
        fn append<'commit>(commit: &'commit Commit, chain: &mut Vec<&'commit Commit>) {
            if let Some(preceding) = commit.preceding.as_deref() {
                append(preceding, chain);
            }
            chain.push(commit);
            for following in &commit.following {
                append(following, chain);
            }
        }
        let mut chain = vec![];
        append(self, &mut chain);
        chain.into_iter()
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
        self.commit_phase()
    }
    pub(crate) fn commit_phase(&mut self) -> Result<Commit, Error> {
        let next_id = self.editor.keys.next_commit()?;
        let prev = self.editor.state.clone();
        let selection_changed = self.selection_dirty
            || self
                .pending
                .selection
                .as_ref()
                .is_some_and(Selection::is_dirty)
            || self.pending.selection != prev.selection;
        let mut changes = Changes {
            dirty_leaves: self.dirty_leaves.clone(),
            dirty_elements: self.dirty_elements.clone(),
            mutations: IndexMap::default(),
        };
        let keys: IndexSet<NodeKey> = if self.full_reconcile {
            std::iter::once(NodeKey::ROOT)
                .chain(
                    self.pending
                        .view()
                        .descendants(NodeKey::ROOT)
                        .map(|(key, _)| key),
                )
                .chain(std::iter::once(NodeKey::ROOT))
                .chain(prev.view().descendants(NodeKey::ROOT).map(|(key, _)| key))
                .chain({
                    let mut keys = self.pending.nodes.keys().copied().collect::<Vec<_>>();
                    keys.sort();
                    keys
                })
                .chain({
                    let mut keys = prev.nodes.keys().copied().collect::<Vec<_>>();
                    keys.sort();
                    keys
                })
                .collect()
        } else {
            changes
                .dirty_leaves
                .iter()
                .chain(changes.dirty_elements.keys())
                .copied()
                .collect()
        };
        for key in &keys {
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
        crate::pipeline::apply_model_caches(self);
        changes.dirty_elements = self.dirty_elements.clone();
        let dirty = !changes.is_empty();
        if let Some(selection) = &mut self.pending.selection {
            selection.set_dirty(false);
        }
        if dirty || selection_changed {
            self.editor.state = self.pending.clone();
        }
        self.editor.carried_tags = if !dirty && selection_changed {
            self.options.tags.clone()
        } else {
            TagSet::default()
        };
        let composition_changed = self.editor.composition_key != self.composition_key;
        self.editor.composition_key = self.composition_key;
        self.editor.extensions = self.extensions.clone();
        Ok(Commit {
            default_prevented: self.default_prevented,
            following: vec![],
            follow_up_error: None,
            events: std::mem::take(&mut self.events),
            id: next_id,
            prev,
            next: self.editor.state.clone(),
            changes,
            tags: self.options.tags.clone(),
            normalized: self.normalized.clone(),
            selection_changed,
            composition_key: self.composition_key,
            composition_changed,
            full_reconcile: self.full_reconcile,
            preceding: self.preceding.take(),
            #[cfg(feature = "bench-counters")]
            work: std::mem::take(&mut self.work),
        })
    }
}

impl Transaction<'_> {
    /// Restore a compatible snapshot while leaving this transaction open for further edits.
    pub fn restore_editor_state(&mut self, state: &EditorState) -> Result<(), Error> {
        self.guard_write()?;
        if !Arc::ptr_eq(&state.registry, &self.pending.registry) {
            return Err(Error::ForeignEditorState);
        }
        self.editor.keys.raise_to(state.max_key());
        self.pending = state.pending();
        for key in self.pending.nodes.keys().copied().collect::<Vec<_>>() {
            let slot = self
                .pending
                .nodes
                .get_mut(&key)
                .ok_or(Error::NodeNotFound(key))?;
            let replacement = slot.data.after_clone();
            let record = Arc::make_mut(slot);
            if let Some(data) = replacement {
                record.data = data;
            }
        }
        self.selection_dirty = true;
        self.full_reconcile = true;
        Ok(())
    }
    /// Ask consumers to reconcile every record in both snapshots.
    pub fn request_full_reconcile(&mut self) {
        self.full_reconcile = true;
    }
    pub(crate) fn install_state(&mut self, state: EditorState, tags: TagSet) -> Result<(), Error> {
        if !Arc::ptr_eq(&state.registry, &self.pending.registry) {
            return Err(Error::ForeignEditorState);
        }
        if state.is_empty_state() {
            return Err(Error::SetEmptyEditorState);
        }
        self.editor.keys.raise_to(state.max_key());
        for tag in tags.iter() {
            self.add_tag(tag.clone());
        }
        self.pending = state.pending();
        self.composition_key = None;
        self.dirty_leaves.clear();
        self.dirty_elements.clear();
        self.dirty_elements
            .insert(NodeKey::ROOT, DirtyIntent::AncestorOfDirty);
        self.full_reconcile = true;
        self.selection_dirty = false;
        self.sealed = true;
        Ok(())
    }
    /// Publish pending work first, then seal the transaction around the installed state.
    pub fn set_editor_state(&mut self, state: EditorState, tags: TagSet) -> Result<(), Error> {
        self.guard_write()?;
        if !Arc::ptr_eq(&state.registry, &self.pending.registry) {
            return Err(Error::ForeignEditorState);
        }
        if state.is_empty_state() {
            return Err(Error::SetEmptyEditorState);
        }
        for tag in tags.iter() {
            self.add_tag(tag.clone());
        }
        let preceding = self.commit_phase()?;
        self.install_state(state, TagSet::default())?;
        self.preceding = Some(Box::new(preceding));
        Ok(())
    }
}

impl Editor {
    pub(crate) fn noop_commit(&self) -> Commit {
        Commit {
            id: CommitId(0),
            prev: self.state.clone(),
            next: self.state.clone(),
            changes: Changes::default(),
            tags: TagSet::default(),
            normalized: IndexSet::default(),
            selection_changed: false,
            composition_key: self.composition_key,
            composition_changed: false,
            full_reconcile: false,
            default_prevented: false,
            preceding: None,
            following: vec![],
            follow_up_error: None,
            events: vec![],
            #[cfg(feature = "bench-counters")]
            work: WorkCounters::default(),
        }
    }
}
