//! Block replacement and legacy selection wrapping.
use super::*;
/// Copy format and indent only when they differ.
pub fn copy_block_format_indent(
    tx: &mut Transaction<'_>,
    src: NodeKey,
    dest: NodeKey,
) -> Result<(), Error> {
    let source = tx.element_data(src)?.clone();
    if tx.element_data(dest)?.format != source.format {
        tx.element(dest)?.set_format(source.format)?;
    }
    if tx.element_data(dest)?.indent != source.indent {
        tx.set_indent(dest, source.indent)?;
    }
    Ok(())
}
fn point_at_block_start(state: &impl Read, point: Point, block: NodeKey) -> bool {
    if point.offset() != 0 || state.is_element(point.key()) && state.children_size(point.key()) == 0
    {
        return false;
    }
    let mut node = point.key();
    while node != block {
        if state.prev_sibling(node).is_some() {
            return false;
        }
        let Some(parent) = state.parent(node) else {
            return false;
        };
        node = parent;
    }
    true
}
/// Replace selected block elements in upstream insertion order.
pub fn set_blocks_type(
    tx: &mut Transaction<'_>,
    selection: Option<&Selection>,
    mut create: impl FnMut(&mut Transaction<'_>) -> Result<NodeKey, Error>,
    mut after_create: impl FnMut(&mut Transaction<'_>, NodeKey, NodeKey) -> Result<(), Error>,
) -> Result<(), Error> {
    let Some(selection) = selection else {
        return Ok(());
    };
    let mut blocks = Vec::new();
    let mut focus = None;
    let mut skip_focus = false;
    if let Some(range) = selection.as_range() {
        let anchor = tx.find_matching_parent(range.anchor.key(), |state, key| state.is_block(key));
        focus = tx.find_matching_parent(range.focus.key(), |state, key| state.is_block(key));
        skip_focus = focus.is_some_and(|key| {
            tx.is_element(key) && Some(key) != anchor && point_at_block_start(tx, range.focus, key)
        });
        if let Some(anchor) = anchor.filter(|key| tx.is_element(*key)) {
            blocks.push(anchor);
        }
        if let Some(focus) =
            focus.filter(|key| tx.is_element(*key) && !skip_focus && !blocks.contains(key))
        {
            blocks.push(focus);
        }
    }
    for node in selection.nodes(tx.view())? {
        let block = if tx.is_element(node) && tx.is_block(node) {
            Some(node)
        } else if selection.as_range().is_none() {
            tx.find_matching_parent(node, |state, key| state.is_block(key))
                .filter(|key| tx.is_element(*key))
        } else {
            None
        };
        if let Some(block) = block
            && !(skip_focus && Some(block) == focus)
            && !blocks.contains(&block)
        {
            blocks.push(block);
        }
    }
    for previous in blocks {
        let new = create(tx)?;
        after_create(tx, previous, new)?;
        tx.replace(previous, new, true)?;
    }
    Ok(())
}
/// Replace blocks while copying their element format and indentation.
pub fn set_blocks_type_default(
    tx: &mut Transaction<'_>,
    selection: Option<&Selection>,
    create: impl FnMut(&mut Transaction<'_>) -> Result<NodeKey, Error>,
) -> Result<(), Error> {
    set_blocks_type(tx, selection, create, copy_block_format_indent)
}
fn remove_parent_empty_elements(tx: &mut Transaction<'_>, start: NodeKey) -> Result<(), Error> {
    let mut cursor = Some(start);
    while let Some(node) = cursor {
        if tx.is_root_or_shadow_root(node) {
            break;
        }
        cursor = tx.parent(node);
        if tx.children_size(node) == 0 {
            tx.remove(node, true)?;
        }
    }
    Ok(())
}
/// Deprecated wrapping API, preserving root/shadow-root chunks and previous selection.
pub fn wrap_nodes(
    tx: &mut Transaction<'_>,
    selection: &Selection,
    mut create: impl FnMut(&mut Transaction<'_>) -> Result<NodeKey, Error>,
    wrapping: Option<NodeKey>,
) -> Result<(), Error> {
    let nodes = selection.nodes(tx.view())?;
    if let Some(range) = selection.as_range()
        && (nodes.is_empty()
            || nodes.len() == 1
                && matches!(range.anchor, Point::Element { .. })
                && tx.children_size(range.anchor.key()) == 0)
    {
        let target = if matches!(range.anchor, Point::Text { .. }) {
            tx.parent_or_err(range.anchor.key())?
        } else {
            range.anchor.key()
        };
        let children = tx.children_keys(target)?;
        let element = create(tx)?;
        copy_block_format_indent(tx, target, element)?;
        tx.append(element, &children)?;
        let replacement = if let Some(wrapping) = wrapping {
            tx.append(wrapping, &[element])?;
            wrapping
        } else {
            element
        };
        tx.replace(target, replacement, false)?;
        return Ok(());
    }
    let mut top = None;
    let mut descendants = Vec::new();
    for node in nodes {
        if tx.is_root_or_shadow_root(node) {
            wrap_nodes_impl(tx, &descendants, &mut create, wrapping)?;
            descendants.clear();
            top = Some(node);
        } else if top.is_none_or(|top| tx.is_parent_of(top, node)) {
            descendants.push(node);
        } else {
            wrap_nodes_impl(tx, &descendants, &mut create, wrapping)?;
            descendants = vec![node];
        }
    }
    wrap_nodes_impl(tx, &descendants, &mut create, wrapping)
}
fn wrap_nodes_impl(
    tx: &mut Transaction<'_>,
    nodes: &[NodeKey],
    create: &mut impl FnMut(&mut Transaction<'_>) -> Result<NodeKey, Error>,
    wrapping: Option<NodeKey>,
) -> Result<(), Error> {
    let Some(first) = nodes.first().copied() else {
        return Ok(());
    };
    let mut target = if tx.is_element(first) {
        first
    } else {
        tx.parent_or_err(first)?
    };
    if tx.is_inline(target) {
        target = tx.parent_or_err(target)?;
    }
    let mut target_is_previous = false;
    loop {
        if let Some(previous) = tx.prev_sibling(target) {
            target = previous;
            target_is_previous = true;
            break;
        }
        target = tx.parent_or_err(target)?;
        if tx.is_root_or_shadow_root(target) {
            break;
        }
    }
    let empty = nodes
        .iter()
        .copied()
        .filter(|node| tx.is_element(*node) && tx.children_size(*node) == 0)
        .collect::<Vec<_>>();
    let mut moved = Vec::new();
    let mut mapped = Vec::new();
    let mut elements = Vec::new();
    for node in nodes {
        let mut parent = tx.parent(*node);
        if let Some(key) = parent
            && tx.is_inline(key)
        {
            parent = tx.parent(key);
        }
        if let Some(parent) = parent
            && !tx.is_element(*node)
            && !moved.contains(node)
        {
            if !mapped.contains(&parent) {
                let element = create(tx)?;
                copy_block_format_indent(tx, parent, element)?;
                elements.push(element);
                mapped.push(parent);
                let children = tx.children_keys(parent)?;
                tx.append(element, &children)?;
                for child in children {
                    moved.push(child);
                    if tx.is_element(child) {
                        moved.extend(tx.children_keys(child)?);
                    }
                }
                remove_parent_empty_elements(tx, parent)?;
            }
        } else if empty.contains(node) {
            let element = create(tx)?;
            copy_block_format_indent(tx, *node, element)?;
            elements.push(element);
            tx.remove(*node, true)?;
        }
    }
    if let Some(wrapping) = wrapping {
        tx.append(wrapping, &elements)?;
    }
    let mut last = None;
    if tx.is_root_or_shadow_root(target) {
        if target_is_previous {
            if let Some(wrapping) = wrapping {
                tx.insert_after(target, wrapping, true)?;
            } else {
                for element in elements.iter().rev() {
                    tx.insert_after(target, *element, true)?;
                }
            }
        } else if let Some(first_child) = tx.children_keys(target)?.first().copied() {
            if let Some(wrapping) = wrapping {
                tx.insert_before(first_child, wrapping, true)?;
            } else {
                for element in elements {
                    tx.insert_before(first_child, element, true)?;
                    last = Some(element);
                }
            }
        } else if let Some(wrapping) = wrapping {
            tx.append(target, &[wrapping])?;
        } else {
            tx.append(target, &elements)?;
            last = elements.last().copied();
        }
    } else if let Some(wrapping) = wrapping {
        tx.insert_after(target, wrapping, true)?;
    } else {
        for element in elements.into_iter().rev() {
            tx.insert_after(target, element, true)?;
            last = Some(element);
        }
    }
    if let Some(Selection::Range(previous)) = tx.previous_selection().cloned().filter(|selection| {
        selection.as_range().is_some_and(|range| {
            tx.is_attached(range.anchor.key()) && tx.is_attached(range.focus.key())
        })
    }) {
        tx.set_selection(Some(Selection::Range(previous)))?;
    } else if let Some(last) = last {
        tx.select_end(last)?;
    } else if let Some(selection) = tx.selection().cloned() {
        tx.set_selection(Some(selection))?;
    }
    Ok(())
}
#[cfg(test)]
mod test;
