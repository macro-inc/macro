#![deny(missing_docs)]

use serde::{Deserialize, Serialize};

use crate::{
    constants::{LAST_COLUMN, LAST_ROW},
    expressions::utils::{is_valid_column_number, is_valid_row},
    worksheet::NavigationDirection,
};

use super::common::UserModel;

#[derive(Serialize, Deserialize)]
#[cfg_attr(test, derive(PartialEq, Debug))]
pub struct SelectedView {
    pub sheet: u32,
    pub row: i32,
    pub column: i32,
    pub range: [i32; 4],
    pub top_row: i32,
    pub left_column: i32,
}

impl<'a> UserModel<'a> {
    // The UI renders every row and column at a whole number of pixels
    // (the canvas rounds each size before drawing), so all the scroll and
    // visibility arithmetic in this module must accumulate the rounded
    // sizes: summing the raw values drifts away from the rendered geometry
    // as the rounding errors pile up.
    fn ui_row_height(&self, sheet: u32, row: i32) -> Result<f64, String> {
        self.model.get_row_height(sheet, row).map(f64::round)
    }

    fn ui_column_width(&self, sheet: u32, column: i32) -> Result<f64, String> {
        self.model.get_column_width(sheet, column).map(f64::round)
    }

    // Returns the anchor of the merged cell containing (row, column), or the
    // cell itself if it is not merged.
    fn merge_anchor(&self, sheet: u32, row: i32, column: i32) -> Result<(i32, i32), String> {
        Ok(self
            .model
            .workbook
            .worksheet(sheet)?
            .merge_anchor(row, column))
    }

    // Returns the selection range of a single selected cell: the whole merged
    // range when the cell is merged, the cell itself otherwise.
    fn single_cell_range(&self, sheet: u32, row: i32, column: i32) -> Result<[i32; 4], String> {
        let worksheet = self.model.workbook.worksheet(sheet)?;
        Ok(match worksheet.merged_cell_containing(row, column) {
            Some(m) => [m.row, m.column, m.last_row(), m.last_column()],
            None => [row, column, row, column],
        })
    }

    // The selected range for a selection anchored at (anchor_row, anchor_column)
    // whose moving corner (focus) is at (focus_row, focus_column): the bounding
    // box of both cells — each taken as its whole merged cell when inside one —
    // grown so it never covers a merged cell partially. Recomputing the range
    // from anchor and focus (instead of stretching the previous, already grown,
    // range) is what lets a selection shrink back over a merged cell.
    fn selection_range(
        &self,
        sheet: u32,
        anchor_row: i32,
        anchor_column: i32,
        focus_row: i32,
        focus_column: i32,
    ) -> Result<[i32; 4], String> {
        let worksheet = self.model.workbook.worksheet(sheet)?;
        let cell_rect = |row: i32, column: i32| match worksheet.merged_cell_containing(row, column)
        {
            Some(m) => (m.row, m.column, m.last_row(), m.last_column()),
            None => (row, column, row, column),
        };
        let (anchor_first_row, anchor_first_column, anchor_last_row, anchor_last_column) =
            cell_rect(anchor_row, anchor_column);
        let (focus_first_row, focus_first_column, focus_last_row, focus_last_column) =
            cell_rect(focus_row, focus_column);
        self.grow_range_over_merged_cells(
            sheet,
            [
                anchor_first_row.min(focus_first_row),
                anchor_first_column.min(focus_first_column),
                anchor_last_row.max(focus_last_row),
                anchor_last_column.max(focus_last_column),
            ],
        )
    }

    // Grows the range until it fully contains every merged cell it touches
    // (growing to swallow one merge can graze another, hence the fixpoint
    // loop). The orientation of the range is preserved: the start corner stays
    // on the same side it was.
    fn grow_range_over_merged_cells(
        &self,
        sheet: u32,
        range: [i32; 4],
    ) -> Result<[i32; 4], String> {
        let [start_row, start_column, end_row, end_column] = range;
        let mut min_row = start_row.min(end_row);
        let mut max_row = start_row.max(end_row);
        let mut min_column = start_column.min(end_column);
        let mut max_column = start_column.max(end_column);
        let worksheet = self.model.workbook.worksheet(sheet)?;
        loop {
            let mut changed = false;
            for m in &worksheet.merged_cells {
                if m.intersects(
                    min_row,
                    min_column,
                    max_column - min_column + 1,
                    max_row - min_row + 1,
                ) {
                    if m.row < min_row {
                        min_row = m.row;
                        changed = true;
                    }
                    if m.last_row() > max_row {
                        max_row = m.last_row();
                        changed = true;
                    }
                    if m.column < min_column {
                        min_column = m.column;
                        changed = true;
                    }
                    if m.last_column() > max_column {
                        max_column = m.last_column();
                        changed = true;
                    }
                }
            }
            if !changed {
                break;
            }
        }
        let (new_start_row, new_end_row) = if start_row <= end_row {
            (min_row, max_row)
        } else {
            (max_row, min_row)
        };
        let (new_start_column, new_end_column) = if start_column <= end_column {
            (min_column, max_column)
        } else {
            (max_column, min_column)
        };
        Ok([new_start_row, new_start_column, new_end_row, new_end_column])
    }

