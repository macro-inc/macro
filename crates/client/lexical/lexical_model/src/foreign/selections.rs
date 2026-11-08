//! Selection object identities independent of transaction-local slot indices.
use crate::*;
use std::sync::Arc;

/// Identity of a development host selection object. Tokens retain no selection or editor.
#[derive(Clone, Debug)]
pub struct ForeignSelectionIdentity(Arc<()>);
impl PartialEq for ForeignSelectionIdentity {
    fn eq(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.0, &other.0)
    }
}
impl Eq for ForeignSelectionIdentity {}
impl Default for ForeignSelectionIdentity {
    fn default() -> Self {
        Self(Arc::new(()))
    }
}

#[derive(Clone, Default)]
pub(crate) struct SelectionIdentities {
    pub current: ForeignSelectionIdentity,
    pub detached: Vec<ForeignSelectionIdentity>,
}
impl Transaction<'_> {
    /// Identity of the existing selection object at this transaction slot.
    pub fn foreign_selection_identity(
        &self,
        slot: SelectionSlot,
    ) -> Option<ForeignSelectionIdentity> {
        match slot {
            SelectionSlot::Active => Some(self.foreign_selections.current.clone()),
            SelectionSlot::Detached(id) => self.foreign_selections.detached.get(id.0).cloned(),
        }
    }
    /// Locate an existing object after native replacement or explicit reactivation.
    pub fn foreign_selection_slot(
        &self,
        identity: &ForeignSelectionIdentity,
    ) -> Option<SelectionSlot> {
        if &self.foreign_selections.current == identity {
            return Some(SelectionSlot::Active);
        }
        self.foreign_selections
            .detached
            .iter()
            .rposition(|stored| stored == identity)
            .map(|index| SelectionSlot::Detached(DetachedSelectionId(index)))
    }
    /// Bind host object metadata while hydrating an independent read or update frame.
    /// This changes no selection value, replacement count or model dirtiness.
    /// Runtime object changes use replace_selection or activate_foreign_selection.
    pub fn bind_foreign_selection_identity(
        &mut self,
        slot: SelectionSlot,
        identity: ForeignSelectionIdentity,
    ) -> Result<(), Error> {
        match slot {
            SelectionSlot::Active => self.foreign_selections.current = identity,
            SelectionSlot::Detached(id) => {
                *self
                    .foreign_selections
                    .detached
                    .get_mut(id.0)
                    .ok_or(Error::UnknownSelectionSlot)? = identity;
            }
        }
        Ok(())
    }
    /// Hydrate an existing host selection object without allocating a new identity.
    pub fn detach_foreign_selection(
        &mut self,
        selection: Selection,
        identity: ForeignSelectionIdentity,
    ) -> SelectionSlot {
        let slot = self.detach_selection(selection);
        if let SelectionSlot::Detached(id) = slot {
            self.foreign_selections.detached[id.0] = identity;
        }
        slot
    }
    pub(crate) fn retire_foreign_selection(&mut self) {
        let identity = self.foreign_selections.current.clone();
        if let Some(selection) = self.selection().map(Selection::snapshot_for_foreign_read) {
            let SelectionSlot::Detached(id) = self.detach_selection(selection) else {
                unreachable!()
            };
            self.foreign_selections.detached[id.0] = identity;
        }
        self.foreign_selections.current = ForeignSelectionIdentity::default();
    }
    pub(crate) fn restore_foreign_selection_identity(
        &mut self,
        identity: ForeignSelectionIdentity,
    ) {
        if self.foreign_selections.current != identity {
            self.retire_foreign_selection();
            self.foreign_selections.current = identity;
        }
    }
    /// Activate the same host object from a detached slot, preserving its identity.
    pub fn activate_foreign_selection(&mut self, slot: SelectionSlot) -> Result<(), Error> {
        self.guard_write()?;
        let identity = self
            .foreign_selection_identity(slot)
            .ok_or(Error::UnknownSelectionSlot)?;
        let selection = self
            .selection_at(slot)?
            .map(Selection::snapshot_for_foreign_read);
        self.restore_foreign_selection_identity(identity);
        self.set_selection(selection)
    }
}

#[cfg(test)]
mod test;
