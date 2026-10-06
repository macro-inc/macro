use bitcode::{Decode, Encode};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, fmt::Display};

use crate::{cf_types::ConditionalFormatting, expressions::token::Error};

fn default_as_false() -> bool {
    false
}

fn is_false(b: &bool) -> bool {
    !*b
}

#[derive(Serialize, Deserialize, Encode, Decode, Debug, PartialEq, Clone, Default)]
#[serde(untagged)]
pub enum Color {
    Rgb(String),
    /// Theme slot index and tint. Tint ∈ [-1, 1]: positive lightens, negative darkens.
    Theme(i32, f64),
    /// No color — equivalent to OOXML `<color auto="1"/>` or absence of `<color>`.
    #[default]
    None,
}

/// Valid hex colors are #FFAABB
/// #fff is not valid
fn is_valid_hex_color(color: &str) -> bool {
    if color.chars().count() != 7 {
        return false;
    }
    if !color.starts_with('#') {
        return false;
    }
    if let Ok(z) = i32::from_str_radix(&color[1..], 16) {
        if (0..=0xffffff).contains(&z) {
            return true;
        }
    }
    false
}

impl Color {
    pub fn is_none(&self) -> bool {
        matches!(self, Color::None)
    }

    pub fn is_some(&self) -> bool {
        !matches!(self, Color::None)
    }

    /// Resolves the color to a `#RRGGBB` string, consulting the workbook theme when needed.
    /// Returns an empty string for `Color::None`.
    pub fn to_rgb(&self, theme: &Theme) -> String {
        match self {
            Color::Rgb(s) => s.clone(),
            Color::Theme(idx, tint) => theme.resolve(*idx, *tint),
            Color::None => String::new(),
        }
    }

    pub fn from_rgb(color: &str) -> Result<Self, String> {
        if is_valid_hex_color(color) {
            return Ok(Color::Rgb(color.to_string()));
        }
        Err(format!("Invalid color: '{}'.", color))
    }

    /// Parses a color from the JS/WASM parameter format:
    /// - `""` => `Color::None`
    /// - `"#RRGGBB"` => `Color::Rgb(...)`
    /// - `"[index, tint]"` => `Color::Theme(index, tint)`
    pub fn from_param(s: &str) -> Result<Self, String> {
        if s.is_empty() {
            return Ok(Color::None);
        }
        if is_valid_hex_color(s) {
            return Ok(Color::Rgb(s.to_string()));
        }
        if let Some(inner) = s.strip_prefix('[').and_then(|s| s.strip_suffix(']')) {
            let mut parts = inner.splitn(2, ',');
            if let (Some(idx_str), Some(tint_str)) = (parts.next(), parts.next()) {
                if let (Ok(idx), Ok(tint)) = (
                    idx_str.trim().parse::<i32>(),
                    tint_str.trim().parse::<f64>(),
                ) {
                    return Ok(Color::Theme(idx, tint));
                }
            }
        }
        Err(format!("Invalid color: '{}'.", s))
    }
}

#[derive(Encode, Decode, Debug, PartialEq, Eq, Clone)]
pub struct Metadata {
    pub application: String,
    pub app_version: String,
    pub creator: String,
    pub last_modified_by: String,
    pub created: String,       // "2020-08-06T21:20:53Z",
    pub last_modified: String, //"2020-11-20T16:24:35"
}

#[derive(Encode, Decode, Debug, PartialEq, Eq, Clone)]
pub struct WorkbookSettings {
    pub tz: String,
    pub locale: String,
}

/// A Workbook View tracks of the selected sheet for each view
#[derive(Encode, Decode, Debug, PartialEq, Clone)]
pub struct WorkbookView {
    /// The index of the currently selected sheet.
    pub sheet: u32,
    /// The current width of the window
    pub window_width: i64,
    /// The current height of the window
    pub window_height: i64,
}