    /// Returns the selected sheet index
    pub fn get_selected_sheet(&self) -> u32 {
        if let Some(view) = self.model.workbook.views.get(&self.model.view_id) {
            view.sheet
        } else {
            0
        }
    }

    /// Returns the selected cell
    pub fn get_selected_cell(&self) -> (u32, i32, i32) {
        let sheet = if let Some(view) = self.model.workbook.views.get(&self.model.view_id) {
            view.sheet
        } else {
            0
        };
        if let Ok(worksheet) = self.model.workbook.worksheet(sheet) {
            if let Some(view) = worksheet.views.get(&self.model.view_id) {
                return (sheet, view.row, view.column);
            }
        }
        // return a safe default
        (0, 1, 1)
    }

    /// Returns selected view
    pub fn get_selected_view(&self) -> SelectedView {
        let sheet = if let Some(view) = self.model.workbook.views.get(&self.model.view_id) {
            view.sheet
        } else {
            0
        };
        if let Ok(worksheet) = self.model.workbook.worksheet(sheet) {
            if let Some(view) = worksheet.views.get(&self.model.view_id) {
                return SelectedView {
                    sheet,
                    row: view.row,
                    column: view.column,
                    range: view.range,
                    top_row: view.top_row,
                    left_column: view.left_column,
                };
            }
        }
        // return a safe default
        SelectedView {
            sheet: 0,
            row: 1,
            column: 1,
            range: [1, 1, 1, 1],
            top_row: 1,
            left_column: 1,
        }
    }

    /// Sets the the selected sheet
    pub fn set_selected_sheet(&mut self, sheet: u32) -> Result<(), String> {
        if self.model.workbook.worksheet(sheet).is_err() {
            return Err(format!("Invalid worksheet index {sheet}"));
        }
        if let Some(view) = self.model.workbook.views.get_mut(&0) {
            view.sheet = sheet;
        }
        Ok(())
    }

    /// Sets the selected cell for the current view. Note that this also sets the selected range
    pub fn set_selected_cell(&mut self, row: i32, column: i32) -> Result<(), String> {
        let sheet = if let Some(view) = self.model.workbook.views.get(&self.model.view_id) {
            view.sheet
        } else {
            0
        };
        if !is_valid_column_number(column) {
            return Err(format!("Invalid column: '{column}'"));
        }
        if !is_valid_row(row) {
            return Err(format!("Invalid row: '{row}'"));
        }
        if self.model.workbook.worksheet(sheet).is_err() {
            return Err(format!("Invalid worksheet index {sheet}"));
        }
        // A covered cell can never be selected: snap to the anchor and select
        // the whole merged range.
        let (row, column) = self.merge_anchor(sheet, row, column)?;
        let range = self.single_cell_range(sheet, row, column)?;
        if let Ok(worksheet) = self.model.workbook.worksheet_mut(sheet) {
            if let Some(view) = worksheet.views.get_mut(&0) {
                view.row = row;
                view.column = column;
                view.range = range;
                view.focus_row = row;
                view.focus_column = column;
            }
        }
        Ok(())
    }

