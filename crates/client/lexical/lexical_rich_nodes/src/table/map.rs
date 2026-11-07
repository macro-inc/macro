//! Span geometry follows upstream map placement, holes and live-cell identity.
use super::*;

/// One cell's placement and snapshot, copied into every slot its span covers.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TableMapValue {
    /// Cell identity.
    pub cell: Id<TableCellNode>,
    /// Origin row.
    pub start_row: u32,
    /// Origin column.
    pub start_column: u32,
    /// Row span at map creation.
    pub row_span: u32,
    /// Column span at map creation.
    pub col_span: u32,
    /// Header state at map creation.
    pub header_state: TableCellHeaderState,
    /// The record was already writable when the map captured it.
    pub live: bool,
}
impl TableMapValue {
    /// Current span for a live record, otherwise the frozen map-time span.
    pub fn row_span(&self, view: StateRef<'_>) -> u32 {
        if self.live {
            view.get::<TableCellNode>(self.cell)
                .map_or(self.row_span, |c| c.row_span)
        } else {
            self.row_span
        }
    }
    /// Current horizontal span for a live record, otherwise the map-time span.
    pub fn col_span(&self, view: StateRef<'_>) -> u32 {
        if self.live {
            view.get::<TableCellNode>(self.cell)
                .map_or(self.col_span, |c| c.col_span)
        } else {
            self.col_span
        }
    }
    /// Current header for a live record, otherwise the frozen header.
    pub fn header_state(&self, view: StateRef<'_>) -> TableCellHeaderState {
        if self.live {
            view.get::<TableCellNode>(self.cell)
                .map_or(self.header_state, |c| c.header_state)
        } else {
            self.header_state
        }
    }
    /// Inclusive final spanned row.
    pub fn end_row(&self, view: StateRef<'_>) -> i64 {
        i64::from(self.start_row) + i64::from(self.row_span(view)) - 1
    }
    /// Inclusive final spanned column.
    pub fn end_column(&self, view: StateRef<'_>) -> i64 {
        i64::from(self.start_column) + i64::from(self.col_span(view)) - 1
    }
}
/// Span-expanded rows. Ragged rows and unoccupied slots remain observable.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct TableMap {
    /// Rows of span slots, with holes represented by None.
    pub rows: Vec<Vec<Option<TableMapValue>>>,
}
impl TableMap {
    /// Span slot, or None for a hole or an out-of-range coordinate.
    pub fn get(&self, row: u32, column: u32) -> Option<&TableMapValue> {
        self.rows.get(row as usize)?.get(column as usize)?.as_ref()
    }
    /// Number of rows, including empty rows.
    pub fn row_count(&self) -> u32 {
        self.rows.len() as u32
    }
    /// Width of the first row, as upstream uses even for ragged tables.
    pub fn column_count(&self) -> u32 {
        self.rows.first().map_or(0, |row| row.len() as u32)
    }
}
fn compute(
    view: StateRef<'_>,
    table: Id<TableNode>,
    a: Option<Id<TableCellNode>>,
    b: Option<Id<TableCellNode>>,
    writable: impl Fn(NodeKey) -> bool,
) -> Result<(TableMap, Option<TableMapValue>, Option<TableMapValue>)> {
    table_id(view, table.key())?;
    let rows = view.children_keys(table)?;
    let mut map = TableMap {
        rows: vec![vec![]; rows.len()],
    };
    let mut av = None;
    let mut bv = None;
    for (r, row) in rows.iter().copied().enumerate() {
        if !view.is::<TableRowNode>(row) {
            return Err(Error::Invariant(
                "Expected TableNode children to be TableRowNode",
            ));
        }
        let mut column = 0;
        for cell in view.children(row) {
            let data = view.get::<TableCellNode>(cell).ok_or(Error::Invariant(
                "Expected TableRowNode children to be TableCellNode",
            ))?;
            while map.rows[r].get(column).is_some_and(Option::is_some) {
                column += 1;
            }
            let value = TableMapValue {
                cell: cell_id(view, cell)?,
                start_row: r as u32,
                start_column: column as u32,
                row_span: data.row_span,
                col_span: data.col_span,
                header_state: data.header_state,
                live: writable(cell),
            };
            for target_row in map.rows.iter_mut().skip(r).take(data.row_span as usize) {
                let end = column
                    .checked_add(data.col_span as usize)
                    .ok_or(Error::Invariant("Invalid table span"))?;
                if target_row.len() < end {
                    target_row.resize(end, None);
                }
                target_row[column..end].fill(Some(value));
            }
            if a == Some(value.cell) && av.is_none() {
                av = Some(value);
            }
            if b == Some(value.cell) && bv.is_none() {
                bv = Some(value);
            }
        }
    }
    Ok((map, av, bv))
}
/// Compute a read-only table map, allowing either requested endpoint to be absent.
pub fn compute_table_map_skip_cell_check(
    view: StateRef<'_>,
    table: Id<TableNode>,
    a: Option<Id<TableCellNode>>,
    b: Option<Id<TableCellNode>>,
) -> Result<(TableMap, Option<TableMapValue>, Option<TableMapValue>)> {
    compute(view, table, a, b, |_| false)
}
/// Compute a read-only map and require both endpoints to be members of the table.
pub fn compute_table_map(
    view: StateRef<'_>,
    table: Id<TableNode>,
    a: Id<TableCellNode>,
    b: Id<TableCellNode>,
) -> Result<(TableMap, TableMapValue, TableMapValue)> {
    let (map, a, b) = compute_table_map_skip_cell_check(view, table, Some(a), Some(b))?;
    Ok((
        map,
        a.ok_or(Error::Invariant("Anchor not found in Table"))?,
        b.ok_or(Error::Invariant("Focus not found in Table"))?,
    ))
}
pub(super) fn compute_in(
    tx: &Transaction<'_>,
    table: Id<TableNode>,
    a: Option<Id<TableCellNode>>,
    b: Option<Id<TableCellNode>>,
) -> Result<(TableMap, Option<TableMapValue>, Option<TableMapValue>)> {
    compute(tx.view(), table, a, b, |key| tx.is_writable(key))
}
pub(super) fn checked_in(
    tx: &Transaction<'_>,
    table: Id<TableNode>,
    a: Id<TableCellNode>,
    b: Id<TableCellNode>,
) -> Result<(TableMap, TableMapValue, TableMapValue)> {
    let (map, a, b) = compute_in(tx, table, Some(a), Some(b))?;
    Ok((
        map,
        a.ok_or(Error::Invariant("Anchor not found in Table"))?,
        b.ok_or(Error::Invariant("Focus not found in Table"))?,
    ))
}
/// A node or selection endpoint used for table ancestry resolution.
#[derive(Clone, Copy, Debug)]
pub enum TripletSource {
    /// Resolve ancestry from this node.
    Node(NodeKey),
    /// Resolve ancestry from this point's node.
    Point(Point),
}
/// Nearest cell ancestor-or-self, its immediate row and the row's immediate table.
pub fn get_node_triplet(
    view: StateRef<'_>,
    source: TripletSource,
) -> Result<(Id<TableCellNode>, Id<TableRowNode>, Id<TableNode>)> {
    let key = match source {
        TripletSource::Node(key) => key,
        TripletSource::Point(point) => point.key(),
    };
    let cell = find_cell_node(view, key)
        .ok_or(Error::Invariant("Expected to find a parent TableCellNode"))?;
    let row = view
        .parent(cell)
        .and_then(|key| view.cast::<TableRowNode>(key))
        .ok_or(Error::Invariant(
            "Expected TableCellNode to have a parent TableRowNode",
        ))?;
    let table = view
        .parent(row)
        .and_then(|key| view.cast::<TableNode>(key))
        .ok_or(Error::Invariant(
            "Expected TableRowNode to have a parent TableNode",
        ))?;
    Ok((cell, row, table))
}
/// Inclusive span-expanded selection bounds.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TableCellRectBoundary {
    /// Leftmost selected column.
    pub min_column: u32,
    /// Topmost selected row.
    pub min_row: u32,
    /// Rightmost selected column.
    pub max_column: u32,
    /// Bottommost selected row.
    pub max_row: u32,
}
/// Largest cell span on each side of a selection rectangle.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TableCellRectSpans {
    /// Largest row span on the top side.
    pub top_span: u32,
    /// Largest column span on the left side.
    pub left_span: u32,
    /// Largest column span on the right side.
    pub right_span: u32,
    /// Largest row span on the bottom side.
    pub bottom_span: u32,
}
/// Grow endpoint bounds to a fixpoint that contains every intersecting whole cell.
pub fn compute_table_cell_rect_boundary(
    map: &TableMap,
    a: &TableMapValue,
    b: &TableMapValue,
) -> TableCellRectBoundary {
    let mut rect = TableCellRectBoundary {
        min_column: a.start_column.min(b.start_column),
        min_row: a.start_row.min(b.start_row),
        max_column: (a.start_column.saturating_add(a.col_span).saturating_sub(1))
            .max(b.start_column.saturating_add(b.col_span).saturating_sub(1)),
        max_row: (a.start_row.saturating_add(a.row_span).saturating_sub(1))
            .max(b.start_row.saturating_add(b.row_span).saturating_sub(1)),
    };
    loop {
        let previous = rect;
        for row in &map.rows {
            for v in row.iter().take(map.column_count() as usize).flatten() {
                let end_row = v.start_row.saturating_add(v.row_span).saturating_sub(1);
                let end_column = v.start_column.saturating_add(v.col_span).saturating_sub(1);
                if v.start_column <= rect.max_column
                    && end_column >= rect.min_column
                    && v.start_row <= rect.max_row
                    && end_row >= rect.min_row
                {
                    rect.min_column = rect.min_column.min(v.start_column);
                    rect.min_row = rect.min_row.min(v.start_row);
                    rect.max_column = rect.max_column.max(end_column);
                    rect.max_row = rect.max_row.max(end_row);
                }
            }
        }
        if rect == previous {
            return rect;
        }
    }
}
/// Inspect boundary spans; a hole where upstream dereferences a cell is an error.
pub fn compute_table_cell_rect_spans(
    map: &TableMap,
    rect: &TableCellRectBoundary,
) -> Result<TableCellRectSpans> {
    let mut spans = TableCellRectSpans {
        top_span: 1,
        left_span: 1,
        right_span: 1,
        bottom_span: 1,
    };
    for column in rect.min_column..=rect.max_column {
        spans.top_span = spans.top_span.max(
            map.get(rect.min_row, column)
                .ok_or(Error::Invariant("Table map contains a hole"))?
                .row_span,
        );
        spans.bottom_span = spans.bottom_span.max(
            map.get(rect.max_row, column)
                .ok_or(Error::Invariant("Table map contains a hole"))?
                .row_span,
        );
    }
    for row in rect.min_row..=rect.max_row {
        spans.left_span = spans.left_span.max(
            map.get(row, rect.min_column)
                .ok_or(Error::Invariant("Table map contains a hole"))?
                .col_span,
        );
        spans.right_span = spans.right_span.max(
            map.get(row, rect.max_column)
                .ok_or(Error::Invariant("Table map contains a hole"))?
                .col_span,
        );
    }
    Ok(spans)
}
/// A cell's origin and spans, independent of selection rectangle expansion.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TableCellNodeRect {
    /// Origin row index.
    pub row_index: u32,
    /// Origin column index.
    pub column_index: u32,
    /// Stored row span, with zero treated as one.
    pub row_span: u32,
    /// Stored column span, with zero treated as one.
    pub col_span: u32,
}
/// Independently locate a cell using the upstream matrix walk and falsy span defaults.
pub fn get_table_cell_node_rect(
    view: StateRef<'_>,
    cell: Id<TableCellNode>,
) -> Result<Option<TableCellNodeRect>> {
    let (_, _, table) = get_node_triplet(view, TripletSource::Node(cell.key()))?;
    let rows = view.children_keys(table)?;
    let width = rows.first().map_or(0, |row| view.children_size(*row)) as usize;
    let mut matrix = vec![vec![false; width]; rows.len()];
    for (r, row) in rows.iter().copied().enumerate() {
        let mut column = 0;
        for child in view.children(row) {
            while matrix[r].get(column) == Some(&true) {
                column += 1;
            }
            let data = view
                .get::<TableCellNode>(child)
                .ok_or(Error::Invariant("Expected TableCellNode"))?;
            let rs = data.row_span.max(1);
            let cs = data.col_span.max(1);
            for row in matrix.iter_mut().skip(r).take(rs as usize) {
                row.resize(row.len().max(column + cs as usize), false);
                row[column..column + cs as usize].fill(true);
            }
            if child == cell.key() {
                return Ok(Some(TableCellNodeRect {
                    row_index: r as u32,
                    column_index: column as u32,
                    row_span: rs,
                    col_span: cs,
                }));
            }
            column += cs as usize;
        }
    }
    Ok(None)
}
/// Nearest table cell ancestor-or-self.
pub fn find_cell_node(view: StateRef<'_>, key: NodeKey) -> Option<Id<TableCellNode>> {
    view.find_matching_parent(key, |v, k| v.is::<TableCellNode>(k))
        .and_then(|k| view.cast(k))
}
/// Nearest table ancestor-or-self.
pub fn find_table_node(view: StateRef<'_>, key: NodeKey) -> Option<Id<TableNode>> {
    view.find_matching_parent(key, |v, k| v.is::<TableNode>(k))
        .and_then(|k| view.cast(k))
}
/// Find a cell's immediate row, or return the upstream diagnostic.
pub fn get_table_row_node_from_table_cell_node(
    view: StateRef<'_>,
    key: NodeKey,
) -> Result<Id<TableRowNode>> {
    let row = view
        .find_matching_parent(key, |v, k| v.is::<TableRowNode>(k))
        .and_then(|key| view.cast(key));
    row.ok_or(Error::Invariant(
        "Expected table cell to be inside of table row.",
    ))
}
/// Find the containing table, or return the upstream diagnostic.
pub fn get_table_node_from_lexical_node(view: StateRef<'_>, key: NodeKey) -> Result<Id<TableNode>> {
    find_table_node(view, key).ok_or(Error::Invariant(
        "Expected table cell to be inside of table.",
    ))
}
/// Physical row index among table children; -1 if not found.
pub fn get_table_row_index_from_table_cell_node(
    view: StateRef<'_>,
    cell: Id<TableCellNode>,
) -> Result<i32> {
    let row = get_table_row_node_from_table_cell_node(view, cell.key())?;
    Ok(view.index_within_parent(row).map_or(-1, |i| i.0 as i32))
}
/// Physical child index within the row, without expanding spans.
pub fn get_table_column_index_from_table_cell_node(
    view: StateRef<'_>,
    cell: Id<TableCellNode>,
) -> Result<i32> {
    get_table_row_node_from_table_cell_node(view, cell.key())?;
    Ok(view.index_within_parent(cell).map_or(-1, |i| i.0 as i32))
}
/// Last enclosing cell before reaching the requested table, handling nested tables.
pub fn find_parent_table_cell_node_in_table(
    view: StateRef<'_>,
    table: NodeKey,
    node: Option<NodeKey>,
) -> Option<Id<TableCellNode>> {
    let mut current = node;
    let mut cell = None;
    while let Some(key) = current {
        if key == table {
            return cell;
        }
        if let Some(found) = view.cast::<TableCellNode>(key) {
            cell = Some(found);
        }
        current = view.parent(key);
    }
    None
}
/// Both selection endpoints must be strict descendants of the table.
pub fn is_selection_in_table(
    view: StateRef<'_>,
    selection: Option<&Selection>,
    table: NodeKey,
) -> bool {
    let endpoints = match selection {
        Some(Selection::Range(s)) => Some((s.anchor.key(), s.focus.key())),
        Some(Selection::Table(s)) => Some((s.anchor.key(), s.focus.key())),
        _ => None,
    };
    endpoints.is_some_and(|(a, b)| view.is_parent_of(table, a) && view.is_parent_of(table, b))
}
/// Upstream endpoint test, using the first slot and last slot of the last row.
pub fn is_full_table_selection(
    view: StateRef<'_>,
    selection: Option<&Selection>,
    table: Id<TableNode>,
) -> Result<bool> {
    let Some(Selection::Table(selection)) = selection else {
        return Ok(false);
    };
    let a = view
        .cast::<TableCellNode>(selection.anchor.key())
        .ok_or(Error::Invariant("Anchor not found in Table"))?;
    let f = view
        .cast::<TableCellNode>(selection.focus.key())
        .ok_or(Error::Invariant("Focus not found in Table"))?;
    let (map, _, _) = compute_table_map(view, table, a, f)?;
    let first = map.get(0, 0);
    let last = map
        .rows
        .last()
        .and_then(|row| row.last())
        .and_then(Option::as_ref);
    Ok(first.zip(last).is_some_and(|(first, last)| {
        selection.anchor.key() == first.cell.key() && selection.focus.key() == last.cell.key()
    }))
}
#[cfg(test)]
mod test;
