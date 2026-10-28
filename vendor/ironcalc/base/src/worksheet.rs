use crate::constants::{self, LAST_COLUMN, LAST_ROW};
use crate::expressions::types::CellReferenceIndex;
use crate::expressions::utils::{is_valid_column_number, is_valid_row};
use crate::model::CellStructure;
use crate::{expressions::token::Error, types::*};

#[derive(Debug, PartialEq, Eq)]
pub struct WorksheetDimension {
    pub min_row: i32,
    pub max_row: i32,
    pub min_column: i32,
    pub max_column: i32,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum NavigationDirection {
    Left,
    Right,
    Up,
    Down,
}

impl Worksheet {
    pub fn get_name(&self) -> String {
        self.name.clone()
    }

    pub fn get_sheet_id(&self) -> u32 {
        self.sheet_id
    }

    pub fn set_name(&mut self, name: &str) {
        self.name = name.to_string();
    }

    pub fn cell(&self, row: i32, column: i32) -> Option<&Cell> {
        self.sheet_data.cell(row, column)
    }

    pub(crate) fn cell_mut(&mut self, row: i32, column: i32) -> Option<&mut Cell> {
        self.sheet_data.cell_mut(row, column)
    }

    pub(crate) fn update_cell(
        &mut self,
        row: i32,
        column: i32,
        new_cell: Cell,
    ) -> Result<(), String> {
        // validate row and column arg before updating cell of worksheet
        if !is_valid_row(row) || !is_valid_column_number(column) {
            return Err("Incorrect row or column".to_string());
        }

        self.sheet_data.set_cell(row, column, new_cell);
        Ok(())
    }

    // See: get_style_for_cell
    fn get_row_column_style(&self, row_index: i32, column_index: i32) -> i32 {
        let rows = &self.rows;
        for row in rows {
            if row.r == row_index {
                if row.custom_format {
                    return row.s;
                }
                break;
            }
        }
        let cols = &self.cols;
        for column in cols.iter() {
            let min = column.min;
            let max = column.max;
            if column_index >= min && column_index <= max {
                return column.style.unwrap_or(0);
            }
        }
        0
    }

    pub fn get_style(&self, row: i32, column: i32) -> i32 {
        match self.sheet_data.cell(row, column) {
            Some(cell) => cell.get_style(),
            None => self.get_row_column_style(row, column),
        }
    }

    pub fn set_style(&mut self, style_index: i32) -> Result<(), String> {
        self.cols = vec![Col {
            min: 1,
            max: constants::LAST_COLUMN,
            width: constants::DEFAULT_COLUMN_WIDTH,
            custom_width: false,
            style: Some(style_index),
            hidden: false,
        }];
        Ok(())
    }

    pub fn set_column_style(&mut self, column: i32, style_index: i32) -> Result<(), String> {
        let width = self
            .get_column_width(column)
            .unwrap_or(constants::DEFAULT_COLUMN_WIDTH);
        let hidden = self.is_column_hidden(column)?;
        self.set_column_width_and_style(column, width, hidden, Some(style_index))
    }

    pub fn set_row_style(&mut self, row: i32, style_index: i32) -> Result<(), String> {
        // FIXME: This is a HACK
        let custom_format = style_index != 0;
        for r in self.rows.iter_mut() {
            if r.r == row {
                r.s = style_index;
                r.custom_format = custom_format;
                return Ok(());
            }
        }
        self.rows.push(Row {
            height: constants::DEFAULT_ROW_HEIGHT / constants::ROW_HEIGHT_FACTOR,
            r: row,
            custom_format,
            custom_height: false,
            s: style_index,
            hidden: false,
        });
        Ok(())
    }

    pub fn delete_row_style(&mut self, row: i32) -> Result<(), String> {
        let mut index = None;
        for (i, r) in self.rows.iter().enumerate() {
            if r.r == row {
                index = Some(i);
                break;
            }
        }
        if let Some(i) = index {
            if let Some(r) = self.rows.get_mut(i) {
                r.s = 0;
                r.custom_format = false;
            }
        }
        Ok(())
    }