    /// Sets the selected range. Note that the selected cell must be in the selected range.
    pub fn set_selected_range(
        &mut self,
        start_row: i32,
        start_column: i32,
        end_row: i32,
        end_column: i32,
    ) -> Result<(), String> {
        let sheet = if let Some(view) = self.model.workbook.views.get(&self.model.view_id) {
            view.sheet
        } else {
            0
        };

        if !is_valid_column_number(start_column) {
            return Err(format!("Invalid column: '{start_column}'"));
        }
        if !is_valid_row(start_row) {
            return Err(format!("Invalid row: '{start_row}'"));
        }

        if !is_valid_column_number(end_column) {
            return Err(format!("Invalid column: '{end_column}'"));
        }
        if !is_valid_row(end_row) {
            return Err(format!("Invalid row: '{end_row}'"));
        }
        if self.model.workbook.worksheet(sheet).is_err() {
            return Err(format!("Invalid worksheet index {sheet}"));
        }
        let (selected_row, selected_column) = {
            let worksheet = self.model.workbook.worksheet(sheet)?;
            match worksheet.views.get(&self.model.view_id) {
                Some(view) => (view.row, view.column),
                None => return Ok(()),
            }
        };
        // The selected cell must be inside the range. It is not necessarily on
        // a corner: extending a selection over merged cells can grow the range
        // past the selected cell on any side.
        let min_row = start_row.min(end_row);
        let max_row = start_row.max(end_row);
        let min_column = start_column.min(end_column);
        let max_column = start_column.max(end_column);
        if selected_row < min_row || selected_row > max_row {
            return Err(format!(
                "The selected cell is not inside the range. Row: '{selected_row}' and row range '({start_row}, {end_row})'"
            ));
        }
        if selected_column < min_column || selected_column > max_column {
            return Err(format!(
                "The selected cell is not inside the range. Column '{selected_column}' and column range '({start_column}, {end_column})'"
            ));
        }
        // The focus is the moving corner of the selection: the corner of the
        // requested range opposite the selected cell on each axis.
        let focus_row = if selected_row == end_row {
            start_row
        } else {
            end_row
        };
        let focus_column = if selected_column == end_column {
            start_column
        } else {
            end_column
        };
        // A selection can never cover part of a merged cell — except full-row
        // and full-column selections which may slice through
        // merged ranges without dragging their other rows/columns in
        let full_columns = start_row == 1 && end_row == LAST_ROW;
        let full_rows = start_column == 1 && end_column == LAST_COLUMN;
        let range = if full_columns || full_rows {
            [min_row, min_column, max_row, max_column]
        } else {
            self.grow_range_over_merged_cells(sheet, [min_row, min_column, max_row, max_column])?
        };
        if let Ok(worksheet) = self.model.workbook.worksheet_mut(sheet) {
            if let Some(view) = worksheet.views.get_mut(&0) {
                view.range = range;
                view.focus_row = focus_row;
                view.focus_column = focus_column;
            }
        }
        Ok(())
    }

