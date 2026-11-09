//! Owned unpublished updates, independent of runtime node hosting.
use crate::collections::{IndexMap, IndexSet};
use crate::*;
use std::sync::Arc;

/// An unpublished transaction detached from its editor borrow.
/// Dropping it discards its writes, events, extensions, tags and queued updates.
pub struct PendingUpdate {
    update: Arc<()>,
    #[cfg(feature = "foreign-nodes")]
    native_calls: Arc<crate::foreign::native::NativeCalls>,
    #[cfg(feature = "foreign-nodes")]
    read_only: bool,
    defer_publication: bool,
    #[cfg(feature = "foreign-nodes")]
    read_sources: Option<crate::state::NodeMap>,
    #[cfg(feature = "foreign-nodes")]
    read_origin: Option<crate::foreign::ReadOrigin>,
    #[cfg(feature = "foreign-nodes")]
    read_update_facts: Option<Arc<ForeignUpdateFacts>>,
    #[cfg(feature = "foreign-nodes")]
    retired_records: crate::state::NodeMap,
    #[cfg(feature = "foreign-nodes")]
    previous_selection: Option<Selection>,
    #[cfg(feature = "foreign-nodes")]
    previous_selection_identity: Option<ForeignSelectionIdentity>,
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
    pipeline_continuation: Option<Box<crate::pipeline::continuation::PipelineContinuation>>,
    pub(crate) prepared: Option<Box<crate::prepared::PreparedTransition>>,
    #[cfg(feature = "bench-counters")]
    work: WorkCounters,
    detached: Vec<Option<Selection>>,
    selection_replacements: u64,
    #[cfg(feature = "foreign-nodes")]
    foreign_selections: crate::foreign::selections::SelectionIdentities,
    #[cfg(feature = "foreign-nodes")]
    native_projection: Option<crate::foreign::projection::NativeProjection>,
}

impl PendingUpdate {
    pub(crate) fn check_owner(&self, editor: &Editor) -> Result<(), Error> {
        if !Arc::ptr_eq(editor.staging_owner(), &self.owner)
            || editor.suspend_version != self.version
        {
            return Err(Error::StaleSuspendedUpdate);
        }
        Ok(())
    }
}

impl Transaction<'_> {
    /// Whether writes or queued work require another pipeline pass before commit.
    /// This is the same predicate used by commit and survives suspend/resume.
    pub fn needs_flush(&self) -> bool {
        self.dirty_since_flush
    }
    /// Whether dropping this update would lose model effects beyond host API values/tags.
    /// This observes the current pending state; it neither flushes nor authorizes writes.
    pub fn has_staged_effects(&self) -> bool {
        self.has_dirty_nodes()
            || self.selection_will_change()
            || self.composition_key != self.editor.composition_key
            || self.full_reconcile
            || self.default_prevented
            || !self.events.is_empty()
            || !self.nested.is_empty()
            || self.extensions_changed()
            || self.preceding.as_ref().is_some_and(|commit| {
                commit.chain().any(|entry| {
                    !entry.is_noop()
                        || entry.composition_changed
                        || entry.full_reconcile
                        || entry.default_prevented
                })
            })
    }
    /// Detach without flushing or publishing the pending update.
    pub fn suspend(self) -> PendingUpdate {
        PendingUpdate {
            #[cfg(feature = "foreign-nodes")]
            update: self.foreign_update,
            #[cfg(not(feature = "foreign-nodes"))]
            update: self
                .staging_update
                .into_inner()
                .unwrap_or_else(|| Arc::new(())),
            #[cfg(feature = "foreign-nodes")]
            native_calls: self.foreign_native_calls,
            #[cfg(feature = "foreign-nodes")]
            read_only: self.foreign_read_only,
            defer_publication: self.defer_publication,
            #[cfg(feature = "foreign-nodes")]
            read_sources: self.foreign_read_sources,
            #[cfg(feature = "foreign-nodes")]
            read_origin: self.foreign_read_origin,
            #[cfg(feature = "foreign-nodes")]
            read_update_facts: self.foreign_read_update_facts,
            #[cfg(feature = "foreign-nodes")]
            retired_records: self.foreign_retired_records,
            #[cfg(feature = "foreign-nodes")]
            previous_selection: self.foreign_previous_selection,
            #[cfg(feature = "foreign-nodes")]
            previous_selection_identity: self.foreign_previous_selection_identity,
            #[cfg(feature = "foreign-nodes")]
            native_projection: self.native_projection,
            owner: self.editor.staging_owner().clone(),
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
            pipeline_continuation: self.pipeline_continuation,
            prepared: self.prepared,
            #[cfg(feature = "bench-counters")]
            work: self.work,
            detached: self.detached,
            selection_replacements: self.selection_replacements,
            #[cfg(feature = "foreign-nodes")]
            foreign_selections: self.foreign_selections,
        }
    }
}
impl Editor {
    /// Resume an update belonging to this editor at its original publication.
    /// A commit or state installation since suspension makes the update stale.
    pub fn resume(&mut self, update: PendingUpdate) -> Result<Transaction<'_>, Error> {
        self.resume_owned(update)
            .map_err(|failure| failure.into_parts().0)
    }
    pub(crate) fn resume_owned(
        &mut self,
        update: PendingUpdate,
    ) -> Result<Transaction<'_>, PreparationFailure> {
        if let Err(error) = update.check_owner(self) {
            return Err(PreparationFailure::new(error, update));
        }
        Ok(Transaction {
            #[cfg(feature = "foreign-nodes")]
            foreign_update: update.update,
            #[cfg(not(feature = "foreign-nodes"))]
            staging_update: std::sync::OnceLock::from(update.update),
            #[cfg(feature = "foreign-nodes")]
            foreign_native_calls: update.native_calls,
            #[cfg(feature = "foreign-nodes")]
            foreign_read_only: update.read_only,
            defer_publication: update.defer_publication,
            #[cfg(feature = "foreign-nodes")]
            foreign_read_sources: update.read_sources,
            #[cfg(feature = "foreign-nodes")]
            foreign_read_origin: update.read_origin,
            #[cfg(feature = "foreign-nodes")]
            foreign_read_update_facts: update.read_update_facts,
            #[cfg(feature = "foreign-nodes")]
            foreign_retired_records: update.retired_records,
            #[cfg(feature = "foreign-nodes")]
            foreign_previous_selection: update.previous_selection,
            #[cfg(feature = "foreign-nodes")]
            foreign_previous_selection_identity: update.previous_selection_identity,
            #[cfg(feature = "foreign-nodes")]
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
            pipeline_continuation: update.pipeline_continuation,
            prepared: update.prepared,
            #[cfg(feature = "bench-counters")]
            work: update.work,
            detached: update.detached,
            selection_replacements: update.selection_replacements,
            #[cfg(feature = "foreign-nodes")]
            foreign_selections: update.foreign_selections,
        })
    }
}