/// An internal representation of an IronCalc Workbook
#[derive(Encode, Decode, Debug, PartialEq, Clone)]
pub struct Workbook {
    pub shared_strings: Vec<String>,
    pub defined_names: Vec<DefinedName>,
    pub worksheets: Vec<Worksheet>,
    pub styles: Styles,
    pub name: String,
    pub settings: WorkbookSettings,
    pub metadata: Metadata,
    pub tables: HashMap<String, Table>,
    pub views: HashMap<u32, WorkbookView>,
    pub theme: Theme,
}

/// A defined name. The `sheet_id` is the sheet index in case the name is local
#[derive(Encode, Decode, Debug, PartialEq, Eq, Clone)]
pub struct DefinedName {
    pub name: String,
    pub formula: String,
    pub sheet_id: Option<u32>,
}

/// * state:
///   18.18.68 ST_SheetState (Sheet Visibility Types)
///   hidden, veryHidden, visible
#[derive(Encode, Decode, Debug, PartialEq, Eq, Clone)]
pub enum SheetState {
    Visible,
    Hidden,
    VeryHidden,
}

impl Display for SheetState {
    fn fmt(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
        match self {
            SheetState::Visible => write!(formatter, "visible"),
            SheetState::Hidden => write!(formatter, "hidden"),
            SheetState::VeryHidden => write!(formatter, "veryHidden"),
        }
    }
}

/// Represents the state of the worksheet as seen by the user. This includes
/// details such as the currently selected cell, the visible range, and the
/// position of the viewport.
#[derive(Encode, Decode, Debug, PartialEq, Clone)]
pub struct WorksheetView {
    /// The row index of the currently selected cell (the anchor of the selection).
    pub row: i32,
    /// The column index of the currently selected cell (the anchor of the selection).
    pub column: i32,
    /// The selected range in the worksheet, specified as [start_row, start_column, end_row, end_column].
    /// Always normalized (start <= end). This is derived state: the bounding box of the
    /// anchor and the focus, grown so it never covers a merged cell partially.
    pub range: [i32; 4],
    /// The row of the focus: the moving corner of the selection, the one that
    /// keyboard- or pointer-extending the selection displaces. It is not
    /// necessarily a corner of `range` (extending over merged cells grows the
    /// range beyond the anchor-focus bounding box).
    pub focus_row: i32,
    /// The column of the focus.
    pub focus_column: i32,
    /// The row index of the topmost visible cell in the worksheet view.
    pub top_row: i32,
    /// The column index of the leftmost visible cell in the worksheet view.
    pub left_column: i32,
}

/// Represents a hyperlink in the worksheet, which can be either external or internal.
/// The display text is not part of the link, it is the content of the cell the link is
/// attached to. Links are just cell metadata.
#[derive(Serialize, Deserialize, Encode, Decode, Debug, PartialEq, Eq, Clone)]
#[serde(tag = "type")]
pub enum Link {
    /// A link to a resource outside the workbook: an URL, a mailto: URI or a file.
    /// If the target points to a location inside another document it is written
    /// as `target#location` (e.g. `file.xlsx#Sheet1!A1`).
    External {
        target: String,
        tooltip: Option<String>,
    },
    /// A link to a location in this workbook: a cell reference like `Sheet1!A30`
    /// or a defined name.
    Internal {
        location: String,
        tooltip: Option<String>,
    },
}

/// A rectangular range of cells that is displayed as a single cell.
/// The anchor (top-left) cell holds the content and is the only cell of the
/// range users can edit; every other cell of the range is "covered" and must
/// stay empty of content, although it can hold styles.
#[derive(Serialize, Deserialize, Encode, Decode, Debug, PartialEq, Eq, Clone, Copy)]
pub struct MergedCell {
    /// Row of the anchor (top-left) cell
    pub row: i32,
    /// Column of the anchor (top-left) cell
    pub column: i32,
    /// Number of columns of the merged range (>= 1)
    pub width: i32,
    /// Number of rows of the merged range (>= 1)
    pub height: i32,
}

