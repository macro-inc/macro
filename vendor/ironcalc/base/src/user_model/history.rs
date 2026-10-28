use std::collections::HashMap;

use bitcode::{Decode, Encode};

use crate::{
    cf_types::CfRule,
    types::{
        Cell, Col, Color, Link, MergedCell, Row, SheetState, Style, StyleIncludes, Theme, Worksheet,
    },
};

#[derive(Clone, Encode, Decode)]
pub(crate) struct RowData {
    pub(crate) row: Option<Row>,
    pub(crate) data: HashMap<i32, Cell>,
}

#[derive(Clone, Encode, Decode)]
pub(crate) struct ColumnData {
    pub(crate) column: Option<Col>,
    pub(crate) data: HashMap<i32, Cell>,
}

#[derive(Clone, Encode, Decode)]
pub(crate) enum Diff {
    // Cell diffs
    SetCellValue {
        sheet: u32,
        row: i32,
        column: i32,
        new_value: String,
        old_value: Box<Option<Cell>>,
    },
    SetArrayValue {
        sheet: u32,
        row: i32,
        column: i32,
        width: i32,
        height: i32,
        new_value: String,
        old_values: Vec<Vec<Option<Cell>>>,
    },
    RangeClearContents {
        sheet: u32,
        row: i32,
        column: i32,
        width: i32,
        height: i32,
        old_value: Vec<Vec<Option<Cell>>>,
    },
    RangeClearAll {
        sheet: u32,
        row: i32,
        column: i32,
        width: i32,
        height: i32,
        old_value: Vec<Vec<Option<Cell>>>,
        old_style: Vec<Vec<Style>>,
    },
    CellClearFormatting {
        sheet: u32,
        row: i32,
        column: i32,
        old_style: Box<Option<Style>>,
    },
    SetCellStyle {
        sheet: u32,
        row: i32,
        column: i32,
        old_value: Box<Option<Style>>,
        new_value: Box<Style>,
    },
    // Unlike `SetCellStyle`, applying a named style is recorded by name so that
    // redo re-links the cell to the style instead of copying its formatting.
    ApplyNamedStyle {
        sheet: u32,
        row: i32,
        column: i32,
        old_value: Box<Option<Style>>,
        name: String,
    },
    // Column and Row diffs
    SetColumnWidth {
        sheet: u32,
        column: i32,
        new_value: f64,
        old_value: f64,
    },
    SetColumnHidden {
        sheet: u32,
        column: i32,
        new_value: bool,
        old_value: bool,
    },
    SetRowHeight {
        sheet: u32,
        row: i32,
        new_value: f64,
        old_value: f64,
    },
    SetRowHidden {
        sheet: u32,
        row: i32,
        new_value: bool,
        old_value: bool,
    },
    SetColumnStyle {
        sheet: u32,
        column: i32,
        old_value: Box<Option<Style>>,
        new_value: Box<Style>,
    },
    SetRowStyle {
        sheet: u32,
        row: i32,
        old_value: Box<Option<Style>>,
        new_value: Box<Style>,
    },
    DeleteColumnStyle {
        sheet: u32,
        column: i32,
        old_value: Box<Option<Style>>,
    },
    DeleteRowStyle {
        sheet: u32,
        row: i32,
        old_value: Box<Option<Style>>,
    },
    InsertRows {
        sheet: u32,
        row: i32,
        count: i32,
    },
    DeleteRows {
        sheet: u32,
        row: i32,
        count: i32,
        old_data: Vec<RowData>,
    },
    InsertColumns {
        sheet: u32,
        column: i32,
        count: i32,
    },
    DeleteColumns {
        sheet: u32,
        column: i32,
        count: i32,
        old_data: Vec<ColumnData>,
    },
    DeleteSheet {
        sheet: u32,
        old_data: Box<Worksheet>,
    },
    SetFrozenRowsCount {
        sheet: u32,
        new_value: i32,
        old_value: i32,
    },
    SetFrozenColumnsCount {
        sheet: u32,
        new_value: i32,
        old_value: i32,
    },
    NewSheet {
        index: u32,
        name: String,
    },
    DuplicateSheet {
        /// Index of the sheet that was duplicated.
        source_index: u32,
        /// Index of the resulting copy (always `source_index + 1`).
        new_index: u32,
    },
    RenameSheet {
        index: u32,
        old_value: String,
        new_value: String,
    },
    MoveSheet {
        /// Index of the worksheet before the move.
        sheet_index: u32,
        /// Index the worksheet was moved to.
        new_index: u32,
    },
    SetSheetColor {
        index: u32,
        old_value: Color,
        new_value: Color,
    },
    SetSheetState {
        index: u32,
        old_value: SheetState,
        new_value: SheetState,
    },
    SetShowGridLines {
        sheet: u32,
        old_value: bool,
        new_value: bool,
    },
    SetTheme {
        old_value: Box<Theme>,
        new_value: Box<Theme>,
    },
    CreateDefinedName {
        name: String,
        scope: Option<u32>,
        value: String,
    },
    DeleteDefinedName {
        name: String,
        scope: Option<u32>,
        old_value: String,
    },
    UpdateDefinedName {
        name: String,
        scope: Option<u32>,
        old_formula: String,
        new_name: String,
        new_scope: Option<u32>,
        new_formula: String,
    },
    MoveColumns {
        sheet: u32,
        column: i32,
        column_count: i32,
        delta: i32,
    },
    MoveRows {
        sheet: u32,
        row: i32,
        row_count: i32,
        delta: i32,
    },
    SetLocale {
        old_value: String,
        new_value: String,
    },
    SetWorkbookName {
        old_value: String,
        new_value: String,
    },
    SetTimezone {
        old_value: String,
        new_value: String,
    },
    // Named style diffs
    CreateNamedStyle {
        name: String,
        style: Box<Style>,
        includes: StyleIncludes,
    },
    DeleteNamedStyle {
        name: String,
        old_xf_id: i32,
    },
    UpdateNamedStyle {
        name: String,
        new_name: String,
        old_style: Box<Style>,
        new_style: Box<Style>,
        old_includes: StyleIncludes,
        new_includes: StyleIncludes,
    },
    // Conditional formatting diffs
    AddConditionalFormatting {
        sheet: u32,
        range: String,
        rule: Box<CfRule>,
        priority: u32,
    },
    DeleteConditionalFormatting {
        sheet: u32,
        index: u32,
        old_range: String,
        old_rule: Box<CfRule>,
        old_priority: u32,
    },
    UpdateConditionalFormatting {
        sheet: u32,
        index: u32,
        old_range: String,
        old_rule: Box<CfRule>,
        old_priority: u32,
        new_range: String,
        new_rule: Box<CfRule>,
    },
    /// Sets (`new_value` is `Some`) or deletes (`new_value` is `None`) the link
    /// attached to a cell. `old_value` is the link previously in the cell if any.
    SetCellLink {
        sheet: u32,
        row: i32,
        column: i32,
        old_value: Box<Option<Link>>,
        new_value: Box<Option<Link>>,
    },
    /// Swaps the priorities of the two CF rules at `index_a` and `index_b`.
    /// `priority_a`/`priority_b` are their priorities *before* the swap.
    SwapConditionalFormattingPriority {
        sheet: u32,
        index_a: u32,
        index_b: u32,
        priority_a: u32,
        priority_b: u32,
    },
    /// Sets the full list of merged cells of a sheet: apply installs
    /// `new_value`, undo installs `old_value`. Structural actions (insert,
    /// delete or move of rows and columns) displace merged ranges on their own
    /// when they are replayed, but their undo cannot always reconstruct the
    /// original ranges; those actions push this diff with
    /// `old_value == new_value` (a no-op on apply) so that undo restores the
    /// exact previous list.
    SetMergedCells {
        sheet: u32,
        old_value: Vec<MergedCell>,
        new_value: Vec<MergedCell>,
    },
    // FIXME: we are missing SetViewDiffs
}

pub(crate) type DiffList = Vec<Diff>;

#[derive(Default)]
pub(crate) struct History {
    pub(crate) undo_stack: Vec<DiffList>,
    pub(crate) redo_stack: Vec<DiffList>,
}

impl History {
    pub fn push(&mut self, diff_list: DiffList) {
        self.undo_stack.push(diff_list);
        self.redo_stack = vec![];
    }

    pub fn undo(&mut self) -> Option<Vec<Diff>> {
        match self.undo_stack.pop() {
            Some(diff_list) => {
                self.redo_stack.push(diff_list.clone());
                Some(diff_list)
            }
            None => None,
        }
    }

    pub fn redo(&mut self) -> Option<Vec<Diff>> {
        match self.redo_stack.pop() {
            Some(diff_list) => {
                self.undo_stack.push(diff_list.clone());
                Some(diff_list)
            }
            None => None,
        }
    }
}

#[derive(Clone, Encode, Decode)]
pub enum DiffType {
    Undo,
    Redo,
}

#[derive(Clone, Encode, Decode)]
pub struct QueueDiffs {
    pub r#type: DiffType,
    pub list: DiffList,
}