impl Editor {
    pub(crate) fn staging_owner(&self) -> &Arc<()> {
        #[cfg(feature = "foreign-nodes")]
        {
            &self.suspend_owner
        }
        #[cfg(not(feature = "foreign-nodes"))]
        {
            self.suspend_owner.get_or_init(|| Arc::new(()))
        }
    }
}

impl Transaction<'_> {
    pub(crate) fn guard_staged_publication(&self) -> Result<(), Error> {
        if self.defer_publication {
            return Err(Error::Invariant("host update awaits admission"));
        }
        Ok(())
    }
    /// Install an unpublished update into a pristine command transaction.
    /// The host must route the command through its ordinary authorization and
    /// readiness boundary; this method grants no independent edit authority.
    pub fn adopt_staged_update(&mut self, update: PendingUpdate) -> Result<(), Error> {
        self.check_staged_update(&update)?;
        self.install_staged_update(update);
        Ok(())
    }
    pub(crate) fn check_staged_update(&self, update: &PendingUpdate) -> Result<(), Error> {
        self.guard_write()?;
        #[cfg(feature = "foreign-nodes")]
        if update.read_only {
            return Err(Error::ForeignReadOnly);
        }
        if !Arc::ptr_eq(self.editor.staging_owner(), &update.owner)
            || self.editor.suspend_version != update.version
        {
            return Err(Error::StaleSuspendedUpdate);
        }
        if self.has_staged_effects()
            || self.preceding.is_some()
            || self.options
                != (UpdateOptions {
                    tags: self.editor.carried_tags.clone(),
                    ..UpdateOptions::default()
                })
        {
            return Err(Error::Invariant("host update target is not pristine"));
        }
        if update.preceding.is_some() {
            return Err(Error::Invariant(
                "host update already published a preceding commit",
            ));
        }
        Ok(())
    }
    pub(crate) fn install_staged_update(&mut self, update: PendingUpdate) {
        self.defer_publication = false;
        #[cfg(feature = "foreign-nodes")]
        {
            self.foreign_update = update.update;
        }
        #[cfg(feature = "foreign-nodes")]
        {
            self.foreign_native_calls = update.native_calls;
        }
        #[cfg(feature = "foreign-nodes")]
        {
            self.foreign_read_only = update.read_only;
        }
        #[cfg(feature = "foreign-nodes")]
        {
            self.foreign_read_sources = update.read_sources;
        }
        #[cfg(feature = "foreign-nodes")]
        {
            self.foreign_read_origin = update.read_origin;
        }
        #[cfg(feature = "foreign-nodes")]
        {
            self.foreign_read_update_facts = update.read_update_facts;
        }
        #[cfg(feature = "foreign-nodes")]
        {
            self.foreign_retired_records = update.retired_records;
        }
        #[cfg(feature = "foreign-nodes")]
        {
            self.foreign_previous_selection = update.previous_selection;
        }
        #[cfg(feature = "foreign-nodes")]
        {
            self.foreign_previous_selection_identity = update.previous_selection_identity;
        }
        #[cfg(feature = "foreign-nodes")]
        {
            self.native_projection = update.native_projection;
        }
        #[cfg(not(feature = "foreign-nodes"))]
        {
            self.staging_update = std::sync::OnceLock::from(update.update);
        }
        self.extensions = update.extensions;
        self.events = update.events;
        self.default_prevented = update.default_prevented;
        self.pending = update.pending;
        self.dirty_leaves = update.dirty_leaves;
        self.dirty_elements = update.dirty_elements;
        self.composition_key = update.composition_key;
        self.selection_context = update.selection_context;
        self.sealed = update.sealed;
        self.full_reconcile = update.full_reconcile;
        self.selection_dirty = update.selection_dirty;
        self.preceding = update.preceding;
        self.options = update.options;
        self.normalized = update.normalized;
        self.nested = update.nested;
        self.transform_iterations = update.transform_iterations;
        self.dirty_since_flush = update.dirty_since_flush;
        self.pipeline_continuation = update.pipeline_continuation;
        self.prepared = update.prepared;
        #[cfg(feature = "bench-counters")]
        {
            self.work = update.work;
        }
        self.detached = update.detached;
        self.selection_replacements = update.selection_replacements;
        #[cfg(feature = "foreign-nodes")]
        {
            self.foreign_selections = update.foreign_selections;
        }
    }
}

#[cfg(test)]
mod test;
