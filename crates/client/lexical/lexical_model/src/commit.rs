//! Snapshot transitions and mutation reporting.
use crate::collections::{IndexMap, IndexSet};
use crate::*;
use std::sync::Arc;

/// Monotonic identity of a commit in one editor.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct CommitId(pub u64);
/// Outcome of the designated main transaction, independent of earlier or later commits.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum MainCommitOutcome {
    /// No successful main transaction commit was observed.
    #[default]
    NotPublished,
    /// The main transaction committed, including empty or unhandled transactions.
    Published {
        /// Identity returned by that exact transaction commit.
        commit_id: CommitId,
        /// Command handling result before post-commit work.
        handled: Handled,
    },
}
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
    /// Runtime payloads validated at flush and publication.
    pub foreign_payloads_checked: u64,
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
pub struct Commit {
    /// Actual originating transaction, never a host-invented publication identity.
    #[cfg(feature = "foreign-nodes")]
    pub foreign_update: Option<ForeignUpdateIdentity>,
    /// Host default action was prevented.
    pub default_prevented: bool,
    /// Published follow-up transitions.
    pub following: Vec<Commit>,
    /// A failed follow-up round, leaving earlier commits intact.
    pub follow_up_error: Option<FollowUpError>,
    /// Typed host events in emission order.
    pub events: Vec<PluginEvent>,
    pub(crate) receipts: Vec<crate::receipt::Receipt>,
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
    /// A retained live root state's stored slot was re-recorded from its live value,
    /// without dirtying nodes (Transaction::supersede_retained_root_state).
    pub stored_state_superseded: bool,
    /// Earlier transition published by set_editor_state inside the update.
    pub preceding: Option<Box<Commit>>,
    /// Instrumented model work.
    #[cfg(feature = "bench-counters")]
    pub work: WorkCounters,
}
// Capture-only receipts are intentionally absent from public Clone and Debug.
impl Clone for Commit {
    fn clone(&self) -> Self {
        Self {
            #[cfg(feature = "foreign-nodes")]
            foreign_update: self.foreign_update.clone(),
            default_prevented: self.default_prevented,
            following: self.following.clone(),
            follow_up_error: self.follow_up_error.clone(),
            events: self.events.clone(),
            id: self.id,
            prev: self.prev.clone(),
            next: self.next.clone(),
            changes: self.changes.clone(),
            tags: self.tags.clone(),
            normalized: self.normalized.clone(),
            selection_changed: self.selection_changed,
            composition_key: self.composition_key,
            composition_changed: self.composition_changed,
            full_reconcile: self.full_reconcile,
            stored_state_superseded: self.stored_state_superseded,
            preceding: self.preceding.clone(),
            receipts: vec![],
            #[cfg(feature = "bench-counters")]
            work: self.work.clone(),
        }
    }
}
impl std::fmt::Debug for Commit {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let mut value = f.debug_struct("Commit");
        #[cfg(feature = "foreign-nodes")]
        value.field("foreign_update", &self.foreign_update);
        value.field("default_prevented", &self.default_prevented);
        value.field("following", &self.following);
        value.field("follow_up_error", &self.follow_up_error);
        value.field("events", &self.events);
        value.field("id", &self.id);
        value.field("prev", &self.prev);
        value.field("next", &self.next);
        value.field("changes", &self.changes);
        value.field("tags", &self.tags);
        value.field("normalized", &self.normalized);
        value.field("selection_changed", &self.selection_changed);
        value.field("composition_key", &self.composition_key);
        value.field("composition_changed", &self.composition_changed);
        value.field("full_reconcile", &self.full_reconcile);
        value.field("stored_state_superseded", &self.stored_state_superseded);
        value.field("preceding", &self.preceding);
        #[cfg(feature = "bench-counters")]
        value.field("work", &self.work);
        value.finish()
    }
}
impl Commit {
    /// Nothing dirty, no selection change and no emitted events.
    pub fn is_noop(&self) -> bool {
        self.changes.is_empty()
            && !self.selection_changed
            && self.events.is_empty()
            && !self.stored_state_superseded
    }
    /// A publication whose only effect is a superseded retained root stored slot: it is
    /// projected with its chain but never delivered to after-commit hooks.
    pub fn only_supersedes_stored_state(&self) -> bool {
        self.stored_state_superseded
            && self.changes.is_empty()
            && !self.selection_changed
            && self.events.is_empty()
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
#[derive(Clone, Copy)]
pub(crate) enum CacheReconciliation {
    Writable,
    Imported,
}

impl Transaction<'_> {
    pub(crate) fn selection_will_change(&self) -> bool {
        self.selection_dirty
            || self
                .pending
                .selection
                .as_ref()
                .is_some_and(Selection::is_dirty)
            || self.pending.selection != self.editor.state.selection
    }
    /// Flush pending writes and publish atomically; any error leaves the editor unchanged.
    pub fn commit(self) -> Result<Commit, Error> {
        self.commit_with_metadata(|_| {})
    }
    pub(crate) fn commit_imported_state(
        self,
        normalize: impl FnOnce(&mut Commit),
    ) -> Result<Commit, Error> {
        self.commit_with_caches(CacheReconciliation::Imported, normalize)
    }
    /// Normalize an initialization receipt before publication to metadata observers.
    pub(crate) fn commit_with_metadata(
        self,
        normalize: impl FnOnce(&mut Commit),
    ) -> Result<Commit, Error> {
        self.commit_with_caches(CacheReconciliation::Writable, normalize)
    }
    fn commit_with_caches(
        mut self,
        caches: CacheReconciliation,
        normalize: impl FnOnce(&mut Commit),
    ) -> Result<Commit, Error> {
        self.guard_staged_publication()?;
        if self.dirty_since_flush {
            self.flush()?;
        }
        self.commit_phase_prepared_normalized(|_| Ok(()), normalize, caches)
            .map(|(commit, ())| commit)
    }
    pub(crate) fn commit_phase(&mut self) -> Result<Commit, Error> {
        self.commit_phase_prepared(|_| Ok(()))
            .map(|(commit, ())| commit)
    }

    /// Prepare a development host artifact before publishing pending model effects.
    /// A preparation error drops this update; previously published preceding commits
    /// remain published, and allocated keys/commit IDs are never reused.
    #[cfg(feature = "foreign-nodes")]
    pub fn commit_foreign<T, E: From<Error>>(
        mut self,
        prepare: impl FnOnce(&Commit) -> Result<T, E>,
    ) -> Result<(Commit, T), E> {
        self.guard_staged_publication()?;
        if self.dirty_since_flush {
            self.flush()?;
        }
        self.commit_phase_prepared(prepare)
    }

    fn commit_phase_prepared<T, E: From<Error>>(
        &mut self,
        prepare: impl FnOnce(&Commit) -> Result<T, E>,
    ) -> Result<(Commit, T), E> {
        self.commit_phase_prepared_normalized(prepare, |_| {}, CacheReconciliation::Writable)
    }

    fn commit_phase_prepared_normalized<T, E: From<Error>>(
        &mut self,
        prepare: impl FnOnce(&Commit) -> Result<T, E>,
        normalize: impl FnOnce(&mut Commit),
        caches: CacheReconciliation,
    ) -> Result<(Commit, T), E> {
        self.guard_staged_publication()?;
        let transition = match self.prepared.take() {
            Some(value) => {
                self.check_prepared_publication(&value)?;
                *value
            }
            None => self.prepare_transition(caches)?,
        };
        let dirty = !transition.changes.is_empty();
        let selection_changed = transition.selection_changed;
        let (mut commit, next_id, receipt) = transition.into_publication();
        normalize(&mut commit);
        let artifact = prepare(&commit)?;
        #[cfg(feature = "foreign-nodes")]
        ForeignReadOperation::check()?;
        if dirty || selection_changed || commit.stored_state_superseded {
            self.editor.state = self.pending.clone();
        }
        self.editor.carried_tags = if !dirty && selection_changed {
            self.options.tags.clone()
        } else {
            TagSet::default()
        };
        self.editor.composition_key = self.composition_key;
        self.editor.extensions = self.extensions.clone();
        self.editor.suspend_version = next_id;
        // Every successful publication ends the pending update's local values, including empty,
        // tag-only and event-only ones; drop them after the publication callbacks.
        let retired = std::mem::take(&mut self.update_local);
        if let Some(receipt) = receipt {
            receipt.publish();
        }
        #[cfg(feature = "foreign-nodes")]
        if let Some(observer) = &self.editor.foreign_publication_observer {
            observer.published(&commit);
        }
        drop(retired);
        Ok((commit, artifact))
    }

    // Keep transition construction visible to ordinary commit callers so its
    // large return value and absent prepared receipt can be optimized away.
    #[inline(always)]
    pub(crate) fn prepare_transition(
        &mut self,
        caches: CacheReconciliation,
    ) -> Result<crate::prepared::PreparedTransition, Error> {
        #[cfg(feature = "foreign-nodes")]
        if self.foreign_read_only {
            return Err(Error::ForeignReadOnly);
        }
        #[cfg(feature = "foreign-nodes")]
        ForeignReadOperation::check()?;
        // A prepared seal can publish without a flush; check it here as well.
        self.check_dirty_depth()?;
        let next_id = self.editor.keys.next_commit()?;
        let prev = self.editor.state.clone();
        let selection_changed = self.selection_will_change();
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
        if matches!(caches, CacheReconciliation::Writable) {
            crate::pipeline::apply_model_caches(self)?;
        }
        #[cfg(feature = "foreign-nodes")]
        ForeignReadOperation::check()?;
        #[cfg(feature = "foreign-nodes")]
        self.check_pending_foreign_payloads()?;
        changes.dirty_elements = self.dirty_elements.clone();
        let dirty = !changes.is_empty();
        if let Some(selection) = &mut self.pending.selection {
            selection.set_dirty(false);
        }
        let composition_changed = self.editor.composition_key != self.composition_key;
        #[cfg(feature = "foreign-nodes")]
        {
            self.pending.foreign_selection_identity = self.foreign_selections.current.clone();
        }
        let next = if dirty || selection_changed || self.stored_state_superseded {
            self.pending.clone()
        } else {
            prev.clone()
        };
        Ok(crate::prepared::PreparedTransition {
            receipt: None,
            #[cfg(feature = "foreign-nodes")]
            foreign_update: Some(self.foreign_update_identity()),
            default_prevented: self.default_prevented,
            events: std::mem::take(&mut self.events),
            receipts: std::mem::take(&mut self.receipts),
            publication_id: next_id,
            prev,
            next,
            changes,
            tags: self.options.tags.clone(),
            normalized: self.normalized.clone(),
            selection_changed,
            composition_key: self.composition_key,
            composition_changed,
            full_reconcile: self.full_reconcile,
            stored_state_superseded: self.stored_state_superseded,
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
        #[cfg(feature = "foreign-nodes")]
        self.retire_foreign_selection();
        self.pending = state.pending();
        #[cfg(feature = "foreign-nodes")]
        {
            self.pending.foreign_instances = self.editor.foreign_instances.clone();
        }
        for key in self.pending.nodes.keys().copied().collect::<Vec<_>>() {
            #[cfg(feature = "foreign-nodes")]
            if self.clone_foreign_instance_for_restore(key)? {
                continue;
            }
            #[cfg(feature = "foreign-nodes")]
            let clone_source = self.foreign_clone_source(key)?;
            let slot = self
                .pending
                .nodes
                .get_mut(&key)
                .ok_or(Error::NodeNotFound(key))?;
            #[cfg(feature = "foreign-nodes")]
            let replacement = crate::foreign::payload::clone_payload(
                &self.pending.registry,
                slot.type_index,
                key,
                key,
                &slot.data,
                clone_source,
            );
            #[cfg(feature = "foreign-nodes")]
            ForeignReadOperation::check()?;
            #[cfg(not(feature = "foreign-nodes"))]
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
        #[cfg(feature = "foreign-nodes")]
        self.retire_foreign_selection();
        self.pending = state.pending();
        #[cfg(feature = "foreign-nodes")]
        {
            self.pending.foreign_instances = self.editor.foreign_instances.clone();
        }
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
        self.guard_staged_publication()?;
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
            #[cfg(feature = "foreign-nodes")]
            foreign_update: None,
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
            stored_state_superseded: false,
            default_prevented: false,
            preceding: None,
            following: vec![],
            follow_up_error: None,
            events: vec![],
            receipts: vec![],
            #[cfg(feature = "bench-counters")]
            work: WorkCounters::default(),
        }
    }
}
