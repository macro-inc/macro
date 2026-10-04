use serde::Serialize;
use wasm_bindgen::{
    prelude::{wasm_bindgen, JsError},
    JsValue,
};

use ironcalc_base::{
    cf_types::CfRuleInput,
    colors,
    expressions::{
        lexer::util::get_tokens as tokenizer,
        types::Area,
        utils::{column_to_number, number_to_column, quote_name as quote_name_ic},
    },
    types::{CellType, Color, Link, Style, StyleIncludes},
    worksheet::NavigationDirection,
    BorderArea, ClipboardData, UserModel as BaseModel,
};

fn to_js_error(error: String) -> JsError {
    JsError::new(&error.to_string())
}

/// Return an array with a list of all the tokens from a formula
/// This is used by the UI to color them according to a theme.
#[wasm_bindgen(js_name = "getTokens", unchecked_return_type = "MarkedToken[]")]
pub fn get_tokens(formula: &str) -> Result<JsValue, JsError> {
    let tokens = tokenizer(formula);
    serde_wasm_bindgen::to_value(&tokens).map_err(JsError::from)
}

#[wasm_bindgen(js_name = "columnNameFromNumber")]
pub fn column_name_from_number(column: i32) -> Result<String, JsError> {
    match number_to_column(column) {
        Some(c) => Ok(c),
        None => Err(JsError::new("Invalid column number")),
    }
}

#[wasm_bindgen(js_name = "columnNumberFromName")]
pub fn column_number_from_name(column: &str) -> Result<i32, JsError> {
    match column_to_number(column) {
        Ok(c) => Ok(c),
        Err(_) => Err(JsError::new("Invalid column name")),
    }
}

#[wasm_bindgen(js_name = "quoteName")]
pub fn quote_name(name: &str) -> String {
    quote_name_ic(name)
}

/// Gets all timezones
#[wasm_bindgen(js_name = "getAllTimezones")]
pub fn get_all_timezones() -> Vec<String> {
    ironcalc_base::get_all_timezones()
}

/// Gets all supported locales
#[wasm_bindgen(js_name = "getSupportedLocales")]
pub fn get_supported_locales() -> Vec<String> {
    ironcalc_base::get_supported_locales()
}

/// Returns the list of builtin themes with their color slots.
#[wasm_bindgen(js_name = "getThemeList", unchecked_return_type = "IronCalcTheme[]")]
#[allow(clippy::unwrap_used)]
pub fn get_theme_list() -> JsValue {
    serde_wasm_bindgen::to_value(&ironcalc_base::themes::builtin_themes()).unwrap()
}

/// Tint algorithm
#[wasm_bindgen(js_name = "hexWithTintToRgb")]
pub fn hex_with_tint_to_rgb(hex: &str, tint: f64) -> String {
    colors::hex_with_tint_to_rgb(hex, tint)
}

#[derive(Serialize)]
struct DefinedName {
    name: String,
    scope: Option<u32>,
    formula: String,
}

#[derive(Serialize)]
struct FmtSettings {
    currency: String,
    currency_format: String,
    short_date: String,
    short_date_example: String,
    long_date: String,
    long_date_example: String,
    number_fmt: String,
    number_example: String,
}

impl From<ironcalc_base::FmtSettings> for FmtSettings {
    fn from(settings: ironcalc_base::FmtSettings) -> Self {
        FmtSettings {
            currency: settings.currency,
            currency_format: settings.currency_format,
            short_date: settings.short_date,
            short_date_example: settings.short_date_example,
            long_date: settings.long_date,
            long_date_example: settings.long_date_example,
            number_fmt: settings.number_fmt,
            number_example: settings.number_example,
        }
    }
}

fn leak_str(s: &str) -> &'static str {
    Box::leak(s.to_owned().into_boxed_str())
}

#[wasm_bindgen]
pub struct Model {
    model: BaseModel<'static>,
}

#[wasm_bindgen]
impl Model {
    #[wasm_bindgen(constructor)]
    pub fn new(
        name: &str,
        locale: &str,
        timezone: &str,
        language_id: &str,
    ) -> Result<Model, JsError> {
        let name = leak_str(name);
        let locale = leak_str(locale);
        let timezone = leak_str(timezone);
        let language_id = leak_str(language_id);
        let model =
            BaseModel::new_empty(name, locale, timezone, language_id).map_err(to_js_error)?;
        Ok(Model { model })
    }

    #[wasm_bindgen(js_name = "fromBytes")]
    pub fn from_bytes(bytes: &[u8], language_id: &str) -> Result<Model, JsError> {
        let language_id = leak_str(language_id);
        let model = BaseModel::from_bytes(bytes, language_id).map_err(to_js_error)?;
        Ok(Model { model })
    }

    /// Loads a workbook from the bytes of an xlsx file.
    /// Only available in `@ironcalc/wasm-xlsx`.
    #[cfg(feature = "xlsx")]
    #[wasm_bindgen(js_name = "fromXlsx")]
    pub fn from_xlsx(
        bytes: &[u8],
        name: &str,
        locale: &str,
        timezone: &str,
        language_id: &str,
    ) -> Result<Model, JsError> {
        let workbook = ironcalc::import::load_from_xlsx_bytes(bytes, name, locale, timezone)
            .map_err(|e| to_js_error(e.to_string()))?;
        let language_id = leak_str(language_id);
        let calc_model =
            ironcalc_base::Model::from_workbook(workbook, language_id).map_err(to_js_error)?;
        Ok(Model {
            model: BaseModel::from_model(calc_model),
        })
    }

    pub fn undo(&mut self) -> Result<(), JsError> {
        self.model.undo().map_err(to_js_error)
    }

    pub fn redo(&mut self) -> Result<(), JsError> {
        self.model.redo().map_err(to_js_error)
    }

    #[wasm_bindgen(js_name = "canUndo")]
    pub fn can_undo(&self) -> bool {
        self.model.can_undo()
    }

    #[wasm_bindgen(js_name = "canRedo")]
    pub fn can_redo(&self) -> bool {
        self.model.can_redo()
    }

    #[wasm_bindgen(js_name = "pauseEvaluation")]
    pub fn pause_evaluation(&mut self) {
        self.model.pause_evaluation()
    }

    #[wasm_bindgen(js_name = "resumeEvaluation")]
    pub fn resume_evaluation(&mut self) {
        self.model.resume_evaluation()
    }

