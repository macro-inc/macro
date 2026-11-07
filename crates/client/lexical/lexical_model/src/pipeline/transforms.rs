use super::normalize::normalize_text_node;
use crate::*;
use std::mem;

fn run(tx: &mut Transaction<'_>, key: NodeKey, composing: Option<NodeKey>) -> Result<(), Error> {
    if Some(key) == composing || !tx.is_attached(key) {
        return Ok(());
    }
    let Some(index) = tx.type_index(key) else {
        return Ok(());
    };
    let transforms = tx.pending.registry.vtable(index).transforms.clone();
    for transform in transforms {
        if !tx.is_attached(key) {
            break;
        }
        transform.run(tx, key)?;
    }
    Ok(())
}
/// Leaves take priority; root finalizes every element batch in which it appears.
pub(super) fn apply(tx: &mut Transaction<'_>) -> Result<(), Error> {
    let composing = tx.composition_key;
    let mut master_leaves = tx.dirty_leaves.clone();
    let mut master_elements = tx.dirty_elements.clone();
    let mut first_elements = true;
    loop {
        while !tx.dirty_leaves.is_empty() {
            let leaves = mem::take(&mut tx.dirty_leaves);
            for key in leaves {
                #[cfg(feature = "bench-counters")]
                {
                    tx.work.nodes_visited += 1;
                }
                normalize_text_node(tx, key)?;
                run(tx, key, composing)?;
                master_leaves.insert(key);
            }
            if !tx.dirty_leaves.is_empty() {
                tx.transform_iterations += 1;
            }
        }
        let mut elements = mem::take(&mut tx.dirty_elements);
        if elements.shift_remove(&NodeKey::ROOT).is_some() {
            elements.insert(NodeKey::ROOT, DirtyIntent::Intentional);
            // Map.set on the initial master also places root last.
            if first_elements {
                master_elements.shift_remove(&NodeKey::ROOT);
            }
        }
        first_elements = false;
        for (key, intent) in elements {
            #[cfg(feature = "bench-counters")]
            {
                tx.work.nodes_visited += 1;
            }
            master_elements.insert(key, intent);
            if intent == DirtyIntent::Intentional {
                run(tx, key, composing)?;
            }
        }
        tx.transform_iterations += 1;
        if tx.dirty_leaves.is_empty() && tx.dirty_elements.is_empty() {
            break;
        }
    }
    tx.dirty_leaves = master_leaves;
    tx.dirty_elements = master_elements;
    Ok(())
}
