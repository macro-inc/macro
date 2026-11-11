//! Session-owned native policies and an exhaustive transport projection without signatures.
use crate::*;
use std::collections::BTreeSet;

#[derive(Default)]
pub(crate) struct PendingDecorators {
    generation: Option<u32>,
    pub(crate) retired: BTreeSet<NodeKey>,
    pub(crate) policies: BTreeMap<NodeKey, DecoratorRenderPolicy>,
}
impl PendingDecorators {
    /// Preserve the latest live native policy before handing a patch to the view.
    /// This queues facts only: no signature observation or revision assignment occurs here.
    pub(crate) fn project(&mut self, value: lexical_model::Diff) -> FfiDiff {
        // No `..`: adding a domain field requires an explicit boundary decision.
        let lexical_model::Diff {
            generation,
            full_reconcile,
            view_text_matches,
            ops,
            decorator_renders,
        } = value;
        if self.generation != Some(generation) {
            self.policies.clear();
            self.retired.clear();
            self.generation = Some(generation);
        }
        for op in &ops {
            if let DiffOp::Remove { key, .. } = op
                && self.policies.remove(key).is_some()
            {
                self.retired.insert(*key);
            }
        }
        let mut decorator_keys = Vec::with_capacity(decorator_renders.len());
        // Explicit wire omission: policies/signatures stay in this session-owned queue.
        // Only keys cross to invalidate cached facts. A consuming view must acknowledge
        // actual fact installation before promoting any signature observation baseline.
        for change in decorator_renders {
            decorator_keys.push(change.key);
            match change.policy {
                Some(policy) => {
                    self.policies.insert(change.key, policy);
                    self.retired.remove(&change.key);
                }
                None => {
                    self.policies.remove(&change.key);
                    self.retired.insert(change.key);
                }
            }
        }
        FfiDiff {
            generation,
            full_reconcile,
            view_text_matches,
            ops,
            decorator_keys,
        }
    }
}
