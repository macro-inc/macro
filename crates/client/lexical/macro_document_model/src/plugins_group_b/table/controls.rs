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
/// The touch handle menu's items, in Source TableMoveHandle order.
#[derive(Clone, Copy, Debug, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub(super) enum MenuItem {
    InsertColumnLeft,
    InsertColumnRight,
    InsertRowBelow,
    InsertRowAbove,
    DeleteRow,
    DeleteColumn,
    SplitCell,
    DeleteTable,
}
/// Closed `select-cells` payload: the handle's tracked corners, each optional.
#[derive(Clone, Copy, Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct SelectCells {
    #[serde(default)]
    pub(super) anchor: Option<u32>,
    #[serde(default)]
    pub(super) focus: Option<u32>,
}
/// What one `select-cells` input did; the view sees only the event name.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum SelectCellsOutcome {
    /// Both cells attached in one table: the TableSelection was set.
    Selected,
    /// A tracked cell is missing or detached: Source's update is a no-op.
    Unchanged,
    /// The cells sit in two tables: Source's table plugin reports Lexical's
    /// same-table invariant and discards the update.
    Straddled,
}
/// Fired once per `select-cells` input, like Source's unconditional
/// SELECTION_CHANGE_COMMAND after `selectHandleCells`' update.
pub(super) static SELECT_CELLS: EventKey<SelectCellsOutcome> =
    EventKey::new("group-b.table-select-cells");
/// Source's message for the straddling selection (Lexical's $getCellNodes invariant).
pub(super) const SELECT_CELLS_STRADDLED: &str =
    "Expected TableSelection anchor and focus to be in the same table";
/// Source TableMoveHandle `selectHandleCells`: when both tracked cells are attached
/// table cells, a TableSelection over the anchor's table; otherwise the update is a
/// no-op. The notification fires either way, in the same transaction.
pub(super) fn select_cells(
    tx: &mut Transaction<'_>,
    anchor: Option<NodeKey>,
    focus: Option<NodeKey>,
) -> Result<bool, Error> {
    let attached = |tx: &Transaction<'_>, key: Option<NodeKey>| {
        key.and_then(|key| tx.view().cast::<TableCellNode>(key))
            .filter(|cell| tx.is_attached(cell.key()))
    };
    let mut outcome = SelectCellsOutcome::Unchanged;
    if let (Some(anchor), Some(focus)) = (attached(tx, anchor), attached(tx, focus)) {
        let table = get_table_node_from_lexical_node(tx.view(), anchor.key())?;
        if get_table_node_from_lexical_node(tx.view(), focus.key())? == table {
            tx.set_selection(Some(Selection::Table(TableSelection::new(
                table.key(),
                anchor.key(),
                focus.key(),
            ))))?;
            outcome = SelectCellsOutcome::Selected;
        } else {
            // Reported after this commit publishes (Actions::after_commit), so the
            // event still reaches the view and nothing changes, as in Source.
            outcome = SelectCellsOutcome::Straddled;
        }
    }
    tx.emit(&SELECT_CELLS, outcome);
    Ok(true)
}
/// Closed `menu-action` payload: no unknown fields, `tracked` optional.
#[derive(Clone, Copy, Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct MenuAction {
    /// The handle's tracked anchor cell; absent when the handle tracks none.
    #[serde(default)]
    pub(super) tracked: Option<u32>,
    pub(super) item: MenuItem,
}
/// Source runMenuAction in one transaction: the live Range/Table selection's anchor
/// cell, else `tracked.selectStart()`, then the item's Source operation on that
/// selection. Row inserts keep the selection, as `$insertTableRowAtNode` does.
pub(super) fn menu_action(
    tx: &mut Transaction<'_>,
    tracked: Option<NodeKey>,
    item: MenuItem,
) -> Result<bool, Error> {
    let live = match tx.selection() {
        Some(Selection::Range(range)) => find_cell_node(tx.view(), range.anchor.key()),
        Some(Selection::Table(table)) => find_cell_node(tx.view(), table.anchor.key()),
        Some(Selection::Node(_)) | None => None,
    };
    let cell = match live {
        Some(cell) => cell,
        None => {
            // Read only when the live selection has no cell, as Source does.
            let Some(cell) = tracked
                .and_then(|key| tx.view().cast::<TableCellNode>(key))
                .filter(|cell| tx.is_attached(cell.key()))
            else {
                return Ok(false);
            };
            tx.select_start(cell)?;
            cell
        }
    };
    // Source runs the action whenever it found a cell, whatever the action returns.
    match item {
        MenuItem::InsertColumnLeft => {
            insert_table_column_at_selection(tx, false)?;
        }
        MenuItem::InsertColumnRight => {
            insert_table_column_at_selection(tx, true)?;
        }
        MenuItem::InsertRowBelow => {
            insert_table_row_at_selection(tx, true)?;
        }
        MenuItem::InsertRowAbove => {
            insert_table_row_at_selection(tx, false)?;
        }
        MenuItem::DeleteRow => delete_table_row_at_selection(tx)?,
        MenuItem::DeleteColumn => delete_table_column_at_selection(tx)?,
        MenuItem::SplitCell => unmerge_cell(tx)?,
        MenuItem::DeleteTable => {
            let table = get_table_node_from_lexical_node(tx.view(), cell.key())?;
            tx.remove(table, true)?;
        }
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
