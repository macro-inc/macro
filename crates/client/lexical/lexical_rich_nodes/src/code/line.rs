//! Structural line navigation; text offsets are UTF-16 units.
use lexical_model::*;

/// Plain code text or a tolerated highlight, excluding tabs and unrelated subclasses.
pub fn is_code_text(state: &impl Read, key: NodeKey) -> bool {
    matches!(state.type_name(key), Ok("text" | "code-highlight"))
}
/// A text run or tab that belongs to a code line.
pub fn is_code_line_node(state: &impl Read, key: NodeKey) -> bool {
    is_code_text(state, key) || state.is::<Tab>(key)
}
fn edge(state: &impl Read, anchor: NodeKey, previous: bool) -> NodeKey {
    let mut node = anchor;
    while is_code_line_node(state, node) {
        let next = if previous {
            state.prev_sibling(node)
        } else {
            state.next_sibling(node)
        };
        let Some(next) = next.filter(|key| is_code_line_node(state, *key)) else {
            break;
        };
        node = next;
    }
    node
}
/// First text/tab on the anchor's line; line breaks are not crossed.
pub fn first_code_node_of_line(state: &impl Read, anchor: NodeKey) -> NodeKey {
    edge(state, anchor, true)
}
/// Last text/tab on the anchor's line; line breaks are not crossed.
pub fn last_code_node_of_line(state: &impl Read, anchor: NodeKey) -> NodeKey {
    edge(state, anchor, false)
}
/// First strong direction in the line, falling back to its block's direction.
pub fn code_line_direction(state: &impl Read, anchor: NodeKey) -> Option<TextDirection> {
    let first = first_code_node_of_line(state, anchor);
    let last = last_code_node_of_line(state, anchor);
    let mut next = Some(first);
    while let Some(node) = next {
        if is_code_text(state, node)
            && let Some(direction) = text_direction(&state.text_content(node))
        {
            return Some(direction);
        }
        if node == last {
            break;
        }
        next = state.next_sibling(node);
    }
    state
        .parent(first)
        .and_then(|key| state.element_data(key).ok())
        .and_then(|data| data.direction)
}
/// Toggle Home between indentation and the beginning of the line, as upstream does.
pub fn start_of_code_in_line(
    state: &impl Read,
    anchor: NodeKey,
    offset: Utf16Offset,
) -> Result<Option<(NodeKey, Utf16Offset)>, Error> {
    if !is_code_line_node(state, anchor) {
        return Err(Error::Invariant(
            "Expected a valid Code Node: CodeHighlightNode, TabNode, LineBreakNode",
        ));
    }
    if offset > state.text_content_size(anchor) {
        return Err(Error::Utf16OffsetOutOfRange(offset));
    }
    let mut last = None;
    let mut non_blank = None;
    let mut node = anchor;
    let mut at = offset.get();
    let mut units: Vec<u16> = state.text_content(node).encode_utf16().collect();
    loop {
        if at == 0 {
            let Some(previous) = state.prev_sibling(node) else {
                break;
            };
            node = previous;
            if state.is_line_break(node) {
                last = Some((node, Utf16Offset(1)));
                break;
            }
            if !is_code_line_node(state, node) {
                return Err(Error::Invariant(
                    "Expected a valid Code Node: CodeHighlightNode, TabNode, LineBreakNode",
                ));
            }
            at = state.text_content_size(node).get().saturating_sub(1);
            units = state.text_content(node).encode_utf16().collect();
        } else {
            at -= 1;
        }
        if is_code_text(state, node) && units.get(at as usize).copied() != Some(u16::from(b' ')) {
            non_blank = Some((node, Utf16Offset(at)));
        }
    }
    if non_blank.is_some() {
        return Ok(non_blank);
    }
    let content = state.text_content(anchor);
    let character = if offset < state.text_content_size(anchor) {
        is_code_text(state, anchor).then(|| content.encode_utf16().nth(offset.get() as usize))
    } else {
        state
            .next_sibling(anchor)
            .filter(|key| is_code_text(state, *key))
            .map(|key| state.text_content(key).encode_utf16().next())
    };
    if character.is_some_and(|unit| unit != Some(u16::from(b' '))) {
        return Ok(last);
    }
    let mut next = Some(anchor);
    let mut at = offset.get() as usize;
    while let Some(node) = next {
        if state.is_line_break(node) {
            break;
        }
        if is_code_text(state, node) {
            for (index, unit) in state.text_content(node).encode_utf16().enumerate().skip(at) {
                if unit != u16::from(b' ') {
                    let index = u32::try_from(index)
                        .map_err(|_| Error::Invariant("code line offset exceeds UTF-16 range"))?;
                    return Ok(Some((node, Utf16Offset(index))));
                }
            }
        }
        next = state.next_sibling(node);
        at = 0;
    }
    Ok(last)
}
/// Last content node on a code line; reject a line-break anchor.
pub fn end_of_code_in_line(state: &impl Read, anchor: NodeKey) -> Result<NodeKey, Error> {
    let last = last_code_node_of_line(state, anchor);
    if state.is_line_break(last) {
        return Err(Error::Invariant(
            "Unexpected lineBreakNode in getEndOfCodeInLine",
        ));
    }
    Ok(last)
}
#[cfg(test)]
mod test;