    /// The selected range is expanded with the keyboard: the focus (the moving
    /// corner of the selection) steps one cell in the key's direction — from
    /// the far edge of its merged cell when it is inside one — skipping hidden
    /// rows and columns, and the selected range is recomputed from the anchor
    /// and the new focus.
    pub fn on_expand_selected_range(&mut self, key: &str) -> Result<(), String> {
        let (sheet, window_width, window_height) =
            if let Some(view) = self.model.workbook.views.get(&self.model.view_id) {
                (
                    view.sheet,
                    view.window_width as f64,
                    view.window_height as f64,
                )
            } else {
                return Ok(());
            };
        let (selected_row, selected_column, focus_row, focus_column, range, top_row, left_column) =
            if let Ok(worksheet) = self.model.workbook.worksheet(sheet) {
                if let Some(view) = worksheet.views.get(&self.model.view_id) {
                    (
                        view.row,
                        view.column,
                        view.focus_row,
                        view.focus_column,
                        view.range,
                        view.top_row,
                        view.left_column,
                    )
                } else {
                    return Ok(());
                }
            } else {
                return Ok(());
            };
        let [row_start, column_start, row_end, column_end] = range;
        if ["ArrowUp", "ArrowDown"].contains(&key) && row_start == 1 && row_end == LAST_ROW {
            // full column selected, nothing to do
            return Ok(());
        }
        if ["ArrowRight", "ArrowLeft"].contains(&key)
            && column_start == 1
            && column_end == LAST_COLUMN
        {
            // full row selected, nothing to do
            return Ok(());
        }
        let frozen_rows = self.model.get_frozen_rows_count(sheet)?;
        let frozen_columns = self.model.get_frozen_columns_count(sheet)?;
        let worksheet = self.model.workbook.worksheet(sheet)?;
        // Stepping starts at the far edge of the focus' merged cell, so a
        // single keystroke crosses the whole merged range
        let focus_merge = worksheet
            .merged_cell_containing(focus_row, focus_column)
            .cloned();

        let mut new_focus_row = focus_row;
        let mut new_focus_column = focus_column;
        match key {
            "ArrowRight" => {
                let edge = focus_merge.map_or(focus_column, |m| m.last_column());
                let mut new_column = edge + 1;
                while new_column < LAST_COLUMN && worksheet.is_column_hidden(new_column)? {
                    new_column += 1;
                }
                if !is_valid_column_number(new_column) {
                    return Ok(());
                }
                if new_column > selected_column {
                    // extending right: if the column is not fully visible we
                    // 'scroll' right until it is
                    let mut width = 0.0;
                    let mut c = left_column;
                    while c <= new_column {
                        width += self.ui_column_width(sheet, c)?;
                        c += 1;
                    }
                    if width > window_width {
                        self.set_top_left_visible_cell(top_row, left_column + 1)?;
                    }
                }
                new_focus_column = new_column;
            }
            "ArrowLeft" => {
                let edge = focus_merge.map_or(focus_column, |m| m.column);
                let mut new_column = edge - 1;
                while new_column > 1 && worksheet.is_column_hidden(new_column)? {
                    new_column -= 1;
                }
                if !is_valid_column_number(new_column) {
                    return Ok(());
                }
                // Frozen columns are always visible: no scrolling needed there
                if new_column < left_column && new_column > frozen_columns {
                    self.set_top_left_visible_cell(top_row, new_column)?;
                }
                new_focus_column = new_column;
            }
            "ArrowUp" => {
                let edge = focus_merge.map_or(focus_row, |m| m.row);
                let mut new_row = edge - 1;
                while new_row > 1 && worksheet.is_row_hidden(new_row)? {
                    new_row -= 1;
                }
                if !is_valid_row(new_row) {
                    return Ok(());
                }
                // Frozen rows are always visible: no scrolling needed there
                if new_row < top_row && new_row > frozen_rows {
                    self.set_top_left_visible_cell(new_row, left_column)?;
                }
                new_focus_row = new_row;
            }
            "ArrowDown" => {
                let edge = focus_merge.map_or(focus_row, |m| m.last_row());
                let mut new_row = edge + 1;
                while new_row < LAST_ROW && worksheet.is_row_hidden(new_row)? {
                    new_row += 1;
                }
                if !is_valid_row(new_row) {
                    return Ok(());
                }
                if new_row > selected_row {
                    // extending down: scroll one row if the new row is not
                    // fully visible
                    let mut height = 0.0;
                    let mut r = top_row;
                    while r <= new_row + 1 {
                        height += self.ui_row_height(sheet, r)?;
                        r += 1;
                    }
                    if height >= window_height {
                        self.set_top_left_visible_cell(top_row + 1, left_column)?;
                    }
                }
                new_focus_row = new_row;
            }
            _ => return Ok(()),
        }

        let new_range = self.selection_range(
            sheet,
            selected_row,
            selected_column,
            new_focus_row,
            new_focus_column,
        )?;
        if let Ok(worksheet) = self.model.workbook.worksheet_mut(sheet) {
            if let Some(view) = worksheet.views.get_mut(&self.model.view_id) {
                view.range = new_range;
                view.focus_row = new_focus_row;
                view.focus_column = new_focus_column;
            }
        }
        Ok(())
    }

    /// Sets the value of the first visible cell
    pub fn set_top_left_visible_cell(
        &mut self,
        top_row: i32,
        left_column: i32,
    ) -> Result<(), String> {
        let sheet = if let Some(view) = self.model.workbook.views.get(&self.model.view_id) {
            view.sheet
        } else {
            0
        };

        if !is_valid_column_number(left_column) {
            return Err(format!("Invalid column: '{left_column}'"));
        }
        if !is_valid_row(top_row) {
            return Err(format!("Invalid row: '{top_row}'"));
        }
        if self.model.workbook.worksheet(sheet).is_err() {
            return Err(format!("Invalid worksheet index {sheet}"));
        }
        if let Ok(worksheet) = self.model.workbook.worksheet_mut(sheet) {
            if let Some(view) = worksheet.views.get_mut(&0) {
                view.top_row = top_row;
                view.left_column = left_column;
            }
        }
        Ok(())
    }

    /// Sets the width of the window
    pub fn set_window_width(&mut self, window_width: f64) {
        if let Some(view) = self.model.workbook.views.get_mut(&self.model.view_id) {
            view.window_width = window_width as i64;
        };
    }

    /// Gets the width of the window
    pub fn get_window_width(&mut self) -> Result<i64, String> {
        if let Some(view) = self.model.workbook.views.get_mut(&self.model.view_id) {
            return Ok(view.window_width);
        };
        Err("View not found".to_string())
    }

    /// Sets the height of the window
    pub fn set_window_height(&mut self, window_height: f64) {
        if let Some(view) = self.model.workbook.views.get_mut(&self.model.view_id) {
            view.window_height = window_height as i64;
        };
    }

