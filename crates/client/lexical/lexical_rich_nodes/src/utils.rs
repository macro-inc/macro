//! Shared block utilities needed by rich-text and tab indentation.
use lexical_model::*;
/// Nearest non-inline element, including the starting node; root is not a block.
pub fn get_nearest_block_element_ancestor_or_throw(
    view: StateRef<'_>,
    key: NodeKey,
) -> crate::Result<NodeKey> {
    view.find_matching_parent(key, |v, k| {
        v.is_element(k) && !v.is_inline(k) && !v.is_root_or_shadow_root(k)
    })
    .ok_or_else(|| lexical_model::Error::Invariant("expected block element ancestor").into())
}
/// Apply an indentation operation once to each selected block that permits indentation.
pub fn handle_indent_and_outdent(
    tx: &mut Transaction<'_>,
    mut change: impl FnMut(&mut Transaction<'_>, NodeKey) -> crate::Result<()>,
) -> crate::Result<bool> {
    let Some(Selection::Range(range)) = tx.selection() else {
        return Ok(false);
    };
    let nodes = range.nodes(tx.view())?;
    let mut handled = Vec::new();
    for key in nodes {
        if let Some(block) = tx.find_matching_parent(key, |v, k| v.is_element(k) && !v.is_inline(k))
            && tx.can_indent(block)
            && !handled.contains(&block)
        {
            change(tx, block)?;
            handled.push(block);
        }
    }
    Ok(!handled.is_empty())
}

/// ECMAScript trim whitespace, excluding Unicode-only whitespace such as NEL.
pub(crate) fn is_js_whitespace(ch: char) -> bool {
    matches!(ch, '\u{0009}'..='\u{000d}' | ' ' | '\u{00a0}' | '\u{1680}' | '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}')
}

/// Lift a block at its current position to its nearest root, splitting enclosing blocks.
/// Suppresses empty edge copies, as upstream shouldSplit=false does.
pub(crate) fn lift_to_nearest_root(
    tx: &mut Transaction<'_>,
    node: NodeKey,
    remove_empty: bool,
) -> std::result::Result<(), lexical_model::Error> {
    let mut caret: PointCaret = SiblingCaret::new(node, CaretDirection::Next)
        .rewind(tx.view())?
        .into();
    if caret.node_at_caret(tx.view()) == Some(node)
        || caret.flipped(tx.view()).node_at_caret(tx.view()) == Some(node)
    {
        tx.remove(node, true)?;
    }
    let options = SplitAtPointCaretNextOptions {
        should_split: |_, _, _| false,
        remove_empty_destination: remove_empty,
        ..Default::default()
    };
    while let Some(next) = tx.split_at_point_caret_next(caret, options)? {
        caret = next.into();
    }
    tx.caret_insert(caret, node)?;
    Ok(())
}
