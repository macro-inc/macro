//! Record identity allocation shared by independent callback dispatch frames.
use super::{Result, fail};
use lexical_model::{ForeignRecordIdentity, NodeKey};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

#[derive(Clone, Default)]
pub(crate) struct RecordIdentities(Arc<Mutex<Records>>);

#[derive(Default)]
struct Records {
    by_record: HashMap<(NodeKey, ForeignRecordIdentity), (u64, u64)>,
    next: u64,
}

impl RecordIdentities {
    /// Only owned identity data is accessed under this guard; no model or host
    /// call runs in this scope.
    pub fn identify(
        &self,
        key: NodeKey,
        identity: ForeignRecordIdentity,
        version: u64,
    ) -> Result<(u64, u64)> {
        let mut records = self
            .0
            .lock()
            .map_err(|_| fail("record identity store poisoned"))?;
        if let Some(record) = records.by_record.get(&(key, identity.clone())) {
            return Ok(*record);
        }
        let record = (version, records.next);
        records.next = records
            .next
            .checked_add(1)
            .ok_or_else(|| fail("record identity overflow"))?;
        records.by_record.insert((key, identity), record);
        Ok(record)
    }

    pub fn retain(
        &self,
        live: &std::collections::HashSet<(NodeKey, ForeignRecordIdentity)>,
    ) -> Result<()> {
        self.0
            .lock()
            .map_err(|_| fail("record identity store poisoned"))?
            .by_record
            .retain(|key, _| live.contains(key));
        Ok(())
    }

    pub fn matches(
        &self,
        key: NodeKey,
        record: &ForeignRecordIdentity,
        identity: u64,
    ) -> Result<bool> {
        Ok(self
            .0
            .lock()
            .map_err(|_| fail("record identity store poisoned"))?
            .by_record
            .get(&(key, record.clone()))
            .is_some_and(|record| record.1 == identity))
    }

    pub fn release_version(&self, version: u64) -> Result<()> {
        self.0
            .lock()
            .map_err(|_| fail("record identity store poisoned"))?
            .by_record
            .retain(|_, (owner, _)| *owner != version);
        Ok(())
    }
}
