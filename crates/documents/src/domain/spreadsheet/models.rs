//! Shared spreadsheet commands used by the AI tools and execution port.
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// Font family.
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum SpreadsheetFont {
    /// Sans.
    Sans,
    /// Serif.
    Serif,
    /// Mono.
    Mono,
}

/// Horizontal alignment.
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum SpreadsheetHorizontalAlign {
    /// Auto.
    Auto,
    /// Left.
    Left,
    /// Center.
    Center,
    /// Right.
    Right,
}

/// Vertical alignment.
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum SpreadsheetVerticalAlign {
    /// Top.
    Top,
    /// Middle.
    Middle,
    /// Bottom.
    Bottom,
}

/// Number interpretation and display; currency is USD and dates use UTC.
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum SpreadsheetNumberFormat {
    /// General.
    General,
    /// Number.
    Number,
    /// Currency.
    Currency,
    /// Percent.
    Percent,
    /// Date.
    Date,
    /// Time.
    Time,
    /// Scientific.
    Scientific,
    /// Text.
    Text,
}

/// Sparse cell styling patch. Omitted fields remain unchanged.
#[derive(Debug, Clone, Default, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SpreadsheetStyle {
    /// Bold text.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bold: Option<bool>,
    /// Italic text.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub italic: Option<bool>,
    /// Underlined text.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub underline: Option<bool>,
    /// Struck-through text.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub strikethrough: Option<bool>,
    /// Font family.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font_family: Option<SpreadsheetFont>,
    /// Font size in points, 8 through 36.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font_size: Option<u8>,
    /// Text color as #RRGGBB; empty string resets it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text_color: Option<String>,
    /// Fill color as #RRGGBB; empty string resets it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fill_color: Option<String>,
    /// Horizontal alignment.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub horizontal_align: Option<SpreadsheetHorizontalAlign>,
    /// Vertical alignment.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vertical_align: Option<SpreadsheetVerticalAlign>,
    /// Wrap text.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wrap: Option<bool>,
    /// Top border.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub border_top: Option<bool>,
    /// Right border.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub border_right: Option<bool>,
    /// Bottom border.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub border_bottom: Option<bool>,
    /// Left border.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub border_left: Option<bool>,
    /// Decimal places, 0 through 10; -1 restores automatic.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub decimals: Option<i8>,
    /// How to interpret and display the input.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub format: Option<SpreadsheetNumberFormat>,
}

/// Source text for one cell. Formulas start with =; a leading apostrophe forces literal text.
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SpreadsheetCellInput {
    /// A1 address, from A1 through Z1000.
    pub address: String,
    /// Raw text or formula, at most 10,000 characters.
    pub value: String,
}

/// A scratch formula evaluated without persisting it.
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SpreadsheetFormula {
    /// Optional label echoed with the result.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    /// Excel-style formula, beginning with =.
    pub formula: String,
}

/// Hypothetical inputs applied only to the calculation's disposable workbook.
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SpreadsheetOverride {
    /// Stable sheet ID or exact sheet name from ReadSpreadsheet.
    pub sheet_id: String,
    /// Cells to change in this hypothetical calculation.
    pub cells: Vec<SpreadsheetCellInput>,
}

/// A column width.
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SpreadsheetColumnWidth {
    /// Column letter A through Z.
    pub column: String,
    /// Width in pixels, 64 through 640.
    pub width: u16,
}

/// One operation in an atomic workbook edit. All operations validate before any write.
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum SpreadsheetOperation {
    /// Set raw values/formulas while preserving existing formatting.
    SetCells {
        /// Stable sheet ID or exact name.
        sheet_id: String,
        /// Cells and their new source inputs.
        cells: Vec<SpreadsheetCellInput>,
    },
    /// Apply a sparse formatting patch to a rectangle.
    FormatCells {
        /// Stable sheet ID or exact name.
        sheet_id: String,
        /// A1 rectangle, for example A1:D20.
        range: String,
        /// Properties to change; omitted properties remain unchanged.
        style: SpreadsheetStyle,
    },
    /// Clear a rectangle's inputs, optionally its formatting too.
    ClearCells {
        /// Stable sheet ID or exact name.
        sheet_id: String,
        /// A1 rectangle.
        range: String,
        /// Defaults to false; preserves formatting unless requested.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        clear_formatting: Option<bool>,
    },
    /// Repeat a source rectangle into a target using relative formula translation.
    FillCells {
        /// Stable sheet ID or exact name.
        sheet_id: String,
        /// Source rectangle.
        source_range: String,
        /// Target rectangle.
        target_range: String,
    },
    /// Add an empty sheet; later operations may address it by this name.
    AddSheet {
        /// Unique Excel-compatible name, at most 31 characters.
        name: String,
    },
    /// Rename a sheet; rejected when existing formulas directly reference its current name.
    RenameSheet {
        /// Stable sheet ID or exact name.
        sheet_id: String,
        /// New unique name.
        name: String,
    },
    /// Duplicate a sheet, including values, formulas, styles, and layout.
    DuplicateSheet {
        /// Stable sheet ID or exact name.
        sheet_id: String,
        /// Optional unique name for the copy.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        name: Option<String>,
    },
    /// Delete a sheet; the final sheet and directly referenced sheets are protected.
    DeleteSheet {
        /// Stable sheet ID or exact name.
        sheet_id: String,
    },
    /// Append rows, up to the 1,000-row sheet limit.
    AppendRows {
        /// Stable sheet ID or exact name.
        sheet_id: String,
        /// Number of rows to append.
        count: u16,
    },
    /// Resize one or more columns.
    ResizeColumns {
        /// Stable sheet ID or exact name.
        sheet_id: String,
        /// Column widths to set.
        columns: Vec<SpreadsheetColumnWidth>,
    },
}

