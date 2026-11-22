//! Structural helpers that preserve node identities and live child cursors.
use lexical_model::*;
/// Nearest node of a registered element type, including the starting node and root.
pub fn get_nearest_node_of_type<T: ElementNode>(
    state: &impl Read,
    mut node: NodeKey,
) -> Option<Id<T>> {
    loop {
        if let Some(id) = state.cast::<T>(node) {
            return Some(id);
        }
        node = state.parent(node)?;
    }
}
/// Replace a node with a new wrapper, then move it into that wrapper.
pub fn wrap_node_in_element(
    tx: &mut Transaction<'_>,
    node: NodeKey,
    create: impl FnOnce(&mut Transaction<'_>) -> Result<NodeKey, Error>,
) -> Result<NodeKey, Error> {
    let element = create(tx)?;
    tx.replace(node, element, false)?;
    tx.append(element, &[node])?;
    Ok(element)
}
/// Replace an element with its children in order.
pub fn unwrap_node(tx: &mut Transaction<'_>, element: NodeKey) -> Result<(), Error> {
    let parent = tx.parent_or_err(element)?;
    let index = tx
        .index_within_parent(element)
        .ok_or(Error::NoParent(element))?;
    let children = tx.children_keys(element)?;
    tx.splice(parent, index, 1, &children)
}
/// Prepend one child to an element.
pub fn insert_first(tx: &mut Transaction<'_>, parent: NodeKey, node: NodeKey) -> Result<(), Error> {
    tx.splice(parent, ChildIndex(0), 0, &[node])
}
/// A mutation-safe child cursor; the next sibling is read before yielding a node.
pub struct ChildCursor {
    next: Option<NodeKey>,
    reverse: bool,
}
impl ChildCursor {
    /// Read and cache the following sibling before handing the current child to the caller.
    pub fn next(&mut self, state: &impl Read) -> Option<NodeKey> {
        let node = self.next?;
        self.next = if self.reverse {
            state.prev_sibling(node)
        } else {
            state.next_sibling(node)
        };
        Some(node)
    }
}
/// Iterate children from first to last.
pub fn first_to_last(state: &impl Read, parent: NodeKey) -> ChildCursor {
    ChildCursor {
        next: state
            .children_keys(parent)
            .ok()
            .and_then(|children| children.first().copied()),
        reverse: false,
    }
}
/// Iterate children from last to first.
pub fn last_to_first(state: &impl Read, parent: NodeKey) -> ChildCursor {
    ChildCursor {
        next: state
            .children_keys(parent)
            .ok()
            .and_then(|children| children.last().copied()),
        reverse: true,
    }
}
/// Collect matching descendants, without descending into matches.
pub fn descendants_matching(
    state: &impl Read,
    children: &[NodeKey],
    mut pred: impl FnMut(StateRef<'_>, NodeKey) -> bool,
) -> Vec<NodeKey> {
    let mut stack = children.iter().rev().copied().collect::<Vec<_>>();
    let mut result = Vec::new();
    while let Some(node) = stack.pop() {
        if pred(state.view(), node) {
            result.push(node);
        } else if let Ok(children) = state.children_keys(node) {
            stack.extend(children.into_iter().rev());
        }
    }
    result
}
/// Remove nonmatching descendants and lift matching descendants out of rejected elements.
pub fn unwrap_and_filter_descendants(
    tx: &mut Transaction<'_>,
    root: NodeKey,
    mut pred: impl FnMut(StateRef<'_>, NodeKey) -> bool,
) -> Result<bool, Error> {
    filter(tx, root, None, &mut pred)
}
fn filter(
    tx: &mut Transaction<'_>,
    root: NodeKey,
    insert_after: Option<NodeKey>,
    pred: &mut impl FnMut(StateRef<'_>, NodeKey) -> bool,
) -> Result<bool, Error> {
    let mut cursor = last_to_first(tx, root);
    let mut changed = false;
    while let Some(node) = cursor.next(tx) {
        if pred(tx.view(), node) {
            if let Some(after) = insert_after {
                tx.insert_after(after, node, true)?;
                changed = true;
            }
        } else {
            if tx.is_element(node) {
                filter(tx, node, insert_after.or(Some(node)), pred)?;
            }
            tx.remove(node, false)?;
            changed = true;
        }
    }
    Ok(changed)
}
