//! Shared selection objects and transaction-local slot/activation metadata.
use super::{Result, fail};
use lexical_model::{ForeignSelectionIdentity, Selection, SelectionSlot, Transaction};
use std::sync::{Arc, Mutex, MutexGuard};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct ActiveSelection {
    pub id: usize,
    revision: u64,
}

#[derive(Clone, Default)]
pub(crate) struct SelectionBindings {
    objects: Arc<Mutex<Objects>>,
    frame: Arc<Mutex<Frame>>,
}
#[derive(Default)]
struct Objects {
    identities: Vec<ForeignSelectionIdentity>,
    values: Vec<Option<Selection>>,
}
#[derive(Clone, Default)]
struct Frame {
    slots: Vec<Option<SelectionSlot>>,
    active: Option<usize>,
    revision: u64,
}
impl SelectionBindings {
    fn objects(&self) -> Result<MutexGuard<'_, Objects>> {
        self.objects
            .lock()
            .map_err(|_| fail("selection object store poisoned"))
    }
    fn frame(&self) -> Result<MutexGuard<'_, Frame>> {
        self.frame
            .lock()
            .map_err(|_| fail("selection frame store poisoned"))
    }
    pub fn active(&self) -> Result<Option<ActiveSelection>> {
        let values = self.frame()?;
        Ok(values.active.map(|id| ActiveSelection {
            id,
            revision: values.revision,
        }))
    }
    pub fn set_active(&self, active: Option<usize>) -> Result<()> {
        let mut values = self.frame()?;
        if active.is_some_and(|id| values.slots.get(id).copied().flatten().is_none()) {
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
        let mut values = self.frame()?;
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
        Ok(self.frame()?.slots.get(id).copied().flatten())
    }
    pub fn set_slot(&self, id: usize, slot: SelectionSlot) -> Result<()> {
        if id >= self.objects()?.identities.len() {
            return Err(fail("selection handle"));
        }
        let mut frame = self.frame()?;
        let size = frame.slots.len().max(id + 1);
        frame.slots.resize(size, None);
        frame.slots[id] = Some(slot);
        Ok(())
    }
    pub fn identity(&self, id: usize) -> Result<Option<ForeignSelectionIdentity>> {
        Ok(self.objects()?.identities.get(id).cloned())
    }
    pub fn find(&self, identity: &ForeignSelectionIdentity) -> Result<Option<usize>> {
        Ok(self
            .objects()?
            .identities
            .iter()
            .position(|known| known == identity))
    }
    pub fn resolve(&self, tx: &mut Transaction<'_>, id: usize) -> Result<Option<SelectionSlot>> {
        let Some(identity) = self.identity(id)? else {
            return Ok(None);
        };
        let slot = match tx.foreign_selection_slot(&identity) {
            Some(slot) => slot,
            None => {
                let value = self
                    .objects()?
                    .values
                    .get(id)
                    .and_then(Option::as_ref)
                    .map(Selection::snapshot_for_foreign_read);
                let Some(value) = value else { return Ok(None) };
                tx.detach_foreign_selection(value, identity)
            }
        };
        self.set_slot(id, slot)?;
        Ok(Some(slot))
    }
    pub fn synchronize(&self, tx: &Transaction<'_>) -> Result<()> {
        let identities = self.objects()?.identities.clone();
        let slots = identities
            .iter()
            .map(|identity| tx.foreign_selection_slot(identity))
            .collect();
        self.frame()?.slots = slots;
        if let Some(active) = self.active()?
            && self.try_slot(active.id)? != Some(SelectionSlot::Active)
        {
            self.clear_if_active(Some(active))?;
        }
        Ok(())
    }
    pub fn push(&self, slot: SelectionSlot, identity: ForeignSelectionIdentity) -> Result<usize> {
        let id = {
            let mut values = self.objects()?;
            let id = values.identities.len();
            values.identities.push(identity);
            values.values.push(None);
            id
        };
        self.set_slot(id, slot)?;
        Ok(id)
    }
    pub fn slots(&self) -> Result<Vec<Option<SelectionSlot>>> {
        Ok(self.frame()?.slots.clone())
    }
    pub fn replace_slots(&self, slots: Vec<Option<SelectionSlot>>) -> Result<()> {
        self.frame()?.slots = slots;
        Ok(())
    }
    pub fn values(&self) -> Result<Vec<Option<Selection>>> {
        Ok(self
            .objects()?
            .values
            .iter()
            .map(|selection| selection.as_ref().map(Selection::snapshot_for_foreign_read))
            .collect())
    }
    pub fn save_value(&self, id: usize, value: Option<Selection>) -> Result<()> {
        *self
            .objects()?
            .values
            .get_mut(id)
            .ok_or_else(|| fail("selection handle"))? = value;
        Ok(())
    }
    pub fn restore_values(&self, values: Vec<Option<Selection>>) -> Result<()> {
        self.set_active(None)?;
        {
            let mut stored = self.objects()?;
            stored.identities.truncate(values.len());
            stored.values = values;
        }
        self.frame()?.slots.clear();
        Ok(())
    }
}

#[cfg(test)]
mod test;
