//! Commit-time model processing.
mod gc;
mod model_caches;
mod normalize;
mod transforms;
use crate::*;
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
    pub(crate) fn drain_updates(&mut self) -> Result<bool, Error> {
        let mut skip_transforms = false;
        while let Some((update, options)) = self.nested.pop_front() {
            skip_transforms |= options.skip_transforms;
            for tag in options.tags.iter() {
                self.add_tag(tag.clone());
            }
            update(self)?;
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
        let result = self.flush_inner(mode);
        #[cfg(feature = "foreign-nodes")]
        let result = result.and_then(|()| self.view().check_foreign_payloads());
        self.transform_iterations = 0;
        if result.is_ok() {
            self.dirty_since_flush = false;
        }
        result
    }
    fn flush_inner(&mut self, mode: FlushMode) -> Result<(), Error> {
        let nested_skip_transforms = self.drain_updates()?;
        let anchor = self
            .try_range_at(SelectionSlot::Active)
            .map(|range| range.anchor);
        let mut anchor_key = None;
        if let Some(Point::Text { key, .. }) = anchor {
            self.run_selection_transform(key)?;
            anchor_key = Some(key);
        }
        // The anchor hook may move the live focus, including to a newly created node.
        if let Some(Point::Text { key, .. }) = self
            .try_range_at(SelectionSlot::Active)
            .map(|range| range.focus)
            && Some(key) != anchor_key
        {
            self.run_selection_transform(key)?;
        }
        if !self.dirty_leaves.is_empty() || !self.dirty_elements.is_empty() {
            if mode == FlushMode::NormalizeOnly
                || self.options.skip_transforms
                || nested_skip_transforms
            {
                for key in self.dirty_leaves.clone() {
                    normalize::normalize_text_node(self, key)?;
                }
            } else {
                transforms::apply(self)?;
            }
            self.drain_updates()?;
            gc::collect(self);
        }
        if let Some(Selection::Range(range)) = &self.pending.selection
            && (!self.pending.nodes.contains_key(&range.anchor.key())
                || !self.pending.nodes.contains_key(&range.focus.key()))
        {
            return Err(Error::SelectionLost);
        }
        if matches!(&self.pending.selection, Some(Selection::Node(selection)) if selection.nodes.is_empty())
        {
            #[cfg(feature = "foreign-nodes")]
            self.retire_foreign_selection();
            self.pending.selection = None;
        }
        #[cfg(debug_assertions)]
        for key in self.dirty_leaves.iter().chain(self.dirty_elements.keys()) {
            if let Some(node) = self.pending.nodes.get(key)
                && let Some(flags) = self.pending.registry.registered(node.type_index).flags
                && self.view().type_flags(*key) != flags
            {
                return Err(Error::TypeFlagsMismatch(
                    self.pending.registry.registered(node.type_index).type_name,
                ));
            }
        }
        Ok(())
    }
    fn run_selection_transform(&mut self, key: NodeKey) -> Result<(), Error> {
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
        if self.foreign_read_only {
            return Err(Error::ForeignReadOnly);
        }
        if self.sealed {
            return Err(Error::WriteAfterSetEditorState);
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
