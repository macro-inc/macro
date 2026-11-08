use crate::collections::IndexSet;
use crate::*;
/// Only dirty detached roots and their still-parented descendants are collected.
pub(super) fn collect(tx: &mut Transaction<'_>) {
    let mut deleted = IndexSet::default();
    for key in tx.dirty_elements.keys().copied().collect::<Vec<_>>() {
        if !tx.is_attached(key) {
            let mut stack = vec![key];
            while let Some(node) = stack.pop() {
                for child in tx.children(node) {
                    if tx.parent(child) == Some(node) {
                        stack.push(child);
                    }
                }
                deleted.insert(node);
                if !tx.editor.state.nodes.contains_key(&node) {
                    tx.dirty_elements.shift_remove(&node);
                }
            }
        }
    }
    for key in deleted {
        tx.remove_record(key);
    }
    for key in tx.dirty_leaves.clone() {
        if tx.pending.nodes.contains_key(&key) && !tx.is_attached(key) {
            tx.remove_record(key);
            if !tx.editor.state.nodes.contains_key(&key) {
                tx.dirty_leaves.shift_remove(&key);
            }
        }
    }
}
