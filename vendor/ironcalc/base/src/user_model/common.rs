#![deny(missing_docs)]

use std::{collections::HashMap, fmt::Debug};

use serde::{Deserialize, Serialize};

use crate::{
    cf_types::ExtendedStyle,
    constants::{LAST_COLUMN, LAST_ROW},
    expressions::{
        parser::CompletionContext,
        types::Area,
        utils::{is_valid_column_number, is_valid_row},
    },
    model::{FmtSettings, Model},
    types::{
        Alignment, ArrayKind, BorderItem, Cell, CellType, Col, Color, HorizontalAlignment,
        MergedCell, SheetProperties, SheetState, Style, Theme, VerticalAlignment,
    },
};

use crate::user_model::history::{
    ColumnData, Diff, DiffList, DiffType, History, QueueDiffs, RowData,
};

use super::border_utils::is_max_border;

#[derive(Serialize, Deserialize)]
pub enum CellArrayStructure {
    // It's just a single cell
    SingleCell,
    // It is part of a dynamic array
    // (anchor_row, anchor_column, width, height)
    DynamicChild(i32, i32, i32, i32),
    // Anchor of a dynamic array (width, height)
    DynamicAnchor(i32, i32),
    // It is part of an array formula
    ArrayChild(i32, i32, i32, i32),
    // Anchor of an array formula
    ArrayAnchor(i32, i32),
}

#[derive(Serialize, Deserialize, PartialEq)]
pub enum BorderType {
    All,
    Inner,
    Outer,
    Top,
    Right,
    Bottom,
    Left,
    CenterH,
    CenterV,
    None,
}

/// This is the struct for a border area
#[derive(Serialize, Deserialize)]
pub struct BorderArea {
    pub(crate) item: BorderItem,
    pub(crate) r#type: BorderType,
}

fn boolean(value: &str) -> Result<bool, String> {
    match value {
        "true" => Ok(true),
        "false" => Ok(false),
        _ => Err(format!("Invalid value for boolean: '{value}'.")),
    }
}

fn horizontal(value: &str) -> Result<HorizontalAlignment, String> {
    match value {
        "center" => Ok(HorizontalAlignment::Center),
        "centerContinuous" => Ok(HorizontalAlignment::CenterContinuous),
        "distributed" => Ok(HorizontalAlignment::Distributed),
        "fill" => Ok(HorizontalAlignment::Fill),
        "general" => Ok(HorizontalAlignment::General),
        "justify" => Ok(HorizontalAlignment::Justify),
        "left" => Ok(HorizontalAlignment::Left),
        "right" => Ok(HorizontalAlignment::Right),
        _ => Err(format!(
            "Invalid value for horizontal alignment: '{value}'."
        )),
    }
}

fn vertical(value: &str) -> Result<VerticalAlignment, String> {
    match value {
        "bottom" => Ok(VerticalAlignment::Bottom),
        "center" => Ok(VerticalAlignment::Center),
        "distributed" => Ok(VerticalAlignment::Distributed),
        "justify" => Ok(VerticalAlignment::Justify),
        "top" => Ok(VerticalAlignment::Top),
        _ => Err(format!("Invalid value for vertical alignment: '{value}'.")),
    }
}

fn update_style(old_value: &Style, style_path: &str, value: &str) -> Result<Style, String> {
    let mut style = old_value.clone();
    match style_path {
        "font.b" => {
            style.font.b = boolean(value)?;
        }
        "font.i" => {
            style.font.i = boolean(value)?;
        }
        "font.u" => {
            style.font.u = boolean(value)?;
        }
        "font.strike" => {
            style.font.strike = boolean(value)?;
        }
        "font.color" => {
            style.font.color = Color::from_param(value)?;
        }
        "font.size" => {
            let new_size: i32 = value
                .parse()
                .map_err(|_| format!("Invalid value for font size: '{value}'."))?;
            if new_size < 1 {
                return Err(format!("Invalid value for font size: '{new_size}'."));
            }
            style.font.sz = new_size;
        }
        "font.size_delta" => {
            // This is a special case, we need to add the value to the current size
            let size_delta: i32 = value
                .parse()
                .map_err(|_| format!("Invalid value for font size: '{value}'."))?;
            let new_size = style.font.sz + size_delta;
            if new_size < 1 {
                return Err(format!("Invalid value for font size: '{new_size}'."));
            }
            style.font.sz = new_size;
        }
        "fill.color" | "fill.bg_color" | "fill.fg_color" => {
            style.fill.color = Color::from_param(value)?;
        }
        "num_fmt" => {
            value.clone_into(&mut style.num_fmt);
        }
        "alignment" => {
            if !value.is_empty() {
                return Err(format!("Alignment must be empty, but found: '{value}'."));
            }
            style.alignment = None;
        }
        "alignment.horizontal" => match style.alignment {
            Some(ref mut s) => s.horizontal = horizontal(value)?,
            None => {
                let alignment = Alignment {
                    horizontal: horizontal(value)?,
                    ..Default::default()
                };
                style.alignment = Some(alignment)
            }
        },
        "alignment.vertical" => match style.alignment {
            Some(ref mut s) => s.vertical = vertical(value)?,
            None => {
                let alignment = Alignment {
                    vertical: vertical(value)?,
                    ..Default::default()
                };
                style.alignment = Some(alignment)
            }
        },
        "alignment.wrap_text" => match style.alignment {
            Some(ref mut s) => s.wrap_text = boolean(value)?,
            None => {
                let alignment = Alignment {
                    wrap_text: boolean(value)?,
                    ..Default::default()
                };
                style.alignment = Some(alignment)
            }
        },
        _ => {
            return Err(format!("Invalid style path: '{style_path}'."));
        }
    }
    Ok(style)
}

/// # A wrapper around [`Model`] for a spreadsheet end user.
/// UserModel is a wrapper around Model with undo/redo history, _diffs_, automatic evaluation and view management.
///
/// A diff in this context (or more correctly a _user diff_) is a change created by a user.
///
/// Automatic evaluation means that actions like setting a value on a cell or deleting a column
/// will evaluate the model if needed.
///
/// It is meant to be used by UI applications like Web IronCalc or TironCalc.
///
///
/// # Examples
///
/// ```rust
/// # use ironcalc_base::UserModel;
/// # fn main() -> Result<(), Box<dyn std::error::Error>> {
/// let mut model = UserModel::new_empty("model", "en", "UTC", "en")?;
/// model.set_user_input(0, 1, 1, "=1+1")?;
/// assert_eq!(model.get_formatted_cell_value(0, 1, 1)?, "2");
/// model.undo()?;
/// assert_eq!(model.get_formatted_cell_value(0, 1, 1)?, "");
/// model.redo()?;
/// assert_eq!(model.get_formatted_cell_value(0, 1, 1)?, "2");
/// # Ok(())
/// # }
/// ```
pub struct UserModel<'a> {
    pub(crate) model: Model<'a>,
    history: History,
    send_queue: Vec<QueueDiffs>,
    pause_evaluation: bool,
}

/// Given the index of the currently selected sheet, returns the index that same
/// sheet occupies after the worksheet at `from` is moved to `to`. This lets the
/// selection follow a sheet by identity across a reorder instead of pointing at
/// whichever sheet lands in the old slot.
pub(crate) fn selected_sheet_after_move(selected: u32, from: u32, to: u32) -> u32 {
    if selected == from {
        return to;
    }
    // Mirror `Model::move_sheet`: remove at `from`, then insert at `to`.
    let after_remove = if selected > from {
        selected - 1
    } else {
        selected
    };
    if after_remove >= to {
        after_remove + 1
    } else {
        after_remove
    }
}

impl<'a> Debug for UserModel<'a> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("UserModel").finish()
    }
}

impl<'a> UserModel<'a> {
    /// Creates a user model from an existing model
    pub fn from_model(model: Model) -> UserModel {
        UserModel {
            model,
            history: History::default(),
            send_queue: vec![],
            pause_evaluation: false,
        }
    }