impl MergedCell {
    /// Last (bottom) row of the merged range
    pub fn last_row(&self) -> i32 {
        self.row + self.height - 1
    }

    /// Last (rightmost) column of the merged range
    pub fn last_column(&self) -> i32 {
        self.column + self.width - 1
    }

    /// Returns true if (row, column) is inside the merged range
    pub fn contains(&self, row: i32, column: i32) -> bool {
        row >= self.row
            && row <= self.last_row()
            && column >= self.column
            && column <= self.last_column()
    }

    /// Returns true if the merged range intersects the rectangle of `width` columns
    /// and `height` rows anchored at (row, column)
    pub fn intersects(&self, row: i32, column: i32, width: i32, height: i32) -> bool {
        row <= self.last_row()
            && row + height > self.row
            && column <= self.last_column()
            && column + width > self.column
    }
}

/// Internal representation of a worksheet Excel object
#[derive(Encode, Decode, Debug, PartialEq, Clone)]
pub struct Worksheet {
    pub dimension: String,
    pub cols: Vec<Col>,
    pub rows: Vec<Row>,
    pub name: String,
    pub sheet_data: SheetData,
    pub shared_formulas: Vec<String>,
    pub sheet_id: u32,
    pub state: SheetState,
    pub color: Color,
    pub merged_cells: Vec<MergedCell>,
    pub comments: Vec<Comment>,
    pub frozen_rows: i32,
    pub frozen_columns: i32,
    pub views: HashMap<u32, WorksheetView>,
    /// Whether or not to show the grid lines in the worksheet
    pub show_grid_lines: bool,
    pub conditional_formatting: Vec<ConditionalFormatting>,
    /// Hyperlinks in the worksheet, keyed by (row, column) of the cell they are attached to
    pub links: HashMap<(i32, i32), Link>,
}

/// Internal representation of Excel's sheet_data
/// It is row first and because of this all of our API's should be row first
pub use crate::sheet_data::SheetData;

// ECMA-376-1:2016 section 18.3.1.73
#[derive(Encode, Decode, Debug, PartialEq, Clone)]
pub struct Row {
    /// Row index
    pub r: i32,
    pub height: f64,
    pub custom_format: bool,
    pub custom_height: bool,
    pub s: i32,
    pub hidden: bool,
}

// ECMA-376-1:2016 section 18.3.1.13
#[derive(Encode, Decode, Debug, PartialEq, Clone)]
pub struct Col {
    // Column definitions are defined on ranges, unlike rows which store unique, per-row entries.
    /// First column affected by this record. Settings apply to column in \[min, max\] range.
    pub min: i32,
    /// Last column affected by this record. Settings apply to column in \[min, max\] range.
    pub max: i32,
    pub width: f64,
    pub custom_width: bool,
    pub hidden: bool,
    pub style: Option<i32>,
}

/// Cell type enum matching Excel TYPE() function values.
#[derive(Debug, Eq, PartialEq)]
pub enum CellType {
    Number = 1,
    Text = 2,
    LogicalValue = 4,
    ErrorValue = 16,
    Array = 64,
    CompoundData = 128,
}

/// The evaluated value stored in a formula cell.
/// `Unevaluated` is a transient state that only exists during evaluation.
#[derive(Encode, Decode, Debug, Clone, PartialEq)]
pub enum FormulaValue {
    Unevaluated,
    Boolean(bool),
    Number(f64),
    Text(String),
    Error {
        ei: Error,
        // Origin cell reference, e.g. "Sheet3!C4"
        o: String,
        // Human-readable error message, e.g. "Not implemented function"
        m: String,
    },
}

/// The value stored in a spill cell (no formula, no origin tracking).
#[derive(Encode, Decode, Debug, Clone, PartialEq)]
pub enum SpillValue {
    Boolean(bool),
    Number(f64),
    Text(String),
    Error(Error),
}