    pub fn evaluate(&mut self) {
        self.model.evaluate();
    }

    #[wasm_bindgen(js_name = "flushSendQueue")]
    pub fn flush_send_queue(&mut self) -> Vec<u8> {
        self.model.flush_send_queue()
    }

    #[wasm_bindgen(js_name = "applyExternalDiffs")]
    pub fn apply_external_diffs(&mut self, diffs: &[u8]) -> Result<(), JsError> {
        self.model.apply_external_diffs(diffs).map_err(to_js_error)
    }

    #[wasm_bindgen(js_name = "getCellContent")]
    pub fn get_cell_content(&self, sheet: u32, row: i32, column: i32) -> Result<String, JsError> {
        self.model
            .get_cell_content(sheet, row, column)
            .map_err(to_js_error)
    }

    /// Returns completion information for a formula being edited in a cell.
    /// `formula` is the raw cell input (it may start with `=`) and `cursor` is a
    /// char offset into it.
    #[wasm_bindgen(
        js_name = "getFormulaCompletion",
        unchecked_return_type = "CompletionContext"
    )]
    pub fn get_formula_completion(
        &mut self,
        sheet: u32,
        row: i32,
        column: i32,
        formula: &str,
        cursor: usize,
    ) -> Result<JsValue, JsError> {
        let context = self
            .model
            .formula_completion(sheet, row, column, formula, cursor)
            .map_err(to_js_error)?;
        serde_wasm_bindgen::to_value(&context).map_err(|e| to_js_error(e.to_string()))
    }

    /// Cycles the references touched by the cursor through the four
    /// absolute/relative states, Excel F4 style: A1 -> $A$1 -> A$1 -> $A1 -> A1.
    /// Returns the new text together with the new cursor start and end.
    /// `start` and `end` are char offsets into `value`.
    #[wasm_bindgen(
        js_name = "cycleReference",
        unchecked_return_type = "[string, number, number]"
    )]
    pub fn cycle_reference(
        &self,
        value: &str,
        start: usize,
        end: usize,
    ) -> Result<JsValue, JsError> {
        let result = self
            .model
            .cycle_reference(value, start, end)
            .map_err(to_js_error)?;
        serde_wasm_bindgen::to_value(&result).map_err(|e| to_js_error(e.to_string()))
    }

    #[wasm_bindgen(js_name = "newSheet")]
    pub fn new_sheet(&mut self) -> Result<(), JsError> {
        self.model.new_sheet().map_err(to_js_error)
    }

    #[wasm_bindgen(js_name = "deleteSheet")]
    pub fn delete_sheet(&mut self, sheet: u32) -> Result<(), JsError> {
        self.model.delete_sheet(sheet).map_err(to_js_error)
    }

    #[wasm_bindgen(js_name = "duplicateSheet")]
    pub fn duplicate_sheet(&mut self, sheet: u32) -> Result<(), JsError> {
        self.model.duplicate_sheet(sheet).map_err(to_js_error)
    }

    #[wasm_bindgen(js_name = "hideSheet")]
    pub fn hide_sheet(&mut self, sheet: u32) -> Result<(), JsError> {
        self.model.hide_sheet(sheet).map_err(to_js_error)
    }

    #[wasm_bindgen(js_name = "unhideSheet")]
    pub fn unhide_sheet(&mut self, sheet: u32) -> Result<(), JsError> {
        self.model.unhide_sheet(sheet).map_err(to_js_error)
    }

    #[wasm_bindgen(js_name = "renameSheet")]
    pub fn rename_sheet(&mut self, sheet: u32, name: &str) -> Result<(), JsError> {
        self.model.rename_sheet(sheet, name).map_err(to_js_error)
    }

    #[wasm_bindgen(js_name = "setSheetColor")]
    pub fn set_sheet_color(
        &mut self,
        sheet: u32,
        #[wasm_bindgen(unchecked_param_type = "Color")] color: JsValue,
    ) -> Result<(), JsError> {
        let color: ironcalc_base::types::Color =
            serde_wasm_bindgen::from_value(color).unwrap_or(Color::None);
        self.model
            .set_sheet_color(sheet, &color)
            .map_err(to_js_error)
    }

    #[wasm_bindgen(js_name = "rangeClearAll")]
    pub fn range_clear_all(
        &mut self,
        sheet: u32,
        start_row: i32,
        start_column: i32,
        end_row: i32,
        end_column: i32,
    ) -> Result<(), JsError> {
        let range = Area {
            sheet,
            row: start_row,
            column: start_column,
            width: end_column - start_column + 1,
            height: end_row - start_row + 1,
        };
        self.model.range_clear_all(&range).map_err(to_js_error)
    }

    #[wasm_bindgen(js_name = "rangeClearContents")]
    pub fn range_clear_contents(
        &mut self,
        sheet: u32,
        start_row: i32,
        start_column: i32,
        end_row: i32,
        end_column: i32,
    ) -> Result<(), JsError> {
        let range = Area {
            sheet,
            row: start_row,
            column: start_column,
            width: end_column - start_column + 1,
            height: end_row - start_row + 1,
        };
        self.model.range_clear_contents(&range).map_err(to_js_error)
    }

    #[wasm_bindgen(js_name = "rangeClearFormatting")]
    pub fn range_clear_formatting(
        &mut self,
        sheet: u32,
        start_row: i32,
        start_column: i32,
        end_row: i32,
        end_column: i32,
    ) -> Result<(), JsError> {
        let range = Area {
            sheet,
            row: start_row,
            column: start_column,
            width: end_column - start_column + 1,
            height: end_row - start_row + 1,
        };
        self.model
            .range_clear_formatting(&range)
            .map_err(to_js_error)
    }

    #[wasm_bindgen(js_name = "insertRows")]
    pub fn insert_rows(&mut self, sheet: u32, row: i32, row_count: i32) -> Result<(), JsError> {
        self.model
            .insert_rows(sheet, row, row_count)
            .map_err(to_js_error)
    }

    #[wasm_bindgen(js_name = "insertColumns")]
    pub fn insert_columns(
        &mut self,
        sheet: u32,
        column: i32,
        column_count: i32,
    ) -> Result<(), JsError> {
        self.model
            .insert_columns(sheet, column, column_count)
            .map_err(to_js_error)
    }

    #[wasm_bindgen(js_name = "deleteRows")]
    pub fn delete_rows(&mut self, sheet: u32, row: i32, row_count: i32) -> Result<(), JsError> {
        self.model
            .delete_rows(sheet, row, row_count)
            .map_err(to_js_error)
    }

    #[wasm_bindgen(js_name = "deleteColumns")]
    pub fn delete_columns(
        &mut self,
        sheet: u32,
        column: i32,
        column_count: i32,
    ) -> Result<(), JsError> {
        self.model
            .delete_columns(sheet, column, column_count)
            .map_err(to_js_error)
    }

    #[wasm_bindgen(js_name = "moveColumns")]
    pub fn move_columns_action(
        &mut self,
        sheet: u32,
        column: i32,
        column_count: i32,
        delta: i32,
    ) -> Result<(), JsError> {
        self.model
            .move_columns_action(sheet, column, column_count, delta)
            .map_err(to_js_error)
    }

    #[wasm_bindgen(js_name = "moveRows")]
    pub fn move_rows_action(
        &mut self,
        sheet: u32,
        row: i32,
        row_count: i32,
        delta: i32,
    ) -> Result<(), JsError> {
        self.model
            .move_rows_action(sheet, row, row_count, delta)
            .map_err(to_js_error)
    }

    #[wasm_bindgen(js_name = "setRowsHeight")]
    pub fn set_rows_height(
        &mut self,
        sheet: u32,
        row_start: i32,
        row_end: i32,
        height: f64,
    ) -> Result<(), JsError> {
        self.model
            .set_rows_height(sheet, row_start, row_end, height)
            .map_err(to_js_error)
    }

    #[wasm_bindgen(js_name = "setColumnsWidth")]
    pub fn set_columns_width(
        &mut self,
        sheet: u32,
        column_start: i32,
        column_end: i32,
        width: f64,
    ) -> Result<(), JsError> {
        self.model
            .set_columns_width(sheet, column_start, column_end, width)
            .map_err(to_js_error)
    }

    #[wasm_bindgen(js_name = "setColumnsHidden")]
    pub fn set_columns_hidden(
        &mut self,
        sheet: u32,
        column_start: i32,
        column_end: i32,
        hidden: bool,
    ) -> Result<(), JsError> {
        self.model
            .set_columns_hidden(sheet, column_start, column_end, hidden)
            .map_err(to_js_error)
    }

    #[wasm_bindgen(js_name = "setRowsHidden")]
    pub fn set_rows_hidden(
        &mut self,
        sheet: u32,
        row_start: i32,
        row_end: i32,
        hidden: bool,
    ) -> Result<(), JsError> {
        self.model
            .set_rows_hidden(sheet, row_start, row_end, hidden)
            .map_err(to_js_error)
    }

    #[wasm_bindgen(js_name = "getRowHeight")]
    pub fn get_row_height(&mut self, sheet: u32, row: i32) -> Result<f64, JsError> {
        self.model.get_row_height(sheet, row).map_err(to_js_error)
    }

    #[wasm_bindgen(js_name = "getColumnWidth")]
    pub fn get_column_width(&mut self, sheet: u32, column: i32) -> Result<f64, JsError> {
        self.model
            .get_column_width(sheet, column)
            .map_err(to_js_error)
    }

    #[wasm_bindgen(js_name = "setUserInput")]
    pub fn set_user_input(
        &mut self,
        sheet: u32,
        row: i32,
        column: i32,
        input: &str,
    ) -> Result<(), JsError> {
        self.model
            .set_user_input(sheet, row, column, input)
            .map_err(to_js_error)
    }

    #[wasm_bindgen(js_name = "setUserArrayFormula")]
    pub fn set_user_array_formula(
        &mut self,
        sheet: u32,
        row: i32,
        column: i32,
        width: i32,
        height: i32,
        formula: &str,
    ) -> Result<(), JsError> {
        self.model
            .set_user_array_formula(sheet, row, column, width, height, formula)
            .map_err(to_js_error)
    }

    #[wasm_bindgen(js_name = "getFormattedCellValue")]
    pub fn get_formatted_cell_value(
        &self,
        sheet: u32,
        row: i32,
        column: i32,
    ) -> Result<String, JsError> {
        self.model
            .get_formatted_cell_value(sheet, row, column)
            .map_err(to_js_error)
    }

    #[wasm_bindgen(js_name = "getFrozenRowsCount")]
    pub fn get_frozen_rows_count(&self, sheet: u32) -> Result<i32, JsError> {
        self.model.get_frozen_rows_count(sheet).map_err(to_js_error)
    }

    #[wasm_bindgen(js_name = "getFrozenColumnsCount")]
    pub fn get_frozen_columns_count(&self, sheet: u32) -> Result<i32, JsError> {
        self.model
            .get_frozen_columns_count(sheet)
            .map_err(to_js_error)
    }

    #[wasm_bindgen(js_name = "setFrozenRowsCount")]
    pub fn set_frozen_rows_count(&mut self, sheet: u32, count: i32) -> Result<(), JsError> {
        self.model
            .set_frozen_rows_count(sheet, count)
            .map_err(to_js_error)
    }

    #[wasm_bindgen(js_name = "setFrozenColumnsCount")]
    pub fn set_frozen_columns_count(&mut self, sheet: u32, count: i32) -> Result<(), JsError> {
        self.model
            .set_frozen_columns_count(sheet, count)
            .map_err(to_js_error)
    }

    // This two are only used when we want to compute the automatic width of a column or height of a row
    #[wasm_bindgen(js_name = "getRowsWithData")]
    pub fn get_rows_with_data(&self, sheet: u32, column: i32) -> Result<Vec<i32>, JsError> {
        let sheet_data = &self
            .model
            .get_model()
            .workbook
            .worksheet(sheet)
            .map_err(to_js_error)?
            .sheet_data;
        Ok(sheet_data
            .rows()
            .into_iter()
            .filter(|row| sheet_data.cell(*row, column).is_some())
            .collect())
    }

    #[wasm_bindgen(js_name = "getColumnsWithData")]
    pub fn get_columns_with_data(&self, sheet: u32, row: i32) -> Result<Vec<i32>, JsError> {
        Ok(self
            .model
            .get_model()
            .workbook
            .worksheet(sheet)
            .map_err(to_js_error)?
            .sheet_data
            .columns_in_row(row))
    }

    #[wasm_bindgen(js_name = "updateRangeStyle")]
    pub fn update_range_style(
        &mut self,
        #[wasm_bindgen(unchecked_param_type = "Area")] range: JsValue,
        style_path: &str,
        value: &str,
    ) -> Result<(), JsError> {
        let range: Area =
            serde_wasm_bindgen::from_value(range).map_err(|e| to_js_error(e.to_string()))?;
        self.model
            .update_range_style(&range, style_path, value)
            .map_err(to_js_error)
    }

    #[wasm_bindgen(js_name = "mergeCells")]
    pub fn merge_cells(
        &mut self,
        #[wasm_bindgen(unchecked_param_type = "Area")] range: JsValue,
    ) -> Result<(), JsError> {
        let range: Area =
            serde_wasm_bindgen::from_value(range).map_err(|e| to_js_error(e.to_string()))?;
        self.model.merge_cells(&range).map_err(to_js_error)
    }

    #[wasm_bindgen(js_name = "mergeCellsCenter")]
    pub fn merge_cells_center(
        &mut self,
        #[wasm_bindgen(unchecked_param_type = "Area")] range: JsValue,
    ) -> Result<(), JsError> {
        let range: Area =
            serde_wasm_bindgen::from_value(range).map_err(|e| to_js_error(e.to_string()))?;
        self.model.merge_cells_center(&range).map_err(to_js_error)
    }

    #[wasm_bindgen(js_name = "mergeCellsAcross")]
    pub fn merge_cells_across(
        &mut self,
        #[wasm_bindgen(unchecked_param_type = "Area")] range: JsValue,
    ) -> Result<(), JsError> {
        let range: Area =
            serde_wasm_bindgen::from_value(range).map_err(|e| to_js_error(e.to_string()))?;
        self.model.merge_cells_across(&range).map_err(to_js_error)
    }

    #[wasm_bindgen(js_name = "mergeCellsDown")]
    pub fn merge_cells_down(
        &mut self,
        #[wasm_bindgen(unchecked_param_type = "Area")] range: JsValue,
    ) -> Result<(), JsError> {
        let range: Area =
            serde_wasm_bindgen::from_value(range).map_err(|e| to_js_error(e.to_string()))?;
        self.model.merge_cells_down(&range).map_err(to_js_error)
    }

    #[wasm_bindgen(js_name = "unmergeCells")]
    pub fn unmerge_cells(
        &mut self,
        #[wasm_bindgen(unchecked_param_type = "Area")] range: JsValue,
    ) -> Result<(), JsError> {
        let range: Area =
            serde_wasm_bindgen::from_value(range).map_err(|e| to_js_error(e.to_string()))?;
        self.model.unmerge_cells(&range).map_err(to_js_error)
    }

    #[wasm_bindgen(js_name = "getMergedCells", unchecked_return_type = "MergedCell[]")]
    pub fn get_merged_cells(&self, sheet: u32) -> Result<JsValue, JsError> {
        let merged_cells = self.model.get_merged_cells(sheet).map_err(to_js_error)?;
        serde_wasm_bindgen::to_value(&merged_cells).map_err(|e| to_js_error(e.to_string()))
    }

    #[wasm_bindgen(js_name = "getCellStyle", unchecked_return_type = "ExtendedCellStyle")]
    pub fn get_cell_style(
        &mut self,
        sheet: u32,
        row: i32,
        column: i32,
    ) -> Result<JsValue, JsError> {
        let style = self
            .model
            .get_extended_cell_style(sheet, row, column)
            .map_err(to_js_error)?;

        serde_wasm_bindgen::to_value(&style).map_err(|e| to_js_error(e.to_string()))
    }

    #[wasm_bindgen(js_name = "onPasteStyles")]
    pub fn on_paste_styles(
        &mut self,
        #[wasm_bindgen(unchecked_param_type = "CellStyle[][]")] styles: JsValue,
    ) -> Result<(), JsError> {
        let styles: &Vec<Vec<Style>> =
            &serde_wasm_bindgen::from_value(styles).map_err(|e| to_js_error(e.to_string()))?;
        self.model.on_paste_styles(styles).map_err(to_js_error)
    }

    #[wasm_bindgen(js_name = "getCellType")]
    pub fn get_cell_type(&self, sheet: u32, row: i32, column: i32) -> Result<i32, JsError> {
        Ok(
            match self
                .model
                .get_cell_type(sheet, row, column)
                .map_err(to_js_error)?
            {
                CellType::Number => 1,
                CellType::Text => 2,
                CellType::LogicalValue => 4,
                CellType::ErrorValue => 16,
                CellType::Array => 64,
                CellType::CompoundData => 128,
            },
        )
    }

    // I don't _think_ serializing to JsValue can't fail
    // FIXME: Remove this clippy directive
    #[wasm_bindgen(
        js_name = "getWorksheetsProperties",
        unchecked_return_type = "WorksheetProperties[]"
    )]
    #[allow(clippy::unwrap_used)]
    pub fn get_worksheets_properties(&self) -> JsValue {
        serde_wasm_bindgen::to_value(&self.model.get_worksheets_properties()).unwrap()
    }

    #[wasm_bindgen(js_name = "getSelectedSheet")]
    pub fn get_selected_sheet(&self) -> u32 {
        self.model.get_selected_sheet()
    }

    #[wasm_bindgen(js_name = "getSelectedCell")]
    pub fn get_selected_cell(&self) -> Vec<i32> {
        let (sheet, row, column) = self.model.get_selected_cell();
        vec![sheet as i32, row, column]
    }

    // I don't _think_ serializing to JsValue can't fail
    // FIXME: Remove this clippy directive
    #[wasm_bindgen(js_name = "getSelectedView", unchecked_return_type = "SelectedView")]
    #[allow(clippy::unwrap_used)]
    pub fn get_selected_view(&self) -> JsValue {
        serde_wasm_bindgen::to_value(&self.model.get_selected_view()).unwrap()
    }

    #[wasm_bindgen(js_name = "setSelectedSheet")]
    pub fn set_selected_sheet(&mut self, sheet: u32) -> Result<(), JsError> {
        self.model.set_selected_sheet(sheet).map_err(to_js_error)
    }

    #[wasm_bindgen(js_name = "setSelectedCell")]
    pub fn set_selected_cell(&mut self, row: i32, column: i32) -> Result<(), JsError> {
        self.model
            .set_selected_cell(row, column)
            .map_err(to_js_error)
    }

    #[wasm_bindgen(js_name = "setSelectedRange")]
    pub fn set_selected_range(
        &mut self,
        start_row: i32,
        start_column: i32,
        end_row: i32,
        end_column: i32,
    ) -> Result<(), JsError> {
        self.model
            .set_selected_range(start_row, start_column, end_row, end_column)
            .map_err(to_js_error)
    }

    #[wasm_bindgen(js_name = "setTopLeftVisibleCell")]
    pub fn set_top_left_visible_cell(
        &mut self,
        top_row: i32,
        top_column: i32,
    ) -> Result<(), JsError> {
        self.model
            .set_top_left_visible_cell(top_row, top_column)
            .map_err(to_js_error)
    }

    #[wasm_bindgen(js_name = "setShowGridLines")]
    pub fn set_show_grid_lines(
        &mut self,
        sheet: u32,
        show_grid_lines: bool,
    ) -> Result<(), JsError> {
        self.model
            .set_show_grid_lines(sheet, show_grid_lines)
            .map_err(to_js_error)
    }

    #[wasm_bindgen(js_name = "getShowGridLines")]
    pub fn get_show_grid_lines(&mut self, sheet: u32) -> Result<bool, JsError> {
        self.model.get_show_grid_lines(sheet).map_err(to_js_error)
    }

    /// Returns the link attached to the cell or undefined if there isn't one.
    #[wasm_bindgen(js_name = "getCellLink", unchecked_return_type = "Link | undefined")]
    pub fn get_cell_link(&self, sheet: u32, row: i32, column: i32) -> Result<JsValue, JsError> {
        let link = self
            .model
            .get_cell_link(sheet, row, column)
            .map_err(to_js_error)?;
        serde_wasm_bindgen::to_value(&link).map_err(|e| to_js_error(e.to_string()))
    }

    /// Attaches a link to a cell, replacing the existing one if there was one.
    /// If `label` is given it becomes the content of the cell (the displayed text).
    /// A new link also applies the link style (underline + theme hyperlink color)
    /// to the cell. The whole operation is a single undo step.
    #[wasm_bindgen(js_name = "setCellLink")]
    pub fn set_cell_link(
        &mut self,
        sheet: u32,
        row: i32,
        column: i32,
        #[wasm_bindgen(unchecked_param_type = "Link")] link: JsValue,
        label: Option<String>,
    ) -> Result<(), JsError> {
        let link: Link =
            serde_wasm_bindgen::from_value(link).map_err(|e| to_js_error(e.to_string()))?;
        self.model
            .set_cell_link(sheet, row, column, link, label.as_deref())
            .map_err(to_js_error)
    }

    /// Removes the link attached to the cell. It is not an error if the cell has no link.
    #[wasm_bindgen(js_name = "deleteCellLink")]
    pub fn delete_cell_link(&mut self, sheet: u32, row: i32, column: i32) -> Result<(), JsError> {
        self.model
            .delete_cell_link(sheet, row, column)
            .map_err(to_js_error)
    }

    /// Returns all the links in the worksheet sorted by (row, column).
    #[wasm_bindgen(js_name = "getLinks", unchecked_return_type = "CellLink[]")]
    pub fn get_links(&self, sheet: u32) -> Result<JsValue, JsError> {
        let links = self.model.get_links_list(sheet).map_err(to_js_error)?;
        // The `CellLink` entries have the link fields flattened, which serde
        // serializes through its map machinery; the json_compatible serializer
        // produces plain JS objects for maps instead of `Map` instances.
        links
            .serialize(&serde_wasm_bindgen::Serializer::json_compatible())
            .map_err(|e| to_js_error(e.to_string()))
    }

    /// Sets the workbook theme.
    #[wasm_bindgen(js_name = "setTheme")]
    pub fn set_theme(
        &mut self,
        #[wasm_bindgen(unchecked_param_type = "IronCalcTheme")] theme: JsValue,
    ) -> Result<(), JsError> {
        let theme: ironcalc_base::types::Theme =
            serde_wasm_bindgen::from_value(theme).map_err(|e| to_js_error(e.to_string()))?;
        self.model.set_theme(theme);
        Ok(())
    }

    /// Returns the current workbook theme.
    #[wasm_bindgen(js_name = "getTheme", unchecked_return_type = "IronCalcTheme")]
    pub fn get_theme(&self) -> Result<JsValue, JsError> {
        serde_wasm_bindgen::to_value(&self.model.get_theme())
            .map_err(|e| to_js_error(e.to_string()))
    }

    /// Resolves a `Color` value to a CSS hex string using the current workbook theme.
    /// Accepts `Color`; returns `""` for absent/None colors.
    #[wasm_bindgen(js_name = "resolveColor")]
    pub fn resolve_color(
        &self,
        #[wasm_bindgen(unchecked_param_type = "Color")] color: JsValue,
    ) -> String {
        let color: ironcalc_base::types::Color =
            serde_wasm_bindgen::from_value(color).unwrap_or(ironcalc_base::types::Color::None);
        self.model.resolve_color(&color)
    }

    #[wasm_bindgen(js_name = "autoFillRows")]
    pub fn auto_fill_rows(
        &mut self,
        #[wasm_bindgen(unchecked_param_type = "Area")] source_area: JsValue,
        to_row: i32,
    ) -> Result<(), JsError> {
        let area: Area =
            serde_wasm_bindgen::from_value(source_area).map_err(|e| to_js_error(e.to_string()))?;
        self.model
            .auto_fill_rows(&area, to_row)
            .map_err(to_js_error)
    }

    #[wasm_bindgen(js_name = "autoFillColumns")]
    pub fn auto_fill_columns(
        &mut self,
        #[wasm_bindgen(unchecked_param_type = "Area")] source_area: JsValue,
        to_column: i32,
    ) -> Result<(), JsError> {
        let area: Area =
            serde_wasm_bindgen::from_value(source_area).map_err(|e| to_js_error(e.to_string()))?;
        self.model
            .auto_fill_columns(&area, to_column)
            .map_err(to_js_error)
    }

    #[wasm_bindgen(js_name = "onArrowRight")]
    pub fn on_arrow_right(&mut self) -> Result<(), JsError> {
        self.model.on_arrow_right().map_err(to_js_error)
    }

    #[wasm_bindgen(js_name = "onArrowLeft")]
    pub fn on_arrow_left(&mut self) -> Result<(), JsError> {
        self.model.on_arrow_left().map_err(to_js_error)
    }

    #[wasm_bindgen(js_name = "onArrowUp")]
    pub fn on_arrow_up(&mut self) -> Result<(), JsError> {
        self.model.on_arrow_up().map_err(to_js_error)
    }

    #[wasm_bindgen(js_name = "onArrowDown")]
    pub fn on_arrow_down(&mut self) -> Result<(), JsError> {
        self.model.on_arrow_down().map_err(to_js_error)
    }

    #[wasm_bindgen(js_name = "onPageDown")]
    pub fn on_page_down(&mut self) -> Result<(), JsError> {
        self.model.on_page_down().map_err(to_js_error)
    }

    #[wasm_bindgen(js_name = "onPageUp")]
    pub fn on_page_up(&mut self) -> Result<(), JsError> {
        self.model.on_page_up().map_err(to_js_error)
    }

    #[wasm_bindgen(js_name = "onNavigateToEdgeInDirection")]
    pub fn on_navigate_to_edge_in_direction(&mut self, direction: &str) -> Result<(), JsError> {
        let direction = match direction {
            "ArrowLeft" => NavigationDirection::Left,
            "ArrowRight" => NavigationDirection::Right,
            "ArrowUp" => NavigationDirection::Up,
            "ArrowDown" => NavigationDirection::Down,
            _ => return Err(JsError::new(&format!("Invalid direction: {direction}"))),
        };
        self.model
            .on_navigate_to_edge_in_direction(direction)
            .map_err(to_js_error)
    }

    #[wasm_bindgen(js_name = "setWindowWidth")]
    pub fn set_window_width(&mut self, window_width: f64) {
        self.model.set_window_width(window_width);
    }

    #[wasm_bindgen(js_name = "setWindowHeight")]
    pub fn set_window_height(&mut self, window_height: f64) {
        self.model.set_window_height(window_height);
    }

    #[wasm_bindgen(js_name = "getScrollX")]
    pub fn get_scroll_x(&self) -> Result<f64, JsError> {
        self.model.get_scroll_x().map_err(to_js_error)
    }

    #[wasm_bindgen(js_name = "getScrollY")]
    pub fn get_scroll_y(&self) -> Result<f64, JsError> {
        self.model.get_scroll_y().map_err(to_js_error)
    }

    #[wasm_bindgen(js_name = "onExpandSelectedRange")]
    pub fn on_expand_selected_range(&mut self, key: &str) -> Result<(), JsError> {
        self.model
            .on_expand_selected_range(key)
            .map_err(to_js_error)
    }

    #[wasm_bindgen(js_name = "onAreaSelecting")]
    pub fn on_area_selecting(
        &mut self,
        target_row: i32,
        target_column: i32,
    ) -> Result<(), JsError> {
        self.model
            .on_area_selecting(target_row, target_column)
            .map_err(to_js_error)
    }

    #[wasm_bindgen(js_name = "setAreaWithBorder")]
    pub fn set_area_with_border(
        &mut self,
        #[wasm_bindgen(unchecked_param_type = "Area")] area: JsValue,
        #[wasm_bindgen(unchecked_param_type = "BorderArea")] border_area: JsValue,
    ) -> Result<(), JsError> {
        let range: Area =
            serde_wasm_bindgen::from_value(area).map_err(|e| to_js_error(e.to_string()))?;
        let border: BorderArea =
            serde_wasm_bindgen::from_value(border_area).map_err(|e| to_js_error(e.to_string()))?;
        self.model
            .set_area_with_border(&range, &border)
            .map_err(|e| to_js_error(e.to_string()))?;
        Ok(())
    }

    #[wasm_bindgen(js_name = "toBytes")]
    pub fn to_bytes(&self) -> Vec<u8> {
        self.model.to_bytes()
    }

    /// Serializes the workbook to xlsx bytes.
    /// Only available in `@ironcalc/wasm-xlsx`.
    #[cfg(feature = "xlsx")]
    #[wasm_bindgen(js_name = "toXlsx")]
    pub fn to_xlsx(&self) -> Result<Vec<u8>, JsError> {
        let writer = std::io::Cursor::new(Vec::new());
        let writer = ironcalc::export::save_xlsx_to_writer(self.model.get_model(), writer)
            .map_err(|e| to_js_error(e.to_string()))?;
        Ok(writer.into_inner())
    }

    #[wasm_bindgen(js_name = "getName")]
    pub fn get_name(&self) -> String {
        self.model.get_name()
    }

    #[wasm_bindgen(js_name = "setName")]
    pub fn set_name(&mut self, name: &str) {
        self.model.set_name(name);
    }

    #[wasm_bindgen(js_name = "copyToClipboard", unchecked_return_type = "Clipboard")]
    pub fn copy_to_clipboard(&self) -> Result<JsValue, JsError> {
        let data = self
            .model
            .copy_to_clipboard()
            .map_err(|e| to_js_error(e.to_string()))?;

        serde_wasm_bindgen::to_value(&data).map_err(|e| to_js_error(e.to_string()))
    }

    #[wasm_bindgen(js_name = "pasteFromClipboard")]
    pub fn paste_from_clipboard(
        &mut self,
        source_sheet: u32,
        #[wasm_bindgen(unchecked_param_type = "[number, number, number, number]")]
        source_range: JsValue,
        #[wasm_bindgen(unchecked_param_type = "ClipboardData")] clipboard: JsValue,
        is_cut: bool,
    ) -> Result<(), JsError> {
        let source_range: (i32, i32, i32, i32) =
            serde_wasm_bindgen::from_value(source_range).map_err(|e| to_js_error(e.to_string()))?;
        let clipboard: ClipboardData =
            serde_wasm_bindgen::from_value(clipboard).map_err(|e| to_js_error(e.to_string()))?;
        self.model
            .paste_from_clipboard(source_sheet, source_range, &clipboard, is_cut)
            .map_err(|e| to_js_error(e.to_string()))
    }

    #[wasm_bindgen(js_name = "pasteCsvText")]
    pub fn paste_csv_string(
        &mut self,
        #[wasm_bindgen(unchecked_param_type = "Area")] area: JsValue,
        csv: &str,
    ) -> Result<(), JsError> {
        let range: Area =
            serde_wasm_bindgen::from_value(area).map_err(|e| to_js_error(e.to_string()))?;
        self.model
            .paste_csv_string(&range, csv)
            .map_err(|e| to_js_error(e.to_string()))
    }

    #[wasm_bindgen(
        js_name = "getDefinedNameList",
        unchecked_return_type = "DefinedName[]"
    )]
    pub fn get_defined_name_list(&self) -> Result<JsValue, JsError> {
        let data: Vec<DefinedName> = self
            .model
            .get_defined_name_list()
            .iter()
            .map(|s| DefinedName {
                name: s.0.to_owned(),
                scope: s.1,
                formula: s.2.to_owned(),
            })
            .collect();
        serde_wasm_bindgen::to_value(&data).map_err(|e| to_js_error(e.to_string()))
    }

    #[wasm_bindgen(js_name = "newDefinedName")]
    pub fn new_defined_name(
        &mut self,
        name: &str,
        scope: Option<u32>,
        formula: &str,
    ) -> Result<(), JsError> {
        self.model
            .new_defined_name(name, scope, formula)
            .map_err(|e| to_js_error(e.to_string()))
    }

    #[wasm_bindgen(js_name = "updateDefinedName")]
    pub fn update_defined_name(
        &mut self,
        name: &str,
        scope: Option<u32>,
        new_name: &str,
        new_scope: Option<u32>,
        new_formula: &str,
    ) -> Result<(), JsError> {
        self.model
            .update_defined_name(name, scope, new_name, new_scope, new_formula)
            .map_err(|e| to_js_error(e.to_string()))
    }

    #[wasm_bindgen(js_name = "deleteDefinedName")]
    pub fn delete_definedname(&mut self, name: &str, scope: Option<u32>) -> Result<(), JsError> {
        self.model
            .delete_defined_name(name, scope)
            .map_err(|e| to_js_error(e.to_string()))
    }

    #[wasm_bindgen(js_name = "getLastNonEmptyInRowBeforeColumn")]
    pub fn get_last_non_empty_in_row_before_column(
        &self,
        sheet: u32,
        row: i32,
        column: i32,
    ) -> Result<Option<i32>, JsError> {
        self.model
            .get_last_non_empty_in_row_before_column(sheet, row, column)
            .map_err(to_js_error)
    }

    #[wasm_bindgen(js_name = "getFirstNonEmptyInRowAfterColumn")]
    pub fn get_first_non_empty_in_row_after_column(
        &self,
        sheet: u32,
        row: i32,
        column: i32,
    ) -> Result<Option<i32>, JsError> {
        self.model
            .get_first_non_empty_in_row_after_column(sheet, row, column)
            .map_err(to_js_error)
    }

    #[wasm_bindgen(js_name = "isValidDefinedName")]
    pub fn is_valid_defined_name(
        &mut self,
        name: &str,
        scope: Option<u32>,
        formula: &str,
    ) -> Result<(), JsError> {
        match self.model.is_valid_defined_name(name, scope, formula) {
            Ok(_) => Ok(()),
            Err(e) => Err(to_js_error(e.to_string())),
        }
    }

    #[wasm_bindgen(js_name = "setTimezone")]
    pub fn set_timezone(&mut self, timezone: &str) -> Result<(), JsError> {
        self.model
            .set_timezone(timezone)
            .map_err(|e| to_js_error(e.to_string()))
    }

    #[wasm_bindgen(js_name = "setLocale")]
    pub fn set_locale(&mut self, locale: &str) -> Result<(), JsError> {
        self.model
            .set_locale(locale)
            .map_err(|e| to_js_error(e.to_string()))
    }

    /// Gets the timezone of the model
    #[wasm_bindgen(js_name = "getTimezone")]
    pub fn get_timezone(&self) -> String {
        self.model.get_timezone()
    }

    /// Gets the locale of the model
    #[wasm_bindgen(js_name = "getLocale")]
    pub fn get_locale(&self) -> String {
        self.model.get_locale()
    }

    /// Gets the language of the model
    #[wasm_bindgen(js_name = "getLanguage")]
    pub fn get_language(&self) -> String {
        self.model.get_language()
    }

    /// Sets the language of the model
    #[wasm_bindgen(js_name = "setLanguage")]
    pub fn set_language(&mut self, language: &str) -> Result<(), JsError> {
        self.model
            .set_language(language)
            .map_err(|e| to_js_error(e.to_string()))
    }

    /// Gets Settings format info
    #[wasm_bindgen(js_name = "getFmtSettings", unchecked_return_type = "FmtSettings")]
    pub fn get_fmt_settings(&self) -> Result<JsValue, JsError> {
        let settings: FmtSettings = self.model.get_fmt_settings().into();
        serde_wasm_bindgen::to_value(&settings).map_err(|e| to_js_error(e.to_string()))
    }

    #[wasm_bindgen(
        js_name = "getCellArrayStructure",
        unchecked_return_type = "CellArrayStructure"
    )]
    pub fn get_cell_array_structure(
        &self,
        sheet: u32,
        row: i32,
        column: i32,
    ) -> Result<JsValue, JsError> {
        let cell_structure = self
            .model
            .get_cell_array_structure(sheet, row, column)
            .map_err(|e| to_js_error(e.to_string()))?;
        serde_wasm_bindgen::to_value(&cell_structure).map_err(JsError::from)
    }

    // -----------------------------------------------------------------------
    // Conditional formatting
    // -----------------------------------------------------------------------

    #[wasm_bindgen(
        js_name = "getConditionalFormattingList",
        unchecked_return_type = "ConditionalFormattingView[]"
    )]
    pub fn get_conditional_formatting_list(&self, sheet: u32) -> Result<JsValue, JsError> {
        let list = self
            .model
            .get_conditional_formatting_list(sheet)
            .map_err(|e| to_js_error(e.to_string()))?;
        serde_wasm_bindgen::to_value(&list).map_err(|e| to_js_error(e.to_string()))
    }

    #[wasm_bindgen(js_name = "addConditionalFormatting")]
    pub fn add_conditional_formatting(
        &mut self,
        sheet: u32,
        range: &str,
        #[wasm_bindgen(unchecked_param_type = "CfRuleInput")] rule: JsValue,
    ) -> Result<(), JsError> {
        let rule: CfRuleInput =
            serde_wasm_bindgen::from_value(rule).map_err(|e| to_js_error(e.to_string()))?;
        self.model
            .add_conditional_formatting(sheet, range, rule)
            .map_err(|e| to_js_error(e.to_string()))
    }

    #[wasm_bindgen(
        js_name = "getDxfForConditionalFormatting",
        unchecked_return_type = "Dxf | null"
    )]
    pub fn get_dxf_for_conditional_formatting(
        &self,
        sheet: u32,
        index: u32,
    ) -> Result<JsValue, JsError> {
        let dxf = self
            .model
            .get_dxf_for_conditional_formatting(sheet, index)
            .map_err(|e| to_js_error(e.to_string()))?;
        serde_wasm_bindgen::to_value(&dxf).map_err(|e| to_js_error(e.to_string()))
    }

    #[wasm_bindgen(js_name = "deleteConditionalFormatting")]
    pub fn delete_conditional_formatting(&mut self, sheet: u32, index: u32) -> Result<(), JsError> {
        self.model
            .delete_conditional_formatting(sheet, index)
            .map_err(|e| to_js_error(e.to_string()))
    }

    #[wasm_bindgen(js_name = "updateConditionalFormatting")]
    pub fn update_conditional_formatting(
        &mut self,
        sheet: u32,
        index: u32,
        new_range: &str,
        #[wasm_bindgen(unchecked_param_type = "CfRuleInput")] new_rule: JsValue,
    ) -> Result<(), JsError> {
        let new_rule: CfRuleInput =
            serde_wasm_bindgen::from_value(new_rule).map_err(|e| to_js_error(e.to_string()))?;
        self.model
            .update_conditional_formatting(sheet, index, new_range, new_rule)
            .map_err(|e| to_js_error(e.to_string()))
    }

    #[wasm_bindgen(js_name = "raiseConditionalFormattingPriority")]
    pub fn raise_conditional_formatting_priority(
        &mut self,
        sheet: u32,
        index: u32,
    ) -> Result<(), JsError> {
        self.model
            .raise_conditional_formatting_priority(sheet, index)
            .map_err(|e| to_js_error(e.to_string()))
    }

    #[wasm_bindgen(js_name = "lowerConditionalFormattingPriority")]
    pub fn lower_conditional_formatting_priority(
        &mut self,
        sheet: u32,
        index: u32,
    ) -> Result<(), JsError> {
        self.model
            .lower_conditional_formatting_priority(sheet, index)
            .map_err(|e| to_js_error(e.to_string()))
    }

    // Named styles

    #[wasm_bindgen(js_name = "getNamedStyleList", unchecked_return_type = "string[]")]
    pub fn get_named_style_list(&self) -> Vec<String> {
        self.model.get_named_style_list()
    }

    #[wasm_bindgen(js_name = "getNamedStyle", unchecked_return_type = "CellStyle")]
    pub fn get_named_style(&self, name: &str) -> Result<JsValue, JsError> {
        let style = self.model.get_named_style(name).map_err(to_js_error)?;
        serde_wasm_bindgen::to_value(&style).map_err(|e| to_js_error(e.to_string()))
    }

    /// Returns which formatting categories the named style includes.
    #[wasm_bindgen(
        js_name = "getNamedStyleIncludes",
        unchecked_return_type = "StyleIncludes"
    )]
    pub fn get_named_style_includes(&self, name: &str) -> Result<JsValue, JsError> {
        let includes = self
            .model
            .get_named_style_includes(name)
            .map_err(to_js_error)?;
        serde_wasm_bindgen::to_value(&includes).map_err(|e| to_js_error(e.to_string()))
    }

    /// Creates a new named style. `includes` selects which formatting
    /// categories the style carries.
    #[wasm_bindgen(js_name = "createNamedStyle")]
    pub fn create_named_style(
        &mut self,
        name: &str,
        #[wasm_bindgen(unchecked_param_type = "CellStyle")] style: JsValue,
        #[wasm_bindgen(unchecked_param_type = "StyleIncludes")] includes: JsValue,
    ) -> Result<(), JsError> {
        let style: Style =
            serde_wasm_bindgen::from_value(style).map_err(|e| to_js_error(e.to_string()))?;
        let includes: StyleIncludes =
            serde_wasm_bindgen::from_value(includes).map_err(|e| to_js_error(e.to_string()))?;
        self.model
            .create_named_style(name, &style, includes)
            .map_err(to_js_error)
    }

    #[wasm_bindgen(js_name = "deleteNamedStyle")]
    pub fn delete_named_style(&mut self, name: &str) -> Result<(), JsError> {
        self.model.delete_named_style(name).map_err(to_js_error)
    }

    #[wasm_bindgen(js_name = "updateNamedStyle")]
    pub fn update_named_style(
        &mut self,
        name: &str,
        new_name: &str,
        #[wasm_bindgen(unchecked_param_type = "CellStyle")] style: JsValue,
        #[wasm_bindgen(unchecked_param_type = "StyleIncludes")] includes: JsValue,
    ) -> Result<(), JsError> {
        let style: Style =
            serde_wasm_bindgen::from_value(style).map_err(|e| to_js_error(e.to_string()))?;
        let includes: StyleIncludes =
            serde_wasm_bindgen::from_value(includes).map_err(|e| to_js_error(e.to_string()))?;
        self.model
            .update_named_style(name, new_name, &style, includes)
            .map_err(to_js_error)
    }

    /// Returns all Excel built-in named styles as a `NamedStyle[]`.
    /// These are always available regardless of whether the workbook uses them.
    #[wasm_bindgen(
        js_name = "getBuiltinNamedStyles",
        unchecked_return_type = "NamedStyle[]"
    )]
    pub fn get_builtin_named_styles(&self) -> Result<JsValue, JsError> {
        #[derive(serde::Serialize)]
        struct NamedStyleEntry {
            name: String,
            style: Style,
        }
        let entries: Vec<NamedStyleEntry> = self
            .model
            .get_builtin_named_styles()
            .into_iter()
            .map(|(name, style)| NamedStyleEntry { name, style })
            .collect();
        serde_wasm_bindgen::to_value(&entries).map_err(|e| to_js_error(e.to_string()))
    }

    /// Applies a named style to the current selection.
    /// If the style is a built-in not yet in the workbook, it is added first.
    #[wasm_bindgen(js_name = "onApplyNamedStyle")]
    pub fn on_apply_named_style(&mut self, name: &str) -> Result<(), JsError> {
        self.model.on_apply_named_style(name).map_err(to_js_error)
    }

    #[wasm_bindgen(js_name = "moveSheet")]
    pub fn move_sheet(&mut self, sheet: u32, new_index: u32) -> Result<(), JsError> {
        self.model.move_sheet(sheet, new_index).map_err(to_js_error)
    }
}
