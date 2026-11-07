use super::*;
/// Delete the selected logical rows, trimming spans and moving surviving cells as upstream does.
pub fn delete_table_row_at_selection(tx: &mut Transaction<'_>) -> Result<()> {
    let (mut a, mut f, table) = selection_cells(tx)?;
    if let Some(selection) = tx.selection()
        && selection.is_backward(tx.view())?
    {
        std::mem::swap(&mut a, &mut f);
    }
    let (map, av, fv) = map::checked_in(tx, table, a, f)?;
    let top = av.start_row;
    let bottom = fv.end_row(tx.view());
    if bottom < top {
        return Err(Error::Invariant("Invalid table selection"));
    }
    if map.row_count() == bottom - top + 1 {
        return tx.remove(table, true);
    }
    let row_nodes = tx.children_keys(table)?;
    for row in (top..=bottom).rev() {
        for column in (0..map.column_count()).rev() {
            let v = *map
                .get(row, column)
                .ok_or(Error::Invariant("Table map contains a hole"))?;
            if v.start_column != column {
                continue;
            }
            if v.start_row < top || v.end_row(tx.view()) > bottom {
                let overlap = (i64::from(v.end_row(tx.view()).min(bottom))
                    - i64::from(v.start_row.max(top))
                    + 1)
                .max(0) as u32;
                let span = v
                    .row_span(tx.view())
                    .checked_sub(overlap)
                    .ok_or(Error::Invariant("Invalid table span"))?;
                tx.get_mut::<TableCellNode>(v.cell)?.row_span = span;
            }
            // Read after trimming: live map values see the changed span; frozen
            // ones retain it. Do not hoist this condition above the write.
            if v.start_row >= top && v.end_row(tx.view()) > bottom && row == bottom {
                let next = *row_nodes
                    .get((bottom + 1) as usize)
                    .ok_or(Error::Invariant("Expected TableRowNode"))?;
                row_id(tx.view(), next)?;
                let mut after = None;
                let mut index = 0;
                while index < column {
                    let previous = *map
                        .get(bottom + 1, index)
                        .ok_or(Error::Invariant("Table map contains a hole"))?;
                    if previous.start_row == row + 1 {
                        after = Some(previous.cell);
                    }
                    index += previous.col_span(tx.view()).max(1);
                }
                if let Some(after) = after {
                    tx.insert_after(after, v.cell, true)?;
                } else {
                    insert_first(tx, next, v.cell.key())?;
                }
            }
        }
        let node = *row_nodes
            .get(row as usize)
            .ok_or(Error::Invariant("Expected TableRowNode"))?;
        row_id(tx.view(), node)?;
        tx.remove(node, true)?;
    }
    let destination = if bottom + 1 < map.row_count() {
        map.get(bottom + 1, 0)
    } else {
        top.checked_sub(1).and_then(|r| map.get(r, 0))
    }
    .ok_or(Error::Invariant("Table map contains a hole"))?;
    move_selection_to_cell(tx, destination.cell)
}
/// Delete selected logical columns, preserving repeated live overflow trims per spanned row.
pub fn delete_table_column_at_selection(tx: &mut Transaction<'_>) -> Result<()> {
    let (a, f, table) = selection_cells(tx)?;
    let (map, av, fv) = map::checked_in(tx, table, a, f)?;
    let start = av.start_column.min(fv.start_column);
    let end = av.end_column(tx.view()).max(fv.end_column(tx.view()));
    let count = end - start + 1;
    if map.column_count() == count {
        tx.select_previous(table, None, None)?;
        return tx.remove(table, true);
    }
    for row in 0..map.row_count() {
        for column in start..=end {
            let v = *map
                .get(row, column)
                .ok_or(Error::Invariant("Table map contains a hole"))?;
            if v.start_column < start {
                if column == start {
                    let span = v.col_span(tx.view());
                    let overlap = count.min(
                        span.checked_sub(start - v.start_column)
                            .ok_or(Error::Invariant("Invalid table span"))?,
                    );
                    tx.get_mut::<TableCellNode>(v.cell)?.col_span = span - overlap;
                }
            } else if v.end_column(tx.view()) > end {
                if column == end {
                    let span = v
                        .col_span(tx.view())
                        .checked_sub(end - v.start_column + 1)
                        .ok_or(Error::Invariant("Invalid table span"))?;
                    tx.get_mut::<TableCellNode>(v.cell)?.col_span = span;
                }
            } else {
                tx.remove(v.cell, true)?;
            }
        }
    }
    let focus_row = fv.start_row;
    let next_column = if av.start_column > fv.start_column {
        av.start_column + av.col_span(tx.view())
    } else {
        fv.start_column + fv.col_span(tx.view())
    };
    let destination = map
        .get(focus_row, next_column)
        .or_else(|| {
            fv.start_column
                .min(av.start_column)
                .checked_sub(1)
                .and_then(|c| map.get(focus_row, c))
        })
        .ok_or(Error::Invariant("Cell not found at cords."))?;
    move_selection_to_cell(tx, destination.cell)?;
    if let Some(mut widths) = tx
        .get::<TableNode>(table)
        .and_then(|t| t.col_widths.clone())
    {
        let start = (start as usize).min(widths.len());
        let end = start.saturating_add(count as usize).min(widths.len());
        widths.drain(start..end);
        tx.get_mut::<TableNode>(table)?.col_widths = Some(widths);
    }
    Ok(())
}
