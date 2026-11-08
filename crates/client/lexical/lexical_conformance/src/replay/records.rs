//! Record identity allocation shared by independent callback dispatch frames.
use super::{Result, fail};
use lexical_model::NodeKey;
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

#[derive(Clone, Default)]
pub(crate) struct RecordIdentities(Arc<Mutex<Records>>);

#[derive(Default)]
struct Records {
    by_pointer: HashMap<(NodeKey, usize), (u64, u64)>,
    next: u64,
}

impl RecordIdentities {
    /// Only owned identity data is accessed under this guard; no model or host
    /// call runs in this scope.
    pub fn identify(&self, key: NodeKey, pointer: usize, version: u64) -> Result<(u64, u64)> {
        let mut records = self
            .0
            .lock()
            .map_err(|_| fail("record identity store poisoned"))?;
        if let Some(record) = records.by_pointer.get(&(key, pointer)) {
            return Ok(*record);
        }
        let record = (version, records.next);
        records.next = records
            .next
            .checked_add(1)
            .ok_or_else(|| fail("record identity overflow"))?;
        records.by_pointer.insert((key, pointer), record);
        Ok(record)
    }

    pub fn release_version(&self, version: u64) -> Result<()> {
        self.0
            .lock()
            .map_err(|_| fail("record identity store poisoned"))?
            .by_pointer
            .retain(|_, (owner, _)| *owner != version);
        Ok(())
    }
}
