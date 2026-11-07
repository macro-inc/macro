//! Host-independent table keyboard and selection-change handlers.
use super::*;
/// Layout facts supplied by the view; the model never queries DOM geometry.
pub trait TableView {
    /// Whether the root's typeahead menu is open.
    fn is_typeahead_open(&self) -> bool;
    /// Whether the observer has a host element for this cell.
    fn has_cell_element(&self, key: NodeKey) -> bool;
    /// Whether the caret is on the visual edge line; None means a lookup failed.
    fn caret_exits_cell(
        &self,
        anchor: &Point,
        edge_child: NodeKey,
        dir: TableDirection,
    ) -> Option<bool>;
}
/// Observer updates to execute in the view after a model handler.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ObserverEffect {
    /// No observer update.
    None,
    /// Set anchor then focus, updating the table selection.
    SelectCells {
        /// Table owning the observer.
        table: Id<TableNode>,
        /// Anchor cell.
        anchor: Id<TableCellNode>,
        /// Focus cell.
        focus: Id<TableCellNode>,
    },
    /// Resync current selection, set anchor, then optionally update both cells.
    ResyncFromTableSelection {
        /// Anchor cell.
        anchor: Id<TableCellNode>,
        /// Subsequent cell pair.
        then: Option<(Id<TableCellNode>, Id<TableCellNode>)>,
    },
    /// Schedule the scrollable-table down-arrow selection check.
    CheckSelectionAfterDown {
        /// Table to check.
        table: Id<TableNode>,
    },
}
/// Dispatch result and instructions for the host event/observer.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HandlerResult {
    /// Whether to claim the command.
    pub handled: bool,
    /// Whether to prevent default and stop propagation.
    pub stop_event: bool,
    /// Observer update.
    pub effect: ObserverEffect,
}
impl HandlerResult {
    fn none() -> Self {
        Self {
            handled: false,
            stop_event: false,
            effect: ObserverEffect::None,
        }
    }
    fn stopped() -> Self {
        Self {
            handled: true,
            stop_event: true,
            effect: ObserverEffect::None,
        }
    }
    fn cells(
        table: Id<TableNode>,
        anchor: Id<TableCellNode>,
        focus: Id<TableCellNode>,
        stop_event: bool,
    ) -> Self {
        Self {
            handled: true,
            stop_event,
            effect: ObserverEffect::SelectCells {
                table,
                anchor,
                focus,
            },
        }
    }
}
mod arrow;
pub use arrow::{adjust_focus_in_direction, handle_arrow_key};
mod selection;
pub use selection::*;
/// Kind of host text-deletion command.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DeleteTextKind {
    /// Word deletion.
    Word,
    /// Line deletion.
    Line,
    /// Character deletion.
    Character,
}
/// Model result of deletion/cut.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DeleteOutcome {
    /// Continue base handling.
    NotHandled,
    /// Claimed by the table handler.
    Handled,
    /// Cells/table cleared; apply corresponding host effects.
    Cleared(ClearText),
}
fn endpoints(selection: &Selection) -> Option<(Point, Point)> {
    match selection {
        Selection::Range(s) => Some((s.anchor, s.focus)),
        Selection::Table(s) => Some((s.anchor, s.focus)),
        _ => None,
    }
}
fn inside(view: StateRef<'_>, table: Id<TableNode>, point: Point) -> bool {
    view.is_parent_of(table, point.key())
}
/// Escape a table selection into its focus cell.
pub fn escape_table_selection(tx: &mut Transaction<'_>, table: Id<TableNode>) -> Result<bool> {
    let Some(Selection::Table(s)) = tx.selection() else {
        return Ok(false);
    };
    let Some(cell) = find_cell_node(tx.view(), s.focus.key())
        .filter(|c| find_table_node(tx.view(), c.key()) == Some(table))
    else {
        return Ok(false);
    };
    tx.select_end(cell)?;
    Ok(true)
}
/// Claim table selections and the first-block line-deletion guard.
pub fn delete_text_in_table(
    tx: &mut Transaction<'_>,
    table: Id<TableNode>,
    kind: DeleteTextKind,
) -> Result<DeleteOutcome> {
    let Some(s) = tx.selection().cloned() else {
        return Ok(DeleteOutcome::NotHandled);
    };
    if !is_selection_in_table(tx.view(), Some(&s), table.key()) {
        return Ok(DeleteOutcome::NotHandled);
    }
    if matches!(s, Selection::Table(_)) {
        return Ok(DeleteOutcome::Cleared(clear_text(tx, table.key())?));
    }
    let Selection::Range(r) = s else {
        return Ok(DeleteOutcome::NotHandled);
    };
    let Some(cell) = find_cell_node(tx.view(), r.anchor.key())
        .filter(|c| find_table_node(tx.view(), c.key()) == Some(table))
    else {
        return Ok(DeleteOutcome::NotHandled);
    };
    if inside(tx.view(), table, r.anchor) != inside(tx.view(), table, r.focus) {
        return Ok(DeleteOutcome::Cleared(clear_text(tx, table.key())?));
    }
    let Some(mut block) = tx.find_matching_parent(r.anchor.key(), |v, k| v.is_element(k)) else {
        return Ok(DeleteOutcome::NotHandled);
    };
    while let Some(parent) = tx.parent(block) {
        if parent == cell.key() {
            return Ok(
                if kind == DeleteTextKind::Line && tx.prev_sibling(block).is_none() {
                    DeleteOutcome::Handled
                } else {
                    DeleteOutcome::NotHandled
                },
            );
        }
        block = parent;
    }
    Ok(DeleteOutcome::NotHandled)
}
/// Clear cell selections, or move a crossing range to the table boundary before base deletion.
pub fn delete_cell(tx: &mut Transaction<'_>, table: Id<TableNode>) -> Result<DeleteOutcome> {
    let Some(s) = tx.selection().cloned() else {
        return Ok(DeleteOutcome::NotHandled);
    };
    let Some((a, f)) = endpoints(&s) else {
        return Ok(DeleteOutcome::NotHandled);
    };
    let (ai, fi) = (inside(tx.view(), table, a), inside(tx.view(), table, f));
    if ai != fi {
        let (table_point, outer) = if ai { (a, f) } else { (f, a) };
        if table_point.is_before(tx.view(), &outer)? {
            tx.select_previous(table, None, None)?;
        } else {
            tx.select_next(table, None, None)?;
        }
        if let Some(Selection::Range(mut r)) = tx.selection().cloned() {
            if ai {
                r.focus = outer
            } else {
                r.anchor = outer
            }
            tx.set_selection(Some(Selection::Range(r)))?;
        }
        return Ok(DeleteOutcome::NotHandled);
    }
    if !is_selection_in_table(tx.view(), Some(&s), table.key()) {
        return Ok(DeleteOutcome::NotHandled);
    }
    if matches!(s, Selection::Table(_)) {
        Ok(DeleteOutcome::Cleared(clear_text(tx, table.key())?))
    } else {
        Ok(DeleteOutcome::NotHandled)
    }
}
/// Cut's model half; clipboard serialization and writes happen in the host first.
pub fn cut_in_table(tx: &mut Transaction<'_>, table: Id<TableNode>) -> Result<DeleteOutcome> {
    if tx
        .selection()
        .is_some_and(|s| !matches!(s, Selection::Range(_) | Selection::Table(_)))
    {
        return Ok(DeleteOutcome::NotHandled);
    }
    let result = delete_cell(tx, table)?;
    if matches!(tx.selection(), Some(Selection::Range(_))) {
        tx.remove_text()?;
        Ok(DeleteOutcome::Handled)
    } else {
        Ok(result)
    }
}
/// Format selected cells uniformly, preserving the table selection.
pub fn format_text_in_table(
    tx: &mut Transaction<'_>,
    table: Id<TableNode>,
    format: TextFormatType,
) -> Result<bool> {
    if !is_selection_in_table(tx.view(), tx.selection(), table.key())
        || !matches!(tx.selection(), Some(Selection::Table(_)))
    {
        return Ok(false);
    }
    format_cells(tx, format)?;
    Ok(true)
}
/// Format the full table or each distinct cell and its block children in the endpoint box.
pub fn format_element_in_table(
    tx: &mut Transaction<'_>,
    table: Id<TableNode>,
    format: ElementFormat,
) -> Result<bool> {
    let Some(Selection::Table(s)) = tx.selection().cloned() else {
        return Ok(false);
    };
    if !is_selection_in_table(tx.view(), Some(&Selection::Table(s)), table.key()) {
        return Ok(false);
    }
    let (Some(a), Some(f)) = (
        tx.view().cast::<TableCellNode>(s.anchor.key()),
        tx.view().cast::<TableCellNode>(s.focus.key()),
    ) else {
        return Ok(false);
    };
    if is_full_table_selection(tx.view(), Some(&Selection::Table(s)), table)? {
        tx.element(table)?.set_format(format)?;
        return Ok(true);
    }
    let (map, av, fv) = map::checked_in(tx, table, a, f)?;
    let mut seen = std::collections::HashSet::new();
    for row in
        av.start_row.min(fv.start_row)..=(av.end_row(tx.view()).max(fv.end_row(tx.view())) as u32)
    {
        for col in av.start_column.min(fv.start_column)
            ..=(av.end_column(tx.view()).max(fv.end_column(tx.view())) as u32)
        {
            let cell = map
                .get(row, col)
                .ok_or(Error::Invariant("Table map contains a hole"))?
                .cell;
            if seen.insert(cell) {
                tx.element(cell)?.set_format(format)?;
                for child in tx.children_keys(cell)? {
                    if tx.is_element(child) && !tx.is_inline(child) {
                        tx.element(child)?.set_format(format)?;
                    }
                }
            }
        }
    }
    Ok(true)
}
/// First or last logical corner of a table.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TableEdge {
    /// First logical cell.
    First,
    /// Last logical cell.
    Last,
}
/// Resolve a host caret beside the table to its first/last logical cell.
pub fn table_edge_cursor_position(
    view: StateRef<'_>,
    selection: &RangeSelection,
    table: Id<TableNode>,
    dom_anchor_beside_table: bool,
) -> Result<Option<TableEdge>> {
    if !dom_anchor_beside_table || view.parent(table).is_none() {
        return Ok(None);
    }
    let Some(cell) = find_cell_node(view, selection.anchor.key())
        .filter(|c| find_table_node(view, c.key()) == Some(table))
    else {
        return Ok(None);
    };
    let (map, cv, _) = compute_table_map(view, table, cell, cell)?;
    if map.get(0, 0).is_some_and(|v| v.cell == cv.cell) {
        return Ok(Some(TableEdge::First));
    }
    if map.row_count() > 0
        && map.column_count() > 0
        && map
            .get(map.row_count() - 1, map.column_count() - 1)
            .is_some_and(|v| v.cell == cv.cell)
    {
        return Ok(Some(TableEdge::Last));
    }
    Ok(None)
}
/// Insert a paragraph beside a table and select its end.
pub fn insert_paragraph_at_table_edge(
    tx: &mut Transaction<'_>,
    edge: TableEdge,
    table: Id<TableNode>,
    children: &[NodeKey],
) -> Result<()> {
    let paragraph = tx.create(Paragraph::default())?;
    match edge {
        TableEdge::First => tx.insert_before(table, paragraph, true)?,
        TableEdge::Last => tx.insert_after(table, paragraph, true)?,
    };
    tx.append(paragraph, children)?;
    tx.select_end(paragraph)
}
/// Insert controlled text beside the table when the host caret lies on its edge.
pub fn controlled_text_insertion_in_table(
    tx: &mut Transaction<'_>,
    table: Id<TableNode>,
    text: &str,
    beside: bool,
) -> Result<bool> {
    if !is_selection_in_table(tx.view(), tx.selection(), table.key()) {
        return Ok(false);
    }
    match tx.selection().cloned() {
        Some(Selection::Table(_)) => {
            tx.set_selection(None)?;
            Ok(false)
        }
        Some(Selection::Range(r)) => {
            if let Some(edge) = table_edge_cursor_position(tx.view(), &r, table, beside)? {
                let text = tx.create_text(text)?;
                insert_paragraph_at_table_edge(tx, edge, table, &[text.key()])?;
                Ok(true)
            } else {
                Ok(false)
            }
        }
        _ => Ok(false),
    }
}
/// Move Tab/Shift-Tab from a collapsed range in this table.
pub fn tab_in_table(tx: &mut Transaction<'_>, table: Id<TableNode>, shift: bool) -> Result<bool> {
    let Some(Selection::Range(r)) = tx.selection() else {
        return Ok(false);
    };
    if !r.is_collapsed() {
        return Ok(false);
    }
    let Some(cell) = find_cell_node(tx.view(), r.anchor.key())
        .filter(|c| find_table_node(tx.view(), c.key()) == Some(table))
    else {
        return Ok(false);
    };
    select_adjacent_cell(tx, cell, !shift)?;
    Ok(true)
}
/// Select an adjacent physical cell's end, or a point beside the table.
pub fn select_adjacent_cell(
    tx: &mut Transaction<'_>,
    cell: Id<TableCellNode>,
    forward: bool,
) -> Result<()> {
    let (cell, row, table) = get_node_triplet(tx.view(), TripletSource::Node(cell.key()))?;
    let sibling = if forward {
        tx.next_sibling(cell)
    } else {
        tx.prev_sibling(cell)
    };
    if let Some(sibling) = sibling.filter(|k| tx.is_element(*k)) {
        return tx.select_end(sibling);
    }
    let nextrow = if forward {
        tx.next_sibling(row)
    } else {
        tx.prev_sibling(row)
    };
    if let Some(row) = nextrow {
        let child = if forward {
            tx.first_child(row)
        } else {
            tx.last_child(row)
        };
        if let Some(cell) = child.filter(|k| tx.is_element(*k)) {
            return tx.select_end(cell);
        }
    }
    if forward {
        tx.select_next(table, None, None)
    } else {
        tx.select_previous(table, None, None)
    }
}
/// Insert an empty paragraph beside an edge caret.
pub fn insert_paragraph_in_table(
    tx: &mut Transaction<'_>,
    table: Id<TableNode>,
    beside: bool,
) -> Result<bool> {
    let Some(Selection::Range(r)) = tx.selection().cloned() else {
        return Ok(false);
    };
    if !r.is_collapsed()
        || !is_selection_in_table(tx.view(), Some(&Selection::Range(r.clone())), table.key())
    {
        return Ok(false);
    }
    if let Some(edge) = table_edge_cursor_position(tx.view(), &r, table, beside)? {
        insert_paragraph_at_table_edge(tx, edge, table, &[])?;
        Ok(true)
    } else {
        Ok(false)
    }
}
