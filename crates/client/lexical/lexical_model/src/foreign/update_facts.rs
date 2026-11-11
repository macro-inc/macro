//! Actual update metadata captured for pure host callouts, independent of graph reads.
use crate::*;
use std::sync::Arc;

/// Native update work state, matching the host's three dirty-state meanings.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ForeignDirtyType {
    /// No node processing is pending.
    #[default]
    Clean,
    /// Exact dirty nodes are known.
    Nodes,
    /// The update explicitly requires a complete reconciliation.
    FullReconcile,
}
/// Owned native facts, never inferred from exported/rendered record membership.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ForeignUpdateFacts {
    /// Actual update reconciliation mode.
    pub dirty_type: ForeignDirtyType,
    /// Dirty leaf keys in native processing order.
    pub dirty_leaves: Vec<NodeKey>,
    /// Dirty element keys and exact intentional/incidental marks.
    pub dirty_elements: Vec<(NodeKey, DirtyIntent)>,
}
#[derive(Clone, Copy)]
pub(crate) enum UpdateFactsRef<'a> {
    Transaction {
        leaves: &'a DirtyLeaves,
        elements: &'a crate::collections::IndexMap<NodeKey, DirtyIntent>,
        full_reconcile: bool,
    },
    Captured(&'a Arc<ForeignUpdateFacts>),
}
impl StateRef<'_> {
    /// Capture exact update metadata without callbacks, normalization or graph scans.
    pub fn foreign_update_facts(self) -> Arc<ForeignUpdateFacts> {
        match self.foreign_update_facts {
            Some(UpdateFactsRef::Captured(facts)) => facts.clone(),
            Some(UpdateFactsRef::Transaction {
                leaves,
                elements,
                full_reconcile,
            }) => Arc::new(ForeignUpdateFacts {
                dirty_type: if full_reconcile {
                    ForeignDirtyType::FullReconcile
                } else if leaves.is_empty() && elements.is_empty() {
                    ForeignDirtyType::Clean
                } else {
                    ForeignDirtyType::Nodes
                },
                dirty_leaves: leaves.iter().copied().collect(),
                dirty_elements: elements
                    .iter()
                    .map(|(key, intent)| (*key, *intent))
                    .collect(),
            }),
            None => Arc::default(),
        }
    }
}
impl ForeignReadSnapshot {
    /// Exact source update facts, retained unchanged through independent read peers.
    /// Composition and selection remain available through the snapshot's view.
    pub fn update_facts(&self) -> &ForeignUpdateFacts {
        &self.update_facts
    }
}
#[cfg(test)]
mod test;
