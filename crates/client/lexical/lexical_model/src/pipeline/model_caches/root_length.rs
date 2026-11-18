//! A bounded length difference proves inequality; equal lengths prove nothing.
use crate::collections::IndexSet;
use crate::*;

const MAX_DIRTY_KEYS: usize = 32;
const MAX_REGISTERED_TYPES: usize = 256;
// Counts bounded ancestor/subtree walk steps, not individual map lookups.
// Each step has a fixed number of raw parent/neighbor lookups.
const MAX_WALK_STEPS: usize = 256;
// Raw text and conservative separator bytes; not a CPU/allocation bound.
const MAX_TEXT_BYTES: usize = 64 * 1024;

struct Budget {
    steps: usize,
    bytes: usize,
}

impl Budget {
    fn visit(&mut self) -> Option<()> {
        self.steps = self.steps.checked_sub(1)?;
        Some(())
    }

    fn text(&mut self, bytes: usize) -> Option<()> {
        self.bytes = self.bytes.checked_sub(bytes)?;
        Some(())
    }
}

enum Attachment {
    Detached,
    RootChild(NodeKey),
}

pub(super) fn proves_change(
    tx: &Transaction<'_>,
    previous: StateRef<'_>,
    next: StateRef<'_>,
) -> bool {
    length_difference(tx, previous, next).unwrap_or(false)
}

// Called only after the existing root-text decision proves equality.
pub(super) fn reuse_previous_memo(tx: &mut Transaction<'_>) {
    if !eligible(tx.editor.state.view()) || !eligible(tx.view()) {
        return;
    }
    #[cfg(feature = "foreign-nodes")]
    if ForeignReadOperation::check().is_err() {
        return;
    }
    // Retain the unchanged publication's exact lazy memo without cloning Root,
    // changing dirty intent or leaving its derived cache on an unrelated cell.
    tx.pending.root_text = tx.editor.state.root_text.clone();
}

fn length_difference(
    tx: &Transaction<'_>,
    previous: StateRef<'_>,
    next: StateRef<'_>,
) -> Option<bool> {
    if tx.full_reconcile
        || tx.dirty_leaves.len().checked_add(tx.dirty_elements.len())? > MAX_DIRTY_KEYS
        || !eligible(previous)
        || !eligible(next)
    {
        return None;
    }
    let mut budget = Budget {
        steps: MAX_WALK_STEPS,
        bytes: MAX_TEXT_BYTES,
    };
    let mut roots = IndexSet::default();
    for key in tx.dirty_leaves.iter().chain(tx.dirty_elements.keys()) {
        if *key == NodeKey::ROOT {
            continue;
        }
        for view in [previous, next] {
            if let Attachment::RootChild(key) = root_child(view, *key, &mut budget)? {
                roots.insert(key);
            }
        }
    }
    // Finish the complete raw preflight in both states before any text/getter read.
    for view in [previous, next] {
        let mut seen = IndexSet::default();
        for key in &roots {
            if direct_child(view, *key) {
                preflight(view, *key, &mut budget, &mut seen)?;
            }
        }
    }
    let mut lengths = [0usize; 2];
    for (index, view) in [previous, next].into_iter().enumerate() {
        for key in &roots {
            if direct_child(view, *key) {
                let text = view.text_content(*key);
                lengths[index] = lengths[index].checked_add(text.len())?;
                if view.is_block_element(*key) && view.next_sibling(*key).is_some() {
                    lengths[index] = lengths[index].checked_add(2)?;
                }
            }
        }
    }
    Some(lengths[0] != lengths[1])
}

