//! The cells of a worksheet.
//!
//! Everything that reads or writes the cells of a sheet goes through
//! [`SheetData`], so that how they are stored is nobody else's business.
//!
//! # How they are stored
//!
//! By position, with no hashing. Rows are grouped in chunks of `CHUNK_ROWS`
//! consecutive rows, and a chunk is allocated the first time one of its rows is
//! used, so a sheet with a single cell in its last row costs one chunk and not
//! a million empty rows. A row is a vector of `(column, cell)` sorted by column.
//!
//! ```text
//!   chunks ──► [ chunk 0 | (none) | chunk 2 | ... ]        row >> CHUNK_BITS
//!                  │
//!                  ▼
//!              [ row 0 | row 1 | (none) | ... ]            row & CHUNK_MASK
//!                           │
//!                           ▼
//!                       [ (A, cell) (C, cell) (D, cell) ]  sorted by column
//! ```
//!
//! Reading a cell is two indexed steps and a short search. Rows and cells come
//! out in natural order, first by row and then by column, without sorting.
//! Evaluation reads every cell several times, and with a hash map per row each
//! read was two hashes and two jumps to unrelated places in memory, which on a
//! large sheet cost more than running the formulas.

use bitcode::{Decode, Encode};

use crate::constants::LAST_ROW;
use crate::types::Cell;

const CHUNK_BITS: u32 = 10;
const CHUNK_ROWS: usize = 1 << CHUNK_BITS;
const CHUNK_MASK: usize = CHUNK_ROWS - 1;

/// Rows this short are searched from the left; longer ones by bisection.
const LINEAR_SEARCH_LIMIT: usize = 8;

/// The cells of a worksheet, by row and column. Both are 1-indexed.
///
/// A row can exist without cells: `set_row` with no cells creates one. The xlsx
/// importer does that for rows that carry a height or a style and nothing
/// else, and the exporter writes a `<row>` element for every row that exists
/// here, so such rows survive a round trip. Removing the last cell of a row
/// with `remove_cell` removes the row.
///
/// Rows outside the sheet, below 1 or beyond the last row, cannot hold cells:
/// writing to them does nothing and reading them finds nothing.
#[derive(Encode, Decode, Debug, Clone, Default)]
pub struct SheetData {
    /// `chunks[i]` holds rows `i * CHUNK_ROWS ..`, if any of them exists.
    chunks: Vec<Option<Box<Chunk>>>,
    /// How many rows exist.
    row_count: usize,
}

#[derive(Encode, Decode, Debug, Clone)]
struct Chunk {
    /// Always `CHUNK_ROWS` long.
    rows: Vec<Option<Row>>,
    /// How many of them exist. A chunk with none is freed.
    used: usize,
}

/// The cells of a row with their column, sorted by column.
#[derive(Encode, Decode, Debug, Clone, Default, PartialEq)]
struct Row {
    cells: Vec<(i32, Cell)>,
}

impl Chunk {
    fn new() -> Self {
        let mut rows = Vec::new();
        rows.resize_with(CHUNK_ROWS, || None);
        Chunk { rows, used: 0 }
    }
}

impl Row {
    /// Where the column is, or where it would go.
    #[inline]
    fn position(&self, column: i32) -> Result<usize, usize> {
        if self.cells.len() <= LINEAR_SEARCH_LIMIT {
            for (index, (c, _)) in self.cells.iter().enumerate() {
                if *c >= column {
                    return if *c == column { Ok(index) } else { Err(index) };
                }
            }
            Err(self.cells.len())
        } else {
            self.cells.binary_search_by_key(&column, |(c, _)| *c)
        }
    }

    fn insert(&mut self, column: i32, cell: Cell) -> Option<Cell> {
        // Rows are mostly filled from left to right.
        if self.cells.last().is_none_or(|(last, _)| *last < column) {
            self.cells.push((column, cell));
            return None;
        }
        match self.position(column) {
            Ok(index) => Some(std::mem::replace(&mut self.cells[index].1, cell)),
            Err(index) => {
                self.cells.insert(index, (column, cell));
                None
            }
        }
    }
}

/// The chunk and the place in it of a row, if the row is within the sheet.
#[inline]
fn locate(row: i32) -> Option<(usize, usize)> {
    if !(1..=LAST_ROW).contains(&row) {
        return None;
    }
    let row = row as usize;
    Some((row >> CHUNK_BITS, row & CHUNK_MASK))
}

impl SheetData {
    pub fn new() -> Self {
        Self::default()
    }

    #[inline]
    fn row(&self, row: i32) -> Option<&Row> {
        let (chunk, index) = locate(row)?;
        self.chunks.get(chunk)?.as_ref()?.rows[index].as_ref()
    }

    #[inline]
    fn row_mut(&mut self, row: i32) -> Option<&mut Row> {
        let (chunk, index) = locate(row)?;
        self.chunks.get_mut(chunk)?.as_mut()?.rows[index].as_mut()
    }