/// Whether an array formula is a CSE (Ctrl+Shift+Enter) formula or a dynamic formula.
#[derive(Encode, Decode, Debug, Clone, PartialEq)]
pub enum ArrayKind {
    /// Ctrl+Shift+Enter array formula: fills a fixed declared range.
    Cse,
    /// Dynamic array formula: spills into adjacent cells automatically.
    Dynamic,
}

// A cell in a worksheet.
// Every cell has a style index (s) pointing to cell_xfs in the workbook styles.
// Other fields:
// * `f`    — formula index into the sheet's shared_formulas list
// * `si`   — shared string index (SharedString cells only)
// * `v`    — evaluated value (formula/spill cells)
// * `r`    — spill range (width, height) for array/dynamic formula anchors
// * `kind` — Cse or Dynamic for array formula anchors
// * `a`    — anchor cell (row, column) for spill cells
#[derive(Encode, Decode, Debug, Clone, PartialEq)]
pub enum Cell {
    EmptyCell {
        s: i32,
    },
    BooleanCell {
        v: bool,
        s: i32,
    },
    NumberCell {
        v: f64,
        s: i32,
    },
    // Maybe we should not have this type. In Excel this is just a string
    ErrorCell {
        ei: Error,
        s: i32,
    },
    // Always a shared string
    SharedString {
        si: i32,
        s: i32,
    },
    // A regular (non-array) formula cell.
    // `v` is `Unevaluated` transiently during evaluation, then holds the result.
    CellFormula {
        f: i32,
        s: i32,
        v: FormulaValue,
    },
    // The anchor of an array or dynamic formula.
    // `kind` distinguishes CSE from dynamic; `r` is the spill range (width, height).
    // `v` is `Unevaluated` transiently during evaluation, then holds the anchor cell result.
    ArrayFormula {
        f: i32,
        s: i32,
        r: (i32, i32),
        kind: ArrayKind,
        v: FormulaValue,
    },
    // A spill cell: holds a value produced by an array/dynamic formula at `a` (row, column).
    SpillCell {
        s: i32,
        a: (i32, i32),
        v: SpillValue,
    },
}

impl Default for Cell {
    fn default() -> Self {
        Cell::EmptyCell { s: 0 }
    }
}

#[derive(Encode, Decode, Debug, PartialEq, Eq, Clone)]
pub struct Comment {
    pub text: String,
    pub author_name: String,
    pub author_id: Option<String>,
    pub cell_ref: String,
}

// ECMA-376-1:2016 section 18.5.1.2
#[derive(Encode, Decode, Debug, PartialEq, Eq, Clone)]
pub struct Table {
    pub name: String,
    pub display_name: String,
    pub sheet_name: String,
    pub reference: String,
    pub totals_row_count: u32,
    pub header_row_count: u32,
    pub header_row_dxf_id: Option<u32>,
    pub data_dxf_id: Option<u32>,
    pub totals_row_dxf_id: Option<u32>,
    pub columns: Vec<TableColumn>,
    pub style_info: TableStyleInfo,
    pub has_filters: bool,
}

// totals_row_label vs totals_row_function might be mutually exclusive. Use an enum?
// the totals_row_function is an enum not String methinks
#[derive(Encode, Decode, Debug, PartialEq, Eq, Clone)]
pub struct TableColumn {
    pub id: u32,
    pub name: String,
    pub totals_row_label: Option<String>,
    pub header_row_dxf_id: Option<u32>,
    pub data_dxf_id: Option<u32>,
    pub totals_row_dxf_id: Option<u32>,
    pub totals_row_function: Option<String>,
}

impl Default for TableColumn {
    fn default() -> Self {
        TableColumn {
            id: 0,
            name: "Column".to_string(),
            totals_row_label: None,
            totals_row_function: None,
            data_dxf_id: None,
            header_row_dxf_id: None,
            totals_row_dxf_id: None,
        }
    }
}