    pub fn delete_column_style(&mut self, column: i32) -> Result<(), String> {
        if !is_valid_column_number(column) {
            return Err(format!("Column number '{column}' is not valid."));
        }
        let cols = &mut self.cols;

        let mut index = 0;
        let mut split = false;
        for c in cols.iter_mut() {
            let min = c.min;
            let max = c.max;
            if min <= column && column <= max {
                //
                split = true;
                break;
            }
            if column < min {
                // We passed, there is nothing to delete
                break;
            }
            index += 1;
        }
        if split {
            let min = cols[index].min;
            let max = cols[index].max;
            let custom_width = cols[index].custom_width;
            let width = cols[index].width;
            let pre = Col {
                min,
                max: column - 1,
                width,
                custom_width,
                style: cols[index].style,
                hidden: cols[index].hidden,
            };
            let col = Col {
                min: column,
                max: column,
                width,
                custom_width,
                style: None,
                hidden: false,
            };
            let post = Col {
                min: column + 1,
                max,
                width,
                custom_width,
                style: cols[index].style,
                hidden: cols[index].hidden,
            };
            cols.remove(index);
            if column != max {
                cols.insert(index, post);
            }
            if custom_width {
                cols.insert(index, col);
            }
            if column != min {
                cols.insert(index, pre);
            }
        }
        Ok(())
    }

    pub fn set_cell_style(
        &mut self,
        row: i32,
        column: i32,
        style_index: i32,
    ) -> Result<(), String> {
        match self.cell_mut(row, column) {
            Some(cell) => {
                cell.set_style(style_index);
            }
            None => {
                self.cell_clear_contents_with_style(row, column, style_index)?;
            }
        }
        Ok(())

        // TODO: cleanup check if the old cell style is still in use
    }

    pub fn set_cell_with_formula(
        &mut self,
        row: i32,
        column: i32,
        index: i32,
        style: i32,
    ) -> Result<(), String> {
        let cell = Cell::new_formula(index, style);
        self.update_cell(row, column, cell)
    }

    pub fn set_cell_with_dynamic_formula(
        &mut self,
        row: i32,
        column: i32,
        index: i32,
        style: i32,
        width: i32,
        height: i32,
    ) -> Result<(), String> {
        let cell = Cell::ArrayFormula {
            f: index,
            s: style,
            r: (width, height),
            kind: ArrayKind::Dynamic,
            v: FormulaValue::Unevaluated,
        };
        self.update_cell(row, column, cell)
    }

    pub fn set_cell_with_array_formula(
        &mut self,
        row: i32,
        column: i32,
        index: i32,
        style: i32,
        width: i32,
        height: i32,
    ) -> Result<(), String> {
        let cell = Cell::ArrayFormula {
            f: index,
            s: style,
            r: (width, height),
            kind: ArrayKind::Cse,
            v: FormulaValue::Unevaluated,
        };
        self.update_cell(row, column, cell)
    }

    /// Sets a number in a cell. The number has to be finite: no cell holds a
    /// NaN or an infinity, and the cell is left as it was if given one.
    pub fn set_cell_with_number(
        &mut self,
        row: i32,
        column: i32,
        value: f64,
        style: i32,
    ) -> Result<(), String> {
        if !value.is_finite() {
            return Err(format!("A cell cannot hold the number {value}"));
        }
        let cell = Cell::new_number(value, style);
        self.update_cell(row, column, cell)
    }

    pub fn set_cell_with_string(
        &mut self,
        row: i32,
        column: i32,
        index: i32,
        style: i32,
    ) -> Result<(), String> {
        let cell = Cell::new_string(index, style);
        self.update_cell(row, column, cell)
    }

    pub fn set_cell_with_boolean(
        &mut self,
        row: i32,
        column: i32,
        value: bool,
        style: i32,
    ) -> Result<(), String> {
        let cell = Cell::new_boolean(value, style);
        self.update_cell(row, column, cell)
    }

