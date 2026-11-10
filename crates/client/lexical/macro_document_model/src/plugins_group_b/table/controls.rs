//! Source table hover deletion and cell-range movement.
use super::*;

#[derive(Clone, Copy, Debug, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub(super) enum Axis {
    Row,
    Column,
    Table,
}
/// Source hover-delete bounds; selected-cell paint uses TableSelection::nodes separately.
#[derive(Clone, Copy, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SelectionDeleteExtent {
    min_row: u32,
    max_row: u64,
    min_column: u32,
    max_column: u64,
}
impl SelectionDeleteExtent {
    pub(super) fn covers_row(self, row: u32) -> bool {
        row >= self.min_row && u64::from(row) <= self.max_row
    }
    pub(super) fn covers_column(self, column: u32) -> bool {
        column >= self.min_column && u64::from(column) <= self.max_column
    }
}
pub(super) fn selection_delete_extent(
    view: &impl Read,
    table: Id<TableNode>,
) -> Result<Option<SelectionDeleteExtent>, Error> {
    let Some(Selection::Table(selection)) = view.selection() else {
        return Ok(None);
    };
    if table.key() != selection.table {
        return Ok(None);
    }
    let Some(anchor) = find_cell_node(view.view(), selection.anchor.key()) else {
        return Ok(None);
    };
    let Some(focus) = find_cell_node(view.view(), selection.focus.key()) else {
        return Ok(None);
    };
    let (_, a, f) = compute_table_map(view.view(), table, anchor, focus)?;
    Ok(Some(SelectionDeleteExtent {
        min_row: a.start_row.min(f.start_row),
        max_row: (u64::from(a.start_row) + u64::from(a.row_span(view.view())).saturating_sub(1))
            .max(u64::from(f.start_row) + u64::from(f.row_span(view.view())).saturating_sub(1)),
        min_column: a.start_column.min(f.start_column),
        max_column: (u64::from(a.start_column)
            + u64::from(a.col_span(view.view())).saturating_sub(1))
        .max(u64::from(f.start_column) + u64::from(f.col_span(view.view())).saturating_sub(1)),
    }))
}
fn covers(view: &impl Read, cell: Id<TableCellNode>, axis: Axis) -> Result<bool, Error> {
    // Keep the existing no-selection fast exit before looking up the hovered table.
    if !matches!(view.selection(), Some(Selection::Table(_))) {
        return Ok(false);
    }
    let table = get_table_node_from_lexical_node(view.view(), cell.key())?;
    let Some(extent) = selection_delete_extent(view, table)? else {
        return Ok(false);
    };
    let (_, at, _) = compute_table_map(view.view(), table, cell, cell)?;
    Ok(match axis {
        Axis::Row => extent.covers_row(at.start_row),
        Axis::Column => extent.covers_column(at.start_column),
        Axis::Table => true,
    })
}
pub(super) fn delete(tx: &mut Transaction<'_>, key: NodeKey, axis: Axis) -> Result<bool, Error> {
    let Some(cell) = tx
        .view()
        .cast::<TableCellNode>(key)
        .filter(|_| tx.is_attached(key))
    else {
        return Ok(false);
    };
    if matches!(axis, Axis::Table) {
        let table = get_table_node_from_lexical_node(tx.view(), key)?;
        tx.remove(table, true)?;
        return Ok(true);
    }
    if !covers(tx, cell, axis)? {
        tx.select_start(cell)?;
    }
    match axis {
        Axis::Row => delete_table_row_at_selection(tx)?,
        Axis::Column => delete_table_column_at_selection(tx)?,
        Axis::Table => {}
    }
    Ok(true)
}
pub(super) fn move_cells(
    tx: &mut Transaction<'_>,
    anchor: NodeKey,
    focus: NodeKey,
    target: NodeKey,
) -> Result<bool, Error> {
    let Some(anchor) = tx
        .view()
        .cast::<TableCellNode>(anchor)
        .filter(|_| tx.is_attached(anchor))
    else {
        return Ok(false);
    };
    let Some(focus) = tx
        .view()
        .cast::<TableCellNode>(focus)
        .filter(|_| tx.is_attached(focus))
    else {
        return Ok(false);
    };
    let Some(target) = tx
        .view()
        .cast::<TableCellNode>(target)
        .filter(|_| tx.is_attached(target))
    else {
        return Ok(false);
    };
    let table = get_table_node_from_lexical_node(tx.view(), anchor.key())?;
    if get_table_node_from_lexical_node(tx.view(), focus.key())? != table {
        return Ok(false);
    }
    let selection = Selection::Table(TableSelection::new(table.key(), anchor.key(), focus.key()));
    let cells: Vec<_> = selection
        .nodes(tx.view())?
        .into_iter()
        .filter(|key| tx.is::<TableCellNode>(*key))
        .collect();
    if cells.is_empty() || cells.contains(&target.key()) {
        return Ok(false);
    }
    let serialized = lexical_rich_nodes::clipboard::generate_json_from_selected_nodes(
        tx.view(),
        "document-session",
        Some(&selection),
    )?;
    let nodes =
        lexical_rich_nodes::clipboard::generate_nodes_from_serialized_nodes(tx, &serialized.nodes)?;
    for cell in &cells {
        tx.clear(*cell)?;
        let p = tx.create(Paragraph::default())?;
        tx.append(*cell, &[p.key()])?;
    }
    tx.select_start(target)?;
    if tx.selection().is_none() {
        restore(tx, &cells, &nodes)?;
        return Ok(false);
    }
    let handled = tx.dispatch(&Command::InsertClipboardNodes {
        nodes: nodes.clone(),
        selection: SelectionSlot::Active,
    })?;
    if handled == Handled::No {
        restore(tx, &cells, &nodes)?;
        return Ok(false);
    }
    Ok(true)
}
fn restore(tx: &mut Transaction<'_>, cells: &[NodeKey], nodes: &[NodeKey]) -> Result<(), Error> {
    let Some(table) = nodes.first().filter(|key| tx.is::<TableNode>(**key)) else {
        return Ok(());
    };
    let mut templates = Vec::new();
    for row in tx.children_keys(*table)? {
        if tx.is::<TableRowNode>(row) {
            for cell in tx.children_keys(row)? {
                if tx.is::<TableCellNode>(cell) {
                    templates.push(cell);
                }
            }
        }
    }
    for (cell, template) in cells.iter().zip(templates) {
        tx.clear(*cell)?;
        let children = tx.children_keys(template)?;
        tx.append(*cell, &children)?;
    }
    Ok(())
}
