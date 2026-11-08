//! Development-only raw records retained after actual removal.
use crate::{NodeKey, NodeRef, Transaction};

impl Transaction<'_> {
    /// Last record removed from this update, for captured host fields only.
    /// This never makes it reachable through node lookup or tree traversal.
    pub fn retired_record(&self, key: NodeKey) -> Option<NodeRef<'_>> {
        self.foreign_retired_records
            .get(&key)
            .map(|slot| NodeRef::from_retired(slot, &self.pending.registry))
    }
}

#[cfg(test)]
mod test;