    pub fn set_cell_with_error(
        &mut self,
        row: i32,
        column: i32,
        error: Error,
        style: i32,
    ) -> Result<(), String> {
        let cell = Cell::new_error(error, style);
        self.update_cell(row, column, cell)
    }

    pub fn cell_clear_contents(&mut self, row: i32, column: i32) -> Result<(), String> {
        let s = self.get_style(row, column);
        let cell = Cell::EmptyCell { s };
        self.update_cell(row, column, cell)
    }

    pub fn cell_clear_contents_with_style(
        &mut self,
        row: i32,
        column: i32,
        style: i32,
    ) -> Result<(), String> {
        let cell = Cell::EmptyCell { s: style };
        self.update_cell(row, column, cell)
    }

    /// Returns the merged cell containing (row, column), if any
    pub fn merged_cell_containing(&self, row: i32, column: i32) -> Option<&MergedCell> {
        self.merged_cells.iter().find(|m| m.contains(row, column))
    }

    /// Returns true if (row, column) is inside a merged range but is not its anchor
    pub fn is_covered_cell(&self, row: i32, column: i32) -> bool {
        match self.merged_cell_containing(row, column) {
            Some(m) => m.row != row || m.column != column,
            None => false,
        }
    }

    /// Returns the anchor of the merged cell containing (row, column),
    /// or (row, column) itself if the cell is not merged
    pub fn merge_anchor(&self, row: i32, column: i32) -> (i32, i32) {
        match self.merged_cell_containing(row, column) {
            Some(m) => (m.row, m.column),
            None => (row, column),
        }
    }

    pub fn set_frozen_rows(&mut self, frozen_rows: i32) -> Result<(), String> {
        if frozen_rows < 0 {
            return Err("Frozen rows cannot be negative".to_string());
        }
        if frozen_rows >= constants::LAST_ROW {
            return Err("Too many rows".to_string());
        }
        self.frozen_rows = frozen_rows;
        Ok(())
    }

    pub fn set_frozen_columns(&mut self, frozen_columns: i32) -> Result<(), String> {
        if frozen_columns < 0 {
            return Err("Frozen columns cannot be negative".to_string());
        }
        if frozen_columns >= constants::LAST_COLUMN {
            return Err("Too many columns".to_string());
        }
        self.frozen_columns = frozen_columns;
        Ok(())
    }

    /// Changes the hidden status of a row.
    pub fn set_row_hidden(&mut self, row: i32, hidden: bool) -> Result<(), String> {
        if !is_valid_row(row) {
            return Err(format!("Row number '{row}' is not valid."));
        }

        let rows = &mut self.rows;
        for r in rows.iter_mut() {
            if r.r == row {
                r.hidden = hidden;
                return Ok(());
            }
        }
        rows.push(Row {
            height: constants::DEFAULT_ROW_HEIGHT / constants::ROW_HEIGHT_FACTOR,
            r: row,
            custom_format: false,
            custom_height: false,
            s: 0,
            hidden,
        });
        Ok(())
    }

    /// Changes the height of a row.
    ///   * If the row does not a have a style we add it.
    ///   * If it has we modify the height and make sure it is applied.
    ///
    /// Fails if row index is outside allowed range or height is negative.
    pub fn set_row_height(&mut self, row: i32, height: f64) -> Result<(), String> {
        if !is_valid_row(row) {
            return Err(format!("Row number '{row}' is not valid."));
        }
        if height < 0.0 {
            return Err(format!("Can not set a negative height: {height}"));
        }
        let hidden = self.is_row_hidden(row)?;
        let rows = &mut self.rows;
        for r in rows.iter_mut() {
            if r.r == row {
                r.height = height / constants::ROW_HEIGHT_FACTOR;
                r.custom_height = true;
                return Ok(());
            }
        }
        rows.push(Row {
            height: height / constants::ROW_HEIGHT_FACTOR,
            r: row,
            custom_format: false,
            custom_height: true,
            s: 0,
            hidden,
        });
        Ok(())
    }

