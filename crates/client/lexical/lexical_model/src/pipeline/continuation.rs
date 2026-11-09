//! Owned work cursors for an unpublished, cooperatively scheduled pipeline.
use super::{gc, normalize, transforms};
use crate::*;
use std::num::NonZeroUsize;

/// A maximum number of node-work and phase-boundary operations per call.
///
/// This is not a wall-clock limit. A virtual hook, text merge, ordered-map
/// removal or final foreign payload validation remains synchronous.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PipelineBudget {
    /// Maximum operations before returning to the host.
    pub max_work: NonZeroUsize,
}
/// Whether this unpublished pipeline has reached its normal flush boundary.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PipelineProgress {
    /// More processing is required; nothing was published.
    Pending,
    /// The normal pipeline, including its failure guards, finished.
    Complete,
}
#[derive(Clone, Copy)]
enum Phase {
    Updates,
    Anchor,
    Focus,
    Dirty,
    NormalizeCopy,
    Normalize,
    Transforms,
    AfterUpdates,
    Collect,
    Selection,
    Validate,
    Finish,
    Complete,
    Failed,
}
/// Owned transaction work, moved unchanged through suspend and resume.
pub(crate) struct PipelineContinuation {
    mode: FlushMode,
    phase: Phase,
    nested_skip: bool,
    anchor_key: Option<NodeKey>,
    index: usize,
    normalize: crate::collections::IndexSet<NodeKey>,
    transforms: transforms::TransformState,
    collection: gc::Collection,
}
impl PipelineContinuation {
    pub(crate) fn new(mode: FlushMode) -> Self {
        Self {
            mode,
            phase: Phase::Updates,
            nested_skip: false,
            anchor_key: None,
            index: 0,
            normalize: Default::default(),
            transforms: Default::default(),
            collection: Default::default(),
        }
    }
    pub(crate) fn matches_mode(&self, mode: FlushMode) -> bool {
        self.mode == mode
    }
    pub(crate) fn run(
        &mut self,
        tx: &mut Transaction<'_>,
        mode: FlushMode,
        budget: Option<PipelineBudget>,
    ) -> Result<PipelineProgress, Error> {
        if self.mode != mode {
            return Err(Error::Invariant("cannot change a suspended pipeline mode"));
        }
        let mut remaining = budget.map(|budget| budget.max_work.get());
        loop {
            if matches!(self.phase, Phase::Complete) {
                return Ok(PipelineProgress::Complete);
            }
            if remaining == Some(0) {
                return Ok(PipelineProgress::Pending);
            }
            if let Some(remaining) = &mut remaining {
                *remaining -= 1;
            }
            if let Err(error) = self.step(tx) {
                self.phase = Phase::Failed;
                return Err(error);
            }
        }
    }
    fn update(&mut self, tx: &mut Transaction<'_>) -> Result<bool, Error> {
        let Some(skip) = tx.drain_update()? else {
            return Ok(false);
        };
        self.nested_skip |= skip;
        Ok(true)
    }
    fn step(&mut self, tx: &mut Transaction<'_>) -> Result<(), Error> {
        match self.phase {
            Phase::Updates => {
                if !self.update(tx)? {
                    self.phase = Phase::Anchor;
                }
            }
            Phase::Anchor => {
                if let Some(Point::Text { key, .. }) = tx
                    .try_range_at(SelectionSlot::Active)
                    .map(|range| range.anchor)
                {
                    tx.selection_transform(key)?;
                    self.anchor_key = Some(key);
                }
                self.phase = Phase::Focus;
            }
            Phase::Focus => {
                if let Some(Point::Text { key, .. }) = tx
                    .try_range_at(SelectionSlot::Active)
                    .map(|range| range.focus)
                    && Some(key) != self.anchor_key
                {
                    tx.selection_transform(key)?;
                }
                self.phase = Phase::Dirty;
            }
            Phase::Dirty => {
                if tx.dirty_leaves.is_empty() && tx.dirty_elements.is_empty() {
                    self.phase = Phase::Selection;
                } else if self.mode == FlushMode::NormalizeOnly
                    || tx.options.skip_transforms
                    || self.nested_skip
                {
                    self.phase = Phase::NormalizeCopy;
                } else {
                    self.transforms = transforms::TransformState::new(tx.composition_key);
                    self.phase = Phase::Transforms;
                }
            }
            Phase::NormalizeCopy => {
                if let Some(key) = tx.dirty_leaves.get_index(self.index) {
                    self.normalize.insert(*key);
                    self.index += 1;
                } else {
                    self.index = 0;
                    self.phase = Phase::Normalize;
                }
            }
            Phase::Normalize => {
                if let Some(key) = self.normalize.get_index(self.index).copied() {
                    self.index += 1;
                    normalize::normalize_text_node(tx, key)?;
                } else {
                    self.phase = Phase::AfterUpdates;
                }
            }
            Phase::Transforms => {
                if self.transforms.step(tx)? {
                    self.phase = Phase::AfterUpdates;
                }
            }
            Phase::AfterUpdates => {
                if !self.update(tx)? {
                    #[cfg(feature = "foreign-nodes")]
                    ForeignReadOperation::check()?;
                    self.phase = Phase::Collect;
                }
            }
            Phase::Collect => {
                if self.collection.step(tx) {
                    self.phase = Phase::Selection;
                }
            }
            Phase::Selection => {
                if let Some(Selection::Range(range)) = &tx.pending.selection
                    && (!tx.pending.nodes.contains_key(&range.anchor.key())
                        || !tx.pending.nodes.contains_key(&range.focus.key()))
                {
                    return Err(Error::SelectionLost);
                }
                if matches!(&tx.pending.selection, Some(Selection::Node(selection)) if selection.nodes.is_empty())
                {
                    #[cfg(feature = "foreign-nodes")]
                    tx.retire_foreign_selection();
                    tx.pending.selection = None;
                }
                self.index = 0;
                self.phase = Phase::Validate;
            }
            Phase::Validate => {
                #[cfg(debug_assertions)]
                {
                    let key = if self.index < tx.dirty_leaves.len() {
                        tx.dirty_leaves.get_index(self.index).copied()
                    } else {
                        tx.dirty_elements
                            .get_index(self.index - tx.dirty_leaves.len())
                            .map(|(key, _)| *key)
                    };
                    if let Some(key) = key {
                        self.index += 1;
                        if let Some(node) = tx.pending.nodes.get(&key)
                            && let Some(flags) =
                                tx.pending.registry.registered(node.type_index).flags
                            && tx.view().type_flags(key) != flags
                        {
                            return Err(Error::TypeFlagsMismatch(
                                tx.pending.registry.registered(node.type_index).type_name,
                            ));
                        }
                        return Ok(());
                    }
                }
                self.phase = Phase::Finish;
            }
            Phase::Finish => {
                #[cfg(feature = "foreign-nodes")]
                ForeignReadOperation::check()?;
                #[cfg(feature = "foreign-nodes")]
                tx.check_pending_foreign_payloads()?;
                self.phase = Phase::Complete;
            }
            Phase::Complete => {}
            Phase::Failed => return Err(Error::Invariant("cannot resume a failed pipeline")),
        }
        Ok(())
    }
}
impl Transaction<'_> {
    /// Advance the actual flush pipeline without publishing an intermediate state.
    ///
    /// Between calls the owner must retain exclusive update authority. Budgeting
    /// counts work units, not elapsed time; synchronous custom hooks are atomic.
    pub fn step_pipeline(
        &mut self,
        mode: FlushMode,
        budget: PipelineBudget,
    ) -> Result<PipelineProgress, Error> {
        #[cfg(feature = "foreign-nodes")]
        if self.foreign_read_only {
            return Err(Error::ForeignReadOnly);
        }
        if self.sealed {
            return Ok(PipelineProgress::Complete);
        }
        #[cfg(feature = "foreign-nodes")]
        ForeignReadOperation::check()?;
        if self
            .pipeline_continuation
            .as_ref()
            .is_some_and(|state| !state.matches_mode(mode))
        {
            return Err(Error::Invariant("cannot change a suspended pipeline mode"));
        }
        self.dirty_since_flush = true;
        let mut continuation = self
            .pipeline_continuation
            .take()
            .unwrap_or_else(|| Box::new(PipelineContinuation::new(mode)));
        match continuation.run(self, mode, Some(budget)) {
            Ok(PipelineProgress::Complete) => {
                self.transform_iterations = 0;
                self.dirty_since_flush = false;
                Ok(PipelineProgress::Complete)
            }
            result => {
                if result.is_err() {
                    self.transform_iterations = 0;
                }
                self.pipeline_continuation = Some(continuation);
                result
            }
        }
    }
}
#[cfg(test)]
mod test;
