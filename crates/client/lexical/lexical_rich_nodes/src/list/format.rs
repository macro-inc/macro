//! List insertion, removal, numbering and indentation.
use super::*;
use super::{item::*, utils::*};
use std::collections::HashSet;
/// Merge two list trees, recursively coalescing adjacent nested wrappers.
pub fn merge_lists(tx: &mut Transaction<'_>, a: Id<ListNode>, b: Id<ListNode>) -> Result<()> {
    if let (Some(last), Some(first)) = (tx.last_child(a), tx.first_child(b))
        && is_nested_list_node(tx, last)
        && is_nested_list_node(tx, first)
    {
        let left = list_id(tx, tx.first_child_or_err(last)?)?;
        let right = list_id(tx, tx.first_child_or_err(first)?)?;
        merge_lists(tx, left, right)?;
        tx.remove(first, false)?;
    }
    let children = tx.children_keys(b)?;
    if !children.is_empty() {
        tx.append(a, &children)?;
    }
    tx.remove(b, false)
}
/// Assign sequential values, excluding nested wrapper items from increments.
pub fn update_children_list_item_value(tx: &mut Transaction<'_>, list: Id<ListNode>) -> Result<()> {
    let payload = tx
        .get::<ListNode>(list)
        .ok_or(Error::NodeTypeMismatch(list.key()))?
        .clone();
    let mut value = payload.start();
    for key in tx.children_keys(list)? {
        let Some(item) = tx.view().cast::<ListItemNode>(key) else {
            continue;
        };
        if get_value(tx, item)? != value {
            set_value(tx, item, value)?;
        }
        if payload.list_type() != ListType::Check
            && tx
                .get::<ListItemNode>(item)
                .is_some_and(|n| n.checked.is_some())
        {
            set_checked(tx, item, None)?;
        }
        if !tx.first_child(item).is_some_and(|k| tx.is::<ListNode>(k)) {
            value += 1;
        }
    }
    Ok(())
}
/// Merge a same-type following list, retaining this list's start value.
pub fn merge_next_sibling_list_if_same_type(
    tx: &mut Transaction<'_>,
    list: Id<ListNode>,
) -> Result<()> {
    let next = tx
        .next_sibling(list)
        .and_then(|k| tx.view().cast::<ListNode>(k));
    if let Some(next) = next
        && tx.get::<ListNode>(list).map(ListNode::list_type)
            == tx.get::<ListNode>(next).map(ListNode::list_type)
    {
        merge_lists(tx, list, next)?;
    }
    Ok(())
}
/// Move a non-wrapper item one nesting level deeper.
pub fn handle_indent(tx: &mut Transaction<'_>, item: Id<ListItemNode>) -> Result<()> {
    if is_nested_list_node(tx, item.key()) {
        return Ok(());
    }
    let parent = tx.parent(item);
    let prev = tx.prev_sibling(item);
    let next = tx.next_sibling(item);
    let previous_inner = prev
        .filter(|k| is_nested_list_node(tx, *k))
        .and_then(|k| tx.first_child(k));
    let next_inner = next
        .filter(|k| is_nested_list_node(tx, *k))
        .and_then(|k| tx.first_child(k));
    match (previous_inner, next_inner) {
        (Some(left), Some(right)) => {
            tx.append(left, &[item.key()])?;
            let children = tx.children_keys(right)?;
            tx.splice(left, ChildIndex(tx.children_size(left)), 0, &children)?;
            if let Some(next) = next {
                tx.remove(next, false)?;
            }
        }
        (None, Some(inner)) => {
            if let Some(first) = tx.first_child(inner) {
                tx.insert_before(first, item, true)?;
            }
        }
        (Some(inner), None) => tx.append(inner, &[item.key()])?,
        (None, None) => {
            if let Some(parent) = parent.filter(|k| tx.is::<ListNode>(*k)) {
                let wrapper = tx.copy_node(item, false)?;
                let list = tx.copy_node(parent, false)?;
                tx.append(wrapper, &[list])?;
                tx.append(list, &[item.key()])?;
                if let Some(prev) = prev {
                    tx.insert_after(prev, wrapper, true)?;
                } else if let Some(next) = next {
                    tx.insert_before(next, wrapper, true)?;
                } else {
                    tx.append(parent, &[wrapper])?;
                }
            }
        }
    }
    Ok(())
}
/// Move an item out of its containing nested wrapper, splitting middle siblings.
pub fn handle_outdent(tx: &mut Transaction<'_>, item: Id<ListItemNode>) -> Result<()> {
    if is_nested_list_node(tx, item.key()) {
        return Ok(());
    }
    let Some(list) = tx.parent(item).filter(|k| tx.is::<ListNode>(*k)) else {
        return Ok(());
    };
    let Some(wrapper) = tx.parent(list).filter(|k| tx.is::<ListItemNode>(*k)) else {
        return Ok(());
    };
    if !tx.parent(wrapper).is_some_and(|k| tx.is::<ListNode>(k)) {
        return Ok(());
    }
    if tx.first_child(list) == Some(item.key()) {
        tx.insert_before(wrapper, item, true)?;
        if tx.is_empty(list) {
            tx.remove(wrapper, false)?;
        }
    } else if tx.last_child(list) == Some(item.key()) {
        tx.insert_after(wrapper, item, true)?;
        if tx.is_empty(list) {
            tx.remove(wrapper, false)?;
        }
    } else {
        let before_item = tx.copy_node(item, false)?;
        let before_list = tx.copy_node(list, false)?;
        tx.append(before_item, &[before_list])?;
        let before: Vec<_> = tx.prev_siblings(item).collect();
        for sibling in before {
            tx.append(before_list, &[sibling])?;
        }
        let after_item = tx.copy_node(item, false)?;
        let after_list = tx.copy_node(list, false)?;
        tx.append(after_item, &[after_list])?;
        let after: Vec<_> = tx.next_siblings(item).collect();
        tx.splice(after_list, ChildIndex(0), 0, &after)?;
        tx.insert_before(wrapper, before_item, true)?;
        tx.insert_after(wrapper, after_item, true)?;
        tx.replace(wrapper, item, false)?;
    }
    Ok(())
}
fn selecting_empty(st: &impl Read, anchor: NodeKey, nodes: &[NodeKey]) -> bool {
    st.is::<ListItemNode>(anchor)
        && (nodes.is_empty() || nodes.len() == 1 && nodes[0] == anchor && st.is_empty(anchor))
}
/// Convert selected blocks or existing lists to the requested marker type.
pub fn insert_list(tx: &mut Transaction<'_>, list_type: ListType) -> Result<()> {
    let Some(selection) = tx.selection().cloned() else {
        return Ok(());
    };
    let mut nodes = selection.nodes(tx.view())?;
    if let Some(range) = selection.as_range() {
        let anchor = if range.is_backward(tx.view())? {
            range.focus
        } else {
            range.anchor
        }
        .key();
        if tx.is_root_or_shadow_root(anchor) {
            let first = if let Some(first) = tx.first_child(anchor) {
                first
            } else {
                let paragraph = tx.create(Paragraph {})?;
                tx.append(anchor, &[paragraph.key()])?;
                paragraph.key()
            };
            tx.select_start(first)?;
            nodes = tx.selection().ok_or(Error::NoSelection)?.nodes(tx.view())?;
        } else if selecting_empty(tx, anchor, &nodes) {
            let list = create_list_node(tx, list_type, 1)?;
            let parent = tx.parent_or_err(anchor)?;
            if tx.is_root_or_shadow_root(parent) {
                tx.replace(anchor, list, false)?;
                let item = create_list_item_node(tx, None)?;
                let format = tx.element_data(anchor)?.format;
                tx.element(item)?.set_format(format)?;
                set_indent(tx, item, tx.indent(anchor))?;
                tx.append(list, &[item.key()])?;
            } else if tx.is::<ListItemNode>(anchor) {
                let children = tx.children_keys(parent)?;
                tx.splice(list, ChildIndex(0), 0, &children)?;
                tx.replace(parent, list, false)?;
            }
            return Ok(());
        }
    }
    let mut handled = HashSet::new();
    for node in nodes {
        if tx.is_element(node)
            && tx.is_empty(node)
            && !tx.is::<ListItemNode>(node)
            && !handled.contains(&node)
        {
            create_list_or_merge(tx, node, list_type)?;
            continue;
        }
        let mut parent = if !tx.is_element(node) {
            tx.parent(node)
        } else if tx.is::<ListItemNode>(node) && tx.is_empty(node) {
            Some(node)
        } else {
            None
        };
        while let Some(key) = parent {
            if tx.is::<ListNode>(key) {
                if handled.insert(key) {
                    let list = create_list_node(tx, list_type, 1)?;
                    let children = tx.children_keys(key)?;
                    tx.splice(list, ChildIndex(0), 0, &children)?;
                    tx.replace(key, list, false)?;
                }
                break;
            }
            let next = tx.parent(key);
            if next.is_some_and(|k| tx.is_root_or_shadow_root(k)) && handled.insert(key) {
                create_list_or_merge(tx, key, list_type)?;
                break;
            }
            parent = next;
        }
    }
    Ok(())
}
fn create_list_or_merge(
    tx: &mut Transaction<'_>,
    node: NodeKey,
    list_type: ListType,
) -> Result<Id<ListNode>> {
    if tx.is::<ListNode>(node) {
        return list_id(tx, node);
    }
    let previous = tx
        .prev_sibling(node)
        .and_then(|k| tx.view().cast::<ListNode>(k))
        .filter(|k| {
            tx.get::<ListNode>(*k)
                .is_some_and(|n| n.list_type() == list_type)
        });
    let next = tx
        .next_sibling(node)
        .and_then(|k| tx.view().cast::<ListNode>(k))
        .filter(|k| {
            tx.get::<ListNode>(*k)
                .is_some_and(|n| n.list_type() == list_type)
        });
    let item = create_list_item_node(tx, None)?;
    let children = tx.children_keys(node)?;
    tx.splice(item, ChildIndex(0), 0, &children)?;
    let target = if let Some(previous) = previous {
        tx.append(previous, &[item.key()])?;
        if let Some(next) = next {
            let children = tx.children_keys(next)?;
            tx.splice(
                previous,
                ChildIndex(tx.children_size(previous)),
                0,
                &children,
            )?;
            tx.remove(next, false)?;
        }
        previous
    } else if let Some(next) = next {
        tx.insert_before(tx.first_child_or_err(next)?, item, true)?;
        next
    } else {
        let list = create_list_node(tx, list_type, 1)?;
        tx.append(list, &[item.key()])?;
        tx.replace(node, list, false)?;
        list
    };
    let format = tx.element_data(node)?.format;
    tx.element(item)?.set_format(format)?;
    set_indent(tx, item, tx.indent(node))?;
    remap_points(tx, SelectionSlot::Active, target.key(), item.key(), 0)?;
    tx.remove(node, false)?;
    Ok(target)
}
/// Replace selected list trees with paragraphs, preserving text selection.
pub fn remove_list(tx: &mut Transaction<'_>) -> Result<()> {
    let Some(range) = tx.selection().and_then(Selection::as_range).cloned() else {
        return Ok(());
    };
    let nodes = range.nodes(tx.view())?;
    let mut lists = Vec::new();
    if selecting_empty(tx, range.anchor.key(), &nodes) {
        lists.push(get_top_list_node(tx, range.anchor.key())?);
    } else {
        for node in nodes {
            if !tx.is_element(node)
                && let Some(item) = find_nearest_list_item_node(tx, node)
            {
                let top = get_top_list_node(tx, item.key())?;
                if !lists.contains(&top) {
                    lists.push(top);
                }
            }
        }
    }
    for list in lists {
        let mut after = list.key();
        for item in get_all_list_items(tx, list) {
            let p = tx.create(Paragraph {})?;
            tx.element(p)?
                .set_text_style(&range.style)?
                .set_text_format(range.format)?;
            let children = tx.children_keys(item)?;
            tx.append(p, &children)?;
            tx.insert_after(after, p, true)?;
            after = p.key();
            let point = tx
                .first_descendant(p)
                .filter(|k| tx.is_text(*k))
                .map(|k| Point::text(k, Utf16Offset::ZERO))
                .unwrap_or(Point::element(p.key(), ChildIndex(0)));
            if let Some(current) = tx.selection().and_then(Selection::as_range).cloned() {
                for (role, endpoint) in [
                    (PointRole::Anchor, current.anchor),
                    (PointRole::Focus, current.focus),
                ] {
                    if endpoint.key() == item.key() {
                        tx.set_point_at(SelectionSlot::Active, role, point)?;
                    }
                }
            }
            tx.remove(item, false)?;
        }
        tx.remove(list, false)?;
    }
    Ok(())
}
/// Exit an empty list item on Enter, optionally preserving numbering after it.
pub fn handle_list_insert_paragraph(
    tx: &mut Transaction<'_>,
    restore_numbering: bool,
) -> Result<bool> {
    let Some(range) = tx
        .selection()
        .and_then(Selection::as_range)
        .filter(|r| r.is_collapsed())
        .cloned()
    else {
        return Ok(false);
    };
    let anchor = range.anchor.key();
    let item = if tx.is::<ListItemNode>(anchor) && tx.is_empty(anchor) {
        item_id(tx, anchor).ok()
    } else if tx.is_text(anchor) {
        tx.parent(anchor)
            .and_then(|p| tx.view().cast::<ListItemNode>(p))
            .filter(|p| {
                tx.children(*p).all(|k| {
                    tx.is_text(k)
                        && tx
                            .text_content(k)
                            .trim_matches(crate::utils::is_js_whitespace)
                            .is_empty()
                })
            })
    } else {
        None
    };
    let Some(item) = item else {
        return Ok(false);
    };
    let top = get_top_list_node(tx, item.key())?;
    let list = tx.parent_or_err(item)?;
    let parent = tx.parent_or_err(list)?;
    let replacement = if tx.is_root_or_shadow_root(parent) {
        let p = tx.create(Paragraph {})?;
        tx.insert_after(top, p, true)?;
        p.key()
    } else if tx.is::<ListItemNode>(parent) {
        let copy = tx.copy_node(parent, false)?;
        tx.insert_after(parent, copy, true)?;
        copy
    } else {
        return Ok(false);
    };
    tx.element(replacement)?
        .set_text_style(&range.style)?
        .set_text_format(range.format)?
        .select(None, None)?;
    let siblings: Vec<_> = tx.next_siblings(item).collect();
    if !siblings.is_empty() {
        let new_start = if restore_numbering {
            get_new_list_start(tx, list_id(tx, list)?, item)?
        } else {
            1
        };
        let copy = tx.copy_node(list, false)?;
        tx.get_mut::<ListNode>(copy)?.set_start(new_start);
        if tx.is::<ListItemNode>(replacement) {
            let wrapper = tx.copy_node(replacement, false)?;
            tx.append(wrapper, &[copy])?;
            tx.insert_after(replacement, wrapper, true)?;
        } else {
            tx.insert_after(replacement, copy, true)?;
        }
        tx.append(copy, &siblings)?;
    }
    remove_highest_empty_list_parent(tx, item.key())?;
    Ok(true)
}

#[cfg(test)]
mod test;