    /// Changes the width of a column.
    ///   * If the column does not a have a width we simply add it
    ///   * If it has, it might be part of a range and we need to split the range.
    ///
    /// Fails if column index is outside allowed range or width is negative.
    pub fn set_column_width(&mut self, column: i32, width: f64) -> Result<(), String> {
        let style = self.get_column_style(column)?;
        let hidden = self.is_column_hidden(column)?;
        self.set_column_width_and_style(column, width, hidden, style)
    }

    pub fn set_column_hidden(&mut self, column: i32, hidden: bool) -> Result<(), String> {
        let width = self
            .get_actual_column_width(column)
            .unwrap_or(constants::DEFAULT_COLUMN_WIDTH);
        let style = self.get_column_style(column)?;
        self.set_column_width_and_style(column, width, hidden, style)
    }

    pub(crate) fn set_column_width_and_style(
        &mut self,
        column: i32,
        width: f64,
        hidden: bool,
        style: Option<i32>,
    ) -> Result<(), String> {
        if !is_valid_column_number(column) {
            return Err(format!("Column number '{column}' is not valid."));
        }
        if width < 0.0 {
            return Err(format!("Can not set a negative width: {width}"));
        }
        let cols = &mut self.cols;
        let mut col = Col {
            min: column,
            max: column,
            width: width / constants::COLUMN_WIDTH_FACTOR,
            custom_width: width != constants::DEFAULT_COLUMN_WIDTH,
            style,
            hidden,
        };
        let mut index = 0;
        let mut split = false;
        for c in cols.iter_mut() {
            let min = c.min;
            let max = c.max;
            if min <= column && column <= max {
                if min == column && max == column {
                    c.style = style;
                    c.width = width / constants::COLUMN_WIDTH_FACTOR;
                    c.custom_width = width != constants::DEFAULT_COLUMN_WIDTH;
                    c.hidden = hidden;
                    return Ok(());
                }
                split = true;
                break;
            }
            if column < min {
                // We passed, we should insert at index
                break;
            }
            index += 1;
        }
        if split {
            let min = cols[index].min;
            let max = cols[index].max;
            let pre = Col {
                min,
                max: column - 1,
                width: cols[index].width,
                custom_width: cols[index].custom_width,
                style: cols[index].style,
                hidden: cols[index].hidden,
            };
            let post = Col {
                min: column + 1,
                max,
                width: cols[index].width,
                custom_width: cols[index].custom_width,
                style: cols[index].style,
                hidden: cols[index].hidden,
            };
            col.style = cols[index].style;
            cols.remove(index);
            if column != max {
                cols.insert(index, post);
            }
            cols.insert(index, col);
            if column != min {
                cols.insert(index, pre);
            }
        } else {
            cols.insert(index, col);
        }
        Ok(())
    }

    /// Return the width of a column in pixels
    pub fn get_column_width(&self, column: i32) -> Result<f64, String> {
        if !is_valid_column_number(column) {
            return Err(format!("Column number '{column}' is not valid."));
        }

        let cols = &self.cols;
        for col in cols {
            let min = col.min;
            let max = col.max;
            if column >= min && column <= max {
                if col.hidden {
                    return Ok(0.0);
                }
                if col.custom_width {
                    return Ok(col.width * constants::COLUMN_WIDTH_FACTOR);
                }
                break;
            }
        }
        Ok(constants::DEFAULT_COLUMN_WIDTH)
    }

    /// Return the actual width of a column in pixels, ignoring hidden status
    pub fn get_actual_column_width(&self, column: i32) -> Result<f64, String> {
        if !is_valid_column_number(column) {
            return Err(format!("Column number '{column}' is not valid."));
        }

        let cols = &self.cols;
        for col in cols {
            let min = col.min;
            let max = col.max;
            if column >= min && column <= max {
                if col.custom_width {
                    return Ok(col.width * constants::COLUMN_WIDTH_FACTOR);
                }
                break;
            }
        }
        Ok(constants::DEFAULT_COLUMN_WIDTH)
    }

