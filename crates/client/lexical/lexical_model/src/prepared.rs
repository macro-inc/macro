//! Owned sealed main transitions; follow-up hooks still run only after publication.
use crate::collections::IndexSet;
use crate::*;
use std::{
    fmt,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};

/// Publication evidence for one genuine prepared main transition.
/// Adoption and a drained follow-up chain are separate facts.
#[derive(Clone)]
pub struct PreparedReceipt {
    publication: CommitId,
    published: Arc<AtomicBool>,
}
impl PreparedReceipt {
    /// The internal main-publication watermark, only after real installation.
    /// This is not the possibly normalized public initialization Commit.id.
    pub fn main_publication(&self) -> Option<CommitId> {
        self.published
            .load(Ordering::Acquire)
            .then_some(self.publication)
    }
    pub(crate) fn new(publication: CommitId) -> Self {
        Self {
            publication,
            published: Arc::new(AtomicBool::new(false)),
        }
    }
    pub(crate) fn publish(&self) {
        self.published.store(true, Ordering::Release);
    }
}
impl fmt::Debug for PreparedReceipt {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("PreparedReceipt")
            .field("main_publication", &self.main_publication())
            .finish()
    }
}

/// Real pending state and its sealed MAIN transition, with no published Commit.
/// Dropping this value cancels unpublished work. After-commit corrections run
/// only at ordinary admission; paste parity must inspect their drained chain.
pub struct PreparedUpdate {
    pub(crate) pending: PendingUpdate,
    pub(crate) transition: Box<PreparedTransition>,
    pub(crate) receipt: PreparedReceipt,
}
impl fmt::Debug for PreparedUpdate {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("PreparedUpdate")
            .field("receipt", &self.receipt)
            .finish_non_exhaustive()
    }
}
impl PreparedUpdate {
    /// The captured published state against which the main transition was prepared.
    pub fn previous(&self) -> &EditorState {
        &self.transition.prev
    }
    /// The real sealed main state, before any after-commit correction transactions.
    pub fn next(&self) -> &EditorState {
        &self.transition.next
    }
    /// Main-transition dirty metadata, in its actual processing order.
    pub fn changes(&self) -> &Changes {
        &self.transition.changes
    }
    /// Main update tags, before ordinary after-commit follow-ups.
    pub fn tags(&self) -> &TagSet {
        &self.transition.tags
    }
    /// Keys merged by the completed normalization pipeline.
    pub fn normalized(&self) -> &IndexSet<NodeKey> {
        &self.transition.normalized
    }
    /// Whether the sealed main transition changes selection.
    pub fn selection_changed(&self) -> bool {
        self.transition.selection_changed
    }
    /// The composition owner in the sealed main transition.
    pub fn composition_key(&self) -> Option<NodeKey> {
        self.transition.composition_key
    }
    /// Whether the main transition changes composition ownership.
    pub fn composition_changed(&self) -> bool {
        self.transition.composition_changed
    }
    /// Whether the main transition compares the complete maps.
    pub fn full_reconcile(&self) -> bool {
        self.transition.full_reconcile
    }
    /// A job-owned receipt; it remains pending through preparation and refusal.
    pub fn receipt(&self) -> PreparedReceipt {
        self.receipt.clone()
    }
    /// Encode a real main-transition diff using the ordinary borrowed walker.
    /// This explicitly invokes normal export hooks; it is not a drained-chain diff.
    pub fn diff(&self, options: &DiffOptions) -> Result<Diff, Error> {
        let mut diff = Diff {
            generation: self.next().max_key().generation(),
            full_reconcile: self.full_reconcile(),
            view_text_matches: None,
            ops: vec![],
            decorator_renders: vec![],
        };
        crate::diff::visit_transition_diff(
            self.previous().view(),
            self.next().view(),
            self.full_reconcile(),
            self.changes()
                .dirty_leaves
                .iter()
                .chain(self.changes().dirty_elements.keys())
                .copied(),
            options,
            |op| diff.ops.push(op),
        )?;
        diff.decorator_renders = crate::diff::collect_decorator_renders(
            self.previous().view(),
            self.next().view(),
            self.full_reconcile(),
            self.changes()
                .dirty_leaves
                .iter()
                .chain(self.changes().dirty_elements.keys())
                .copied(),
            &diff.ops,
        )?;
        Ok(diff)
    }
}

/// A failed preparation with ownership of the exact unpublished update.
pub struct PreparationFailure {
    error: Error,
    pending: Box<PendingUpdate>,
}
impl PreparationFailure {
    pub(crate) fn new(error: Error, pending: PendingUpdate) -> Self {
        Self {
            error,
            pending: Box::new(pending),
        }
    }
    /// The original model error, without boundary reclassification.
    pub fn error(&self) -> &Error {
        &self.error
    }
    /// Recover the error and the exact owned pending value.
    pub fn into_parts(self) -> (Error, PendingUpdate) {
        (self.error, *self.pending)
    }
}
impl fmt::Debug for PreparationFailure {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("PreparationFailure")
            .field("error", &self.error)
            .finish_non_exhaustive()
    }
}

impl fmt::Display for PreparationFailure {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Display::fmt(&self.error, f)
    }
}
impl std::error::Error for PreparationFailure {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        Some(&self.error)
    }
}

