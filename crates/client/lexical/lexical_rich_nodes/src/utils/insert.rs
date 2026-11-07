//! Caret-based insertion at roots and leaves.
use lexical_model::*;
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
