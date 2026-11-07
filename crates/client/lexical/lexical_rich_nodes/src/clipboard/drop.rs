//! Model half of drag/drop; the view owns drag markers and cross-editor deletion.
use super::*;
/// Whether a drop was consumed by the model.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DropOutcome {
    /// No supported stable drop position or movable selection.
    NotHandled,
    /// The view should prevent the native drop.
    Handled,
}
/// Move selected text within an editor or import clipboard strings at a stable caret.
pub fn do_drop(
    tx: &mut Transaction<'_>,
    drop_caret: PointCaret,
    same_editor: bool,
    rich: bool,
    entries: &[ClipboardEntry<'_>],
    html_nodes: Option<&[SerializedNode]>,
) -> Result<DropOutcome, Error> {
    do_drop_in_namespace(tx, "", drop_caret, same_editor, rich, entries, html_nodes)
}
/// Drop with the target editor's namespace supplied by the host.
/// Use this variant for editors whose internal clipboard namespace is nonempty.
pub fn do_drop_in_namespace(
    tx: &mut Transaction<'_>,
    namespace: &str,
    drop_caret: PointCaret,
    same_editor: bool,
    rich: bool,
    entries: &[ClipboardEntry<'_>],
    html_nodes: Option<&[SerializedNode]>,
) -> Result<DropOutcome, Error> {
    let Some(stable) = tx.split_at_point_caret_next(drop_caret, Default::default())? else {
        return Ok(DropOutcome::NotHandled);
    };
    let stable: PointCaret = stable.into();
    if same_editor {
        let Some(Selection::Range(range)) = tx
            .selection()
            .cloned()
            .filter(|selection| !selection.is_collapsed())
        else {
            return Ok(DropOutcome::NotHandled);
        };
        let range = caret_range_from_selection(tx.view(), &range)?
            .in_direction(tx.view(), CaretDirection::Next);
        let caret = stable.in_direction(tx.view(), CaretDirection::Next);
        if compare_point_caret_next(tx.view(), range.anchor, caret)? == std::cmp::Ordering::Less
            && compare_point_caret_next(tx.view(), caret, range.focus)? == std::cmp::Ordering::Less
        {
            return Ok(DropOutcome::Handled);
        }
        tx.remove_text()?;
    }
    if !tx.is_attached(stable.origin()) {
        return Ok(DropOutcome::Handled);
    }
    tx.set_selection_from_caret_range(CaretRange::new(stable, stable)?)?;
    if rich {
        insert_data_transfer_for_rich_text(
            tx,
            namespace,
            entries,
            html_nodes,
            SelectionSlot::Active,
        )?;
    } else {
        insert_data_transfer_for_plain_text(tx, entries)?;
    }
    Ok(DropOutcome::Handled)
}