    /// Returns true if the column is hidden
    pub fn is_column_hidden(&self, column: i32) -> Result<bool, String> {
        if !is_valid_column_number(column) {
            return Err(format!("Column number '{column}' is not valid."));
        }

        let cols = &self.cols;
        for col in cols {
            let min = col.min;
            let max = col.max;
            if column >= min && column <= max {
                return Ok(col.hidden);
            }
        }
        Ok(false)
    }

    /// Returns if a row is hidden
    pub fn is_row_hidden(&self, row: i32) -> Result<bool, String> {
        if !is_valid_row(row) {
            return Err(format!("Row number '{row}' is not valid."));
        }
        let rows = &self.rows;
        for r in rows {
            if r.r == row {
                return Ok(r.hidden);
            }
        }
        Ok(false)
    }

    /// Returns the column style index if present
    pub fn get_column_style(&self, column: i32) -> Result<Option<i32>, String> {
        if !is_valid_column_number(column) {
            return Err(format!("Column number '{column}' is not valid."));
        }

        let cols = &self.cols;
        for col in cols {
            let min = col.min;
            let max = col.max;
            if column >= min && column <= max {
                return Ok(col.style);
            }
        }
        Ok(None)
    }

    // Returns non empty cells in a column
    pub(crate) fn column_cell_references(
        &self,
        column: i32,
    ) -> Result<Vec<CellReferenceIndex>, String> {
        let mut column_cell_references: Vec<CellReferenceIndex> = Vec::new();
        if !is_valid_column_number(column) {
            return Err(format!("Column number '{column}' is not valid."));
        }

        for row in self.sheet_data.rows() {
            if self.cell(row, column).is_some() {
                column_cell_references.push(CellReferenceIndex {
                    sheet: self.sheet_id,
                    row,
                    column,
                });
            }
        }
        Ok(column_cell_references)
    }

    pub(crate) fn remove_cell(&mut self, row: i32, column: i32) -> Result<(), String> {
        self.sheet_data.remove_cell(row, column);
        Ok(())
    }

    /// Returns the height of a row in pixels
    pub fn row_height(&self, row: i32) -> Result<f64, String> {
        if !is_valid_row(row) {
            return Err(format!("Row number '{row}' is not valid."));
        }

        let rows = &self.rows;
        for r in rows {
            if r.r == row {
                if r.hidden {
                    return Ok(0.0);
                }
                return Ok(r.height * constants::ROW_HEIGHT_FACTOR);
            }
        }
        Ok(constants::DEFAULT_ROW_HEIGHT)
    }

    /// Calculates dimension of the sheet. This function isn't cheap to calculate.
    pub fn dimension(&self) -> WorksheetDimension {
        // FIXME: It's probably better to just track the size as operations happen.
        if self.sheet_data.is_empty() {
            return WorksheetDimension {
                min_row: 1,
                max_row: 1,
                min_column: 1,
                max_column: 1,
            };
        }

        let mut row_range: Option<(i32, i32)> = None;
        let mut column_range: Option<(i32, i32)> = None;

        for (row_index, column_index, _) in self.sheet_data.cells() {
            row_range = if let Some((current_min, current_max)) = row_range {
                Some((current_min.min(row_index), current_max.max(row_index)))
            } else {
                Some((row_index, row_index))
            };
            column_range = if let Some((current_min, current_max)) = column_range {
                Some((current_min.min(column_index), current_max.max(column_index)))
            } else {
                Some((column_index, column_index))
            };
        }

        let dimension = if let Some((min_row, max_row)) = row_range {
            if let Some((min_column, max_column)) = column_range {
                Some(WorksheetDimension {
                    min_row,
                    min_column,
                    max_row,
                    max_column,
                })
            } else {
                None
            }
        } else {
            None
        };

        dimension.unwrap_or(WorksheetDimension {
            min_row: 1,
            max_row: 1,
            min_column: 1,
            max_column: 1,
        })
    }

