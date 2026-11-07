use super::*;
use std::collections::HashSet;
/// Merge the complete bounding box of supplied cells, including unlisted interior cells.
pub fn merge_cells(
    tx: &mut Transaction<'_>,
    cells: &[Id<TableCellNode>],
) -> Result<Option<Id<TableCellNode>>> {
    let Some(first) = cells.first() else {
        return Ok(None);
    };
    let table = get_table_node_from_lexical_node(tx.view(), first.key())?;
    let (map, _, _) = map::compute_in(tx, table, None, None)?;
    let mut min_row = u32::MAX;
    let mut min_column = u32::MAX;
    let mut max_row = 0;
    let mut max_column = 0;
    let mut visited = HashSet::new();
    for row in &map.rows {
        for value in row.iter().flatten() {
            if cells.contains(&value.cell) && visited.insert(value.cell.key()) {
                min_row = min_row.min(value.start_row);
                min_column = min_column.min(value.start_column);
                max_row = max_row.max(value.end_row(tx.view()));
                max_column = max_column.max(value.end_column(tx.view()));
            }
        }
    }
    if visited.is_empty() {
        return Ok(None);
    }
    let target = map
        .get(min_row, min_column)
        .ok_or(Error::Invariant("Table map contains a hole"))?
        .cell;
    let mut data = tx.get_mut::<TableCellNode>(target)?;
    data.col_span = max_column - min_column + 1;
    data.row_span = max_row - min_row + 1;
    visited.clear();
    for row in min_row..=max_row {
        for column in min_column..=max_column {
            let cell = map
                .get(row, column)
                .ok_or(Error::Invariant("Table map contains a hole"))?
                .cell;
            if cell == target || !visited.insert(cell.key()) {
                continue;
            }
            let children = tx.children_keys(cell)?;
            let empty =
                children.len() == 1 && tx.is::<Paragraph>(children[0]) && tx.is_empty(children[0]);
            if !empty {
                tx.append(target, &children)?;
            }
            tx.remove(cell, true)?;
        }
    }
    if tx.is_empty(target) {
        let paragraph = tx.create(Paragraph::default())?;
        tx.append(target, &[paragraph.key()])?;
    }
    Ok(Some(target))
}
/// Unmerge the anchor cell of a range or table selection.
pub fn unmerge_cell(tx: &mut Transaction<'_>) -> Result<()> {
    let (cell, _, _) = selection_cells(tx)?;
    unmerge_cell_node(tx, cell)
}
/// Expand a merged cell, inheriting only header bits shared across the corresponding axes.
pub fn unmerge_cell_node(tx: &mut Transaction<'_>, cell: Id<TableCellNode>) -> Result<()> {
    let data = tx
        .get::<TableCellNode>(cell)
        .ok_or(Error::NodeTypeMismatch(cell.key()))?;
    if data.col_span == 1 && data.row_span == 1 {
        return Ok(());
    }
    let (_, _, table) = get_node_triplet(tx.view(), TripletSource::Node(cell.key()))?;
    let (map, cv, _) = map::checked_in(tx, table, cell, cell)?;
    let columns = cv.col_span(tx.view());
    let rows = cv.row_span(tx.view());
    let header = cv.header_state(tx.view());
    let mut column_styles = Vec::new();
    for column in 0..columns {
        let mut style = header & TableCellHeaderState::COLUMN;
        for row in 0..map.row_count() {
            if style.is_empty() {
                break;
            }
            style &= map
                .get(row, cv.start_column + column)
                .ok_or(Error::Invariant("Table map contains a hole"))?
                .header_state(tx.view());
        }
        column_styles.push(style);
    }
    let mut row_styles = Vec::new();
    for row in 0..rows {
        let mut style = header & TableCellHeaderState::ROW;
        for column in 0..map.column_count() {
            if style.is_empty() {
                break;
            }
            style &= map
                .get(cv.start_row + row, column)
                .ok_or(Error::Invariant("Table map contains a hole"))?
                .header_state(tx.view());
        }
        row_styles.push(style);
    }
    if columns > 1 {
        for column in 1..columns {
            let new =
                cell_with_paragraph(tx, column_styles[column as usize] | row_styles[0], None)?;
            tx.insert_after(cell, new, true)?;
        }
        tx.get_mut::<TableCellNode>(cell)?.col_span = 1;
    }
    if rows > 1 {
        let mut row = tx.parent_or_err(cell)?;
        for offset in 1..rows {
            row = tx
                .next_sibling(row)
                .ok_or(Error::Invariant("Expected TableRowNode"))?;
            row_id(tx.view(), row)?;
            let current_row = cv.start_row + offset;
            let mut column = 0;
            let mut after = None;
            while column < cv.start_column {
                let value = *map
                    .get(current_row, column)
                    .ok_or(Error::Invariant("Table map contains a hole"))?;
                if value.start_row == current_row {
                    after = Some(value.cell);
                }
                column += value.col_span(tx.view()).max(1);
            }
            for column in (0..columns).rev() {
                let new = cell_with_paragraph(
                    tx,
                    column_styles[column as usize] | row_styles[offset as usize],
                    None,
                )?;
                if let Some(after) = after {
                    tx.insert_after(after, new, true)?;
                } else {
                    insert_first(tx, row, new.key())?;
                }
            }
        }
        tx.get_mut::<TableCellNode>(cell)?.row_span = 1;
    }
    Ok(())
}
