//! Selection identities shared by mutable dispatch frames of one transaction.
use super::{Result, fail};
use lexical_model::{ForeignSelectionIdentity, Selection, SelectionSlot, Transaction};
use std::sync::{Arc, Mutex, MutexGuard};

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) struct ActiveSelection {
    pub id: usize,
    revision: u64,
}

#[derive(Clone, Default)]
pub(crate) struct SelectionBindings(Arc<Mutex<Selections>>);

#[derive(Default)]
struct Selections {
    slots: Vec<SelectionSlot>,
    identities: Vec<ForeignSelectionIdentity>,
    values: Vec<Option<Selection>>,
    active: Option<usize>,
    revision: u64,
}

impl SelectionBindings {
    fn lock(&self) -> Result<MutexGuard<'_, Selections>> {
        self.0
            .lock()
            .map_err(|_| fail("selection binding store poisoned"))
    }

    pub fn active(&self) -> Result<Option<ActiveSelection>> {
        let values = self.lock()?;
        Ok(values.active.map(|id| ActiveSelection {
            id,
            revision: values.revision,
        }))
    }

    pub fn set_active(&self, active: Option<usize>) -> Result<()> {
        let mut values = self.lock()?;
        if active.is_some_and(|id| id >= values.slots.len()) {
            return Err(fail("unknown selection handle"));
        }
        values.revision = values
            .revision
            .checked_add(1)
            .ok_or_else(|| fail("selection revision overflow"))?;
        values.active = active;
        Ok(())
    }

    pub fn clear_if_active(&self, expected: Option<ActiveSelection>) -> Result<()> {
        let mut values = self.lock()?;
        let active = values.active.map(|id| ActiveSelection {
            id,
            revision: values.revision,
        });
        if active == expected {
            values.revision = values
                .revision
                .checked_add(1)
                .ok_or_else(|| fail("selection revision overflow"))?;
            values.active = None;
        }
        Ok(())
    }

    pub fn try_slot(&self, id: usize) -> Result<Option<SelectionSlot>> {
        Ok(self.lock()?.slots.get(id).copied())
    }

    pub fn slot(&self, id: usize) -> Result<SelectionSlot> {
        self.try_slot(id)?.ok_or_else(|| fail("selection handle"))
    }

    pub fn set_slot(&self, id: usize, slot: SelectionSlot) -> Result<()> {
        *self
            .lock()?
            .slots
            .get_mut(id)
            .ok_or_else(|| fail("selection handle"))? = slot;
        Ok(())
    }

    pub fn identity(&self, id: usize) -> Result<ForeignSelectionIdentity> {
        self.lock()?
            .identities
            .get(id)
            .cloned()
            .ok_or_else(|| fail("selection identity"))
    }
    pub fn find(&self, identity: &ForeignSelectionIdentity) -> Result<Option<usize>> {
        let values = self.lock()?;
        Ok(values
            .identities
            .iter()
            .take(values.slots.len())
            .position(|known| known == identity))
    }
    pub fn synchronize(&self, tx: &Transaction<'_>) -> Result<()> {
        let slots = self.slots()?;
        for id in 0..slots.len() {
            let identity = self.identity(id)?;
            if let Some(slot) = tx.foreign_selection_slot(&identity) {
                self.set_slot(id, slot)?;
            }
        }
        if let Some(active) = self.active()?
            && self.slot(active.id)? != SelectionSlot::Active
        {
            self.clear_if_active(Some(active))?;
        }
        Ok(())
    }
    pub fn push(&self, slot: SelectionSlot, identity: ForeignSelectionIdentity) -> Result<usize> {
        let mut values = self.lock()?;
        let id = values.slots.len();
        values.slots.push(slot);
        values.identities.push(identity);
        values.values.push(None);
        Ok(id)
    }

    pub fn slots(&self) -> Result<Vec<SelectionSlot>> {
        Ok(self.lock()?.slots.clone())
    }

    pub fn replace_slots(&self, slots: Vec<SelectionSlot>) -> Result<()> {
        self.lock()?.slots = slots;
        Ok(())
    }

    pub fn values(&self) -> Result<Vec<Option<Selection>>> {
        Ok(self
            .lock()?
            .values
            .iter()
            .map(|selection| selection.as_ref().map(Selection::snapshot_for_foreign_read))
            .collect())
    }

    pub fn replace_values(&self, values: Vec<Option<Selection>>) -> Result<()> {
        self.lock()?.values = values;
        Ok(())
    }

    pub fn restore_values(&self, values: Vec<Option<Selection>>) -> Result<()> {
        self.set_active(None)?;
        let mut stored = self.lock()?;
        stored.identities.truncate(values.len());
        stored.values = values;
        stored.slots.clear();
        Ok(())
    }
}