    /// The row, created if it does not exist. `None` outside the sheet.
    fn row_or_insert(&mut self, row: i32) -> Option<&mut Row> {
        let (chunk, index) = locate(row)?;
        if chunk >= self.chunks.len() {
            self.chunks.resize_with(chunk + 1, || None);
        }
        let chunk = self.chunks[chunk].get_or_insert_with(|| Box::new(Chunk::new()));
        if chunk.rows[index].is_none() {
            chunk.rows[index] = Some(Row::default());
            chunk.used += 1;
            self.row_count += 1;
        }
        chunk.rows[index].as_mut()
    }

    /// Every row that exists with its number, in ascending order.
    fn rows_in_order(&self) -> impl Iterator<Item = (i32, &Row)> {
        self.chunks
            .iter()
            .enumerate()
            .filter_map(|(chunk_index, chunk)| Some((chunk_index, chunk.as_ref()?)))
            .flat_map(|(chunk_index, chunk)| {
                chunk
                    .rows
                    .iter()
                    .enumerate()
                    .filter_map(move |(index, row)| {
                        let number = (chunk_index << CHUNK_BITS) | index;
                        Some((number as i32, row.as_ref()?))
                    })
            })
    }

    /// The cell at a position, if there is one.
    #[inline]
    pub fn cell(&self, row: i32, column: i32) -> Option<&Cell> {
        let row = self.row(row)?;
        let index = row.position(column).ok()?;
        Some(&row.cells[index].1)
    }

    /// The cell at a position, to be changed in place.
    #[inline]
    pub fn cell_mut(&mut self, row: i32, column: i32) -> Option<&mut Cell> {
        let row = self.row_mut(row)?;
        let index = row.position(column).ok()?;
        Some(&mut row.cells[index].1)
    }

    /// Puts a cell at a position and returns the one that was there.
    pub fn set_cell(&mut self, row: i32, column: i32, cell: Cell) -> Option<Cell> {
        self.row_or_insert(row)?.insert(column, cell)
    }

    /// Removes the cell at a position and returns it.
    pub fn remove_cell(&mut self, row: i32, column: i32) -> Option<Cell> {
        let row_data = self.row_mut(row)?;
        let index = row_data.position(column).ok()?;
        let (_, cell) = row_data.cells.remove(index);
        if row_data.cells.is_empty() {
            self.remove_row(row);
        }
        Some(cell)
    }

    /// True if the sheet has no rows.
    pub fn is_empty(&self) -> bool {
        self.row_count == 0
    }

    /// Every cell of the sheet with its row and column, in natural order:
    /// by row, and within a row by column.
    pub fn cells(&self) -> impl Iterator<Item = (i32, i32, &Cell)> {
        self.rows_in_order().flat_map(|(row, row_data)| {
            row_data
                .cells
                .iter()
                .map(move |(column, cell)| (row, *column, cell))
        })
    }

    /// The rows that exist, in ascending order.
    pub fn rows(&self) -> Vec<i32> {
        self.rows_in_order().map(|(row, _)| row).collect()
    }

    /// The columns of a row that have cells, in ascending order.
    pub fn columns_in_row(&self, row: i32) -> Vec<i32> {
        match self.row(row) {
            Some(row_data) => row_data.cells.iter().map(|(column, _)| *column).collect(),
            None => Vec::new(),
        }
    }

    /// The cells of a row with their column, in ascending order of column.
    pub fn cells_in_row(&self, row: i32) -> Vec<(i32, &Cell)> {
        match self.row(row) {
            Some(row_data) => row_data
                .cells
                .iter()
                .map(|(column, cell)| (*column, cell))
                .collect(),
            None => Vec::new(),
        }
    }

    /// Removes every cell of a row, and the row.
    pub fn remove_row(&mut self, row: i32) {
        let Some((chunk_index, index)) = locate(row) else {
            return;
        };
        let Some(Some(chunk)) = self.chunks.get_mut(chunk_index) else {
            return;
        };
        if chunk.rows[index].take().is_some() {
            chunk.used -= 1;
            self.row_count -= 1;
            if chunk.used == 0 {
                self.chunks[chunk_index] = None;
            }
        }
    }

    /// Replaces the cells of a row. The row exists afterwards, even with no
    /// cells. If a column is given twice the last one stays.
    pub fn set_row(&mut self, row: i32, cells: impl IntoIterator<Item = (i32, Cell)>) {
        let Some(row_data) = self.row_or_insert(row) else {
            return;
        };
        // Collected at its exact size: a row grown cell by cell from empty
        // starts with room for four, and a sheet with a million short rows
        // paid for that four times over.
        let mut cells: Vec<(i32, Cell)> = cells.into_iter().collect();
        cells.sort_by_key(|(column, _)| *column);
        // Of two cells in the same column the later one stays: it is moved
        // into the slot of the earlier one, which `dedup_by` then keeps.
        cells.dedup_by(|later, earlier| {
            if later.0 == earlier.0 {
                std::mem::swap(&mut later.1, &mut earlier.1);
                true
            } else {
                false
            }
        });
        cells.shrink_to_fit();
        row_data.cells = cells;
    }
}