    /// Gets the height of the window
    pub fn get_window_height(&mut self) -> Result<i64, String> {
        if let Some(view) = self.model.workbook.views.get_mut(&self.model.view_id) {
            return Ok(view.window_height);
        };
        Err("View not found".to_string())
    }

    /// User presses right arrow
    pub fn on_arrow_right(&mut self) -> Result<(), String> {
        let (sheet, window_width) =
            if let Some(view) = self.model.workbook.views.get(&self.model.view_id) {
                (view.sheet, view.window_width)
            } else {
                return Err("View not found".to_string());
            };
        let worksheet = match self.model.workbook.worksheet(sheet) {
            Ok(s) => s,
            Err(_) => return Err("Worksheet not found".to_string()),
        };
        let view = match worksheet.views.get(&self.model.view_id) {
            Some(s) => s,
            None => return Err("View not found".to_string()),
        };
        // Leaving a merged cell starts past its last column
        let row = view.row;
        let mut new_column = match worksheet.merged_cell_containing(row, view.column) {
            Some(m) => m.last_column() + 1,
            None => view.column + 1,
        };
        while new_column <= LAST_COLUMN
            && self
                .model
                .workbook
                .worksheet(sheet)?
                .is_column_hidden(new_column)?
        {
            new_column += 1;
        }
        if !is_valid_column_number(new_column) {
            return Ok(());
        }
        // if the column is not fully visible we 'scroll' right until it is
        let mut width = 0.0;
        let mut column = view.left_column;
        while column <= new_column {
            width += self.ui_column_width(sheet, column)?;
            column += 1;
        }
        // Landing inside a merged cell selects its anchor
        let (new_row, new_column) = self.merge_anchor(sheet, row, new_column)?;
        let new_range = self.single_cell_range(sheet, new_row, new_column)?;
        if let Ok(worksheet) = self.model.workbook.worksheet_mut(sheet) {
            if let Some(view) = worksheet.views.get_mut(&self.model.view_id) {
                view.row = new_row;
                view.column = new_column;
                view.range = new_range;
                view.focus_row = new_row;
                view.focus_column = new_column;
                if width > window_width as f64 {
                    view.left_column += 1;
                }
            }
        }
        Ok(())
    }

    /// User presses left arrow
    pub fn on_arrow_left(&mut self) -> Result<(), String> {
        let sheet = if let Some(view) = self.model.workbook.views.get(&self.model.view_id) {
            view.sheet
        } else {
            return Err("View not found".to_string());
        };
        let worksheet = match self.model.workbook.worksheet(sheet) {
            Ok(s) => s,
            Err(_) => return Err("Worksheet not found".to_string()),
        };
        let view = match worksheet.views.get(&self.model.view_id) {
            Some(s) => s,
            None => return Err("View not found".to_string()),
        };
        // Leaving a merged cell starts before its first column
        let row = view.row;
        let mut new_column = match worksheet.merged_cell_containing(row, view.column) {
            Some(m) => m.column - 1,
            None => view.column - 1,
        };
        while new_column >= 1
            && self
                .model
                .workbook
                .worksheet(sheet)?
                .is_column_hidden(new_column)?
        {
            new_column -= 1;
        }
        if !is_valid_column_number(new_column) {
            return Ok(());
        }
        // Landing inside a merged cell selects its anchor
        let (new_row, new_column) = self.merge_anchor(sheet, row, new_column)?;
        let new_range = self.single_cell_range(sheet, new_row, new_column)?;
        // if the column is not fully visible we 'scroll' right until it is
        if let Ok(worksheet) = self.model.workbook.worksheet_mut(sheet) {
            if let Some(view) = worksheet.views.get_mut(&self.model.view_id) {
                view.row = new_row;
                view.column = new_column;
                view.range = new_range;
                view.focus_row = new_row;
                view.focus_column = new_column;
                if new_column < view.left_column {
                    view.left_column = new_column;
                }
            }
        }
        Ok(())
    }