#[derive(Encode, Decode, Debug, PartialEq, Eq, Clone, Default)]
pub struct TableStyleInfo {
    pub name: Option<String>,
    pub show_first_column: bool,
    pub show_last_column: bool,
    pub show_row_stripes: bool,
    pub show_column_stripes: bool,
}

#[derive(Serialize, Deserialize, Encode, Decode, Debug, PartialEq, Clone, Default)]
pub struct DxfFont {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub strike: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub u: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub b: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub i: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sz: Option<i32>,
    #[serde(skip_serializing_if = "Color::is_none")]
    #[serde(default)]
    pub color: Color,
}

// Dxf stands for "Differential Formatting". It is used in places like:
// * conditional formatting
// * tables
// to specify partial formatting that overrides the cell formatting.
#[derive(Serialize, Deserialize, Encode, Decode, Debug, PartialEq, Clone, Default)]
pub struct Dxf {
    pub font: Option<DxfFont>,
    pub fill: Option<Fill>,
    pub border: Option<Border>,
    pub num_fmt: Option<NumFmt>,
    pub alignment: Option<Alignment>,
}

#[derive(Encode, Decode, Debug, PartialEq, Clone)]
pub struct Styles {
    pub num_fmts: Vec<NumFmt>,
    pub fonts: Vec<Font>,
    pub fills: Vec<Fill>,
    pub borders: Vec<Border>,
    pub cell_style_xfs: Vec<CellStyleXfs>,
    pub cell_xfs: Vec<CellXfs>,
    pub cell_styles: Vec<CellStyles>,
    pub dxfs: Vec<Dxf>,
}

impl Default for Styles {
    fn default() -> Self {
        Styles {
            num_fmts: vec![],
            fonts: vec![Default::default()],
            fills: vec![Default::default(), Default::default()],
            borders: vec![Default::default()],
            cell_style_xfs: vec![Default::default()],
            cell_xfs: vec![Default::default()],
            cell_styles: vec![Default::default()],
            dxfs: vec![],
        }
    }
}

#[derive(Serialize, Deserialize, Encode, Decode, Debug, PartialEq, Clone)]
pub struct Style {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alignment: Option<Alignment>,
    pub num_fmt: String,
    pub fill: Fill,
    pub font: Font,
    pub border: Border,
    pub quote_prefix: bool,
}

impl Default for Style {
    fn default() -> Self {
        Style {
            alignment: None,
            num_fmt: "general".to_string(),
            fill: Fill::default(),
            font: Font::default(),
            border: Border::default(),
            quote_prefix: false,
        }
    }
}

#[derive(Serialize, Deserialize, Encode, Decode, Debug, PartialEq, Eq, Clone)]
pub struct NumFmt {
    pub num_fmt_id: i32,
    pub format_code: String,
}

impl Default for NumFmt {
    fn default() -> Self {
        NumFmt {
            num_fmt_id: 0,
            format_code: "general".to_string(),
        }
    }
}

// ST_FontScheme simple type (§18.18.33).
// Usually major fonts are used for styles like headings,
// and minor fonts are used for body and paragraph text.
#[derive(Serialize, Deserialize, Encode, Decode, Debug, PartialEq, Eq, Clone)]
#[serde(rename_all = "lowercase")]
#[derive(Default)]
pub enum FontScheme {
    #[default]
    Minor,
    Major,
    None,
}

impl Display for FontScheme {
    fn fmt(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
        match self {
            FontScheme::Minor => write!(formatter, "minor"),
            FontScheme::Major => write!(formatter, "major"),
            FontScheme::None => write!(formatter, "none"),
        }
    }
}