/// Pre-adoption refusal preserving the exact sealed capsule for caller recovery.
pub struct PreparedRefusal {
    error: Error,
    prepared: Box<PreparedUpdate>,
}
impl PreparedRefusal {
    /// The original admission preflight error.
    pub fn error(&self) -> &Error {
        &self.error
    }
    /// Recover the original error and the unadopted capsule.
    pub fn into_parts(self) -> (Error, PreparedUpdate) {
        (self.error, *self.prepared)
    }
}
impl fmt::Debug for PreparedRefusal {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("PreparedRefusal")
            .field("error", &self.error)
            .finish_non_exhaustive()
    }
}

impl fmt::Display for PreparedRefusal {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Display::fmt(&self.error, f)
    }
}
impl std::error::Error for PreparedRefusal {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        Some(&self.error)
    }
}

/// Ordinary synchronous preparation stays on the stack. Only an owned job boxes it.
pub(crate) struct PreparedTransition {
    pub(crate) publication_id: CommitId,
    pub(crate) receipt: Option<PreparedReceipt>,
    #[cfg(feature = "foreign-nodes")]
    pub(crate) foreign_update: Option<ForeignUpdateIdentity>,
    pub(crate) default_prevented: bool,
    pub(crate) events: Vec<PluginEvent>,
    pub(crate) prev: EditorState,
    pub(crate) next: EditorState,
    pub(crate) changes: Changes,
    pub(crate) tags: TagSet,
    pub(crate) normalized: IndexSet<NodeKey>,
    pub(crate) selection_changed: bool,
    pub(crate) composition_key: Option<NodeKey>,
    pub(crate) composition_changed: bool,
    pub(crate) full_reconcile: bool,
    pub(crate) preceding: Option<Box<Commit>>,
    #[cfg(feature = "bench-counters")]
    pub(crate) work: WorkCounters,
}
impl PreparedTransition {
    pub(crate) fn into_publication(self) -> (Commit, CommitId, Option<PreparedReceipt>) {
        (
            Commit {
                #[cfg(feature = "foreign-nodes")]
                foreign_update: self.foreign_update,
                default_prevented: self.default_prevented,
                following: vec![],
                follow_up_error: None,
                events: self.events,
                id: self.publication_id,
                prev: self.prev,
                next: self.next,
                changes: self.changes,
                tags: self.tags,
                normalized: self.normalized,
                selection_changed: self.selection_changed,
                composition_key: self.composition_key,
                composition_changed: self.composition_changed,
                full_reconcile: self.full_reconcile,
                preceding: self.preceding,
                #[cfg(feature = "bench-counters")]
                work: self.work,
            },
            self.publication_id,
            self.receipt,
        )
    }
}

impl Transaction<'_> {
    /// Seal a completed pipeline without publishing or running after-commit hooks.
    /// An incomplete or failed preparation returns the exact owned pending value.
    pub fn prepare(mut self) -> Result<PreparedUpdate, PreparationFailure> {
        if self.dirty_since_flush || self.pipeline_continuation.is_some() || !self.nested.is_empty()
        {
            return Err(PreparationFailure::new(
                Error::Invariant("pipeline must finish before preparation"),
                self.suspend(),
            ));
        }
        if self.preceding.is_some() {
            return Err(PreparationFailure::new(
                Error::Invariant("prepared update already published a preceding commit"),
                self.suspend(),
            ));
        }
        let transition = match self.prepared.take() {
            Some(value) => value,
            None => match self.prepare_transition(crate::commit::CacheReconciliation::Writable) {
                Ok(mut transition) => {
                    transition.receipt = Some(PreparedReceipt::new(transition.publication_id));
                    Box::new(transition)
                }
                Err(error) => return Err(PreparationFailure::new(error, self.suspend())),
            },
        };
        let receipt = match &transition.receipt {
            Some(receipt) => receipt.clone(),
            None => {
                return Err(PreparationFailure::new(
                    Error::Invariant("prepared transition has no publication receipt"),
                    self.suspend(),
                ));
            }
        };
        self.sealed = true;
        self.dirty_since_flush = false;
        self.defer_publication = true;
        Ok(PreparedUpdate {
            pending: self.suspend(),
            transition,
            receipt,
        })
    }

    pub(crate) fn check_prepared_publication(
        &self,
        transition: &PreparedTransition,
    ) -> Result<(), Error> {
        #[cfg(feature = "foreign-nodes")]
        if self.foreign_read_only {
            return Err(Error::ForeignReadOnly);
        }
        #[cfg(feature = "foreign-nodes")]
        ForeignReadOperation::check()?;
        if !self.sealed
            || self.dirty_since_flush
            || self.pipeline_continuation.is_some()
            || !self.nested.is_empty()
            || !self.events.is_empty()
            || self.preceding.is_some()
            || self.options.tags != transition.tags
            || self.default_prevented != transition.default_prevented
            || self.full_reconcile != transition.full_reconcile
            || self.composition_key != transition.composition_key
            || (self.selection_dirty && !transition.selection_changed)
        {
            return Err(Error::Invariant("sealed prepared update was modified"));
        }
        Ok(())
    }

    /// Adopt only after ordinary session readiness/access policy admits the command.
    /// Failure preserves the capsule; success grants no independent publication proof.
    pub fn adopt_prepared_update(
        &mut self,
        prepared: PreparedUpdate,
    ) -> Result<(), PreparedRefusal> {
        if let Err(error) = self.check_staged_update(&prepared.pending) {
            return Err(PreparedRefusal {
                error,
                prepared: Box::new(prepared),
            });
        }
        let PreparedUpdate {
            mut pending,
            transition,
            receipt: _,
        } = prepared;
        pending.prepared = Some(transition);
        self.install_staged_update(pending);
        Ok(())
    }
}

#[cfg(test)]
mod test;