/// Two sheets are equal when they have the same rows and the same cells.
/// Which chunks happen to be allocated is not part of that.
impl PartialEq for SheetData {
    fn eq(&self, other: &Self) -> bool {
        self.row_count == other.row_count && self.rows_in_order().eq(other.rows_in_order())
    }
}

#[cfg(test)]
mod test {
    #![allow(clippy::unwrap_used)]

    use super::*;

    fn number(v: f64) -> Cell {
        Cell::NumberCell { v, s: 0 }
    }

    #[test]
    fn set_get_replace_remove() {
        let mut data = SheetData::new();
        assert!(data.is_empty());
        assert_eq!(data.set_cell(3, 2, number(1.0)), None);
        assert_eq!(data.set_cell(3, 2, number(2.0)), Some(number(1.0)));
        assert_eq!(data.cell(3, 2), Some(&number(2.0)));
        assert_eq!(data.cell(3, 1), None);
        assert_eq!(data.cell(4, 2), None);
        *data.cell_mut(3, 2).unwrap() = number(5.0);
        assert_eq!(data.remove_cell(3, 2), Some(number(5.0)));
        assert_eq!(data.remove_cell(3, 2), None);
        // the last cell of the row took the row with it
        assert!(data.is_empty());
        assert!(data.rows().is_empty());
    }

    #[test]
    fn natural_order_whatever_the_order_of_insertion() {
        let mut data = SheetData::new();
        // two chunks, and a row longer than the linear search limit, filled
        // from the right
        for column in (1..=20).rev() {
            data.set_cell(2000, column, number(column as f64));
        }
        data.set_cell(5, 7, number(0.0));
        data.set_cell(5, 3, number(0.0));
        data.set_cell(1, 9, number(0.0));
        let positions: Vec<(i32, i32)> = data.cells().map(|(r, c, _)| (r, c)).collect();
        let mut sorted = positions.clone();
        sorted.sort_unstable();
        assert_eq!(positions, sorted);
        assert_eq!(positions.len(), 23);
        assert_eq!(data.rows(), vec![1, 5, 2000]);
        assert_eq!(data.columns_in_row(5), vec![3, 7]);
        assert_eq!(data.cell(2000, 13), Some(&number(13.0)));
        assert_eq!(data.cells_in_row(2000).len(), 20);
        assert!(data.columns_in_row(6).is_empty());
    }

    #[test]
    fn a_row_can_exist_without_cells() {
        let mut data = SheetData::new();
        data.set_row(10, Vec::new());
        assert!(!data.is_empty());
        assert_eq!(data.rows(), vec![10]);
        assert_eq!(data.cells().count(), 0);
        data.remove_row(10);
        assert!(data.is_empty());
    }

    #[test]
    fn set_row_replaces_and_the_last_duplicate_stays() {
        let mut data = SheetData::new();
        data.set_cell(4, 1, number(1.0));
        data.set_row(
            4,
            vec![(5, number(5.0)), (2, number(2.0)), (5, number(6.0))],
        );
        assert_eq!(data.columns_in_row(4), vec![2, 5]);
        assert_eq!(data.cell(4, 5), Some(&number(6.0)));
        assert_eq!(data.cell(4, 1), None);
    }

    #[test]
    fn rows_outside_the_sheet_hold_nothing() {
        let mut data = SheetData::new();
        for row in [0, -3, LAST_ROW + 1, i32::MAX, i32::MIN] {
            assert_eq!(data.set_cell(row, 1, number(1.0)), None);
            data.set_row(row, vec![(1, number(1.0))]);
            assert_eq!(data.cell(row, 1), None);
            data.remove_row(row);
        }
        assert!(data.is_empty());
        // the first and the last row of the sheet are fine
        data.set_cell(1, 1, number(1.0));
        data.set_cell(LAST_ROW, 1, number(2.0));
        assert_eq!(data.rows(), vec![1, LAST_ROW]);
    }

    #[test]
    fn equality_is_about_cells_not_about_chunks() {
        let mut a = SheetData::new();
        let mut b = SheetData::new();
        a.set_cell(1, 1, number(1.0));
        b.set_cell(1, 1, number(1.0));
        // `a` has had a cell far away, and no longer has
        a.set_cell(900_000, 4, number(9.0));
        a.remove_cell(900_000, 4);
        assert_eq!(a, b);
        b.set_cell(1, 2, number(1.0));
        assert_ne!(a, b);
    }
}
