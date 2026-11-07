//! Caret-based insertion at roots and leaves.
use lexical_model::*;
/// Insert at the nearest root, splitting ancestor blocks as required.
pub fn insert_node_to_nearest_root_at_caret(
    tx: &mut Transaction<'_>,
    node: NodeKey,
    caret: PointCaret,
    options: Option<SplitAtPointCaretNextOptions>,
) -> Result<NodeCaret, Error> {
    let direction = caret.direction();
    let mut insert = caret.in_direction(tx.view(), CaretDirection::Next);
    if let PointCaret::Text(text) = insert {
        if text.offset == Utf16Offset::ZERO {
            insert = PointCaret::from(SiblingCaret::new(text.origin, CaretDirection::Previous))
                .flipped(tx.view());
        } else if text.offset == tx.text_content_size(text.origin) {
            insert = SiblingCaret::new(text.origin, CaretDirection::Next).into();
        }
    }
    if insert.origin() == node {
        let PointCaret::Sibling(sibling) = insert else {
            return Err(Error::Invariant("cannot insert a node into itself"));
        };
        insert = sibling.rewind(tx.view())?.into();
    }
    if insert.node_at_caret(tx.view()) == Some(node)
        || insert.flipped(tx.view()).node_at_caret(tx.view()) == Some(node)
    {
        tx.remove(node, true)?;
    }
    while let Some(next) = tx.split_at_point_caret_next(insert, options.unwrap_or_default())? {
        insert = next.into();
    }
    if matches!(insert, PointCaret::Text(_)) {
        return Err(Error::Invariant("an unattached TextNode cannot be split"));
    }
    let target = if tx.is_inline(node) {
        let paragraph = tx.create(Paragraph {})?;
        tx.append(paragraph, &[node])?;
        paragraph.key()
    } else {
        node
    };
    tx.caret_insert(insert, target)?;
    let result = PointCaret::from(SiblingCaret::new(node, CaretDirection::Next))
        .in_direction(tx.view(), direction);
    Ok(match result {
        PointCaret::Sibling(caret) => caret.into(),
        PointCaret::Child(caret) => caret.into(),
        PointCaret::Text(_) => return Err(Error::Invariant("expected structural insertion caret")),
    })
}
/// Insert using the current or previous selection, or a fresh root paragraph.
pub fn insert_node_to_nearest_root(
    tx: &mut Transaction<'_>,
    node: NodeKey,
) -> Result<NodeKey, Error> {
    let selection = tx.selection().or_else(|| tx.previous_selection()).cloned();
    let caret = if let Some(Selection::Range(range)) = selection {
        caret_from_point(tx.view(), &range.focus, CaretDirection::Next)?
    } else if let Some(last) = selection
        .as_ref()
        .map(|selection| selection.nodes(tx.view()))
        .transpose()?
        .and_then(|nodes| nodes.last().copied())
    {
        SiblingCaret::new(last, CaretDirection::Next).into()
    } else {
        let p = tx.create(Paragraph {})?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        SiblingCaret::new(p.key(), CaretDirection::Next)
            .rewind(tx.view())?
            .into()
    };
    let inserted = insert_node_to_nearest_root_at_caret(tx, node, caret, None)?;
    let selection = match inserted.adjacent_child_caret(tx.view()) {
        Some(NodeCaret::Child(child)) => normalize_caret(tx.view(), child.into())?,
        _ => inserted.into(),
    };
    tx.set_selection_from_caret_range(CaretRange::new(selection, selection)?)?;
    Ok(node)
}
/// Insert at the deepest accessible leaf position after removing selected text.
pub fn insert_node_into_leaf(tx: &mut Transaction<'_>, node: NodeKey) -> Result<(), Error> {
    let Some(Selection::Range(range)) = tx.selection().cloned() else {
        if tx.selection().is_some() {
            tx.insert_nodes(&[node])?;
        }
        return Ok(());
    };
    let range = caret_range_from_selection(tx.view(), &range)?;
    let range = tx.remove_text_from_caret_range(range, SliceMode::RemoveEmptySlices)?;
    let mut insert = range.in_direction(tx.view(), CaretDirection::Next).anchor;
    if matches!(insert, PointCaret::Text(_)) {
        let Some(next) = tx.split_at_point_caret_next(insert, Default::default())? else {
            return Ok(());
        };
        insert = next.into();
    }
    let focus = insert.flipped(tx.view());
    tx.caret_insert(focus, node)?;
    tx.set_selection_from_caret_range(CaretRange::new(focus, focus)?)
}
/// Restore a snapshot and request a full view reconciliation.
pub fn restore_editor_state(tx: &mut Transaction<'_>, state: &EditorState) -> Result<(), Error> {
    tx.restore_editor_state(state)
}
