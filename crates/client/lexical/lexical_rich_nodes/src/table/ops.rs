//! Table restructuring preserves upstream per-slot writes and insertion order.
use super::*;
mod delete;
mod merge;
pub use delete::*;
pub use merge::*;

/// Header policy for dimension-based table creation.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum IncludeHeaders {
    /// Enable or disable both header axes.
    All(bool),
    /// Configure the first row and first column independently.
    Some {
        /// Header row.
        rows: bool,
        /// Header column.
        columns: bool,
    },
}
impl Default for IncludeHeaders {
    fn default() -> Self {
        Self::All(true)
    }
}
/// Create a detached table; every cell initially contains a paragraph and empty text.
pub fn create_table_node_with_dimensions(
    tx: &mut Transaction<'_>,
    rows: u32,
    columns: u32,
    headers: IncludeHeaders,
) -> Result<Id<TableNode>> {
    let table = tx.create(TableNode::default())?;
    let (header_rows, header_columns) = match headers {
        IncludeHeaders::All(value) => (value, value),
        IncludeHeaders::Some { rows, columns } => (rows, columns),
    };
    for r in 0..rows {
        let row = tx.create(TableRowNode::default())?;
        for c in 0..columns {
            let mut header = TableCellHeaderState::NO_STATUS;
            if r == 0 && header_rows {
                header |= TableCellHeaderState::ROW;
            }
            if c == 0 && header_columns {
                header |= TableCellHeaderState::COLUMN;
            }
            let cell = cell_with_paragraph(tx, header, None)?;
            let p = tx.first_child_or_err(cell)?;
            let text = tx.create_text("")?;
            tx.append(p, &[text.key()])?;
            tx.append(row, &[cell.key()])?;
        }
        tx.append(table, &[row.key()])?;
    }
    Ok(table)
}
fn cell_with_paragraph(
    tx: &mut Transaction<'_>,
    header: TableCellHeaderState,
    width: Option<JsNumber>,
) -> Result<Id<TableCellNode>> {
    let cell = tx.create(TableCellNode::new(header, 1, width))?;
    let paragraph = tx.create(Paragraph::default())?;
    tx.append(cell, &[paragraph.key()])?;
    Ok(cell)
}
/// Remove the physical row at index; this deprecated operation does not adjust spans.
pub fn remove_table_row_at_index(
    tx: &mut Transaction<'_>,
    table: Id<TableNode>,
    index: u32,
) -> Result<Id<TableNode>> {
    let row = tx
        .child_at_index(table, ChildIndex(index))
        .ok_or(Error::Invariant(
            "Expected table cell to be inside of table row.",
        ))?;
    tx.remove(row, true)?;
    Ok(table)
}
fn header_for_insert(
    current: TableCellHeaderState,
    possible: TableCellHeaderState,
) -> TableCellHeaderState {
    if current == TableCellHeaderState::BOTH || current == possible {
        possible
    } else {
        TableCellHeaderState::NO_STATUS
    }
}
fn insert_first(tx: &mut Transaction<'_>, parent: NodeKey, node: NodeKey) -> Result<()> {
    if let Some(first) = tx.first_child(parent) {
        tx.insert_before(first, node, true).map(|_| ())
    } else {
        tx.append(parent, &[node])
    }
}
pub(super) fn move_selection_to_cell(
    tx: &mut Transaction<'_>,
    cell: Id<TableCellNode>,
) -> Result<()> {
    let target = tx
        .first_descendant(cell)
        .and_then(|key| tx.parent(key))
        .unwrap_or(cell.key());
    tx.select_start(target)
}
fn selection_cells(
    tx: &Transaction<'_>,
) -> Result<(Id<TableCellNode>, Id<TableCellNode>, Id<TableNode>)> {
    let (anchor, focus) =
        tx.selection()
            .and_then(Selection::start_end_points)
            .ok_or(Error::Invariant(
                "Expected a RangeSelection or TableSelection",
            ))?;
    let (a, _, table) = get_node_triplet(tx.view(), TripletSource::Point(anchor))?;
    let (f, _, _) = get_node_triplet(tx.view(), TripletSource::Point(focus))?;
    Ok((a, f, table))
}
/// Insert a logical row beside the cell, growing intersecting spans once per covered slot.
pub fn insert_table_row_at_node(
    tx: &mut Transaction<'_>,
    cell: Id<TableCellNode>,
    after: bool,
) -> Result<Option<Id<TableRowNode>>> {
    let (_, _, table) = get_node_triplet(tx.view(), TripletSource::Node(cell.key()))?;
    let (map, cv, _) = map::checked_in(tx, table, cell, cell)?;
    let boundary = if after {
        cv.start_row
            + cv.row_span(tx.view())
                .checked_sub(1)
                .ok_or(Error::Invariant("Invalid table span"))?
    } else {
        cv.start_row
    };
    let row = tx.create(TableRowNode::default())?;
    for column in 0..map.column_count() {
        let v = *map
            .get(boundary, column)
            .ok_or(Error::Invariant("Table map contains a hole"))?;
        if if after {
            v.end_row(tx.view()) <= i64::from(boundary)
        } else {
            v.start_row == boundary
        } {
            let new = cell_with_paragraph(
                tx,
                header_for_insert(v.header_state(tx.view()), TableCellHeaderState::COLUMN),
                None,
            )?;
            tx.append(row, &[new.key()])?;
        } else {
            let span = v.row_span(tx.view());
            tx.get_mut::<TableCellNode>(v.cell)?.row_span = span + 1;
        }
    }
    let target = tx
        .child_at_index(table, ChildIndex(boundary))
        .ok_or(Error::Invariant("Expected TableRowNode"))?;
    row_id(tx.view(), target)?;
    if after {
        tx.insert_after(target, row, true)?;
    } else {
        tx.insert_before(target, row, true)?;
    }
    Ok(Some(row))
}
/// Insert a logical row at the selected cells' outer boundary without moving selection.
pub fn insert_table_row_at_selection(
    tx: &mut Transaction<'_>,
    after: bool,
) -> Result<Option<Id<TableRowNode>>> {
    let (a, f, table) = selection_cells(tx)?;
    let (_, av, fv) = map::checked_in(tx, table, a, f)?;
    let cell = if after {
        if av.start_row + av.row_span(tx.view()) > fv.start_row + fv.row_span(tx.view()) {
            a
        } else {
            f
        }
    } else if fv.start_row < av.start_row {
        f
    } else {
        a
    };
    insert_table_row_at_node(tx, cell, after)
}
/// Insert a logical column, preserving repeated writes to cells already writable at map time.
pub fn insert_table_column_at_node(
    tx: &mut Transaction<'_>,
    cell: Id<TableCellNode>,
    after: bool,
    set_selection: bool,
) -> Result<Option<Id<TableCellNode>>> {
    let (_, _, table) = get_node_triplet(tx.view(), TripletSource::Node(cell.key()))?;
    let (map, cv, _) = map::checked_in(tx, table, cell, cell)?;
    let boundary = i64::from(cv.start_column)
        + if after {
            i64::from(cv.col_span(tx.view())) - 1
        } else {
            -1
        };
    let rows = tx.children_keys(table)?;
    let mut first = None;
    for (i, row) in rows.into_iter().enumerate() {
        row_id(tx.view(), row)?;
        let index = boundary.max(0) as u32;
        let value = *map
            .get(i as u32, index)
            .ok_or(Error::Invariant("Table map contains a hole"))?;
        let header = header_for_insert(value.header_state(tx.view()), TableCellHeaderState::ROW);
        let mut create_after = None;
        let mut prepend = false;
        let mut append = false;
        if boundary < 0 {
            prepend = true;
        } else if value.end_column(tx.view()) <= boundary {
            let mut anchor = value;
            let mut previous = boundary;
            while anchor.start_row != i as u32 && anchor.row_span(tx.view()) > 1 {
                previous -= i64::from(value.col_span(tx.view()));
                if previous < 0 {
                    append = true;
                    break;
                }
                anchor = *map
                    .get(i as u32, previous as u32)
                    .ok_or(Error::Invariant("Table map contains a hole"))?;
            }
            if !append {
                create_after = Some(anchor.cell);
            }
        } else {
            let span = value.col_span(tx.view());
            tx.get_mut::<TableCellNode>(value.cell)?.col_span = span + 1;
        }
        if prepend || append || create_after.is_some() {
            let new = cell_with_paragraph(tx, header, None)?;
            if first.is_none() {
                first = Some(new);
            }
            if prepend {
                insert_first(tx, row, new.key())?;
            } else if append {
                tx.append(row, &[new.key()])?;
            } else if let Some(anchor) = create_after {
                tx.insert_after(anchor, new, true)?;
            }
        }
    }
    if set_selection && let Some(first) = first {
        move_selection_to_cell(tx, first)?;
    }
    if let Some(mut widths) = tx
        .get::<TableNode>(table)
        .and_then(|t| t.col_widths.clone())
    {
        let index = boundary.max(0) as usize;
        let value = widths.get(index).copied().flatten();
        widths.insert(index.min(widths.len()), value);
        tx.get_mut::<TableNode>(table)?.col_widths = Some(widths);
    }
    Ok(first)
}
/// Insert a logical column at the outer selected cell boundary.
pub fn insert_table_column_at_selection(
    tx: &mut Transaction<'_>,
    after: bool,
) -> Result<Option<Id<TableCellNode>>> {
    let (a, f, table) = selection_cells(tx)?;
    let (_, av, fv) = map::checked_in(tx, table, a, f)?;
    let cell = if after {
        if av.start_column + av.col_span(tx.view()) > fv.start_column + fv.col_span(tx.view()) {
            a
        } else {
            f
        }
    } else if fv.start_column < av.start_column {
        f
    } else {
        a
    };
    insert_table_column_at_node(tx, cell, after, true)
}
/// Deprecated physical row insertion, inheriting width and column-header neighbors.
pub fn insert_table_row(
    tx: &mut Transaction<'_>,
    table: Id<TableNode>,
    target_index: u32,
    after: bool,
    count: u32,
    grid: &TableGrid,
) -> Result<Id<TableNode>> {
    let target = tx
        .child_at_index(table, ChildIndex(target_index))
        .ok_or(Error::Invariant(
            "Expected table cell to be inside of table row.",
        ))?;
    row_id(tx.view(), target)?;
    let cells = tx.children_keys(target)?;
    for _ in 0..count {
        let row = tx.create(TableRowNode::default())?;
        for cell in &cells {
            let cell = cell_id(tx.view(), *cell)?;
            let (x, y) = grid.coords_of(cell)?;
            let above = grid
                .cell_at(i64::from(x), i64::from(y) - 1)
                .and_then(|c| tx.get::<TableCellNode>(c));
            let below = grid
                .cell_at(i64::from(x), i64::from(y) + 1)
                .and_then(|c| tx.get::<TableCellNode>(c));
            let width = above
                .and_then(|c| c.width.filter(|n| n.0 != 0.0))
                .or_else(|| below.and_then(|c| c.width.filter(|n| n.0 != 0.0)));
            let header = if above.is_some_and(|c| c.has_header_state(TableCellHeaderState::COLUMN))
                || below.is_some_and(|c| c.has_header_state(TableCellHeaderState::COLUMN))
            {
                TableCellHeaderState::COLUMN
            } else {
                TableCellHeaderState::NO_STATUS
            };
            let new = cell_with_paragraph(tx, header, width)?;
            tx.append(row, &[new.key()])?;
        }
        if after {
            tx.insert_after(target, row, true)?;
        } else {
            tx.insert_before(target, row, true)?;
        }
    }
    Ok(table)
}
/// Deprecated physical column insertion, inheriting row-header neighbors.
pub fn insert_table_column(
    tx: &mut Transaction<'_>,
    table: Id<TableNode>,
    target_index: u32,
    after: bool,
    count: u32,
    grid: &TableGrid,
) -> Result<Id<TableNode>> {
    let mut pending = vec![];
    for row in tx.children_keys(table)? {
        for _ in 0..count {
            let target =
                tx.child_at_index(row, ChildIndex(target_index))
                    .ok_or(Error::Invariant(
                        "Expected table cell to be inside of table row.",
                    ))?;
            let cell = cell_id(tx.view(), target)?;
            let (x, y) = grid.coords_of(cell)?;
            let left = grid
                .cell_at(i64::from(x) - 1, i64::from(y))
                .and_then(|c| tx.get::<TableCellNode>(c));
            let right = grid
                .cell_at(i64::from(x) + 1, i64::from(y))
                .and_then(|c| tx.get::<TableCellNode>(c));
            let header = if left.is_some_and(|c| c.has_header_state(TableCellHeaderState::ROW))
                || right.is_some_and(|c| c.has_header_state(TableCellHeaderState::ROW))
            {
                TableCellHeaderState::ROW
            } else {
                TableCellHeaderState::NO_STATUS
            };
            pending.push((cell_with_paragraph(tx, header, None)?, target));
        }
    }
    for (cell, target) in pending {
        if after {
            tx.insert_after(target, cell, true)?;
        } else {
            tx.insert_before(target, cell, true)?;
        }
    }
    Ok(table)
}
/// Deprecated physical column deletion; previously visited rows stay changed on a later error.
pub fn delete_table_column(
    tx: &mut Transaction<'_>,
    table: Id<TableNode>,
    index: u32,
) -> Result<Id<TableNode>> {
    for row in tx.children_keys(table)? {
        let cell = tx
            .child_at_index(row, ChildIndex(index))
            .ok_or(Error::Invariant(
                "Expected table cell to be inside of table row.",
            ))?;
        tx.remove(cell, true)?;
    }
    Ok(table)
}
/// Whether the table is a nonempty rectangle of unit-span cells.
pub fn is_simple_table(view: StateRef<'_>, table: Id<TableNode>) -> bool {
    let Some(first) = view.first_child(table) else {
        return false;
    };
    let columns = view.children_size(first);
    columns > 0
        && view.children(table).all(|row| {
            view.is::<TableRowNode>(row)
                && view.children_size(row) == columns
                && view.children(row).all(|cell| {
                    view.get::<TableCellNode>(cell)
                        .is_some_and(|c| c.row_span == 1 && c.col_span == 1)
                })
        })
}
/// Move one physical column and matching width in a simple table; invalid requests are no-ops.
pub fn move_table_column(
    tx: &mut Transaction<'_>,
    table: Id<TableNode>,
    origin: u32,
    target: u32,
) -> Result<()> {
    let columns = TableNode::column_count(tx.view(), table);
    if origin == target
        || origin >= columns
        || target >= columns
        || !is_simple_table(tx.view(), table)
    {
        return Ok(());
    }
    for row in tx.children_keys(table)? {
        let mut cells = tx.children_keys(row)?;
        let cell = cells.remove(origin as usize);
        cells.insert(target as usize, cell);
        tx.splice(row, ChildIndex(0), columns, &cells)?;
    }
    if let Some(mut widths) = tx
        .get::<TableNode>(table)
        .and_then(|t| t.col_widths.clone())
        && widths.len() == columns as usize
    {
        let width = widths.remove(origin as usize);
        widths.insert(target as usize, width);
        tx.get_mut::<TableNode>(table)?.col_widths = Some(widths);
    }
    Ok(())
}
#[cfg(test)]
mod test;

#[cfg(test)]
mod span_test;