#[derive(Serialize, Deserialize, Encode, Decode, Debug, PartialEq, Clone)]
pub struct Font {
    #[serde(default = "default_as_false")]
    #[serde(skip_serializing_if = "is_false")]
    pub strike: bool,
    #[serde(default = "default_as_false")]
    #[serde(skip_serializing_if = "is_false")]
    pub u: bool, // seems that Excel supports a bit more - double underline / account underline etc.
    #[serde(default = "default_as_false")]
    #[serde(skip_serializing_if = "is_false")]
    pub b: bool,
    #[serde(default = "default_as_false")]
    #[serde(skip_serializing_if = "is_false")]
    pub i: bool,
    pub sz: i32,
    #[serde(skip_serializing_if = "Color::is_none")]
    #[serde(default)]
    pub color: Color,
    pub name: String,
    // This is the font family fallback
    // 1 -> serif
    // 2 -> sans serif
    // 3 -> monospaced
    // ...
    pub family: i32,
    pub scheme: FontScheme,
}

impl Default for Font {
    fn default() -> Self {
        Font {
            strike: false,
            u: false,
            b: false,
            i: false,
            sz: 12,
            color: Color::None,
            name: "Inter".to_string(),
            family: 2,
            scheme: FontScheme::Minor,
        }
    }
}

#[derive(Serialize, Deserialize, Encode, Decode, Debug, PartialEq, Clone, Default)]
pub struct Fill {
    #[serde(skip_serializing_if = "Color::is_none")]
    #[serde(default)]
    pub color: Color,
}

#[derive(Serialize, Deserialize, Encode, Decode, Debug, PartialEq, Eq, Clone)]
#[serde(rename_all = "lowercase")]
#[derive(Default)]
pub enum HorizontalAlignment {
    Center,
    CenterContinuous,
    Distributed,
    Fill,
    #[default]
    General,
    Justify,
    Left,
    Right,
}

// Note that alignment in "General" depends on type

impl HorizontalAlignment {
    fn is_default(&self) -> bool {
        self == &HorizontalAlignment::default()
    }
}

// FIXME: Is there a way to generate this automatically?
impl Display for HorizontalAlignment {
    fn fmt(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
        match self {
            HorizontalAlignment::Center => write!(formatter, "center"),
            HorizontalAlignment::CenterContinuous => write!(formatter, "centerContinuous"),
            HorizontalAlignment::Distributed => write!(formatter, "distributed"),
            HorizontalAlignment::Fill => write!(formatter, "fill"),
            HorizontalAlignment::General => write!(formatter, "general"),
            HorizontalAlignment::Justify => write!(formatter, "justify"),
            HorizontalAlignment::Left => write!(formatter, "left"),
            HorizontalAlignment::Right => write!(formatter, "right"),
        }
    }
}

#[derive(Serialize, Deserialize, Encode, Decode, Debug, PartialEq, Eq, Clone)]
#[serde(rename_all = "lowercase")]
#[derive(Default)]
pub enum VerticalAlignment {
    #[default]
    Bottom,
    Center,
    Distributed,
    Justify,
    Top,
}

impl VerticalAlignment {
    fn is_default(&self) -> bool {
        self == &VerticalAlignment::default()
    }
}

impl Display for VerticalAlignment {
    fn fmt(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
        match self {
            VerticalAlignment::Bottom => write!(formatter, "bottom"),
            VerticalAlignment::Center => write!(formatter, "center"),
            VerticalAlignment::Distributed => write!(formatter, "distributed"),
            VerticalAlignment::Justify => write!(formatter, "justify"),
            VerticalAlignment::Top => write!(formatter, "top"),
        }
    }
}

// 1762
#[derive(Serialize, Deserialize, Encode, Decode, Debug, PartialEq, Eq, Clone, Default)]
pub struct Alignment {
    #[serde(default)]
    #[serde(skip_serializing_if = "HorizontalAlignment::is_default")]
    pub horizontal: HorizontalAlignment,
    #[serde(skip_serializing_if = "VerticalAlignment::is_default")]
    #[serde(default)]
    pub vertical: VerticalAlignment,
    #[serde(default = "default_as_false")]
    #[serde(skip_serializing_if = "is_false")]
    pub wrap_text: bool,
}