    /// Creates a new UserModel.
    ///
    /// See also:
    /// * [Model::new_empty]
    pub fn new_empty(
        name: &'a str,
        locale_id: &'a str,
        timezone: &'a str,
        language_id: &'a str,
    ) -> Result<UserModel<'a>, String> {
        let model = Model::new_empty(name, locale_id, timezone, language_id)?;
        Ok(UserModel {
            model,
            history: History::default(),
            send_queue: vec![],
            pause_evaluation: false,
        })
    }

    /// Creates a model from it's internal representation
    ///
    /// See also:
    /// * [Model::from_bytes]
    pub fn from_bytes(s: &[u8], language_id: &'a str) -> Result<UserModel<'a>, String> {
        let model = Model::from_bytes(s, language_id)?;
        Ok(UserModel {
            model,
            history: History::default(),
            send_queue: vec![],
            pause_evaluation: false,
        })
    }

    /// Returns the internal representation of a model
    ///
    /// See also:
    ///  * [Model::to_bytes]
    pub fn to_bytes(&self) -> Vec<u8> {
        self.model.to_bytes()
    }

    /// Returns the internal model
    pub fn get_model(&self) -> &Model<'_> {
        &self.model
    }

    /// Returns the workbook name
    pub fn get_name(&self) -> String {
        self.model.workbook.name.clone()
    }

    /// Sets the name of a workbook
    pub fn set_name(&mut self, name: &str) {
        let old_value = self.model.workbook.name.clone();
        if old_value == name {
            return;
        }
        self.push_diff_list(vec![Diff::SetWorkbookName {
            old_value,
            new_value: name.to_string(),
        }]);
        self.model.workbook.name = name.to_string();
    }

    /// Undoes last change if any, places the change in the redo list and evaluates the model if needed
    ///
    /// See also:
    /// * [UserModel::redo]
    pub fn undo(&mut self) -> Result<(), String> {
        if let Some(diff_list) = self.history.undo() {
            self.apply_undo_diff_list(&diff_list)?;
            self.send_queue.push(QueueDiffs {
                r#type: DiffType::Undo,
                list: diff_list.clone(),
            });
        };
        Ok(())
    }

    /// Redoes the last undone change, places the change in the undo list and evaluates the model if needed
    ///
    /// See also:
    /// * [UserModel::redo]
    pub fn redo(&mut self) -> Result<(), String> {
        if let Some(diff_list) = self.history.redo() {
            self.apply_diff_list(&diff_list)?;
            self.send_queue.push(QueueDiffs {
                r#type: DiffType::Redo,
                list: diff_list.clone(),
            });
        };
        Ok(())
    }

    /// Returns true if there are items to be undone
    pub fn can_undo(&self) -> bool {
        !self.history.undo_stack.is_empty()
    }

    /// Returns true if there are items to be redone
    pub fn can_redo(&self) -> bool {
        !self.history.redo_stack.is_empty()
    }

    /// Pauses automatic evaluation.
    ///
    /// See also:
    /// * [UserModel::evaluate]
    /// * [UserModel::resume_evaluation]
    pub fn pause_evaluation(&mut self) {
        self.pause_evaluation = true;
    }

    /// Resumes automatic evaluation.
    ///
    /// See also:
    /// * [UserModel::evaluate]
    /// * [UserModel::pause_evaluation]
    pub fn resume_evaluation(&mut self) {
        self.pause_evaluation = false;
    }

    /// Forces an evaluation of the model
    ///
    /// See also:
    /// * [Model::evaluate]
    /// * [UserModel::pause_evaluation]
    pub fn evaluate(&mut self) {
        self.model.evaluate()
    }

    /// Returns the list of pending diffs and removes them from the queue
    ///
    /// This is used together with [apply_external_diffs](UserModel::apply_external_diffs) to keep two remote models
    /// in sync.
    ///
    /// See also:
    /// * [UserModel::apply_external_diffs]
    pub fn flush_send_queue(&mut self) -> Vec<u8> {
        // This can never fail :O:
        let q = bitcode::encode(&self.send_queue);
        self.send_queue = vec![];
        q
    }

    /// This are external diffs that need to be applied to the model
    ///
    /// This is used together with [flush_send_queue](UserModel::flush_send_queue) to keep two remote models in sync
    ///
    /// See also:
    /// * [UserModel::flush_send_queue]
    pub fn apply_external_diffs(&mut self, diff_list_str: &[u8]) -> Result<(), String> {
        if let Ok(queue_diffs_list) = bitcode::decode::<Vec<QueueDiffs>>(diff_list_str) {
            for queue_diff in queue_diffs_list {
                if matches!(queue_diff.r#type, DiffType::Redo) {
                    self.apply_diff_list(&queue_diff.list)?;
                } else {
                    self.apply_undo_diff_list(&queue_diff.list)?;
                }
            }
        } else {
            return Err("Error parsing diff list".to_string());
        }
        Ok(())
    }

    /// Set the input in a cell
    ///
    /// See also:
    /// * [Model::set_user_input]
    pub fn set_user_input(
        &mut self,
        sheet: u32,
        row: i32,
        column: i32,
        value: &str,
    ) -> Result<(), String> {
        if !is_valid_column_number(column) {
            return Err("Invalid column".to_string());
        }
        if !is_valid_row(row) {
            return Err("Invalid row".to_string());
        }
        let old_value = self
            .model
            .workbook
            .worksheet(sheet)?
            .cell(row, column)
            .cloned();
        // If it is a spill cell we want to save the old value as None, because the value of a spill cell is determined by the anchor cell
        let old_value = if matches!(old_value, Some(Cell::SpillCell { .. })) {
            None
        } else {
            old_value
        };
        let mut diff_list = vec![Diff::SetCellValue {
            sheet,
            row,
            column,
            new_value: value.to_string(),
            old_value: Box::new(old_value),
        }];
        self.set_user_input_with_link_diffs(sheet, row, column, value.to_string(), &mut diff_list)?;

        self.evaluate_if_not_paused();

        let style = self.model.get_style_for_cell(sheet, row, column)?;

        let line_count = value.split('\n').count() as f64;
        let row_height = self.model.get_row_height(sheet, row)?;
        // This is in sync with the front-end auto fit row
        let font_size = style.font.sz as f64;
        let line_height = font_size * 1.5;
        let cell_height = (line_count - 1.0) * line_height + 8.0 + font_size;
        if cell_height > row_height {
            diff_list.push(Diff::SetRowHeight {
                sheet,
                row,
                new_value: cell_height,
                old_value: row_height,
            });
            self.model.set_row_height(sheet, row, cell_height)?;
        }

        self.push_diff_list(diff_list);
        Ok(())
    }

    /// Calls [`Model::set_user_input`] and appends to `diff_list` the diffs for the
    /// side effects it has on the cell link: URL-like values are auto-linked (which
    /// also applies the link style when the cell was not linked before) and an empty
    /// input removes the link. The `SetCellValue` diff for the input itself is not
    /// added here.
    pub(super) fn set_user_input_with_link_diffs(
        &mut self,
        sheet: u32,
        row: i32,
        column: i32,
        value: String,
        diff_list: &mut Vec<Diff>,
    ) -> Result<(), String> {
        let old_link = self.model.get_cell_link(sheet, row, column)?;
        let old_style = self.model.get_cell_style_or_none(sheet, row, column)?;
        self.model.set_user_input(sheet, row, column, value)?;
        let new_link = self.model.get_cell_link(sheet, row, column)?;
        if new_link == old_link {
            return Ok(());
        }
        if old_link.is_none() {
            // a newly auto-created link also applies the link style to the cell
            let new_style = self.model.get_style_for_cell(sheet, row, column)?;
            diff_list.push(Diff::SetCellStyle {
                sheet,
                row,
                column,
                old_value: Box::new(old_style),
                new_value: Box::new(new_style),
            });
        }
        diff_list.push(Diff::SetCellLink {
            sheet,
            row,
            column,
            old_value: Box::new(old_link),
            new_value: Box::new(new_link),
        });
        Ok(())
    }

    /// Returns the content of a cell
    ///
    /// See also:
    /// * [Model::get_localized_cell_content]
    #[inline]
    pub fn get_cell_content(&self, sheet: u32, row: i32, column: i32) -> Result<String, String> {
        self.model.get_localized_cell_content(sheet, row, column)
    }

    /// Returns completion information for a formula being edited in a cell.
    ///
    /// `formula` is the raw cell input (it may start with `=`) and `cursor` is a
    /// char offset into it.
    ///
    /// See also:
    /// * [Model::formula_completion]
    #[inline]
    pub fn formula_completion(
        &mut self,
        sheet: u32,
        row: i32,
        column: i32,
        formula: &str,
        cursor: usize,
    ) -> Result<CompletionContext, String> {
        self.model
            .formula_completion(sheet, row, column, formula, cursor)
    }

    /// Cycles the references touched by the cursor through the four
    /// absolute/relative states, Excel F4 style: A1 -> $A$1 -> A$1 -> $A1 -> A1.
    /// Returns the new text together with the new cursor start and end.
    ///
    /// See also:
    /// * [Model::cycle_reference]
    #[inline]
    pub fn cycle_reference(
        &self,
        value: &str,
        start: usize,
        end: usize,
    ) -> Result<(String, i32, i32), String> {
        self.model.cycle_reference(value, start, end)
    }

    /// Returns the formatted value of a cell
    ///
    /// See also:
    /// * [Model::get_formatted_cell_value]
    #[inline]
    pub fn get_formatted_cell_value(
        &self,
        sheet: u32,
        row: i32,
        column: i32,
    ) -> Result<String, String> {
        self.model.get_formatted_cell_value(sheet, row, column)
    }

    /// Returns the type of the cell
    ///
    /// See also
    /// * [Model::get_cell_type]
    pub fn get_cell_type(&self, sheet: u32, row: i32, column: i32) -> Result<CellType, String> {
        self.model.get_cell_type(sheet, row, column)
    }

    /// Adds new sheet
    ///
    /// See also:
    /// * [Model::new_sheet]
    pub fn new_sheet(&mut self) -> Result<(), String> {
        let (name, index) = self.model.new_sheet();
        self.set_selected_sheet(index)?;
        self.push_diff_list(vec![Diff::NewSheet { index, name }]);
        Ok(())
    }

    /// Duplicates a sheet by index, placing the copy right after it and
    /// selecting it.
    ///
    /// See also:
    /// * [Model::duplicate_sheet]
    pub fn duplicate_sheet(&mut self, sheet: u32) -> Result<(), String> {
        let (_name, new_index) = self.model.duplicate_sheet(sheet)?;
        self.set_selected_sheet(new_index)?;
        self.push_diff_list(vec![Diff::DuplicateSheet {
            source_index: sheet,
            new_index,
        }]);
        Ok(())
    }

    /// Deletes sheet by index
    ///
    /// See also:
    /// * [Model::delete_sheet]
    pub fn delete_sheet(&mut self, sheet: u32) -> Result<(), String> {
        let worksheet = self.model.workbook.worksheet(sheet)?;

        self.push_diff_list(vec![Diff::DeleteSheet {
            sheet,
            old_data: Box::new(worksheet.clone()),
        }]);

        let sheet_count = self.model.workbook.worksheets.len() as u32;
        // If we are deleting the last sheet we need to change the selected sheet
        if sheet == sheet_count - 1 && sheet_count > 1 {
            if let Some(view) = self.model.workbook.views.get_mut(&self.model.view_id) {
                view.sheet = sheet_count - 2;
            };
        }

        self.model.delete_sheet(sheet)?;
        Ok(())
    }

    /// Renames a sheet by index
    ///
    /// See also:
    /// * [Model::rename_sheet_by_index]
    pub fn rename_sheet(&mut self, sheet: u32, new_name: &str) -> Result<(), String> {
        let old_value = self.model.workbook.worksheet(sheet)?.name.clone();
        if old_value == new_name {
            return Ok(());
        }
        self.model.rename_sheet_by_index(sheet, new_name)?;
        self.push_diff_list(vec![Diff::RenameSheet {
            index: sheet,
            old_value,
            new_value: new_name.to_string(),
        }]);
        Ok(())
    }

    /// Moves the worksheet at `sheet_index` to `new_index` within the workbook,
    /// shifting the other sheets to accommodate. The moved worksheet ends up at
    /// exactly `new_index`.
    ///
    /// The reorder is undoable/redoable, and the new order is preserved when the
    /// workbook is saved. Cross-sheet formula references stay valid across the
    /// move (sheet order is a position, not an identity — references key off the
    /// sheet name/id). The selection follows the same sheet across the move.
    ///
    /// Moving a sheet to its current position is a no-op (no history entry). Fails
    /// if either index is out of range.
    ///
    /// See also:
    /// * [Model::move_sheet]
    pub fn move_sheet(&mut self, sheet_index: u32, new_index: u32) -> Result<(), String> {
        let sheet_count = self.model.workbook.worksheets.len() as u32;
        if sheet_index >= sheet_count {
            return Err(format!("Invalid sheet index {sheet_index}"));
        }
        if new_index >= sheet_count {
            return Err(format!("Invalid target index {new_index}"));
        }
        if sheet_index == new_index {
            return Ok(());
        }
        let selected = self.get_selected_sheet();
        self.model.move_sheet(sheet_index, new_index)?;
        self.set_selected_sheet(selected_sheet_after_move(selected, sheet_index, new_index))?;
        self.push_diff_list(vec![Diff::MoveSheet {
            sheet_index,
            new_index,
        }]);
        Ok(())
    }

    /// Hides sheet by index
    ///
    /// See also:
    /// * [Model::set_sheet_state]
    /// * [UserModel::unhide_sheet]
    pub fn hide_sheet(&mut self, sheet: u32) -> Result<(), String> {
        let sheet_count = self.model.workbook.worksheets.len() as u32;
        for index in 1..sheet_count {
            let sheet_index = (sheet + index) % sheet_count;
            if self.model.workbook.worksheet(sheet_index)?.state == SheetState::Visible {
                if let Some(view) = self.model.workbook.views.get_mut(&self.model.view_id) {
                    view.sheet = sheet_index;
                };
                break;
            }
        }
        let old_value = self.model.workbook.worksheet(sheet)?.state.clone();
        self.push_diff_list(vec![Diff::SetSheetState {
            index: sheet,
            new_value: SheetState::Hidden,
            old_value,
        }]);
        self.model.set_sheet_state(sheet, SheetState::Hidden)?;
        Ok(())
    }

    /// Un hides sheet by index
    ///
    /// See also:
    /// * [Model::set_sheet_state]
    /// * [UserModel::hide_sheet]
    pub fn unhide_sheet(&mut self, sheet: u32) -> Result<(), String> {
        let old_value = self.model.workbook.worksheet(sheet)?.state.clone();
        self.push_diff_list(vec![Diff::SetSheetState {
            index: sheet,
            new_value: SheetState::Visible,
            old_value,
        }]);
        self.model.set_sheet_state(sheet, SheetState::Visible)?;
        Ok(())
    }

    /// Sets sheet color
    ///
    /// Note: an empty string will remove the color
    ///
    /// See also
    /// * [Model::set_sheet_color]
    /// * [UserModel::get_worksheets_properties]
    pub fn set_sheet_color(&mut self, sheet: u32, color: &Color) -> Result<(), String> {
        let old_value = self.model.workbook.worksheet(sheet)?.color.clone();
        self.model.set_sheet_color(sheet, color)?;
        self.push_diff_list(vec![Diff::SetSheetColor {
            index: sheet,
            old_value,
            new_value: color.clone(),
        }]);
        Ok(())
    }

    /// Removes cells contents and style
    ///
    /// See also:
    /// * [Model::range_clear_all]
    pub fn range_clear_all(&mut self, range: &Area) -> Result<(), String> {
        let sheet = range.sheet;
        // TODO: full rows/columns
        let mut old_value = Vec::new();
        let mut old_style = Vec::new();

        for row in range.row..range.row + range.height {
            let mut data_row = Vec::new();
            let mut style_row = Vec::new();
            for column in range.column..range.column + range.width {
                let old_value = self
                    .model
                    .workbook
                    .worksheet(sheet)?
                    .cell(row, column)
                    .cloned();
                data_row.push(old_value);
                let old_style = self.model.get_style_for_cell(sheet, row, column)?;
                style_row.push(old_style);
            }
            old_value.push(data_row);
            old_style.push(style_row);
        }
        // Clearing the cells also removes their links: capture them for undo
        let link_diffs = self.range_link_diffs(range)?;
        self.model.range_clear_all(range)?;
        let mut diff_list = vec![Diff::RangeClearAll {
            sheet,
            row: range.row,
            column: range.column,
            width: range.width,
            height: range.height,
            old_value,
            old_style,
        }];
        diff_list.extend(link_diffs);

        self.push_diff_list(diff_list);
        self.evaluate_if_not_paused();
        Ok(())
    }

    /// Deletes the content in cells, but keeps the style
    ///
    /// See also:
    /// * [Model::range_clear_contents]
    pub fn range_clear_contents(&mut self, range: &Area) -> Result<(), String> {
        let sheet = range.sheet;
        // TODO: full rows/columns
        let mut old_value = Vec::new();
        for row in range.row..range.row + range.height {
            let mut data_row = Vec::new();
            for column in range.column..range.column + range.width {
                let old_value = self
                    .model
                    .workbook
                    .worksheet(sheet)?
                    .cell(row, column)
                    .cloned();
                data_row.push(old_value);
            }
            old_value.push(data_row);
        }
        // Clearing the cells also removes their links: capture them for undo
        let link_diffs = self.range_link_diffs(range)?;
        self.model.range_clear_contents(range)?;
        let mut diff_list = vec![Diff::RangeClearContents {
            sheet,
            row: range.row,
            column: range.column,
            width: range.width,
            height: range.height,
            old_value,
        }];
        diff_list.extend(link_diffs);
        self.push_diff_list(diff_list);
        self.evaluate_if_not_paused();
        Ok(())
    }

    /// Returns the diffs that remove the links of the cells in `range`, so that
    /// undoing a clear operation restores them.
    pub(super) fn range_link_diffs(&self, range: &Area) -> Result<Vec<Diff>, String> {
        let mut diffs = Vec::new();
        for (&(row, column), link) in &self.model.workbook.worksheet(range.sheet)?.links {
            if row >= range.row
                && row < range.row + range.height
                && column >= range.column
                && column < range.column + range.width
            {
                diffs.push(Diff::SetCellLink {
                    sheet: range.sheet,
                    row,
                    column,
                    old_value: Box::new(Some(link.clone())),
                    new_value: Box::new(None),
                });
            }
        }
        Ok(diffs)
    }

    fn clear_column_formatting(
        &mut self,
        sheet: u32,
        column: i32,
        diff_list: &mut Vec<Diff>,
    ) -> Result<(), String> {
        let old_value = self.model.get_column_style(sheet, column)?;
        self.model.delete_column_style(sheet, column)?;
        diff_list.push(Diff::DeleteColumnStyle {
            sheet,
            column,
            old_value: Box::new(old_value),
        });

        let data_rows: Vec<i32> = self.model.workbook.worksheet(sheet)?.sheet_data.rows();
        let styled_rows = &self.model.workbook.worksheet(sheet)?.rows.clone();

        // Delete the formatting in all non empty cells
        for row in data_rows {
            if let Some(old_style) = self.model.get_cell_style_or_none(sheet, row, column)? {
                // We can always assume that style with style_index 0 exists and it is the default
                self.model
                    .workbook
                    .worksheet_mut(sheet)?
                    .set_cell_style(row, column, 0)?;
                diff_list.push(Diff::CellClearFormatting {
                    sheet,
                    row,
                    column,
                    old_style: Box::new(Some(old_style)),
                });
            } else {
                let old_style = self.model.get_style_for_cell(sheet, row, column)?;
                if old_style != Style::default() {
                    self.model
                        .workbook
                        .worksheet_mut(sheet)?
                        .set_cell_style(row, column, 0)?;
                    diff_list.push(Diff::CellClearFormatting {
                        sheet,
                        row,
                        column,
                        old_style: Box::new(None),
                    });
                }
            }
        }
        // Delete the formatting in all cells with a row style
        for row in styled_rows {
            if let Some(old_style) = self.model.get_cell_style_or_none(sheet, row.r, column)? {
                // We can always assume that style with style_index 0 exists and it is the default
                self.model
                    .workbook
                    .worksheet_mut(sheet)?
                    .set_cell_style(row.r, column, 0)?;
                diff_list.push(Diff::CellClearFormatting {
                    sheet,
                    row: row.r,
                    column,
                    old_style: Box::new(Some(old_style)),
                });
            } else {
                let old_style = self.model.get_style_for_cell(sheet, row.r, column)?;
                if old_style != Style::default() {
                    self.model
                        .workbook
                        .worksheet_mut(sheet)?
                        .set_cell_style(row.r, column, 0)?;
                    diff_list.push(Diff::CellClearFormatting {
                        sheet,
                        row: row.r,
                        column,
                        old_style: Box::new(None),
                    });
                }
            }
        }
        Ok(())
    }

    fn clear_row_formatting(
        &mut self,
        sheet: u32,
        row: i32,
        diff_list: &mut Vec<Diff>,
    ) -> Result<(), String> {
        let old_value = self.model.get_row_style(sheet, row)?;
        self.model.delete_row_style(sheet, row)?;
        diff_list.push(Diff::DeleteRowStyle {
            sheet,
            row,
            old_value: Box::new(old_value),
        });

        // Delete the formatting in all non empty cells
        let columns: Vec<i32> = self
            .model
            .workbook
            .worksheet(sheet)?
            .sheet_data
            .columns_in_row(row);
        for column in columns {
            if let Some(old_style) = self.model.get_cell_style_or_none(sheet, row, column)? {
                // We can always assume that style with style_index 0 exists and it is the default
                self.model
                    .workbook
                    .worksheet_mut(sheet)?
                    .set_cell_style(row, column, 0)?;
                diff_list.push(Diff::CellClearFormatting {
                    sheet,
                    row,
                    column,
                    old_style: Box::new(Some(old_style)),
                });
            } else {
                let old_style = self.model.get_style_for_cell(sheet, row, column)?;
                if old_style != Style::default() {
                    self.model
                        .workbook
                        .worksheet_mut(sheet)?
                        .set_cell_style(row, column, 0)?;
                    diff_list.push(Diff::CellClearFormatting {
                        sheet,
                        row,
                        column,
                        old_style: Box::new(None),
                    });
                }
            }
        }
        Ok(())
    }

    /// Removes cells styles and formatting, but keeps the content
    ///
    /// See also:
    /// * [UserModel::range_clear_all]
    /// * [UserModel::range_clear_contents]
    pub fn range_clear_formatting(&mut self, range: &Area) -> Result<(), String> {
        let sheet = range.sheet;
        let mut diff_list = Vec::new();
        if range.row == 1 && range.height == LAST_ROW {
            for column in range.column..range.column + range.width {
                self.clear_column_formatting(sheet, column, &mut diff_list)?;
            }
            self.push_diff_list(diff_list);
            return Ok(());
        }
        if range.column == 1 && range.width == LAST_COLUMN {
            for row in range.row..range.row + range.height {
                self.clear_row_formatting(sheet, row, &mut diff_list)?;
            }
            self.push_diff_list(diff_list);
            return Ok(());
        }
        for row in range.row..range.row + range.height {
            for column in range.column..range.column + range.width {
                if let Some(old_style) = self.model.get_cell_style_or_none(sheet, row, column)? {
                    // We can always assume that style with style_index 0 exists and it is the default
                    self.model
                        .workbook
                        .worksheet_mut(sheet)?
                        .set_cell_style(row, column, 0)?;
                    diff_list.push(Diff::CellClearFormatting {
                        sheet,
                        row,
                        column,
                        old_style: Box::new(Some(old_style)),
                    });
                } else {
                    let old_style = self.model.get_style_for_cell(sheet, row, column)?;
                    if old_style != Style::default() {
                        self.model
                            .workbook
                            .worksheet_mut(sheet)?
                            .set_cell_style(row, column, 0)?;
                        diff_list.push(Diff::CellClearFormatting {
                            sheet,
                            row,
                            column,
                            old_style: Box::new(None),
                        });
                    }
                }
            }
        }
        self.push_diff_list(diff_list);
        Ok(())
    }

    /// Inserts `row_count` blank rows starting at `row` (both 0-based).
    ///
    /// Parameters
    /// * `sheet` – worksheet index.
    /// * `row` – first row to insert.
    /// * `row_count` – number of rows (> 0).
    ///
    /// History: the method pushes `row_count` `Diff::InsertRow`
    /// items **all using the same `row` index**.  Replaying those diffs (undo / redo)
    /// is therefore immune to the row-shifts that happen after each individual
    /// insertion.
    ///
    /// See also [`Model::insert_rows`].
    pub fn insert_rows(&mut self, sheet: u32, row: i32, row_count: i32) -> Result<(), String> {
        let old_merged_cells = self.model.get_merged_cells(sheet)?.to_vec();
        self.model.insert_rows(sheet, row, row_count)?;

        let mut diff_list = self.merged_cells_snapshot_diffs(sheet, old_merged_cells)?;
        diff_list.push(Diff::InsertRows {
            sheet,
            row,
            count: row_count,
        });
        self.push_diff_list(diff_list);
        self.evaluate_if_not_paused();
        Ok(())
    }

    /// Inserts `column_count` blank columns starting at `column` (0-based).
    ///
    /// Parameters
    /// * `sheet` – worksheet index.
    /// * `column` – first column to insert.
    /// * `column_count` – number of columns (> 0).
    ///
    /// History: pushes one `Diff::InsertColumn`
    /// per inserted column, all with the same `column` value, preventing index
    /// drift when the diffs are reapplied.
    ///
    /// See also [`Model::insert_columns`].
    pub fn insert_columns(
        &mut self,
        sheet: u32,
        column: i32,
        column_count: i32,
    ) -> Result<(), String> {
        let old_merged_cells = self.model.get_merged_cells(sheet)?.to_vec();
        self.model.insert_columns(sheet, column, column_count)?;

        let mut diff_list = self.merged_cells_snapshot_diffs(sheet, old_merged_cells)?;
        diff_list.push(Diff::InsertColumns {
            sheet,
            column,
            count: column_count,
        });
        self.push_diff_list(diff_list);
        self.evaluate_if_not_paused();
        Ok(())
    }

    /// Deletes `row_count` rows starting at `row`.
    ///
    /// History: a `Diff::DeleteRow` is created for
    /// each row, ordered **bottom → top**.  Undo therefore recreates rows from
    /// top → bottom and redo removes them bottom → top, avoiding index drift.
    ///
    /// See also [`Model::delete_rows`].
    pub fn delete_rows(&mut self, sheet: u32, row: i32, row_count: i32) -> Result<(), String> {
        let worksheet = self.model.workbook.worksheet(sheet)?;
        let mut old_data = Vec::new();
        // Collect data for all rows to be deleted
        for r in row..row + row_count {
            let mut row_data = None;
            for rd in &worksheet.rows {
                if rd.r == r {
                    row_data = Some(rd.clone());
                    break;
                }
            }
            // SpillCells are transient; save their style as EmptyCell so undo can
            // restore the style index, letting evaluate() recreate the SpillCell correctly.
            let data = worksheet
                .sheet_data
                .cells_in_row(r)
                .into_iter()
                .map(|(k, v)| {
                    let cell = if let Cell::SpillCell { s, .. } = v {
                        Cell::EmptyCell { s: *s }
                    } else {
                        v.clone()
                    };
                    (k, cell)
                })
                .collect();
            old_data.push(RowData {
                row: row_data,
                data,
            });
        }

        // The links of the deleted rows cannot be restored by re-inserting the
        // rows: capture them for undo. Links below the deleted rows just shift
        // with their cells, [`Model::delete_rows`] takes care of them.
        let link_diffs = self.range_link_diffs(&Area {
            sheet,
            row,
            column: 1,
            width: LAST_COLUMN,
            height: row_count,
        })?;

        let old_merged_cells = self.model.get_merged_cells(sheet)?.to_vec();
        self.model.delete_rows(sheet, row, row_count)?;

        let mut diff_list = self.merged_cells_snapshot_diffs(sheet, old_merged_cells)?;
        diff_list.extend(link_diffs);
        diff_list.push(Diff::DeleteRows {
            sheet,
            row,
            count: row_count,
            old_data,
        });
        self.push_diff_list(diff_list);
        self.evaluate_if_not_paused();
        Ok(())
    }

    /// Deletes `column_count` columns starting at `column`.
    ///
    /// History: pushes one `Diff::DeleteColumn`
    /// per column, **right → left**, so replaying the list is always safe with
    /// respect to index shifts.
    ///
    /// See also [`Model::delete_columns`].
    pub fn delete_columns(
        &mut self,
        sheet: u32,
        column: i32,
        column_count: i32,
    ) -> Result<(), String> {
        let worksheet = self.model.workbook.worksheet(sheet)?;
        let mut old_data = Vec::new();
        // Collect data for all columns to be deleted
        for c in column..column + column_count {
            let mut column_data = None;
            for col in &worksheet.cols {
                if c >= col.min && c <= col.max {
                    column_data = Some(Col {
                        min: c,
                        max: c,
                        width: col.width,
                        custom_width: col.custom_width,
                        style: col.style,
                        hidden: col.hidden,
                    });
                    break;
                }
            }

            // SpillCells are transient; save their style as EmptyCell so undo can
            // restore the style index, letting evaluate() recreate the SpillCell correctly.
            let mut data = HashMap::new();
            for row_idx in worksheet.sheet_data.rows() {
                if let Some(cell) = worksheet.cell(row_idx, c) {
                    let saved = if let Cell::SpillCell { s, .. } = cell {
                        Cell::EmptyCell { s: *s }
                    } else {
                        cell.clone()
                    };
                    data.insert(row_idx, saved);
                }
            }

            old_data.push(ColumnData {
                column: column_data,
                data,
            });
        }

        // The links of the deleted columns cannot be restored by re-inserting
        // the columns: capture them for undo. Links to the right of the deleted
        // columns just shift with their cells, [`Model::delete_columns`] takes
        // care of them.
        let link_diffs = self.range_link_diffs(&Area {
            sheet,
            row: 1,
            column,
            width: column_count,
            height: LAST_ROW,
        })?;

        let old_merged_cells = self.model.get_merged_cells(sheet)?.to_vec();
        self.model.delete_columns(sheet, column, column_count)?;

        let mut diff_list = self.merged_cells_snapshot_diffs(sheet, old_merged_cells)?;
        diff_list.extend(link_diffs);
        diff_list.push(Diff::DeleteColumns {
            sheet,
            column,
            count: column_count,
            old_data,
        });
        self.push_diff_list(diff_list);
        self.evaluate_if_not_paused();
        Ok(())
    }

    /// Moves a column horizontally and adjusts formulas
    pub fn move_columns_action(
        &mut self,
        sheet: u32,
        column: i32,
        column_count: i32,
        delta: i32,
    ) -> Result<(), String> {
        if delta == 0 || column_count <= 0 {
            return Ok(());
        }
        // Adjust delta to skip hidden columns in the landing zone
        let mut new_delta = delta;
        let worksheet = self.model.workbook.worksheet(sheet)?;
        if delta > 0 {
            for col in column + column_count..=column + column_count + delta {
                if worksheet.is_column_hidden(col)? {
                    new_delta += 1;
                }
            }
        } else {
            for col in column + delta..column {
                if worksheet.is_column_hidden(col)? {
                    new_delta -= 1;
                }
            }
        }

        let old_merged_cells = self.model.get_merged_cells(sheet)?.to_vec();
        self.model
            .move_columns_action(sheet, column, column_count, new_delta)?;

        let mut diff_list = self.merged_cells_snapshot_diffs(sheet, old_merged_cells)?;
        diff_list.push(Diff::MoveColumns {
            sheet,
            column,
            column_count,
            delta: new_delta,
        });
        self.push_diff_list(diff_list);
        self.evaluate_if_not_paused();
        Ok(())
    }

    /// Moves a group of rows vertically and adjusts formulas
    pub fn move_rows_action(
        &mut self,
        sheet: u32,
        row: i32,
        row_count: i32,
        delta: i32,
    ) -> Result<(), String> {
        if delta == 0 || row_count <= 0 {
            return Ok(());
        }
        let mut new_delta = delta;
        let worksheet = self.model.workbook.worksheet(sheet)?;
        if delta > 0 {
            for r in row + row_count..=row + row_count + delta {
                if worksheet.is_row_hidden(r)? {
                    new_delta += 1;
                }
            }
        } else {
            for r in row + delta..row {
                if worksheet.is_row_hidden(r)? {
                    new_delta -= 1;
                }
            }
        }

        let old_merged_cells = self.model.get_merged_cells(sheet)?.to_vec();
        self.model
            .move_rows_action(sheet, row, row_count, new_delta)?;

        let mut diff_list = self.merged_cells_snapshot_diffs(sheet, old_merged_cells)?;
        diff_list.push(Diff::MoveRows {
            sheet,
            row,
            row_count,
            delta: new_delta,
        });
        self.push_diff_list(diff_list);
        self.evaluate_if_not_paused();
        Ok(())
    }

    /// Sets the width of a group of columns in a single diff list
    ///
    /// See also:
    /// * [Model::set_column_width]
    pub fn set_columns_width(
        &mut self,
        sheet: u32,
        column_start: i32,
        column_end: i32,
        width: f64,
    ) -> Result<(), String> {
        let mut diff_list = Vec::new();
        for column in column_start..=column_end {
            let old_value = self.model.get_column_width(sheet, column)?;
            diff_list.push(Diff::SetColumnWidth {
                sheet,
                column,
                new_value: width,
                old_value,
            });
            self.model.set_column_width(sheet, column, width)?;
        }
        self.push_diff_list(diff_list);
        Ok(())
    }

    /// Sets the hidden state of a range of columns in a single diff list
    ////
    /// See also:
    /// * [Model::set_column_hidden]
    pub fn set_columns_hidden(
        &mut self,
        sheet: u32,
        column_start: i32,
        column_end: i32,
        hidden: bool,
    ) -> Result<(), String> {
        let mut diff_list = Vec::new();
        for column in column_start..=column_end {
            let old_value = self
                .model
                .workbook
                .worksheet(sheet)?
                .is_column_hidden(column)?;
            diff_list.push(Diff::SetColumnHidden {
                sheet,
                column,
                new_value: hidden,
                old_value,
            });
            self.model.set_column_hidden(sheet, column, hidden)?;
        }
        // If we are hiding columns we might need to adjust the selected column
        if hidden {
            if let Some(view) = self.model.workbook.views.get_mut(&self.model.view_id) {
                if view.sheet == sheet {
                    // We select the next visible column
                    let mut column = column_end + 1;
                    while self
                        .model
                        .workbook
                        .worksheet(sheet)?
                        .is_column_hidden(column)?
                    {
                        column += 1;
                        if column > LAST_COLUMN {
                            break;
                        }
                    }
                    if column > LAST_COLUMN {
                        // We select the previous visible column
                        column = column_start - 1;
                        while self
                            .model
                            .workbook
                            .worksheet(sheet)?
                            .is_column_hidden(column)?
                        {
                            column -= 1;
                            if column <= 0 {
                                // We can't find a visible column
                                column = 1;
                                break;
                            }
                        }
                    }
                    self.set_selected_cell(1, column)?;
                    self.set_selected_range(1, column, LAST_ROW, column)?;
                }
            };
        }
        self.push_diff_list(diff_list);
        Ok(())
    }

    /// Sets the hidden state of a range of rows in a single diff list
    ///// See also:
    /// * [Model::set_row_hidden]
    pub fn set_rows_hidden(
        &mut self,
        sheet: u32,
        row_start: i32,
        row_end: i32,
        hidden: bool,
    ) -> Result<(), String> {
        let mut diff_list = Vec::new();
        for row in row_start..=row_end {
            let old_value = self.model.workbook.worksheet(sheet)?.is_row_hidden(row)?;
            diff_list.push(Diff::SetRowHidden {
                sheet,
                row,
                new_value: hidden,
                old_value,
            });
            self.model.set_row_hidden(sheet, row, hidden)?;
        }
        // Select the next visible row if needed
        if hidden {
            if let Some(view) = self.model.workbook.views.get_mut(&self.model.view_id) {
                if view.sheet == sheet {
                    // We select the next visible row
                    let mut row = row_end + 1;
                    while self.model.workbook.worksheet(sheet)?.is_row_hidden(row)? {
                        row += 1;
                        if row > LAST_ROW {
                            break;
                        }
                    }
                    if row > LAST_ROW {
                        // We select the previous visible row
                        row = row_start - 1;
                        while self.model.workbook.worksheet(sheet)?.is_row_hidden(row)? {
                            row -= 1;
                            if row <= 0 {
                                // We can't find a visible row
                                row = 1;
                                break;
                            }
                        }
                    }
                    self.set_selected_cell(row, 1)?;
                    self.set_selected_range(row, 1, row, LAST_COLUMN)?;
                }
            };
        }
        self.push_diff_list(diff_list);
        Ok(())
    }

    /// Sets the height of a range of rows in a single diff list
    ///
    /// See also:
    /// * [Model::set_row_height]
    pub fn set_rows_height(
        &mut self,
        sheet: u32,
        row_start: i32,
        row_end: i32,
        height: f64,
    ) -> Result<(), String> {
        let mut diff_list = Vec::new();
        for row in row_start..=row_end {
            let old_value = self.model.get_row_height(sheet, row)?;
            diff_list.push(Diff::SetRowHeight {
                sheet,
                row,
                new_value: height,
                old_value,
            });
            self.model.set_row_height(sheet, row, height)?;
        }
        self.push_diff_list(diff_list);
        Ok(())
    }

    /// Gets the height of a row
    ///
    /// See also:
    /// * [Model::get_row_height]
    #[inline]
    pub fn get_row_height(&self, sheet: u32, row: i32) -> Result<f64, String> {
        self.model.get_row_height(sheet, row)
    }

    /// Gets the width of a column
    ///
    /// See also:
    /// * [Model::get_column_width]
    #[inline]
    pub fn get_column_width(&self, sheet: u32, column: i32) -> Result<f64, String> {
        self.model.get_column_width(sheet, column)
    }

    /// Returns the number of frozen rows in the sheet
    ///
    /// See also:
    /// * [Model::get_frozen_rows_count()]
    #[inline]
    pub fn get_frozen_rows_count(&self, sheet: u32) -> Result<i32, String> {
        self.model.get_frozen_rows_count(sheet)
    }

    /// Returns the number of frozen columns in the sheet
    ///
    /// See also:
    /// * [Model::get_frozen_columns_count()]
    #[inline]
    pub fn get_frozen_columns_count(&self, sheet: u32) -> Result<i32, String> {
        self.model.get_frozen_columns_count(sheet)
    }

    /// Sets the number of frozen rows in sheet
    ///
    /// See also:
    /// * [Model::set_frozen_rows()]
    pub fn set_frozen_rows_count(&mut self, sheet: u32, frozen_rows: i32) -> Result<(), String> {
        let old_value = self.model.get_frozen_rows_count(sheet)?;
        self.push_diff_list(vec![Diff::SetFrozenRowsCount {
            sheet,
            new_value: frozen_rows,
            old_value,
        }]);
        self.model.set_frozen_rows(sheet, frozen_rows)
    }

    /// Sets the number of frozen columns in sheet
    ///
    /// See also:
    /// * [Model::set_frozen_columns()]
    pub fn set_frozen_columns_count(
        &mut self,
        sheet: u32,
        frozen_columns: i32,
    ) -> Result<(), String> {
        let old_value = self.model.get_frozen_columns_count(sheet)?;
        self.push_diff_list(vec![Diff::SetFrozenColumnsCount {
            sheet,
            new_value: frozen_columns,
            old_value,
        }]);
        self.model.set_frozen_columns(sheet, frozen_columns)
    }

    /// Paste `styles` in the selected area
    pub fn on_paste_styles(&mut self, styles: &[Vec<Style>]) -> Result<(), String> {
        let styles_height = styles.len() as i32;
        let styles_width = styles[0].len() as i32;
        let sheet = if let Some(view) = self.model.workbook.views.get(&self.model.view_id) {
            view.sheet
        } else {
            return Ok(());
        };
        let range = if let Ok(worksheet) = self.model.workbook.worksheet(sheet) {
            if let Some(view) = worksheet.views.get(&self.model.view_id) {
                view.range
            } else {
                return Ok(());
            }
        } else {
            return Ok(());
        };

        // If the pasted area is smaller than the selected area we increase it
        let [row_start, column_start, row_end, column_end] = range;
        let last_row = row_end.max(row_start + styles_height - 1);
        let last_column = column_end.max(column_start + styles_width - 1);

        let mut diff_list = Vec::new();
        for row in row_start..=last_row {
            for column in column_start..=last_column {
                let row_index = ((row - row_start) % styles_height) as usize;
                let column_index = ((column - column_start) % styles_width) as usize;
                let style = &styles[row_index][column_index];
                let old_value = self.model.get_cell_style_or_none(sheet, row, column)?;
                self.model.set_cell_style(sheet, row, column, style)?;
                diff_list.push(Diff::SetCellStyle {
                    sheet,
                    row,
                    column,
                    old_value: Box::new(old_value),
                    new_value: Box::new(style.clone()),
                });
            }
        }
        self.push_diff_list(diff_list);

        // select the pasted range
        if let Ok(worksheet) = self.model.workbook.worksheet_mut(sheet) {
            if let Some(view) = worksheet.views.get_mut(&self.model.view_id) {
                view.range = [row_start, column_start, last_row, last_column];
                view.focus_row = last_row;
                view.focus_column = last_column;
            }
        }
        Ok(())
    }

    // Updates the style of a cell, adding the new style to the diff list
    fn update_single_cell_style(
        &mut self,
        sheet: u32,
        row: i32,
        column: i32,
        style_path: &str,
        value: &str,
        diff_list: &mut Vec<Diff>,
    ) -> Result<(), String> {
        // This is the value in the cell itself
        let old_value = self.model.get_cell_style_or_none(sheet, row, column)?;

        // This takes into account row or column styles. We use the base style (no CF overlay)
        // because we are writing back a persistent style, not a transient CF result.
        let old_style = self.model.get_style_for_cell(sheet, row, column)?;
        let new_style = update_style(&old_style, style_path, value)?;
        self.model.set_cell_style(sheet, row, column, &new_style)?;
        diff_list.push(Diff::SetCellStyle {
            sheet,
            row,
            column,
            old_value: Box::new(old_value),
            new_value: Box::new(new_style),
        });
        Ok(())
    }

    /// Updates the range with a cell style.
    /// See also:
    /// * [Model::set_cell_style]
    pub fn update_range_style(
        &mut self,
        range: &Area,
        style_path: &str,
        value: &str,
    ) -> Result<(), String> {
        let sheet = range.sheet;
        let mut diff_list = Vec::new();
        if range.row == 1 && range.height == LAST_ROW {
            // Full columns
            let styled_rows = &self.model.workbook.worksheet(sheet)?.rows.clone();
            // We need all the rows in the column to update the style
            // NB: This is too much, this is all the rows that have values
            let data_rows: Vec<i32> = self.model.workbook.worksheet(sheet)?.sheet_data.rows();
            for column in range.column..range.column + range.width {
                // we set the style of the full column
                let old_style = self.model.get_column_style(sheet, column)?;
                let style = match old_style.as_ref() {
                    Some(s) => s,
                    None => &Style::default(),
                };
                let style = update_style(style, style_path, value)?;
                self.model.set_column_style(sheet, column, &style)?;
                diff_list.push(Diff::SetColumnStyle {
                    sheet,
                    column,
                    old_value: Box::new(old_style),
                    new_value: Box::new(style),
                });

                // We need to update the styles in all cells that have a row style
                for row_s in styled_rows.iter() {
                    let row = row_s.r;
                    self.update_single_cell_style(
                        sheet,
                        row,
                        column,
                        style_path,
                        value,
                        &mut diff_list,
                    )?;
                }

                // Update style in all cells that have different styles
                // FIXME: We need a better way to transverse of cells in a column
                for &row in &data_rows {
                    if self
                        .model
                        .workbook
                        .worksheet(sheet)?
                        .cell(row, column)
                        .is_some()
                    {
                        // If the cell has non empty content it will always have some style
                        self.update_single_cell_style(
                            sheet,
                            row,
                            column,
                            style_path,
                            value,
                            &mut diff_list,
                        )?;
                    }
                }
            }
        } else if range.column == 1 && range.width == LAST_COLUMN {
            // Full rows
            let styled_columns = &self.model.workbook.worksheet(sheet)?.cols.clone();
            for row in range.row..range.row + range.height {
                // Now update style in all cells that are not empty
                let columns: Vec<i32> = self
                    .model
                    .workbook
                    .worksheet(sheet)?
                    .sheet_data
                    .columns_in_row(row);
                for column in columns {
                    self.update_single_cell_style(
                        sheet,
                        row,
                        column,
                        style_path,
                        value,
                        &mut diff_list,
                    )?;
                }

                // We need to go through all the cells that have a column style and merge the styles
                for col in styled_columns.iter() {
                    for column in col.min..col.max + 1 {
                        self.update_single_cell_style(
                            sheet,
                            row,
                            column,
                            style_path,
                            value,
                            &mut diff_list,
                        )?;
                    }
                }

                // Finally update the style of the row
                let old_style = self.model.get_row_style(sheet, row)?;
                let style = match old_style.as_ref() {
                    Some(s) => s,
                    None => &Style::default(),
                };
                let style = update_style(style, style_path, value)?;
                self.model.set_row_style(sheet, row, &style)?;
                diff_list.push(Diff::SetRowStyle {
                    sheet,
                    row,
                    old_value: Box::new(old_style),
                    new_value: Box::new(style),
                });
            }
        } else {
            for row in range.row..range.row + range.height {
                for column in range.column..range.column + range.width {
                    self.update_single_cell_style(
                        sheet,
                        row,
                        column,
                        style_path,
                        value,
                        &mut diff_list,
                    )?;
                }
            }
        }
        self.push_diff_list(diff_list);
        Ok(())
    }

    /// Returns the style for a cell
    ///
    /// Cells share a border, so the left border of B1 is the right border of A1
    /// In the object structure the borders of the cells might be difference,
    /// We always pick the "heaviest" border.
    ///
    /// See also:
    /// * [Model::get_style_for_cell]
    pub fn get_cell_style(&self, sheet: u32, row: i32, column: i32) -> Result<Style, String> {
        let mut style = self.model.get_style_for_cell(sheet, row, column)?;

        // We need to check if the adjacent cells have a "heavier" border
        let border_top = if row > 1 {
            self.model
                .get_style_for_cell(sheet, row - 1, column)?
                .border
                .bottom
        } else {
            None
        };

        let border_right = if column < LAST_COLUMN {
            self.model
                .get_style_for_cell(sheet, row, column + 1)?
                .border
                .left
        } else {
            None
        };

        let border_bottom = if row < LAST_ROW {
            self.model
                .get_style_for_cell(sheet, row + 1, column)?
                .border
                .top
        } else {
            None
        };

        let border_left = if column > 1 {
            self.model
                .get_style_for_cell(sheet, row, column - 1)?
                .border
                .right
        } else {
            None
        };

        if is_max_border(style.border.top.as_ref(), border_top.as_ref()) {
            style.border.top = border_top;
        }

        if is_max_border(style.border.right.as_ref(), border_right.as_ref()) {
            style.border.right = border_right;
        }

        if is_max_border(style.border.bottom.as_ref(), border_bottom.as_ref()) {
            style.border.bottom = border_bottom;
        }

        if is_max_border(style.border.left.as_ref(), border_left.as_ref()) {
            style.border.left = border_left;
        }

        Ok(style)
    }

    /// Returns the full extended style for a cell, including any conditional formatting overlay.
    ///
    /// Identical border-adjacency logic as [`Self::get_cell_style`] but applied to the CF-overlaid style.
    /// Use this when you need icon-set or data-bar decorations in addition to the base style.
    pub fn get_extended_cell_style(
        &self,
        sheet: u32,
        row: i32,
        column: i32,
    ) -> Result<ExtendedStyle, String> {
        let mut extended = self.model.get_extended_style_for_cell(sheet, row, column)?;

        let border_top = if row > 1 {
            self.model
                .get_style_for_cell(sheet, row - 1, column)?
                .border
                .bottom
        } else {
            None
        };

        let border_right = if column < LAST_COLUMN {
            self.model
                .get_style_for_cell(sheet, row, column + 1)?
                .border
                .left
        } else {
            None
        };

        let border_bottom = if row < LAST_ROW {
            self.model
                .get_style_for_cell(sheet, row + 1, column)?
                .border
                .top
        } else {
            None
        };

        let border_left = if column > 1 {
            self.model
                .get_style_for_cell(sheet, row, column - 1)?
                .border
                .right
        } else {
            None
        };

        if is_max_border(extended.style.border.top.as_ref(), border_top.as_ref()) {
            extended.style.border.top = border_top;
        }

        if is_max_border(extended.style.border.right.as_ref(), border_right.as_ref()) {
            extended.style.border.right = border_right;
        }

        if is_max_border(
            extended.style.border.bottom.as_ref(),
            border_bottom.as_ref(),
        ) {
            extended.style.border.bottom = border_bottom;
        }

        if is_max_border(extended.style.border.left.as_ref(), border_left.as_ref()) {
            extended.style.border.left = border_left;
        }

        Ok(extended)
    }

    /// Returns information about the sheets
    ///
    /// See also:
    /// * [Model::get_worksheets_properties]
    #[inline]
    pub fn get_worksheets_properties(&self) -> Vec<SheetProperties> {
        self.model.get_worksheets_properties()
    }

    /// Sets the workbook theme.
    pub fn set_theme(&mut self, theme: Theme) {
        let old_value = self.model.workbook.theme.clone();
        let new_value = theme.clone();
        self.model.set_theme(theme);
        self.push_diff_list(vec![Diff::SetTheme {
            old_value: Box::new(old_value),
            new_value: Box::new(new_value),
        }]);
    }

    /// Returns the current workbook theme.
    pub fn get_theme(&self) -> Theme {
        self.model.get_theme()
    }

    /// Resolves a `Color` value to a CSS hex string using the current workbook theme.
    /// Returns an empty string for `Color::None`.
    pub fn resolve_color(&self, color: &Color) -> String {
        color.to_rgb(&self.model.workbook.theme)
    }

    /// Set the gid lines in the worksheet to visible (`true`) or hidden (`false`)
    pub fn set_show_grid_lines(&mut self, sheet: u32, show_grid_lines: bool) -> Result<(), String> {
        let old_value = self.model.workbook.worksheet(sheet)?.show_grid_lines;
        self.model.set_show_grid_lines(sheet, show_grid_lines)?;

        self.push_diff_list(vec![Diff::SetShowGridLines {
            sheet,
            new_value: show_grid_lines,
            old_value,
        }]);
        Ok(())
    }

    /// Returns true in the grid lines for
    pub fn get_show_grid_lines(&self, sheet: u32) -> Result<bool, String> {
        Ok(self.model.workbook.worksheet(sheet)?.show_grid_lines)
    }

    /// Returns the largest column in the row less than a column whose cell has a non empty value.
    /// If there are none it returns `None`.
    /// This is useful when rendering a part of a worksheet to know which cells spill over
    pub fn get_last_non_empty_in_row_before_column(
        &self,
        sheet: u32,
        row: i32,
        column: i32,
    ) -> Result<Option<i32>, String> {
        let worksheet = self.model.workbook.worksheet(sheet)?;
        let mut last_column = None;
        // From left to right
        for (col, cell) in worksheet.sheet_data.cells_in_row(row) {
            if col < column {
                if matches!(cell, Cell::EmptyCell { .. }) {
                    continue;
                }
                last_column = Some(col);
            }
        }
        Ok(last_column)
    }

    /// Returns the smallest column in the row larger than "column" whose cell has a non empty value.
    /// If there are none it returns `None`.
    /// This is useful when rendering a part of a worksheet to know which cells spill over
    pub fn get_first_non_empty_in_row_after_column(
        &self,
        sheet: u32,
        row: i32,
        column: i32,
    ) -> Result<Option<i32>, String> {
        let worksheet = self.model.workbook.worksheet(sheet)?;
        // From left to right
        for (col, cell) in worksheet.sheet_data.cells_in_row(row) {
            if col > column {
                if matches!(cell, Cell::EmptyCell { .. }) {
                    continue;
                }
                return Ok(Some(col));
            }
        }
        Ok(None)
    }

    /// Returns the geometric structure of a cell
    pub fn get_cell_array_structure(
        &self,
        sheet: u32,
        row: i32,
        column: i32,
    ) -> Result<CellArrayStructure, String> {
        let cell = self
            .model
            .workbook
            .worksheet(sheet)?
            .cell(row, column)
            .cloned()
            .unwrap_or_default();
        match cell {
            Cell::EmptyCell { .. }
            | Cell::BooleanCell { .. }
            | Cell::NumberCell { .. }
            | Cell::ErrorCell { .. }
            | Cell::SharedString { .. }
            | Cell::CellFormula { .. } => Ok(CellArrayStructure::SingleCell),
            Cell::SpillCell { a, .. } => {
                let (m_row, m_column) = a;
                let m_cell = self
                    .model
                    .workbook
                    .worksheet(sheet)?
                    .cell(m_row, m_column)
                    .cloned()
                    .unwrap_or_default();
                let (width, height, is_dynamic) = match m_cell {
                    Cell::ArrayFormula {
                        r,
                        kind: ArrayKind::Dynamic,
                        ..
                    } => (r.0, r.1, true),
                    Cell::ArrayFormula {
                        r,
                        kind: ArrayKind::Cse,
                        ..
                    } => (r.0, r.1, false),
                    _ => return Err("Invalid structure".to_string()),
                };
                if is_dynamic {
                    Ok(CellArrayStructure::DynamicChild(
                        m_row, m_column, width, height,
                    ))
                } else {
                    Ok(CellArrayStructure::ArrayChild(
                        m_row, m_column, width, height,
                    ))
                }
            }
            Cell::ArrayFormula {
                r,
                kind: ArrayKind::Dynamic,
                ..
            } => Ok(CellArrayStructure::DynamicAnchor(r.0, r.1)),
            Cell::ArrayFormula {
                r,
                kind: ArrayKind::Cse,
                ..
            } => Ok(CellArrayStructure::ArrayAnchor(r.0, r.1)),
        }
    }

    /// Sets an array formula in the given range.
    pub fn set_user_array_formula(
        &mut self,
        sheet: u32,
        row: i32,
        column: i32,
        width: i32,
        height: i32,
        formula: &str,
    ) -> Result<(), String> {
        let ws = self.model.workbook.worksheet(sheet)?;
        let mut old_values = Vec::new();
        for r in row..row + height {
            let mut row_vals = Vec::new();
            for c in column..column + width {
                let cell = ws.cell(r, c).cloned();
                // SpillCells are transient — restored by re-evaluation, so store as None.
                let cell = if matches!(cell, Some(Cell::SpillCell { .. })) {
                    None
                } else {
                    cell
                };
                row_vals.push(cell);
            }
            old_values.push(row_vals);
        }
        self.model
            .set_user_array_formula(sheet, row, column, width, height, formula)?;
        self.push_diff_list(vec![Diff::SetArrayValue {
            sheet,
            row,
            column,
            width,
            height,
            new_value: formula.to_string(),
            old_values,
        }]);
        self.evaluate_if_not_paused();
        Ok(())
    }

    /// Returns the list of defined names
    pub fn get_defined_name_list(&self) -> Vec<(String, Option<u32>, String)> {
        self.model.get_defined_name_list()
    }

    /// Delete an existing defined name
    pub fn delete_defined_name(&mut self, name: &str, scope: Option<u32>) -> Result<(), String> {
        let old_value = self.model.get_defined_name_formula(name, scope)?;
        let diff_list = vec![Diff::DeleteDefinedName {
            name: name.to_string(),
            scope,
            old_value,
        }];
        self.push_diff_list(diff_list);
        self.model.delete_defined_name(name, scope)?;
        self.evaluate_if_not_paused();
        Ok(())
    }

    /// Create a new defined name
    pub fn new_defined_name(
        &mut self,
        name: &str,
        scope: Option<u32>,
        formula: &str,
    ) -> Result<(), String> {
        self.model.new_defined_name(name, scope, formula)?;
        // Diffs store the internal (English) formula so undo/redo replays
        // correctly regardless of the active language at replay time. A
        // just-created name is guaranteed to be retrievable, so propagate any
        // (unexpected) error rather than masking it with a localized formula.
        let value = self.model.get_defined_name_formula(name, scope)?;
        let diff_list = vec![Diff::CreateDefinedName {
            name: name.to_string(),
            scope,
            value,
        }];
        self.push_diff_list(diff_list);
        self.evaluate_if_not_paused();
        Ok(())
    }

    /// Updates a defined name
    pub fn update_defined_name(
        &mut self,
        name: &str,
        scope: Option<u32>,
        new_name: &str,
        new_scope: Option<u32>,
        new_formula: &str,
    ) -> Result<(), String> {
        // Both formulas in the diff are stored internally (in English) so
        // undo/redo replays correctly regardless of the active language.
        let old_formula = self
            .model
            .get_defined_name_formula(name, scope)
            .map_err(|_| "General: Failed to get old name")?;
        self.model
            .update_defined_name(name, scope, new_name, new_scope, new_formula)?;
        // Read back the canonical (English) formula that was just stored so the
        // diff stays canonical; a successful update guarantees it is retrievable.
        let new_formula_internal = self.model.get_defined_name_formula(new_name, new_scope)?;
        let diff_list = vec![Diff::UpdateDefinedName {
            name: name.to_string(),
            scope,
            old_formula,
            new_name: new_name.to_string(),
            new_scope,
            new_formula: new_formula_internal,
        }];
        self.push_diff_list(diff_list);
        self.evaluate_if_not_paused();
        Ok(())
    }

    /// validates a new defined name
    pub fn is_valid_defined_name(
        &mut self,
        name: &str,
        scope: Option<u32>,
        formula: &str,
    ) -> Result<Option<u32>, String> {
        self.model.is_valid_defined_name(name, scope, formula)
    }

    /// Sets the timezone for the model
    pub fn set_timezone(&mut self, timezone: &str) -> Result<(), String> {
        let diff_list = vec![Diff::SetTimezone {
            old_value: self.get_timezone(),
            new_value: timezone.to_string(),
        }];
        self.push_diff_list(diff_list);
        self.model.set_timezone(timezone)
    }

    /// Sets the locale for the model
    pub fn set_locale(&mut self, locale: &str) -> Result<(), String> {
        let diff_list = vec![Diff::SetLocale {
            old_value: self.get_locale(),
            new_value: locale.to_string(),
        }];
        self.push_diff_list(diff_list);
        self.model.set_locale(locale)
    }

    /// Gets the timezone of the model
    pub fn get_timezone(&self) -> String {
        self.model.get_timezone()
    }

    /// Gets the locale of the model
    pub fn get_locale(&self) -> String {
        self.model.get_locale()
    }

    /// Get the language for the model
    pub fn get_language(&self) -> String {
        self.model.get_language()
    }

    /// Sets the language for the model
    pub fn set_language(&mut self, language: &str) -> Result<(), String> {
        self.model.set_language(language)
    }

    /// Gets the formatting settings for the model
    pub fn get_fmt_settings(&self) -> FmtSettings {
        self.model.get_fmt_settings()
    }

    // **** Private methods ****** //

    /// Returns a snapshot diff of the merged cells of the sheet when the
    /// current list differs from `old_merged_cells`, and nothing otherwise.
    ///
    /// Structural actions (insert, delete or move of rows and columns) displace
    /// merged ranges on their own when they are (re)played, but their undo
    /// cannot always reconstruct the original ranges (a fully deleted merge is
    /// gone, deleting rows above a merge and re-inserting them displaces it).
    /// The snapshot has `old_value == new_value` — a no-op when applied — and
    /// must go *before* the structural diff in the list, so that on undo
    /// (replayed in reverse) it runs last and restores the exact original list.
    pub(super) fn merged_cells_snapshot_diffs(
        &self,
        sheet: u32,
        old_merged_cells: Vec<MergedCell>,
    ) -> Result<Vec<Diff>, String> {
        if self.model.get_merged_cells(sheet)? != old_merged_cells.as_slice() {
            Ok(vec![Diff::SetMergedCells {
                sheet,
                old_value: old_merged_cells.clone(),
                new_value: old_merged_cells,
            }])
        } else {
            Ok(vec![])
        }
    }

    pub(crate) fn push_diff_list(&mut self, diff_list: DiffList) {
        self.send_queue.push(QueueDiffs {
            r#type: DiffType::Redo,
            list: diff_list.clone(),
        });
        self.history.push(diff_list);
    }

    pub(super) fn evaluate_if_not_paused(&mut self) {
        if !self.pause_evaluation {
            self.model.evaluate();
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::{
        types::{HorizontalAlignment, VerticalAlignment},
        user_model::common::{horizontal, selected_sheet_after_move, vertical},
    };

    #[test]
    fn test_selected_sheet_after_move() {
        // The moved sheet is followed to its destination.
        assert_eq!(selected_sheet_after_move(0, 0, 2), 2);
        assert_eq!(selected_sheet_after_move(3, 3, 0), 0);

        // A sheet between the source and destination shifts by one.
        // [A,B,C,D], select C (2), move A (0) -> 2 => [B,C,A,D], C is at 1.
        assert_eq!(selected_sheet_after_move(2, 0, 2), 1);
        // [A,B,C,D], select A (0), move C (2) -> 0 => [C,A,B,D], A is at 1.
        assert_eq!(selected_sheet_after_move(0, 2, 0), 1);

        // A sheet outside the moved span keeps its index.
        // [A,B,C,D], select D (3), move B (1) -> 2 => [A,C,B,D], D still at 3.
        assert_eq!(selected_sheet_after_move(3, 1, 2), 3);
    }

    #[test]
    fn test_vertical() {
        let all = vec![
            VerticalAlignment::Bottom,
            VerticalAlignment::Center,
            VerticalAlignment::Distributed,
            VerticalAlignment::Justify,
            VerticalAlignment::Top,
        ];
        for a in all {
            assert_eq!(vertical(&format!("{a}")), Ok(a));
        }
    }

    #[test]
    fn test_horizontal() {
        let all = vec![
            HorizontalAlignment::Center,
            HorizontalAlignment::CenterContinuous,
            HorizontalAlignment::Distributed,
            HorizontalAlignment::Fill,
            HorizontalAlignment::General,
            HorizontalAlignment::Justify,
            HorizontalAlignment::Left,
            HorizontalAlignment::Right,
        ];
        for a in all {
            assert_eq!(horizontal(&format!("{a}")), Ok(a));
        }
    }
}