    /// User presses up arrow key
    pub fn on_arrow_up(&mut self) -> Result<(), String> {
        let sheet = if let Some(view) = self.model.workbook.views.get(&self.model.view_id) {
            view.sheet
        } else {
            return Err("View not found".to_string());
        };
        let worksheet = match self.model.workbook.worksheet(sheet) {
            Ok(s) => s,
            Err(_) => return Err("Worksheet not found".to_string()),
        };
        let view = match worksheet.views.get(&self.model.view_id) {
            Some(s) => s,
            None => return Err("View not found".to_string()),
        };
        // Leaving a merged cell starts above its first row
        let column = view.column;
        let mut new_row = match worksheet.merged_cell_containing(view.row, column) {
            Some(m) => m.row - 1,
            None => view.row - 1,
        };
        while new_row >= 1
            && self
                .model
                .workbook
                .worksheet(sheet)?
                .is_row_hidden(new_row)?
        {
            new_row -= 1;
        }
        if !is_valid_row(new_row) {
            return Ok(());
        }
        // Landing inside a merged cell selects its anchor
        let (new_row, new_column) = self.merge_anchor(sheet, new_row, column)?;
        let new_range = self.single_cell_range(sheet, new_row, new_column)?;
        // if the column is not fully visible we 'scroll' right until it is
        if let Ok(worksheet) = self.model.workbook.worksheet_mut(sheet) {
            if let Some(view) = worksheet.views.get_mut(&self.model.view_id) {
                view.row = new_row;
                view.column = new_column;
                view.range = new_range;
                view.focus_row = new_row;
                view.focus_column = new_column;
                if new_row < view.top_row {
                    view.top_row = new_row;
                }
            }
        }
        Ok(())
    }

    /// User presses down arrow key
    pub fn on_arrow_down(&mut self) -> Result<(), String> {
        let (sheet, window_height) =
            if let Some(view) = self.model.workbook.views.get(&self.model.view_id) {
                (view.sheet, view.window_height)
            } else {
                return Err("View not found".to_string());
            };
        let worksheet = match self.model.workbook.worksheet(sheet) {
            Ok(s) => s,
            Err(_) => return Err("Worksheet not found".to_string()),
        };
        let view = match worksheet.views.get(&self.model.view_id) {
            Some(s) => s,
            None => return Err("View not found".to_string()),
        };
        // Leaving a merged cell starts below its last row
        let column = view.column;
        let mut new_row = match worksheet.merged_cell_containing(view.row, column) {
            Some(m) => m.last_row() + 1,
            None => view.row + 1,
        };
        while new_row <= LAST_ROW
            && self
                .model
                .workbook
                .worksheet(sheet)?
                .is_row_hidden(new_row)?
        {
            new_row += 1;
        }
        if !is_valid_row(new_row) {
            return Ok(());
        }
        // if the row is not fully visible we 'scroll' down until it is
        let mut height = 0.0;
        let mut row = view.top_row;
        while row <= new_row + 1 && row <= LAST_ROW {
            height += self.ui_row_height(sheet, row)?;
            row += 1;
        }
        // Landing inside a merged cell selects its anchor
        let (new_row, new_column) = self.merge_anchor(sheet, new_row, column)?;
        let new_range = self.single_cell_range(sheet, new_row, new_column)?;
        if let Ok(worksheet) = self.model.workbook.worksheet_mut(sheet) {
            if let Some(view) = worksheet.views.get_mut(&self.model.view_id) {
                view.row = new_row;
                view.column = new_column;
                view.range = new_range;
                view.focus_row = new_row;
                view.focus_column = new_column;
                if height > window_height as f64 {
                    view.top_row += 1;
                }
            }
        }
        Ok(())
    }

    // TODO: This function should be memoized
    /// Returns the x-coordinate of the cell in the top left corner
    pub fn get_scroll_x(&self) -> Result<f64, String> {
        let sheet = if let Some(view) = self.model.workbook.views.get(&self.model.view_id) {
            view.sheet
        } else {
            return Err("View not found".to_string());
        };
        let worksheet = match self.model.workbook.worksheet(sheet) {
            Ok(s) => s,
            Err(_) => return Err("Worksheet not found".to_string()),
        };
        let view = match worksheet.views.get(&self.model.view_id) {
            Some(s) => s,
            None => return Err("View not found".to_string()),
        };
        let mut scroll_x = 0.0;
        for column in 1..view.left_column {
            scroll_x += self.ui_column_width(sheet, column)?;
        }
        Ok(scroll_x)
    }

    // TODO: This function should be memoized
    /// Returns the y-coordinate of the cell in the top left corner
    pub fn get_scroll_y(&self) -> Result<f64, String> {
        let sheet = if let Some(view) = self.model.workbook.views.get(&self.model.view_id) {
            view.sheet
        } else {
            return Err("View not found".to_string());
        };
        let worksheet = match self.model.workbook.worksheet(sheet) {
            Ok(s) => s,
            Err(_) => return Err("Worksheet not found".to_string()),
        };
        let view = match worksheet.views.get(&self.model.view_id) {
            Some(s) => s,
            None => return Err("View not found".to_string()),
        };
        let mut scroll_y = 0.0;
        for row in 1..view.top_row {
            scroll_y += self.ui_row_height(sheet, row)?;
        }
        Ok(scroll_y)
    }