#[derive(Encode, Decode, Debug, PartialEq, Eq, Clone)]
pub struct CellStyleXfs {
    pub num_fmt_id: i32,
    pub font_id: i32,
    pub fill_id: i32,
    pub border_id: i32,
    pub apply_number_format: bool,
    pub apply_border: bool,
    pub apply_alignment: bool,
    pub apply_protection: bool,
    pub apply_font: bool,
    pub apply_fill: bool,
}

impl Default for CellStyleXfs {
    fn default() -> Self {
        CellStyleXfs {
            num_fmt_id: 0,
            font_id: 0,
            fill_id: 0,
            border_id: 0,
            apply_number_format: true,
            apply_border: true,
            apply_alignment: true,
            apply_protection: true,
            apply_font: true,
            apply_fill: true,
        }
    }
}

/// The formatting categories a named style includes — Excel's "Style Includes"
/// checkboxes, stored as the `apply*` attributes of the style's `cellStyleXfs`
/// record. Applying the style to a cell only stamps the included categories.
/// The default (like "Normal") includes everything; the built-in "Percent",
/// for example, includes only the number format.
#[derive(Serialize, Deserialize, Encode, Decode, Debug, PartialEq, Eq, Clone, Copy)]
#[serde(default)]
pub struct StyleIncludes {
    pub number_format: bool,
    pub font: bool,
    pub fill: bool,
    pub border: bool,
    pub alignment: bool,
    pub protection: bool,
}

impl Default for StyleIncludes {
    fn default() -> Self {
        StyleIncludes {
            number_format: true,
            font: true,
            fill: true,
            border: true,
            alignment: true,
            protection: true,
        }
    }
}

#[derive(Encode, Decode, Debug, PartialEq, Eq, Clone, Default)]
pub struct CellXfs {
    pub xf_id: i32,
    pub num_fmt_id: i32,
    pub font_id: i32,
    pub fill_id: i32,
    pub border_id: i32,
    pub apply_number_format: bool,
    pub apply_border: bool,
    pub apply_alignment: bool,
    pub apply_protection: bool,
    pub apply_font: bool,
    pub apply_fill: bool,
    pub quote_prefix: bool,
    pub alignment: Option<Alignment>,
}

#[derive(Encode, Decode, Debug, PartialEq, Eq, Clone)]
pub struct CellStyles {
    pub name: String,
    pub xf_id: i32,
    pub builtin_id: i32,
}

impl Default for CellStyles {
    fn default() -> Self {
        CellStyles {
            name: "normal".to_string(),
            xf_id: 0,
            builtin_id: 0,
        }
    }
}

#[derive(Serialize, Deserialize, Encode, Decode, Debug, PartialEq, Eq, PartialOrd, Clone)]
#[serde(rename_all = "lowercase")]
pub enum BorderStyle {
    Thin,
    Medium,
    Thick,
    Double,
    Dotted,
    SlantDashDot,
    MediumDashed,
    MediumDashDotDot,
    MediumDashDot,
}

impl Display for BorderStyle {
    fn fmt(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
        match self {
            BorderStyle::Thin => write!(formatter, "thin"),
            BorderStyle::Thick => write!(formatter, "thick"),
            BorderStyle::SlantDashDot => write!(formatter, "slantdashdot"),
            BorderStyle::MediumDashed => write!(formatter, "mediumdashed"),
            BorderStyle::MediumDashDotDot => write!(formatter, "mediumdashdotdot"),
            BorderStyle::MediumDashDot => write!(formatter, "mediumdashdot"),
            BorderStyle::Medium => write!(formatter, "medium"),
            BorderStyle::Double => write!(formatter, "double"),
            BorderStyle::Dotted => write!(formatter, "dotted"),
        }
    }
}

