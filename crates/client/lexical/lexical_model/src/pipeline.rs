//! Commit-time model processing.
pub(crate) mod continuation;
mod gc;
mod model_caches;
mod normalize;
mod transforms;
use crate::*;
pub use continuation::{PipelineBudget, PipelineProgress};
pub use normalize::normalize_range_selection;
use std::collections::VecDeque;

/// Options applied to an atomic update.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct UpdateOptions {
    /// Normalize text without running transforms.
    pub skip_transforms: bool,
    /// Tags merged at the start of the update.
    pub tags: TagSet,
}
/// Processing policy at a flush boundary.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FlushMode {
    /// Normalize and run transforms to a fixpoint.
    Transforms,
    /// Normalize the current dirty text once.
    NormalizeOnly,
}
/// Queued update body, executed at the next drain point.
pub type NestedUpdateFn = fn(&mut Transaction<'_>) -> Result<(), Error>;
impl Transaction<'_> {
    /// Current update options.
    pub fn options(&self) -> &UpdateOptions {
        &self.options
    }
    /// Tags accumulated by this transaction.
    pub fn tags(&self) -> &TagSet {
        &self.options.tags
    }
    /// Add an update tag.
    pub fn add_tag(&mut self, tag: UpdateTag) {
        self.options.tags.insert(tag);
    }
    /// Whether a tag has been accumulated.
    pub fn has_tag(&self, tag: &UpdateTag) -> bool {
        self.options.tags.contains(tag)
    }
    /// Queue a nested update without executing it inline.
    pub fn queue_update(
        &mut self,
        update: NestedUpdateFn,
        options: UpdateOptions,
    ) -> Result<(), Error> {
        self.guard_write()?;
        self.nested.push_back((update, options));
        self.dirty_since_flush = true;
        Ok(())
    }
    pub(crate) fn drain_update(&mut self) -> Result<Option<bool>, Error> {
        #[cfg(feature = "foreign-nodes")]
        ForeignReadOperation::check()?;
        let Some((update, options)) = self.nested.pop_front() else {
            return Ok(None);
        };
        for tag in options.tags.iter() {
            self.add_tag(tag.clone());
        }
        update(self)?;
        #[cfg(feature = "foreign-nodes")]
        ForeignReadOperation::check()?;
        Ok(Some(options.skip_transforms))
    }
    #[cfg(all(test, feature = "foreign-nodes"))]
    pub(crate) fn drain_updates(&mut self) -> Result<bool, Error> {
        let mut skip_transforms = false;
        while let Some(skip) = self.drain_update()? {
            skip_transforms |= skip;
        }
        Ok(skip_transforms)
    }
    /// Run the model pipeline using the transaction's options.
    pub fn flush(&mut self) -> Result<(), Error> {
        self.flush_with(if self.options.skip_transforms {
            FlushMode::NormalizeOnly
        } else {
            FlushMode::Transforms
        })
    }
    /// Run queued updates, selection hooks, normalization, transforms, GC and validation.
    pub fn flush_with(&mut self, mode: FlushMode) -> Result<(), Error> {
        #[cfg(feature = "foreign-nodes")]
        if self.foreign_read_only {
            return Err(Error::ForeignReadOnly);
        }
        if self.sealed {
            return Ok(());
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
        let suspended = self.pipeline_continuation.is_some();
        let mut continuation = self.pipeline_continuation.take().map_or_else(
            || continuation::PipelineContinuation::new(mode),
            |value| *value,
        );
        let result = continuation.run(self, mode, None);
        self.transform_iterations = 0;
        if result.is_ok() {
            self.dirty_since_flush = false;
        } else if suspended {
            self.pipeline_continuation = Some(Box::new(continuation));
        }
        result.map(|_| ())
    }
    /// Run one node's virtual selection transform in the current mutable update.
    pub fn selection_transform(&mut self, key: NodeKey) -> Result<(), Error> {
        self.guard_write()?;
        let index = self.type_index(key).ok_or(Error::PointNodeNotFound(key))?;
        (self.pending.registry.vtable(index).selection_transform)(self, key)
    }
    /// Normalize the active range, preserving point-set side effects.
    pub fn normalize_selection(&mut self) -> Result<(), Error> {
        self.normalize_selection_at(SelectionSlot::Active)
    }
    /// Normalize a range in the selected slot.
    pub fn normalize_selection_at(&mut self, slot: SelectionSlot) -> Result<(), Error> {
        let Some(mut range) = self.try_range_at(slot).cloned() else {
            return Ok(());
        };
        let before = range.clone();
        normalize_range_selection(self.view(), &mut range)?;
        if before == range {
            return Ok(());
        }
        if let Some(composing) = self.composition_key {
            for (old, new) in [(before.anchor, range.anchor), (before.focus, range.focus)] {
                if old != new && old.key() == composing {
                    self.set_composition_key(Some(new.key()))?;
                }
            }
        }
        match slot {
            SelectionSlot::Active => self.set_selection(Some(Selection::Range(range)))?,
            SelectionSlot::Detached(id) => {
                if let Some(selection) = self.detached.get_mut(id.0) {
                    *selection = Some(Selection::Range(range));
                }
            }
        }
        Ok(())
    }
    pub(crate) fn guard_write(&self) -> Result<(), Error> {
        #[cfg(feature = "foreign-nodes")]
        ForeignReadOperation::check()?;
        #[cfg(feature = "foreign-nodes")]
        if self.foreign_read_only {
            return Err(Error::ForeignReadOnly);
        }
        if self.sealed {
            return Err(Error::WriteAfterSetEditorState);
        }
        if self.pipeline_continuation.is_some() {
            return Err(Error::Invariant("pipeline work is suspended"));
        }
        if self.transform_iterations > 99 {
            return Err(Error::InfiniteTransforms);
        }
        Ok(())
    }
}
pub(crate) fn nested_queue() -> VecDeque<(NestedUpdateFn, UpdateOptions)> {
    VecDeque::new()
}
pub(crate) use model_caches::apply as apply_model_caches;

#[cfg(test)]
mod test;