    /// User presses page down.
    /// The `top_row` is now the first row that is not fully visible
    pub fn on_page_down(&mut self) -> Result<(), String> {
        let (sheet, window_height) =
            if let Some(view) = self.model.workbook.views.get(&self.model.view_id) {
                (view.sheet, view.window_height)
            } else {
                return Err("View not found".to_string());
            };
        let worksheet = match self.model.workbook.worksheet(sheet) {
            Ok(s) => s,
            Err(_) => return Err("Worksheet not found".to_string()),
        };
        let view = match worksheet.views.get(&self.model.view_id) {
            Some(s) => s,
            None => return Err("View not found".to_string()),
        };
        let mut last_row = view.top_row;
        let mut height = self.ui_row_height(sheet, last_row)?;
        while height <= window_height as f64 {
            last_row += 1;
            height += self.ui_row_height(sheet, last_row)?;
        }
        if !is_valid_row(last_row) {
            return Ok(());
        }
        let row_delta = view.row - view.top_row;
        // Landing inside a merged cell selects its anchor
        let (new_row, new_column) = self.merge_anchor(sheet, last_row + row_delta, view.column)?;
        let new_range = self.single_cell_range(sheet, new_row, new_column)?;
        if let Ok(worksheet) = self.model.workbook.worksheet_mut(sheet) {
            if let Some(view) = worksheet.views.get_mut(&self.model.view_id) {
                view.top_row = last_row;
                view.row = new_row;
                view.column = new_column;
                view.range = new_range;
                view.focus_row = new_row;
                view.focus_column = new_column;
            }
        }
        Ok(())
    }

    /// On page up. tis needs to be the inverse of page down
    pub fn on_page_up(&mut self) -> Result<(), String> {
        let (sheet, window_height) =
            if let Some(view) = self.model.workbook.views.get(&self.model.view_id) {
                (view.sheet, view.window_height as f64)
            } else {
                return Err("View not found".to_string());
            };
        let worksheet = match self.model.workbook.worksheet(sheet) {
            Ok(s) => s,
            Err(_) => return Err("Worksheet not found".to_string()),
        };
        let view = match worksheet.views.get(&self.model.view_id) {
            Some(s) => s,
            None => return Err("View not found".to_string()),
        };

        let mut first_row = view.top_row;
        let mut height = self.ui_row_height(sheet, first_row)?;
        while height <= window_height && first_row > 1 {
            first_row -= 1;
            height += self.ui_row_height(sheet, first_row)?;
        }

        let row_delta = view.row - view.top_row;
        // Landing inside a merged cell selects its anchor
        let (new_row, new_column) = self.merge_anchor(sheet, first_row + row_delta, view.column)?;
        let new_range = self.single_cell_range(sheet, new_row, new_column)?;
        if let Ok(worksheet) = self.model.workbook.worksheet_mut(sheet) {
            if let Some(view) = worksheet.views.get_mut(&self.model.view_id) {
                view.top_row = first_row;
                view.row = new_row;
                view.column = new_column;
                view.range = new_range;
                view.focus_row = new_row;
                view.focus_column = new_column;
            }
        }
        Ok(())
    }