pub(super) fn eligible(view: StateRef<'_>) -> bool {
    let state = view.state;
    if state.opaque_text_count != 0 || state.registry.types().len() > MAX_REGISTERED_TYPES {
        return false;
    }
    let Some(root) = state.nodes.get(&NodeKey::ROOT) else {
        return false;
    };
    if !matches!(root.base, BaseData::Element(_))
        || root.links.parent.is_some()
        || root.links.prev.is_some()
        || root.links.next.is_some()
    {
        return false;
    }
    #[cfg(feature = "foreign-nodes")]
    if root.foreign_instance.get().is_some()
        || state.foreign_instances.has_hooks()
        || !state.registry.native_overlays.is_empty()
    {
        return false;
    }
    state.registry.types().all(|node| {
        let table = state.registry.vtable(node.index);
        #[cfg(feature = "foreign-nodes")]
        if node.foreign.is_some() || table.foreign.is_some() {
            return false;
        }
        node.kind != NodeKind::Element || (!table.per_instance && node.flags.is_some())
    })
}

fn direct_child(view: StateRef<'_>, key: NodeKey) -> bool {
    view.state
        .nodes
        .get(&key)
        .is_some_and(|node| node.links.parent == Some(NodeKey::ROOT))
}

fn root_child(view: StateRef<'_>, key: NodeKey, budget: &mut Budget) -> Option<Attachment> {
    if !view.state.nodes.contains_key(&key) {
        return Some(Attachment::Detached);
    }
    let mut current = key;
    let mut seen = IndexSet::default();
    loop {
        budget.visit()?;
        if !seen.insert(current) {
            return None;
        }
        let node = view.state.nodes.get(&current)?;
        let Some(parent) = node.links.parent else {
            return (node.links.prev.is_none() && node.links.next.is_none())
                .then_some(Attachment::Detached);
        };
        check_child(view, current, parent)?;
        if parent == NodeKey::ROOT {
            return Some(Attachment::RootChild(current));
        }
        current = parent;
    }
}

fn check_child(view: StateRef<'_>, key: NodeKey, parent: NodeKey) -> Option<()> {
    let node = view.state.nodes.get(&key)?;
    let parent_node = view.state.nodes.get(&parent)?;
    let BaseData::Element(element) = &parent_node.base else {
        return None;
    };
    if key == parent
        || node.links.parent != Some(parent)
        || element.size == 0
        || node.links.prev.is_none() != (element.first == Some(key))
        || node.links.next.is_none() != (element.last == Some(key))
    {
        return None;
    }
    match node.links.prev {
        Some(prev) => {
            let previous = view.state.nodes.get(&prev)?;
            if previous.links.parent != Some(parent) || previous.links.next != Some(key) {
                return None;
            }
        }
        None if element.first != Some(key) => return None,
        None => {}
    }
    match node.links.next {
        Some(next) => {
            let next = view.state.nodes.get(&next)?;
            if next.links.parent != Some(parent) || next.links.prev != Some(key) {
                return None;
            }
        }
        None if element.last != Some(key) => return None,
        None => {}
    }
    Some(())
}

fn preflight(
    view: StateRef<'_>,
    root: NodeKey,
    budget: &mut Budget,
    seen: &mut IndexSet<NodeKey>,
) -> Option<()> {
    check_child(view, root, NodeKey::ROOT)?;
    let mut stack = vec![root];
    while let Some(key) = stack.pop() {
        budget.visit()?;
        if !seen.insert(key) {
            return None;
        }
        let node = view.state.nodes.get(&key)?;
        // Two bytes per node conservatively cover all possible block separators,
        // including the selected root child's separator in the actual Root.
        budget.text(2)?;
        match &node.base {
            BaseData::Text(data) => budget.text(data.text.as_str().len())?,
            BaseData::LineBreak => budget.text(1)?,
            BaseData::Decorator => return None,
            BaseData::Element(element) => {
                let mut child = element.first;
                let mut count = 0u32;
                let mut last = None;
                while let Some(key) = child {
                    budget.visit()?;
                    check_child(view, key, node.key)?;
                    count = count.checked_add(1)?;
                    if count > element.size {
                        return None;
                    }
                    stack.push(key);
                    last = Some(key);
                    child = view.state.nodes.get(&key)?.links.next;
                }
                if count != element.size || last != element.last {
                    return None;
                }
            }
        }
    }
    Some(())
}