    /// Returns true if cell is completely empty.
    /// Cell with formula that evaluates to empty string is not considered empty.
    pub fn is_empty_cell(&self, row: i32, column: i32) -> Result<bool, String> {
        if !is_valid_column_number(column) || !is_valid_row(row) {
            return Err("Row or column is outside valid range.".to_string());
        }

        let is_empty = match self.sheet_data.cell(row, column) {
            Some(cell) => matches!(cell, Cell::EmptyCell { .. }),
            None => true,
        };

        Ok(is_empty)
    }

    // Returns:
    // - If it is an anchor for a dynamic array => full range
    // - If it is an anchor for an array formula => full range
    // - If it is a single cell with a formula => SingleCell
    // - If it is a single cell without formula => Error
    // - If it is a spill cell => Error
    // - Any other case => Error
    pub(crate) fn get_cell_spill(&self, row: i32, column: i32) -> Result<(i32, i32), String> {
        if !is_valid_column_number(column) || !is_valid_row(row) {
            return Err("Row or column is outside valid range.".to_string());
        }

        let cell = match self.cell(row, column) {
            Some(c) => c,
            None => return Err("Cell does not exist.".to_string()),
        };
        match cell {
            Cell::ArrayFormula { r, .. } => Ok((r.0, r.1)),
            Cell::CellFormula { .. } => Ok((1, 1)),
            _ => Err("Cell does not contain a formula.".to_string()),
        }
    }

    /// Returns true if cell is part of an array formula. This includes both anchor and spill cells.
    pub(crate) fn get_cell_structure(
        &self,
        row: i32,
        column: i32,
    ) -> Result<CellStructure, String> {
        if !is_valid_column_number(column) || !is_valid_row(row) {
            return Err("Row or column is outside valid range.".to_string());
        }

        let cell = match self.cell(row, column) {
            Some(c) => c,
            None => return Ok(CellStructure::SingleCell),
        };
        match cell {
            Cell::ArrayFormula {
                r,
                kind: ArrayKind::Cse,
                ..
            } => Ok(CellStructure::ArrayFormula { range: *r }),
            Cell::ArrayFormula {
                r,
                kind: ArrayKind::Dynamic,
                ..
            } => Ok(CellStructure::DynamicFormula { range: *r }),
            Cell::SpillCell { a, .. } => {
                let anchor_cell = match self.cell(a.0, a.1) {
                    Some(c) => c,
                    None => return Err("Invalid spill reference".to_string()),
                };
                match anchor_cell {
                    Cell::ArrayFormula {
                        r,
                        kind: ArrayKind::Cse,
                        ..
                    } => Ok(CellStructure::SpillArray {
                        anchor: (a.0, a.1),
                        range: *r,
                    }),
                    Cell::ArrayFormula {
                        r,
                        kind: ArrayKind::Dynamic,
                        ..
                    } => Ok(CellStructure::SpillDynamic {
                        anchor: (a.0, a.1),
                        range: *r,
                    }),
                    _ => Err("Spill cell does not reference an array formula".to_string()),
                }
            }
            _ => Ok(CellStructure::SingleCell),
        }
    }

