//! Shared block utilities needed by rich-text and tab indentation.
use lexical_model::*;
mod dfs;
pub use dfs::*;
mod tree;
pub use tree::*;
mod insert;
pub use insert::*;
mod nested;
pub use nested::*;
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

pub(crate) use lexical_model::is_js_whitespace;

/// Lift a block at its current position to its nearest root, splitting enclosing blocks.
/// Suppresses empty edge copies, as upstream shouldSplit=false does.
pub(crate) fn lift_to_nearest_root(
    tx: &mut Transaction<'_>,
    node: NodeKey,
    remove_empty: bool,
) -> std::result::Result<(), lexical_model::Error> {
    let caret = SiblingCaret::new(node, CaretDirection::Next).into();
    let options = SplitAtPointCaretNextOptions {
        should_split: |_, _, _| false,
        remove_empty_destination: remove_empty,
        ..Default::default()
    };
    insert_node_to_nearest_root_at_caret(tx, node, caret, Some(options))?;
    Ok(())
}

/// Pinned linkify-it domain/email/protocol recognition.
pub mod linkify;
/// Shared UTF-16 match arrays and stateless regex/synthetic matching.
pub mod matcher;
#[cfg(test)]
mod test;
