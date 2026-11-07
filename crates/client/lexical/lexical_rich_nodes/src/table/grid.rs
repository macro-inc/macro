//! Physical table coordinates coexist with the distinct span-expanded map.
use super::*;
use serde::{Serialize, Serializer};
use std::collections::HashSet;
/// Immutable model-derived replacement for the DOM-scanned table grid.
#[derive(Clone, Debug, PartialEq)]
pub struct TableGrid {
    /// Table identity.
    pub table: Id<TableNode>,
    /// Actual row children, without span expansion.
    pub physical: Vec<Vec<Id<TableCellNode>>>,
    /// Physical row count.
    pub rows: u32,
    /// Child count of the LAST row, preserving the upstream quirk.
    pub columns: u32,
    /// Logical span geometry.
    pub map: TableMap,
}
impl Serialize for TableGrid {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        let physical = self
            .physical
            .iter()
            .map(|row| {
                row.iter()
                    .map(|cell| cell.key().to_string())
                    .collect::<Vec<_>>()
            })
            .collect::<Vec<_>>();
        let map = self.map.rows.iter().map(|row| row.iter().map(|v| v.map(|v| serde_json::json!({"cell":v.cell.key().to_string(),"startRow":v.start_row,"startColumn":v.start_column,"rowSpan":v.row_span,"colSpan":v.col_span,"headerState":v.header_state}))).collect::<Vec<_>>()).collect::<Vec<_>>();
        serde_json::json!({"table":self.table.key().to_string(),"physical":physical,"rows":self.rows,"columns":self.columns,"map":{"rows":map}}).serialize(serializer)
    }
}
/// Build a fresh physical grid and span map from the current model.
pub fn table_grid(view: StateRef<'_>, table: Id<TableNode>) -> Result<TableGrid> {
    let mut physical = vec![];
    for row in view.children(table) {
        row_id(view, row)?;
        let cells = view
            .children(row)
            .map(|key| cell_id(view, key))
            .collect::<Result<Vec<_>>>()?;
        physical.push(cells);
    }
    let rows = physical.len() as u32;
    let columns = physical.last().map_or(0, |row| row.len() as u32);
    let (map, _, _) = compute_table_map_skip_cell_check(view, table, None, None)?;
    Ok(TableGrid {
        table,
        physical,
        rows,
        columns,
        map,
    })
}
impl TableGrid {
    /// Physical lookup; excess x clamps to the row's final cell, negative coordinates miss.
    pub fn cell_at(&self, x: i64, y: i64) -> Option<Id<TableCellNode>> {
        let row = self.physical.get(usize::try_from(y).ok()?)?;
        let x = usize::try_from(x).ok()?;
        row.get(x.min(row.len().checked_sub(1)?)).copied()
    }
    /// Physical lookup with the upstream invariant on a miss.
    pub fn cell_at_or_err(&self, x: i64, y: i64) -> Result<Id<TableCellNode>> {
        self.cell_at(x, y)
            .ok_or(Error::Invariant("Cell not found at cords."))
    }
    /// Physical coordinates of a cell, irrespective of its span.
    pub fn coords_of(&self, cell: Id<TableCellNode>) -> Result<(u32, u32)> {
        self.cells()
            .find(|(c, _, _)| *c == cell)
            .map(|(_, x, y)| (x, y))
            .ok_or(Error::Invariant("Cell not found in table."))
    }
    /// Logical span slot.
    pub fn slot(&self, row: u32, col: u32) -> Option<&TableMapValue> {
        self.map.get(row, col)
    }
    /// Physical cells in row-major order, with x and y coordinates.
    pub fn cells(&self) -> impl Iterator<Item = (Id<TableCellNode>, u32, u32)> + '_ {
        self.physical.iter().enumerate().flat_map(|(y, row)| {
            row.iter()
                .enumerate()
                .map(move |(x, cell)| (*cell, x as u32, y as u32))
        })
    }
}
/// Requested table traversal direction.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TableDirection {
    /// Previous physical cell.
    Backward,
    /// Next physical cell.
    Forward,
    /// Cell in the row above.
    Up,
    /// Cell in the row below.
    Down,
}
/// Navigation decision, separated from application to the selection.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CellMove {
    /// Move to a cell boundary.
    Cell {
        /// Destination cell.
        cell: Id<TableCellNode>,
        /// Select start instead of end.
        from_start: bool,
    },
    /// Leave before the table.
    SelectPreviousOfTable,
    /// Leave after the table.
    SelectNextOfTable,
}
/// Decide physical navigation using the last row's column count, as upstream does.
pub fn next_cell_in_direction(
    grid: &TableGrid,
    x: u32,
    y: u32,
    direction: TableDirection,
) -> Result<CellMove> {
    let (x, y) = (i64::from(x), i64::from(y));
    let (next_x, next_y, start) = match direction {
        TableDirection::Backward if x != 0 => (x - 1, y, false),
        TableDirection::Backward if y != 0 => (i64::from(grid.columns) - 1, y - 1, false),
        TableDirection::Backward => return Ok(CellMove::SelectPreviousOfTable),
        TableDirection::Forward if x != i64::from(grid.columns) - 1 => (x + 1, y, true),
        TableDirection::Forward if y != i64::from(grid.rows) - 1 => (0, y + 1, true),
        TableDirection::Forward => return Ok(CellMove::SelectNextOfTable),
        TableDirection::Up if y != 0 => (x, y - 1, false),
        TableDirection::Up => return Ok(CellMove::SelectPreviousOfTable),
        TableDirection::Down if y != i64::from(grid.rows) - 1 => (x, y + 1, true),
        TableDirection::Down => return Ok(CellMove::SelectNextOfTable),
    };
    Ok(CellMove::Cell {
        cell: grid.cell_at_or_err(next_x, next_y)?,
        from_start: start,
    })
}
/// Apply the navigation decision through the core's normal selection rules.
pub fn apply_cell_move(
    tx: &mut Transaction<'_>,
    table: Id<TableNode>,
    movement: CellMove,
) -> Result<()> {
    match movement {
        CellMove::Cell {
            cell,
            from_start: true,
        } => tx.select_start(cell),
        CellMove::Cell {
            cell,
            from_start: false,
        } => tx.select_end(cell),
        CellMove::SelectPreviousOfTable => tx.select_previous(table, None, None),
        CellMove::SelectNextOfTable => tx.select_next(table, None, None),
    }
}
/// Keys to highlight in a view, derived from the supplied model selection.
pub fn selected_node_keys(
    view: StateRef<'_>,
    selection: Option<&Selection>,
) -> Result<HashSet<NodeKey>> {
    selection.map_or_else(
        || Ok(HashSet::new()),
        |selection| Ok(selection.nodes(view)?.into_iter().collect()),
    )
}
