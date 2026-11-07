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
    let caret = SiblingCaret::new(node, CaretDirection::Next).into();
    let options = SplitAtPointCaretNextOptions {
        should_split: |_, _, _| false,
        remove_empty_destination: remove_empty,
        ..Default::default()
    };
    insert_node_to_nearest_root_at_caret(tx, node, caret, options)?;
    Ok(())
}

/// Hoist matching descendants out of unsupported wrappers, traversing last-to-first.
pub fn unwrap_and_filter_descendants(
    tx: &mut Transaction<'_>,
    root: NodeKey,
    mut predicate: impl FnMut(StateRef<'_>, NodeKey) -> bool,
) -> std::result::Result<bool, lexical_model::Error> {
    fn walk(
        tx: &mut Transaction<'_>,
        root: NodeKey,
        after: Option<NodeKey>,
        predicate: &mut impl FnMut(StateRef<'_>, NodeKey) -> bool,
    ) -> std::result::Result<bool, lexical_model::Error> {
        let mut changed = false;
        for node in tx.children_keys(root)?.into_iter().rev() {
            if predicate(tx.view(), node) {
                if let Some(after) = after {
                    tx.insert_after(after, node, true)?;
                }
            } else {
                changed = true;
                if tx.is_element(node) {
                    walk(tx, node, after.or(Some(node)), predicate)?;
                }
                tx.remove(node, false)?;
            }
        }
        Ok(changed)
    }
    walk(tx, root, None, &mut predicate)
}

/// Insert a node at the selection, splitting ancestors up to the nearest root.
pub fn insert_node_to_nearest_root(
    tx: &mut Transaction<'_>,
    node: NodeKey,
) -> Result<NodeKey, Error> {
    let selection = tx.selection().or_else(|| tx.previous_selection()).cloned();
    let caret = if let Some(Selection::Range(range)) = selection {
        caret_from_point(tx.view(), &range.focus, CaretDirection::Next)?
    } else if let Some(last) = selection
        .as_ref()
        .map(|s| s.nodes(tx.view()))
        .transpose()?
        .unwrap_or_default()
        .last()
    {
        SiblingCaret::new(*last, CaretDirection::Next).into()
    } else {
        let paragraph = tx.create(Paragraph::default())?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        SiblingCaret::new(paragraph.key(), CaretDirection::Next)
            .rewind(tx.view())?
            .into()
    };
    let inserted = insert_node_to_nearest_root_at_caret(tx, node, caret, Default::default())?;
    let selected = match inserted.adjacent_child_caret(tx.view()) {
        Some(NodeCaret::Child(child)) => normalize_caret(tx.view(), child.into())?,
        _ => inserted.into(),
    };
    tx.set_selection_from_caret_range(CaretRange::collapsed(selected))?;
    Ok(node)
}

/// Split at a point caret and insert a block (or a paragraph wrapping an inline node).
pub fn insert_node_to_nearest_root_at_caret(
    tx: &mut Transaction<'_>,
    node: NodeKey,
    caret: PointCaret,
    options: SplitAtPointCaretNextOptions,
) -> Result<NodeCaret, Error> {
    let direction = caret.direction();
    let mut insert = caret.in_direction(tx.view(), CaretDirection::Next);
    if let PointCaret::Text(text) = insert {
        if text.offset.0 == 0 {
            insert = SiblingCaret::new(text.origin, CaretDirection::Previous)
                .flipped(tx.view())
                .into();
        } else if text.offset.0 == tx.text_content_size(text.origin).0 {
            insert = SiblingCaret::new(text.origin, CaretDirection::Next).into();
        }
    }
    if insert.origin() == node {
        let PointCaret::Sibling(sibling) = insert else {
            return Err(Error::invariant(format!(
                "$insertNodeToNearestRootAtCaret node {node} of type {} can not be inserted into itself",
                tx.type_name(node)?
            )));
        };
        insert = sibling.rewind(tx.view())?.into();
    }
    if insert.node_at_caret(tx.view()) == Some(node)
        || insert.flipped(tx.view()).node_at_caret(tx.view()) == Some(node)
    {
        tx.remove(node, true)?;
    }
    while let Some(next) = tx.split_at_point_caret_next(insert, options)? {
        insert = next.into();
    }
    if matches!(insert, PointCaret::Text(_)) {
        return Err(Error::Invariant(
            "$insertNodeToNearestRootAtCaret: An unattached TextNode can not be split",
        ));
    }
    let block = if tx.is_inline(node) {
        let p = tx.create(Paragraph::default())?;
        tx.append(p, &[node])?;
        p.key()
    } else {
        node
    };
    tx.caret_insert(insert, block)?;
    let inserted = PointCaret::from(SiblingCaret::new(node, CaretDirection::Next))
        .in_direction(tx.view(), direction);
    match inserted {
        PointCaret::Child(child) => Ok(child.into()),
        PointCaret::Sibling(sibling) => Ok(sibling.into()),
        _ => unreachable!(),
    }
}

/// Pinned linkify-it domain/email/protocol recognition.
pub mod linkify;
/// Shared UTF-16 match arrays and stateless regex/synthetic matching.
pub mod matcher;
