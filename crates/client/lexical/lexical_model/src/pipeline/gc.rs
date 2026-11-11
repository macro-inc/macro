use crate::collections::IndexSet;
use crate::*;

#[derive(Default)]
enum CollectionPhase {
    #[default]
    CopyElements,
    Walk,
    Remove,
    CopyLeaves,
    Leaves,
}
/// Resumable version of the dirty detached-root collection pass.
#[derive(Default)]
pub(super) struct Collection {
    phase: CollectionPhase,
    keys: Vec<NodeKey>,
    index: usize,
    stack: Vec<NodeKey>,
    walking: Option<(NodeKey, Option<NodeKey>)>,
    deleted: IndexSet<NodeKey>,
    removals: Option<indexmap::set::IntoIter<NodeKey>>,
}
impl Collection {
    pub(super) fn step(&mut self, tx: &mut Transaction<'_>) -> bool {
        match self.phase {
            CollectionPhase::CopyElements => {
                if let Some((key, _)) = tx.dirty_elements.get_index(self.index) {
                    self.keys.push(*key);
                    self.index += 1;
                } else {
                    self.index = 0;
                    self.phase = CollectionPhase::Walk;
                }
            }
            CollectionPhase::Walk => {
                if let Some((node, child)) = self.walking {
                    if let Some(child) = child {
                        self.walking = Some((node, tx.next_sibling(child)));
                        if tx.parent(child) == Some(node) {
                            self.stack.push(child);
                        }
                    } else {
                        self.deleted.insert(node);
                        if !tx.editor.state.nodes.contains_key(&node) {
                            tx.dirty_elements.shift_remove(&node);
                        }
                        self.walking = None;
                    }
                } else if let Some(node) = self.stack.pop() {
                    self.walking = Some((node, tx.first_child(node)));
                } else if let Some(key) = self.keys.get(self.index).copied() {
                    self.index += 1;
                    if !tx.is_attached(key) {
                        self.stack.push(key);
                    }
                } else {
                    self.removals = Some(std::mem::take(&mut self.deleted).into_iter());
                    self.keys.clear();
                    self.index = 0;
                    self.phase = CollectionPhase::Remove;
                }
            }
            CollectionPhase::Remove => {
                if let Some(key) = self.removals.as_mut().and_then(Iterator::next) {
                    tx.remove_record(key);
                } else {
                    self.removals = None;
                    self.phase = CollectionPhase::CopyLeaves;
                }
            }
            CollectionPhase::CopyLeaves => {
                if let Some(key) = tx.dirty_leaves.get_index(self.index) {
                    self.keys.push(*key);
                    self.index += 1;
                } else {
                    self.index = 0;
                    self.phase = CollectionPhase::Leaves;
                }
            }
            CollectionPhase::Leaves => {
                if let Some(key) = self.keys.get(self.index).copied() {
                    self.index += 1;
                    if tx.pending.nodes.contains_key(&key) && !tx.is_attached(key) {
                        tx.remove_record(key);
                        if !tx.editor.state.nodes.contains_key(&key) {
                            tx.dirty_leaves.shift_remove(&key);
                        }
                    }
                } else {
                    return true;
                }
            }
        }
        false
    }
}
