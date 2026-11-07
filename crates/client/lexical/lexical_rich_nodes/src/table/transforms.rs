//! Integrity repair and opt-in cell merge/background policies.
use super::*;
/// Repair a cell's parent and ensure it contains a paragraph.
pub fn table_cell_transform(tx: &mut Transaction<'_>, cell: Id<TableCellNode>) -> Result<()> {
    if !tx
        .parent(cell)
        .is_some_and(|key| tx.is::<TableRowNode>(key))
    {
        tx.remove(cell, false)?;
    } else if tx.is_empty(cell) {
        let p = tx.create(Paragraph::default())?;
        tx.append(cell, &[p.key()])?;
    }
    Ok(())
}
/// Remove orphan rows and unwrap unsupported wrappers around cells.
pub fn table_row_transform(tx: &mut Transaction<'_>, row: Id<TableRowNode>) -> Result<()> {
    if !tx.parent(row).is_some_and(|key| tx.is::<TableNode>(key)) {
        tx.remove(row, false)?;
    } else {
        crate::utils::unwrap_and_filter_descendants(tx, row.key(), |view, key| {
            view.is::<TableCellNode>(key)
        })?;
    }
    Ok(())
}
/// Repair row structure, fill ragged geometry and reconcile the column-width array.
pub fn table_transform(tx: &mut Transaction<'_>, table: Id<TableNode>) -> Result<()> {
    crate::utils::unwrap_and_filter_descendants(tx, table.key(), |view, key| {
        view.is::<TableRowNode>(key)
    })?;
    let (map, _, _) = map::compute_in(tx, table, None, None)?;
    let width = map.rows.iter().map(Vec::len).max().unwrap_or(0);
    let rows = tx.children_keys(table)?;
    for (index, slots) in map.rows.iter().enumerate() {
        let Some(row) = rows.get(index).copied() else {
            continue;
        };
        row_id(tx.view(), row)?;
        let filled = slots.iter().filter(|slot| slot.is_some()).count();
        for _ in filled..width {
            let cell = tx.create(TableCellNode::default())?;
            let p = tx.create(Paragraph::default())?;
            tx.append(cell, &[p.key()])?;
            tx.append(row, &[cell.key()])?;
        }
    }
    let count = TableNode::column_count(tx.view(), table) as usize;
    if let Some(mut widths) = tx
        .get::<TableNode>(table)
        .and_then(|t| t.col_widths.clone())
        && widths.len() != count
    {
        let next = if count < widths.len() {
            widths.truncate(count);
            Some(widths)
        } else if let Some(last) = widths.last().copied() {
            widths.resize(count, last);
            Some(widths)
        } else {
            None
        };
        tx.get_mut::<TableNode>(table)?.col_widths = next;
    }
    Ok(())
}
/// Expand every span when merge support is disabled; integrity fills new cells on the next pass.
pub fn table_cell_unmerge_transform(
    tx: &mut Transaction<'_>,
    cell: Id<TableCellNode>,
) -> Result<()> {
    let data = tx
        .get::<TableCellNode>(cell)
        .ok_or(Error::NodeTypeMismatch(cell.key()))?;
    if data.col_span <= 1 && data.row_span <= 1 {
        return Ok(());
    }
    let (_, _, table) = get_node_triplet(tx.view(), TripletSource::Node(cell.key()))?;
    let (map, _, _) = map::checked_in(tx, table, cell, cell)?;
    let rows = tx.children_keys(table)?;
    let mut unmerge = vec![];
    for (i, row) in rows.into_iter().enumerate().take(map.row_count() as usize) {
        row_id(tx.view(), row)?;
        let mut last = None;
        for column in 0..map.column_count() {
            let value = *map
                .get(i as u32, column)
                .ok_or(Error::Invariant("Table map contains a hole"))?;
            if value.start_row == i as u32 && value.start_column == column {
                last = Some(value.cell);
                unmerge.push(value.cell);
            } else if value.col_span(tx.view()) > 1 || value.row_span(tx.view()) > 1 {
                let new = tx.create(TableCellNode::new(value.header_state(tx.view()), 1, None))?;
                if let Some(last) = last {
                    tx.insert_after(last, new, true)?;
                } else if let Some(first) = tx.first_child(row) {
                    tx.insert_before(first, new, true)?;
                } else {
                    tx.append(row, &[new.key()])?;
                }
            }
        }
    }
    for cell in unmerge {
        let mut data = tx.get_mut::<TableCellNode>(cell)?;
        data.col_span = 1;
        data.row_span = 1;
    }
    Ok(())
}
/// Clear fills when background color support is disabled.
pub fn table_cell_background_strip_transform(
    tx: &mut Transaction<'_>,
    cell: Id<TableCellNode>,
) -> Result<()> {
    if tx
        .get::<TableCellNode>(cell)
        .is_some_and(|c| c.background_color.is_some())
    {
        tx.get_mut::<TableCellNode>(cell)?.background_color = None;
    }
    Ok(())
}
