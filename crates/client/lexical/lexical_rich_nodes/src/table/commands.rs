//! Model command handlers; dispatch priority and clipboard access belong to the host.
use super::*;
use std::collections::HashSet;
/// Parsed dimensions for INSERT_TABLE_COMMAND.
#[derive(Clone, Copy, Debug)]
pub struct InsertTablePayload {
    /// Row count after the JS boundary's Number conversion.
    pub rows: u32,
    /// Column count.
    pub columns: u32,
    /// Header policy.
    pub include_headers: IncludeHeaders,
}
/// Insert a table at the active or previous range selection.
pub fn insert_table(
    tx: &mut Transaction<'_>,
    p: &InsertTablePayload,
    has_nested_tables: bool,
) -> Result<bool> {
    let Some(Selection::Range(range)) = tx.selection().or_else(|| tx.previous_selection()) else {
        return Ok(false);
    };
    if !has_nested_tables && find_table_node(tx.view(), range.anchor.key()).is_some() {
        return Ok(false);
    }
    let table = create_table_node_with_dimensions(tx, p.rows, p.columns, p.include_headers)?;
    crate::utils::insert_node_to_nearest_root(tx, table.key())?;
    if let Some(first) = tx.first_descendant(table)
        && tx.is_text(first)
    {
        tx.select_start(first)?;
    }
    Ok(true)
}
/// Select all cells when a table is the root's only child.
pub fn select_all_in_table(tx: &mut Transaction<'_>) -> Result<bool> {
    let Some(Selection::Range(range)) = tx.selection() else {
        return Ok(false);
    };
    let Some(table) = find_table_node(tx.view(), range.anchor.key()) else {
        return Ok(false);
    };
    if tx.parent(table) != Some(NodeKey::ROOT) || tx.children_size(NodeKey::ROOT) != 1 {
        return Ok(false);
    }
    let (map, _, _) = compute_table_map_skip_cell_check(tx.view(), table, None, None)?;
    let Some(first) = map
        .rows
        .first()
        .and_then(|r| r.first())
        .and_then(Option::as_ref)
    else {
        return Ok(false);
    };
    let Some(last) = map
        .rows
        .last()
        .and_then(|r| r.last())
        .and_then(Option::as_ref)
    else {
        return Ok(false);
    };
    select_cells(tx, table, first.cell, last.cell)?;
    Ok(true)
}
/// Triple-click's model half: select the nearest block directly inside a cell.
pub fn select_block_in_cell(tx: &mut Transaction<'_>, start: NodeKey) -> Result<bool> {
    let Some(block) = tx.find_matching_parent(start, |v, k| v.is_element(k) && !v.is_inline(k))
    else {
        return Ok(false);
    };
    if !tx.parent(block).is_some_and(|p| tx.is::<TableCellNode>(p)) {
        return Ok(false);
    }
    tx.element(block)?
        .select(Some(ChildIndex(0)), Some(ChildIndex(0)))?;
    Ok(true)
}
/// Paste a table into a grid or claim unsupported table-containing clipboard content.
pub fn insert_clipboard_nodes_in_table(
    tx: &mut Transaction<'_>,
    nodes: &[NodeKey],
    slot: SelectionSlot,
    has_nested_tables: bool,
) -> Result<bool> {
    let mut contains_table = false;
    for &node in nodes {
        visit_recursively(tx.view(), node, &mut |key| {
            contains_table |= tx.is::<TableNode>(key);
            true
        });
    }
    if !contains_table {
        return Ok(false);
    }
    let Some(selection) = tx.selection_at(slot)?.cloned() else {
        return Ok(false);
    };
    let inside = match &selection {
        Selection::Table(_) => true,
        Selection::Range(r) => {
            find_cell_node(tx.view(), r.anchor.key()).is_some()
                && find_cell_node(tx.view(), r.focus.key()).is_some()
        }
        _ => false,
    };
    if !inside {
        return Ok(false);
    }
    if let [node] = nodes
        && let Some(template) = tx.view().cast::<TableNode>(*node)
    {
        return insert_table_into_grid(tx, template, &selection);
    }
    let multiple = match &selection {
        Selection::Table(s) => s.anchor.key() != s.focus.key(),
        Selection::Range(s) => {
            tx.is::<TableCellNode>(s.anchor.key()) && s.anchor.key() != s.focus.key()
        }
        _ => false,
    };
    Ok(!(matches!(selection, Selection::Range(_)) && has_nested_tables && !multiple))
}
fn insert_table_into_grid(
    tx: &mut Transaction<'_>,
    template: Id<TableNode>,
    selection: &Selection,
) -> Result<bool> {
    let (anchor, focus) = match selection {
        Selection::Range(s) => (s.anchor, s.focus),
        Selection::Table(s) => (s.anchor, s.focus),
        _ => return Ok(false),
    };
    let (ac, _, grid) = get_node_triplet(tx.view(), TripletSource::Point(anchor))?;
    let fc =
        find_cell_node(tx.view(), focus.key()).ok_or(Error::Invariant("Expected TableCellNode"))?;
    let (init, av, fv) = map::checked_in(tx, grid, ac, fc)?;
    let (tmpl, _, _) = map::compute_in(tx, template, None, None)?;
    let (mut row0, mut col0, mut nr, mut nc) = (
        av.start_row,
        av.start_column,
        tmpl.row_count(),
        tmpl.column_count(),
    );
    if matches!(selection, Selection::Table(_)) {
        let b = compute_table_cell_rect_boundary(&init, &av, &fv);
        row0 = b.min_row;
        col0 = b.min_column;
        nr = nr.min(b.max_row - row0 + 1);
        nc = nc.min(b.max_column - col0 + 1);
    }
    let (ir, ic) = (init.row_count(), init.column_count());
    let mut seen = HashSet::new();
    let mut did_merge = false;
    for row in row0..ir.min(row0 + nr) {
        for col in col0..ic.min(col0 + nc) {
            let v = *init
                .get(row, col)
                .ok_or(Error::Invariant("Table map contains a hole"))?;
            if (v.row_span(tx.view()) != 1 || v.col_span(tx.view()) != 1) && seen.insert(v.cell) {
                unmerge_cell_node(tx, v.cell)?;
                did_merge = true;
            }
        }
    }
    let (interim, _, _) = map::compute_in(tx, grid, None, None)?;
    for _ in 0..(row0 + nr).saturating_sub(ir) {
        let cell = interim
            .get(ir - 1, 0)
            .ok_or(Error::Invariant("Table map contains a hole"))?
            .cell;
        insert_table_row_at_node(tx, cell, true)?;
    }
    for _ in 0..(col0 + nc).saturating_sub(ic) {
        let cell = interim
            .get(0, ic - 1)
            .ok_or(Error::Invariant("Table map contains a hole"))?
            .cell;
        insert_table_column_at_node(tx, cell, true, false)?;
    }
    let (interim, _, _) = map::compute_in(tx, grid, None, None)?;
    for tr in 0..nr {
        for tc in 0..nc {
            let Some(v) = tmpl.get(tr, tc) else {
                return Err(Error::Invariant("Table map contains a hole"));
            };
            if v.start_row != tr || v.start_column != tc {
                continue;
            }
            let (row, col) = (row0 + tr, col0 + tc);
            if v.row_span(tx.view()) > 1 || v.col_span(tx.view()) > 1 {
                let mut cells = Vec::new();
                for r in row..(row + v.row_span(tx.view())).min(row0 + nr) {
                    for c in col..(col + v.col_span(tx.view())).min(col0 + nc) {
                        cells.push(
                            interim
                                .get(r, c)
                                .ok_or(Error::Invariant("Table map contains a hole"))?
                                .cell,
                        );
                    }
                }
                merge_cells(tx, &cells)?;
                did_merge = true;
            }
            let cell = interim
                .get(row, col)
                .ok_or(Error::Invariant("Table map contains a hole"))?
                .cell;
            if let Some(bg) = tx
                .get::<TableCellNode>(v.cell)
                .and_then(|v| v.background_color.clone())
            {
                tx.get_mut::<TableCellNode>(cell)?.background_color = Some(bg);
            }
            let old = tx.children_keys(cell)?;
            let children = tx.children_keys(v.cell)?;
            tx.append(cell, &children)?;
            for child in old {
                tx.remove(child, true)?;
            }
        }
    }
    if matches!(selection, Selection::Table(_)) && did_merge {
        let (latest, _, _) = map::compute_in(tx, grid, None, None)?;
        let cell = latest
            .get(av.start_row, av.start_column)
            .ok_or(Error::Invariant("Table map contains a hole"))?
            .cell;
        tx.select_end(cell)?;
    }
    Ok(true)
}
