//! List ancestry and leaf traversal.
use super::*;
/// Count list nesting, starting at one.
pub fn get_list_depth(st: &impl Read, list: Id<ListNode>) -> Result<u32> {
    let mut depth = 1;
    let mut parent = st.parent(list);
    while let Some(key) = parent {
        if !st.is::<ListItemNode>(key) {
            break;
        }
        let list = st
            .parent(key)
            .filter(|k| st.is::<ListNode>(*k))
            .ok_or(Error::Invariant(
                "A ListItemNode must have a ListNode for a parent.",
            ))?;
        depth += 1;
        parent = st.parent(list);
    }
    Ok(depth)
}
/// Find the outermost list above an item; reject malformed direct parents.
pub fn get_top_list_node(st: &impl Read, item: NodeKey) -> Result<Id<ListNode>> {
    let mut list = st
        .parent(item)
        .filter(|k| st.is::<ListNode>(*k))
        .ok_or(Error::Invariant(
            "A ListItemNode must have a ListNode for a parent.",
        ))?;
    for ancestor in st.ancestors(list) {
        if st.is::<ListNode>(ancestor) {
            list = ancestor;
        }
    }
    list_id(st, list)
}
/// True when this item is a nested-list wrapper.
pub fn is_nested_list_node(st: &impl Read, key: NodeKey) -> bool {
    st.is::<ListItemNode>(key) && st.first_child(key).is_some_and(|k| st.is::<ListNode>(k))
}
/// Last leaf item across every ancestor list.
pub fn is_last_item_in_list(st: &impl Read, item: Id<ListItemNode>) -> bool {
    !is_nested_list_node(st, item.key())
        && std::iter::once(item.key())
            .chain(st.ancestors(item))
            .all(|k| !st.is::<ListItemNode>(k) || st.next_sibling(k).is_none())
}
/// Collect leaf items in document order, descending nested wrappers.
pub fn get_all_list_items(st: &impl Read, list: Id<ListNode>) -> Vec<Id<ListItemNode>> {
    let mut out = Vec::new();
    for item in st
        .children(list)
        .filter_map(|k| st.view().cast::<ListItemNode>(k))
    {
        if let Some(inner) = st
            .first_child(item)
            .and_then(|k| st.view().cast::<ListNode>(k))
        {
            out.extend(get_all_list_items(st, inner));
        } else {
            out.push(item);
        }
    }
    out
}
/// Nearest item ancestor or self.
pub fn find_nearest_list_item_node(st: &impl Read, key: NodeKey) -> Option<Id<ListItemNode>> {
    std::iter::once(key)
        .chain(st.ancestors(key))
        .find_map(|k| st.view().cast(k))
}
/// Remove an otherwise empty chain of nested list wrappers.
pub fn remove_highest_empty_list_parent(tx: &mut Transaction<'_>, mut key: NodeKey) -> Result<()> {
    while tx.prev_sibling(key).is_none() && tx.next_sibling(key).is_none() {
        let Some(parent) = tx
            .parent(key)
            .filter(|k| tx.is::<ListNode>(*k) || tx.is::<ListItemNode>(*k))
        else {
            break;
        };
        key = parent;
    }
    tx.remove(key, false)
}
/// Numbering start after splitting at this item.
pub fn get_new_list_start(
    st: &impl Read,
    list: Id<ListNode>,
    item: Id<ListItemNode>,
) -> Result<i32> {
    Ok(st
        .get::<ListNode>(list)
        .ok_or(Error::NodeTypeMismatch(list.key()))?
        .start()
        + st.index_within_parent(item).map_or(0, |n| n.0 as i32))
}

#[cfg(test)]
mod test;