#[derive(Serialize, Deserialize, Encode, Decode, Debug, PartialEq, Clone)]
pub struct BorderItem {
    pub style: BorderStyle,
    #[serde(skip_serializing_if = "Color::is_none")]
    #[serde(default)]
    pub color: Color,
}

#[derive(Serialize, Deserialize, Encode, Decode, Debug, PartialEq, Clone, Default)]
pub struct Border {
    #[serde(default = "default_as_false")]
    #[serde(skip_serializing_if = "is_false")]
    pub diagonal_up: bool,
    #[serde(default = "default_as_false")]
    #[serde(skip_serializing_if = "is_false")]
    pub diagonal_down: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub left: Option<BorderItem>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub right: Option<BorderItem>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub top: Option<BorderItem>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bottom: Option<BorderItem>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diagonal: Option<BorderItem>,
}

/// Information need to show a sheet tab in the UI
/// The color is serialized only if it is not Color::None
#[derive(Serialize, Deserialize, Debug, PartialEq)]
pub struct SheetProperties {
    pub name: String,
    pub state: String,
    pub sheet_id: u32,
    #[serde(skip_serializing_if = "Color::is_none")]
    #[serde(default)]
    pub color: Color,
}

#[derive(Serialize, Deserialize, Encode, Decode, Debug, PartialEq, Eq, Clone)]
pub struct Theme {
    pub name: String,
    pub dk1: String,
    pub lt1: String,
    pub dk2: String,
    pub lt2: String,
    pub accent1: String,
    pub accent2: String,
    pub accent3: String,
    pub accent4: String,
    pub accent5: String,
    pub accent6: String,
    pub hlink: String,
    pub fol_hlink: String,
}

impl Default for Theme {
    fn default() -> Self {
        Theme {
            name: "Office".to_string(),
            dk1: "#000000".to_string(),
            lt1: "#FFFFFF".to_string(),
            dk2: "#44546A".to_string(),
            lt2: "#E7E6E6".to_string(),
            accent1: "#4472C4".to_string(),
            accent2: "#ED7D31".to_string(),
            accent3: "#A5A5A5".to_string(),
            accent4: "#FFC000".to_string(),
            accent5: "#5B9BD5".to_string(),
            accent6: "#70AD47".to_string(),
            hlink: "#0563C1".to_string(),
            fol_hlink: "#954F72".to_string(),
        }
    }
}

impl Theme {
    /// Resolves a `theme="N"` attribute (and optional `tint`) to an `#RRGGBB` string.
    /// Applies the OOXML dk/lt swap for indices 0–3.
    pub fn resolve(&self, theme_index: i32, tint: f64) -> String {
        use crate::colors::hex_with_tint_to_rgb;
        let color = match theme_index {
            0 => &self.lt1,
            1 => &self.dk1,
            2 => &self.lt2,
            3 => &self.dk2,
            4 => &self.accent1,
            5 => &self.accent2,
            6 => &self.accent3,
            7 => &self.accent4,
            8 => &self.accent5,
            9 => &self.accent6,
            10 => &self.hlink,
            11 => &self.fol_hlink,
            _ => &self.dk1,
        };
        hex_with_tint_to_rgb(color, tint)
    }
}

#[cfg(test)]
mod test {
    use super::*;
    #[test]
    fn test_is_valid_hex_color() {
        assert!(is_valid_hex_color("#000000"));
        assert!(is_valid_hex_color("#ffffff"));

        assert!(!is_valid_hex_color("000000"));
        assert!(!is_valid_hex_color("ffffff"));

        assert!(!is_valid_hex_color("#gggggg"));

        // Not obvious cases unrecognized as colors
        assert!(!is_valid_hex_color("#ffffff "));
        assert!(!is_valid_hex_color("#fff")); // CSS shorthand
        assert!(!is_valid_hex_color("#ffffff00")); // with alpha channel
    }
}
