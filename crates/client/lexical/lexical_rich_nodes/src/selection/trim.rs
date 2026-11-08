//! Backward text trimming with committed-state restoration.
use lexical_model::*;
/// Trim UTF-16 content before a live anchor, restoring changed committed text when possible.
pub fn trim_text_content_from_anchor(
    tx: &mut Transaction<'_>,
    slot: SelectionSlot,
    delete_count: usize,
) -> Result<(), Error> {
    let anchor = tx.anchor_at(slot)?;
    let mut current = Some(anchor.key());
    if tx.is_element(anchor.key()) {
        current = tx
            .descendant_by_index(anchor.key(), ChildIndex(anchor.offset()))
            .or(current);
    }
    let mut remaining = delete_count;
    while remaining > 0 {
        let Some(mut node) = current else {
            break;
        };
        if tx.is_element(node) {
            node = tx.last_descendant(node).unwrap_or(node);
        }
        let mut next = tx.prev_sibling(node);
        let mut whitespace = 0usize;
        if next.is_none() {
            let mut parent = tx.parent(node);
            while let Some(key) = parent {
                if let Some(sibling) = tx.prev_sibling(key) {
                    next = Some(sibling);
                    whitespace = if tx.is_inline(key) { 0 } else { 2 };
                    break;
                }
                parent = tx.parent(key);
            }
        }
        let mut text = tx.text_content(node).into_owned();
        if text.is_empty() && tx.is_element(node) && !tx.is_inline(node) {
            text = "\n\n".to_owned();
        }
        let size = text.encode_utf16().count();
        if !tx.is_text(node) || remaining >= size {
            let parent = tx.parent(node);
            tx.remove(node, false)?;
            if let Some(parent) = parent
                && parent != NodeKey::ROOT
                && tx.children_size(parent) == 0
            {
                tx.remove(parent, false)?;
            }
            remaining = remaining.saturating_sub(size + whitespace);
            current = next;
        } else {
            let previous = tx
                .committed_state()
                .text_data(node)
                .ok()
                .filter(|_| tx.committed_state().is_simple_text(node))
                .map(|data| data.text.as_str().to_owned());
            if let Some(previous) = previous.filter(|previous| previous != &text) {
                let target = if tx.is_simple_text(node) {
                    tx.text(node)?.set_text_content(&previous)?;
                    node
                } else {
                    let replacement = tx.create_text(&previous)?.key();
                    tx.replace(node, replacement, false)?;
                    replacement
                };
                if let Some(Selection::Range(range)) = tx.previous_selection().cloned()
                    && range.is_collapsed()
                {
                    let offset = Utf16Offset(range.anchor.offset());
                    tx.select_start(target)?;
                    tx.set_text_node_range(target, offset, target, offset)?;
                }
            } else if tx.is_simple_text(node) {
                let anchor = tx.anchor_at(slot)?;
                let selected = anchor.key() == node;
                let at = if (anchor.offset() as usize) < remaining {
                    size
                } else {
                    anchor.offset() as usize
                };
                let start = if selected { at - remaining } else { 0 };
                let end = if selected { at } else { size - remaining };
                let start =
                    u32::try_from(start).map_err(|_| Error::Invariant("trim offset overflow"))?;
                let end =
                    u32::try_from(end).map_err(|_| Error::Invariant("trim offset overflow"))?;
                let parts = tx
                    .text(node)?
                    .split_text(&[Utf16Offset(start), Utf16Offset(end)])?;
                let excess = *parts
                    .get(usize::from(!(selected && start == 0)))
                    .ok_or(Error::Invariant("trim split returned no excess"))?;
                tx.remove(excess, false)?;
            } else {
                let end = u32::try_from(size - remaining)
                    .map_err(|_| Error::Invariant("trim offset overflow"))?;
                let sliced = tx
                    .text_data(node)?
                    .text
                    .slice(Utf16Offset::ZERO..Utf16Offset(end))?
                    .to_owned();
                let replacement = tx.create_text(&sliced)?;
                tx.replace(node, replacement, false)?;
            }
            remaining = 0;
        }
    }
    Ok(())
}