    /// We extend the selection to cell (target_row, target_column)
    pub fn on_area_selecting(&mut self, target_row: i32, target_column: i32) -> Result<(), String> {
        let (sheet, window_width, window_height) =
            if let Some(view) = self.model.workbook.views.get(&self.model.view_id) {
                (
                    view.sheet,
                    view.window_width as f64,
                    view.window_height as f64,
                )
            } else {
                return Ok(());
            };
        let (selected_row, selected_column, top_row, left_column) =
            if let Ok(worksheet) = self.model.workbook.worksheet(sheet) {
                if let Some(view) = worksheet.views.get(&self.model.view_id) {
                    (view.row, view.column, view.top_row, view.left_column)
                } else {
                    return Ok(());
                }
            } else {
                return Ok(());
            };
        let frozen_rows = self.model.get_frozen_rows_count(sheet)?;
        let frozen_columns = self.model.get_frozen_columns_count(sheet)?;

        let mut new_left_column = left_column;
        if target_column <= frozen_columns {
            // The target is in the frozen pane, which is always visible:
            // no scrolling
        } else if target_column >= selected_column {
            let mut width = 0.0;
            let mut column = left_column;
            while column <= target_column {
                width += self.ui_column_width(sheet, column)?;
                column += 1;
            }

            while width > window_width {
                width -= self.ui_column_width(sheet, new_left_column)?;
                new_left_column += 1;
            }
        } else if target_column < new_left_column {
            new_left_column = target_column;
        }
        let mut new_top_row = top_row;
        if target_row <= frozen_rows {
            // The target is in the frozen pane, which is always visible:
            // no scrolling
        } else if target_row >= selected_row {
            let mut height = 0.0;
            let mut row = top_row;
            while row <= target_row {
                height += self.ui_row_height(sheet, row)?;
                row += 1;
            }
            while height > window_height {
                height -= self.ui_row_height(sheet, new_top_row)?;
                new_top_row += 1;
            }
        } else if target_row < new_top_row {
            new_top_row = target_row;
        }

        // The target is the new focus; the range is recomputed from the anchor
        // (never stretched from the previous, already grown, range: that would
        // keep merged cells the pointer has left)
        let range = self.selection_range(
            sheet,
            selected_row,
            selected_column,
            target_row,
            target_column,
        )?;
        if let Ok(worksheet) = self.model.workbook.worksheet_mut(sheet) {
            if let Some(view) = worksheet.views.get_mut(&self.model.view_id) {
                view.range = range;
                view.focus_row = target_row;
                view.focus_column = target_column;
                if new_top_row != top_row {
                    view.top_row = new_top_row;
                }
                if new_left_column != left_column {
                    view.left_column = new_left_column;
                }
            }
        }

        Ok(())
    }

    /// User navigates to the edge in the given direction
    pub fn on_navigate_to_edge_in_direction(
        &mut self,
        direction: NavigationDirection,
    ) -> Result<(), String> {
        let (sheet, window_height, window_width) =
            if let Some(view) = self.model.workbook.views.get(&self.model.view_id) {
                (view.sheet, view.window_height, view.window_width)
            } else {
                return Err("View not found".to_string());
            };
        let worksheet = match self.model.workbook.worksheet(sheet) {
            Ok(s) => s,
            Err(_) => return Err("Worksheet not found".to_string()),
        };
        let view = match worksheet.views.get(&self.model.view_id) {
            Some(s) => s,
            None => return Err("View not found".to_string()),
        };
        let row = view.row;
        let column = view.column;
        if !is_valid_row(row) || !is_valid_column_number(column) {
            return Err("Invalid row or column".to_string());
        }
        let (new_row, new_column) =
            worksheet.navigate_to_edge_in_direction(row, column, direction)?;
        if !is_valid_row(new_row) || !is_valid_column_number(new_column) {
            return Err("Invalid row or column after navigation".to_string());
        }
        if new_row == row && new_column == column {
            return Ok(()); // No change in selection
        }

        let mut top_row = view.top_row;
        let mut left_column = view.left_column;

        match direction {
            NavigationDirection::Left | NavigationDirection::Right => {
                // If the new column is not fully visible we 'scroll' until it is
                // We need to check two conditions:
                // 1. new_column > view.left_column
                // 2. right_column < new_column
                if new_column < view.left_column {
                    left_column = new_column;
                } else {
                    let mut c = new_column;
                    let mut width = self.ui_column_width(sheet, c)?;
                    while c > 1 && width <= window_width as f64 {
                        c -= 1;
                        width += self.ui_column_width(sheet, c)?;
                    }
                    if c > view.left_column {
                        left_column = c;
                    }
                }
            }
            NavigationDirection::Up | NavigationDirection::Down => {
                // If the new row is not fully visible we 'scroll' until it is
                // We need to check two conditions:
                // 1. new_row > view.top_row
                // 2. bottom_row < new_row
                if new_row < view.top_row {
                    top_row = new_row;
                } else {
                    let mut r = new_row;
                    let mut height = self.ui_row_height(sheet, r)?;
                    while r > 1 && height <= window_height as f64 {
                        r -= 1;
                        height += self.ui_row_height(sheet, r)?;
                    }
                    if r > view.top_row {
                        top_row = r;
                    }
                }
            }
        }

        // Landing inside a merged cell selects its anchor
        let (new_row, new_column) = self.merge_anchor(sheet, new_row, new_column)?;
        let new_range = self.single_cell_range(sheet, new_row, new_column)?;
        if let Ok(worksheet) = self.model.workbook.worksheet_mut(sheet) {
            if let Some(view) = worksheet.views.get_mut(&self.model.view_id) {
                view.row = new_row;
                view.column = new_column;
                view.range = new_range;
                view.focus_row = new_row;
                view.focus_column = new_column;

                view.top_row = top_row;
                view.left_column = left_column;
            }
        }
        Ok(())
    }
}