/// The deterministic spreadsheet execution request.
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(
    tag = "action",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum SpreadsheetRequest {
    /// Inspect the live workbook.
    Read {
        /// Stable sheet ID or exact name; defaults to the first sheet.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        sheet_id: Option<String>,
        /// A1 rectangles. Omit for a compact overview; at most 500 returned cells.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        ranges: Option<Vec<String>>,
        /// Include supported cell styles.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        include_styles: Option<bool>,
    },
    /// Evaluate scratch formulas and optional hypothetical inputs.
    Calculate {
        /// Sheet in whose context unqualified references resolve.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        sheet_id: Option<String>,
        /// At most 20 formulas, evaluated without writes.
        formulas: Vec<SpreadsheetFormula>,
        /// Optional hypothetical cell inputs; never persisted.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        overrides: Option<Vec<SpreadsheetOverride>>,
    },
    /// Apply a guarded atomic mutation.
    Edit {
        /// Revision returned by ReadSpreadsheet; a mismatch changes nothing.
        expected_revision: String,
        /// Between 1 and 25 operations, affecting at most 2,000 cells.
        operations: Vec<SpreadsheetOperation>,
    },
}

/// A calculated scalar with its display text and optional error explanation.
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SpreadsheetValue {
    /// Scalar kind: blank, number, text, boolean, or error.
    #[serde(rename = "type")]
    pub kind: SpreadsheetValueKind,
    /// The typed scalar. Empty cells have a null value.
    pub value: serde_json::Value,
    /// Text shown in the spreadsheet.
    pub display: String,
    /// Explanation for an error result.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// The calculation result kind.
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum SpreadsheetValueKind {
    /// Empty cell.
    Blank,
    /// Numeric value.
    Number,
    /// Literal text.
    Text,
    /// Boolean value.
    Boolean,
    /// Formula error.
    Error,
}

/// Cell source and calculated result.
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SpreadsheetReadCell {
    /// A1 address.
    pub address: String,
    /// Exact persisted source input.
    pub source: String,
    /// Formula, when this input is calculated.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub formula: Option<String>,
    /// Cell formatting, when requested.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style: Option<SpreadsheetStyle>,
    /// The current calculation result.
    #[serde(flatten)]
    pub result: SpreadsheetValue,
}

/// Compact metadata for a sheet.
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SpreadsheetSheetSummary {
    /// Stable sheet identity for future calls.
    pub id: String,
    /// Current sheet name.
    pub name: String,
    /// Available rows.
    pub row_count: usize,
    /// Available columns.
    pub column_count: usize,
    /// Bounding rectangle of used cells, or null for an empty sheet.
    pub used_range: Option<String>,
    /// Number of populated cells.
    pub populated_cells: usize,
    /// Number of formulas.
    pub formula_cells: usize,
    /// Number of calculated errors.
    pub error_cells: usize,
}

/// Addressed range with explicit truncation.
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SpreadsheetReadRange {
    /// Stable sheet identity.
    pub sheet_id: String,
    /// Current sheet name.
    pub sheet_name: String,
    /// Requested or sampled rectangle.
    pub range: String,
    /// Cells with their sources and current results.
    pub cells: Vec<SpreadsheetReadCell>,
    /// True when a narrower follow-up read is needed to see every cell.
    pub truncated: bool,
}

/// One hypothetical formula result.
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SpreadsheetFormulaResult {
    /// Caller-supplied label.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    /// Evaluated scratch formula.
    pub formula: String,
    /// Calculated scalar.
    #[serde(flatten)]
    pub result: SpreadsheetValue,
}

/// Applied edit summary.
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SpreadsheetChange {
    /// Operation type.
    #[serde(rename = "type")]
    pub kind: String,
    /// Affected stable sheet identity.
    pub sheet_id: String,
    /// Human-readable change summary.
    pub summary: String,
    /// Affected range, when applicable.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub range: Option<String>,
}

/// Structured output from a deterministic workbook operation.
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(
    tag = "action",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum SpreadsheetResponse {
    /// Workbook inspection result.
    Read {
        /// Opaque revision required for EditSpreadsheet.
        revision: String,
        /// All visible sheets and their used bounds.
        sheets: Vec<SpreadsheetSheetSummary>,
        /// Addressed cells with raw inputs and calculated results.
        ranges: Vec<SpreadsheetReadRange>,
        /// Limits or issues the caller should account for.
        warnings: Vec<String>,
    },
    /// Scratch calculation result. No persistent changes were made.
    Calculate {
        /// Revision used for these calculations.
        revision: String,
        /// Results in input order.
        results: Vec<SpreadsheetFormulaResult>,
        /// Calculation limits or issues.
        warnings: Vec<String>,
    },
    /// Result of a persisted atomic edit.
    Edit {
        /// Revision after the edit; use a fresh read before further editing.
        revision: String,
        /// Whether a new change was persisted.
        applied: bool,
        /// Applied operation summaries.
        changes: Vec<SpreadsheetChange>,
        /// Sheet metadata after editing.
        sheets: Vec<SpreadsheetSheetSummary>,
        /// Issues requiring inspection, including formula errors.
        warnings: Vec<String>,
    },
}