    /// It provides convenient method for user navigation in the spreadsheet by jumping to edges.
    /// Spreadsheet engines usually allow this method of navigation by using CTRL+arrows.
    /// Behaviour summary:
    /// - if starting cell is empty then find first non empty cell in given direction
    /// - if starting cell is not empty, and neighbour in given direction is empty, then find
    ///   first non empty cell in given direction
    /// - if starting cell is not empty, and neighbour in given direction is also not empty, then
    ///   find last non empty cell in given direction
    pub fn navigate_to_edge_in_direction(
        &self,
        row: i32,
        column: i32,
        direction: NavigationDirection,
    ) -> Result<(i32, i32), String> {
        if !is_valid_column_number(column) || !is_valid_row(row) {
            return Err("Row or column is outside valid range.".to_string());
        }

        // A merged cell behaves as a single cell: stepping out of it starts at
        // its far edge in the direction of travel.
        let start_cell = match self.merged_cell_containing(row, column) {
            Some(m) => match direction {
                NavigationDirection::Left => (row, m.column),
                NavigationDirection::Right => (row, m.last_column()),
                NavigationDirection::Up => (m.row, column),
                NavigationDirection::Down => (m.last_row(), column),
            },
            None => (row, column),
        };
        let neighbour_cell = if let Some(cell) = step_in_direction(start_cell, direction) {
            cell
        } else {
            return Ok((start_cell.0, start_cell.1));
        };

        // The content of a merged cell lives at the anchor: every cell of the
        // range is as empty as the anchor is.
        let is_empty_merge_aware = |row: i32, column: i32| -> Result<bool, String> {
            let (anchor_row, anchor_column) = self.merge_anchor(row, column);
            self.is_empty_cell(anchor_row, anchor_column)
        };

        if is_empty_merge_aware(start_cell.0, start_cell.1)? {
            // Find first non-empty cell or move to the end.
            let found_cells = walk_in_direction(start_cell, direction, |(row, column)| {
                Ok(!is_empty_merge_aware(row, column)?)
            })?;
            Ok(match found_cells.found_cell {
                Some(cell) => cell,
                None => found_cells.previous_cell,
            })
        } else {
            // Neighbour cell is empty     => find FIRST that is NOT empty
            // Neighbour cell is not empty => find LAST  that is NOT empty in sequence
            if is_empty_merge_aware(neighbour_cell.0, neighbour_cell.1)? {
                let found_cells = walk_in_direction(start_cell, direction, |(row, column)| {
                    Ok(!is_empty_merge_aware(row, column)?)
                })?;
                Ok(match found_cells.found_cell {
                    Some(cell) => cell,
                    None => found_cells.previous_cell,
                })
            } else {
                let found_cells = walk_in_direction(start_cell, direction, |(row, column)| {
                    is_empty_merge_aware(row, column)
                })?;
                Ok(found_cells.previous_cell)
            }
        }
    }
}

struct WalkFoundCells {
    /// If cell is found, it contains coordinates of the cell, otherwise None
    found_cell: Option<(i32, i32)>,
    /// Previous cell in chain relative to `found_cell`.
    /// If `found_cell` is None then it's last considered cell.
    previous_cell: (i32, i32),
}

/// Walks in direction until condition is met or boundary reached.
/// Returns tuple `(current_cell, previous_cell)`. `current_cell` is either None or passes predicate
fn walk_in_direction<F>(
    start_cell: (i32, i32),
    direction: NavigationDirection,
    predicate: F,
) -> Result<WalkFoundCells, String>
where
    F: Fn((i32, i32)) -> Result<bool, String>,
{
    let mut previous_cell = start_cell;
    let mut current_cell = step_in_direction(start_cell, direction);
    while let Some(cell) = current_cell {
        if !predicate((cell.0, cell.1))? {
            previous_cell = cell;
            current_cell = step_in_direction(cell, direction);
        } else {
            break;
        }
    }
    Ok(WalkFoundCells {
        found_cell: current_cell,
        previous_cell,
    })
}

/// Returns coordinate of cell in given direction from given cell.
/// Returns `None` if steps over the edge.
fn step_in_direction(
    (row, column): (i32, i32),
    direction: NavigationDirection,
) -> Option<(i32, i32)> {
    if (row == 1 && direction == NavigationDirection::Up)
        || (row == LAST_ROW && direction == NavigationDirection::Down)
        || (column == 1 && direction == NavigationDirection::Left)
        || (column == LAST_COLUMN && direction == NavigationDirection::Right)
    {
        return None;
    }

    Some(match direction {
        NavigationDirection::Left => (row, column - 1),
        NavigationDirection::Right => (row, column + 1),
        NavigationDirection::Up => (row - 1, column),
        NavigationDirection::Down => (row + 1, column),
    })
}
