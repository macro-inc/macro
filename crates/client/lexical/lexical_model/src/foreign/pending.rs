//! Owned updates held across development host calls.
use crate::collections::{IndexMap, IndexSet};
use crate::*;
use std::sync::Arc;

/// Opaque development host identity for an editor, independent of its state.
/// Clones retain only an identity marker, never the editor or its callbacks.
#[derive(Clone)]
pub struct ForeignEditorIdentity(Arc<()>);

impl ForeignEditorIdentity {
    /// Whether a current transaction belongs to this identity's editor.
    pub fn matches(&self, tx: &Transaction<'_>) -> bool {
        Arc::ptr_eq(&self.0, &tx.editor.suspend_owner)
    }
}

/// Opaque identity of one pending update, preserved across suspend/resume.
/// Retaining this marker does not retain pending state or callbacks.
#[derive(Clone)]
pub struct ForeignUpdateIdentity(Arc<()>);

impl ForeignUpdateIdentity {
    /// Whether the transaction is the same pending update, rather than a fresh
    /// transaction belonging to the same editor and committed publication.
    pub fn matches(&self, tx: &Transaction<'_>) -> bool {
        Arc::ptr_eq(&self.0, &tx.foreign_update)
    }
}

/// An unpublished transaction detached from its editor borrow.
/// Dropping it discards its writes, events, extensions, tags and queued updates.
pub struct PendingUpdate {
    update: Arc<()>,
    read_only: bool,
    read_sources: Option<crate::state::NodeMap>,
    previous_selection: Option<Selection>,
    owner: Arc<()>,
    version: CommitId,
    extensions: crate::extension::Extensions,
    events: Vec<PluginEvent>,
    default_prevented: bool,
    pending: EditorState,
    dirty_leaves: IndexSet<NodeKey>,
    dirty_elements: IndexMap<NodeKey, DirtyIntent>,
    composition_key: Option<NodeKey>,
    selection_context: Option<SelectionChangeContext>,
    sealed: bool,
    full_reconcile: bool,
    selection_dirty: bool,
    preceding: Option<Box<Commit>>,
    options: UpdateOptions,
    normalized: IndexSet<NodeKey>,
    nested: std::collections::VecDeque<(NestedUpdateFn, UpdateOptions)>,
    transform_iterations: u16,
    dirty_since_flush: bool,
    #[cfg(feature = "bench-counters")]
    work: WorkCounters,
    detached: Vec<Option<Selection>>,
    selection_replacements: u64,
    native_projection: Option<super::projection::NativeProjection>,
}

impl Transaction<'_> {
    /// Capture editor identity without retaining its state or registry.
    pub fn foreign_editor_identity(&self) -> ForeignEditorIdentity {
        ForeignEditorIdentity(self.editor.suspend_owner.clone())
    }

    /// Capture pending-update identity without retaining its model state.
    pub fn foreign_update_identity(&self) -> ForeignUpdateIdentity {
        ForeignUpdateIdentity(self.foreign_update.clone())
    }

    /// Detach without flushing or publishing the pending update.
    pub fn suspend(self) -> PendingUpdate {
        PendingUpdate {
            update: self.foreign_update,
            read_only: self.foreign_read_only,
            read_sources: self.foreign_read_sources,
            previous_selection: self.foreign_previous_selection,
            native_projection: self.native_projection,
            owner: self.editor.suspend_owner.clone(),
            version: self.editor.suspend_version,
            extensions: self.extensions,
            events: self.events,
            default_prevented: self.default_prevented,
            pending: self.pending,
            dirty_leaves: self.dirty_leaves,
            dirty_elements: self.dirty_elements,
            composition_key: self.composition_key,
            selection_context: self.selection_context,
            sealed: self.sealed,
            full_reconcile: self.full_reconcile,
            selection_dirty: self.selection_dirty,
            preceding: self.preceding,
            options: self.options,
            normalized: self.normalized,
            nested: self.nested,
            transform_iterations: self.transform_iterations,
            dirty_since_flush: self.dirty_since_flush,
            #[cfg(feature = "bench-counters")]
            work: self.work,
            detached: self.detached,
            selection_replacements: self.selection_replacements,
        }
    }
}
impl Editor {
    /// Resume an update belonging to this editor at its original publication.
    /// A commit or state installation since suspension makes the update stale.
    pub fn resume(&mut self, update: PendingUpdate) -> Result<Transaction<'_>, Error> {
        if !Arc::ptr_eq(&self.suspend_owner, &update.owner)
            || self.suspend_version != update.version
        {
            return Err(Error::StaleSuspendedUpdate);
        }
        Ok(Transaction {
            foreign_update: update.update,
            foreign_read_only: update.read_only,
            foreign_read_sources: update.read_sources,
            foreign_previous_selection: update.previous_selection,
            native_projection: update.native_projection,
            editor: self,
            extensions: update.extensions,
            events: update.events,
            default_prevented: update.default_prevented,
            pending: update.pending,
            dirty_leaves: update.dirty_leaves,
            dirty_elements: update.dirty_elements,
            composition_key: update.composition_key,
            selection_context: update.selection_context,
            sealed: update.sealed,
            full_reconcile: update.full_reconcile,
            selection_dirty: update.selection_dirty,
            preceding: update.preceding,
            options: update.options,
            normalized: update.normalized,
            nested: update.nested,
            transform_iterations: update.transform_iterations,
            dirty_since_flush: update.dirty_since_flush,
            #[cfg(feature = "bench-counters")]
            work: update.work,
            detached: update.detached,
            selection_replacements: update.selection_replacements,
        })
    }
}

#[cfg(test)]
mod test;
