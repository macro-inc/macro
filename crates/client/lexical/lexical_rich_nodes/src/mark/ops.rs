//! Wrapping, unwrapping and boundary lookup for annotations.
use super::*;
/// Move children out of a mark in document order and remove its wrapper.
pub fn unwrap_mark_node(tx: &mut Transaction<'_>, mark: NodeKey) -> Result<(), Error> {
    let mut previous = None;
    for child in tx.children_keys(mark)? {
        if let Some(previous) = previous {
            tx.insert_after(previous, child, true)?;
        } else {
            tx.insert_before(mark, child, true)?;
        }
        previous = Some(child);
    }
    tx.remove(mark, false)
}
/// Wrap extracted inline content without mutating the caller's selection value.
/// Line breaks and block boundaries start a fresh annotation run.
pub fn wrap_selection_in_mark_node<F>(
    tx: &mut Transaction<'_>,
    selection: &RangeSelection,
    is_backward: bool,
    id: &str,
    mut create_node: Option<F>,
) -> Result<(), Error>
where
    F: FnMut(&mut Transaction<'_>, Vec<String>) -> Result<NodeKey, Error>,
{
    let mut forward = selection.clone();
    if forward.is_backward(tx.view())? {
        std::mem::swap(&mut forward.anchor, &mut forward.focus);
    }
    let slot = tx.detach_selection(Selection::Range(forward));
    let nodes = tx.extract_at(slot)?;
    tx.take_detached(slot)?;
    let mut current_parent = None;
    let mut last_mark = None;
    for node in nodes {
        if last_mark.is_some_and(|mark| tx.is_parent_of(mark, node)) {
            continue;
        }
        if is_mark_node(tx, node) {
            continue;
        }
        if !tx.is_text(node) && !tx.is_inline_element_or_decorator(node) {
            current_parent = None;
            last_mark = None;
            continue;
        }
        if Some(node) == current_parent {
            continue;
        }
        let parent = tx.parent(node);
        if parent != current_parent {
            last_mark = None;
        }
        current_parent = parent;
        let mark = if let Some(mark) = last_mark {
            mark
        } else {
            let ids = vec![id.to_owned()];
            let mark = match &mut create_node {
                Some(create) => create(tx, ids)?,
                None => create_mark_node(tx, ids)?,
            };
            if !is_mark_node(tx, mark) {
                return Err(Error::Invariant("mark factory must return a MarkNode"));
            }
            tx.insert_before(node, mark, true)?;
            last_mark = Some(mark);
            mark
        };
        tx.append(mark, &[node])?;
    }
    if let Some(mark) = last_mark {
        if is_backward {
            tx.select_start(mark)?;
        } else {
            tx.select_end(mark)?;
        }
    }
    Ok(())
}
/// Read the nearest enclosing mark, or a mark immediately after a text-end boundary.
pub fn get_mark_ids(state: &impl Read, text: NodeKey, offset: Utf16Offset) -> Option<Vec<String>> {
    let mut node = text;
    if state.is_text(text)
        && offset == state.text_content_size(text)
        && let Some(next) = state
            .next_sibling(text)
            .filter(|key| is_mark_node(state, *key))
    {
        return state.get::<MarkNode>(next).map(|mark| mark.ids.clone());
    }
    while let Some(parent) = state.parent(node) {
        if let Some(mark) = state.get::<MarkNode>(parent) {
            return Some(mark.ids.clone());
        }
        node = parent;
    }
    None
}
