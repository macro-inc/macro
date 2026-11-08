//! Source insertion of block-only nodes through a selected list.
use super::*;
use lexical_rich_nodes::list::{ListItemNode, ListNode};

pub(super) fn insert_and_split_list(
    tx: &mut Transaction<'_>,
    nodes: &[NodeKey],
) -> Result<(), Error> {
    let Some(range) = tx.selection().and_then(Selection::as_range).cloned() else {
        return Ok(());
    };
    if !range.is_collapsed() {
        tx.remove_text()?;
    }
    let range = tx.range_selection()?.clone();
    let anchor = range.anchor;
    let node = if tx.is_element(anchor.key()) {
        anchor.key()
    } else {
        let Some(parent) = tx.parent(anchor.key()) else {
            return Ok(());
        };
        parent
    };
    if tx
        .find_matching_parent(node, |state, key| state.is::<ListItemNode>(key))
        .is_none()
    {
        if let Some(top) = tx.top_level_element(node)?
            && anchor.offset() == 0
            && tx.is_empty(top)
            && tx.first_child(NodeKey::ROOT) == Some(top)
            && tx.last_child(NodeKey::ROOT) == Some(top)
        {
            return tx.splice(NodeKey::ROOT, ChildIndex(0), 0, nodes);
        }
        tx.insert_nodes(nodes)?;
    } else {
        let (parent, offset) = split_list_to_root(tx, node, anchor.offset())?;
        tx.splice(parent, offset, 0, nodes)?;
    }
    if let Some(last) = nodes.last() {
        tx.select_end(*last)?;
    }
    Ok(())
}
fn new_list(tx: &mut Transaction<'_>, source: NodeKey) -> Result<NodeKey, Error> {
    let ty = tx
        .get::<ListNode>(source)
        .ok_or(Error::NodeTypeMismatch(source))?
        .list_type();
    Ok(tx.create(ListNode::new(ty, 1))?.key())
}
fn split_list_to_root(
    tx: &mut Transaction<'_>,
    node: NodeKey,
    offset: u32,
) -> Result<(NodeKey, ChildIndex), Error> {
    let Some(item) = tx.find_matching_parent(node, |state, key| state.is::<ListItemNode>(key))
    else {
        return Ok((node, ChildIndex(offset)));
    };
    let mut top = tx
        .parent(item)
        .filter(|key| tx.is::<ListNode>(*key))
        .ok_or(Error::Invariant("list item parent"))?;
    let mut ancestor = tx.parent(top);
    while let Some(parent) = ancestor {
        if tx.is::<ListNode>(parent) {
            top = parent;
        }
        ancestor = tx.parent(parent);
    }
    let Some(parent) = tx.parent(top).filter(|key| tx.is_root_or_shadow_root(*key)) else {
        return Ok((node, ChildIndex(offset)));
    };
    let index = tx
        .index_within_parent(top)
        .ok_or(Error::Invariant("list index"))?;
    let mut current = item;
    let mut list = tx
        .parent(item)
        .ok_or(Error::Invariant("list item parent"))?;
    if offset > 0 && offset < tx.children_size(current) {
        let children = tx.children_keys(current)?;
        let next = tx.create(ListItemNode::default())?;
        tx.append(
            next,
            children
                .get(offset as usize..)
                .ok_or(Error::Invariant("list split offset"))?,
        )?;
        tx.insert_after(current, next, true)?;
        current = next.key();
    }
    while list != top {
        let following: Vec<_> = tx.next_siblings(current).collect();
        let list_parent = tx.parent(list).ok_or(Error::Invariant("list parent"))?;
        if tx.is_root_or_shadow_root(list_parent) {
            break;
        }
        if !following.is_empty() {
            let next = new_list(tx, list)?;
            tx.append(next, &following)?;
            let wrapper = tx.create(ListItemNode::default())?;
            tx.append(wrapper, &[next])?;
            tx.insert_after(list_parent, wrapper, true)?;
        }
        current = list_parent;
        list = tx
            .parent(list_parent)
            .ok_or(Error::Invariant("nested list parent"))?;
    }
    let following: Vec<_> = tx.next_siblings(current).collect();
    if !following.is_empty() {
        let next = new_list(tx, top)?;
        tx.append(next, &following)?;
        tx.splice(parent, ChildIndex(index.0 + 1), 0, &[next])?;
    }
    Ok((parent, ChildIndex(index.0 + 1)))
}
