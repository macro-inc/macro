use super::normalize::normalize_text_node;
use crate::*;
use std::mem;

fn run(
    tx: &mut Transaction<'_>,
    key: NodeKey,
    composing: Option<NodeKey>,
    #[cfg(feature = "foreign-nodes")] cache: &mut crate::foreign::runtime::TransformCache,
) -> Result<(), Error> {
    if Some(key) == composing || !tx.is_attached(key) {
        return Ok(());
    }
    let Some(index) = tx.type_index(key) else {
        return Ok(());
    };
    #[cfg(feature = "foreign-nodes")]
    cache.prepare(tx, index);
    let transforms = tx.pending.registry.vtable(index).transforms.clone();
    for transform in transforms {
        #[cfg(feature = "foreign-nodes")]
        ForeignReadOperation::check()?;
        if !tx.is_attached(key) {
            break;
        }
        transform.run(tx, key)?;
    }
    #[cfg(feature = "foreign-nodes")]
    cache.run(tx, index, key)?;
    Ok(())
}
#[derive(Default)]
enum TransformPhase {
    #[default]
    CopyLeaves,
    CopyElements,
    Leaves,
    Elements,
}
/// Transform fixpoint state, owned across bounded pipeline steps.
#[derive(Default)]
pub(super) struct TransformState {
    phase: TransformPhase,
    copy_index: usize,
    composing: Option<NodeKey>,
    master_leaves: crate::collections::IndexSet<NodeKey>,
    master_elements: crate::collections::IndexMap<NodeKey, DirtyIntent>,
    leaves: Option<indexmap::set::IntoIter<NodeKey>>,
    elements: Option<indexmap::map::IntoIter<NodeKey, DirtyIntent>>,
    first_elements: bool,
    #[cfg(feature = "foreign-nodes")]
    cache: crate::foreign::runtime::TransformCache,
}
impl TransformState {
    pub(super) fn new(composing: Option<NodeKey>) -> Self {
        Self {
            composing,
            first_elements: true,
            ..Self::default()
        }
    }
    /// One node or phase boundary; leaves retain priority and root runs last.
    pub(super) fn step(&mut self, tx: &mut Transaction<'_>) -> Result<bool, Error> {
        match self.phase {
            TransformPhase::CopyLeaves => {
                if let Some(key) = tx.dirty_leaves.get_index(self.copy_index) {
                    self.master_leaves.insert(*key);
                    self.copy_index += 1;
                } else {
                    self.copy_index = 0;
                    self.phase = TransformPhase::CopyElements;
                }
            }
            TransformPhase::CopyElements => {
                if let Some((key, intent)) = tx.dirty_elements.get_index(self.copy_index) {
                    self.master_elements.insert(*key, *intent);
                    self.copy_index += 1;
                } else {
                    self.phase = TransformPhase::Leaves;
                }
            }
            TransformPhase::Leaves => {
                if let Some(key) = self.leaves.as_mut().and_then(Iterator::next) {
                    #[cfg(feature = "bench-counters")]
                    {
                        tx.work.nodes_visited += 1;
                    }
                    normalize_text_node(tx, key)?;
                    run(
                        tx,
                        key,
                        self.composing,
                        #[cfg(feature = "foreign-nodes")]
                        &mut self.cache,
                    )?;
                    self.master_leaves.insert(key);
                } else {
                    if self.leaves.take().is_some() && !tx.dirty_leaves.is_empty() {
                        tx.transform_iterations += 1;
                    }
                    if tx.dirty_leaves.is_empty() {
                        let mut elements = mem::take(&mut tx.dirty_elements);
                        if elements.shift_remove(&NodeKey::ROOT).is_some() {
                            elements.insert(NodeKey::ROOT, DirtyIntent::Intentional);
                            if self.first_elements {
                                self.master_elements.shift_remove(&NodeKey::ROOT);
                            }
                        }
                        self.first_elements = false;
                        self.elements = Some(elements.into_iter());
                        self.phase = TransformPhase::Elements;
                    } else {
                        self.leaves = Some(mem::take(&mut tx.dirty_leaves).into_iter());
                    }
                }
            }
            TransformPhase::Elements => {
                if let Some((key, intent)) = self.elements.as_mut().and_then(Iterator::next) {
                    #[cfg(feature = "bench-counters")]
                    {
                        tx.work.nodes_visited += 1;
                    }
                    self.master_elements.insert(key, intent);
                    if intent == DirtyIntent::Intentional {
                        run(
                            tx,
                            key,
                            self.composing,
                            #[cfg(feature = "foreign-nodes")]
                            &mut self.cache,
                        )?;
                    }
                } else {
                    self.elements = None;
                    tx.transform_iterations += 1;
                    if tx.dirty_leaves.is_empty() && tx.dirty_elements.is_empty() {
                        tx.dirty_leaves = mem::take(&mut self.master_leaves);
                        tx.dirty_elements = mem::take(&mut self.master_elements);
                        return Ok(true);
                    }
                    self.phase = TransformPhase::Leaves;
                }
            }
        }
        Ok(false)
    }
}
