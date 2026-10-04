/* tslint:disable */
/* eslint-disable */

export interface Area {
  sheet: number;
  row: number;
  column: number;
  width: number;
  height: number;
}

// A rectangular range displayed as a single cell, anchored at its top-left
// corner. `width` is the number of columns and `height` the number of rows.
export interface MergedCell {
  row: number;
  column: number;
  width: number;
  height: number;
}

export enum BorderType {
  All = "All",
  Inner = "Inner",
  Outer = "Outer",
  Top = "Top",
  Right = "Right",
  Bottom = "Bottom",
  Left = "Left",
  CenterH = "CenterH",
  CenterV = "CenterV",
  None = "None",
}

export interface BorderArea {
  item: BorderItem;
  type: BorderType;
}

type ErrorType =
  | "REF"
  | "NAME"
  | "VALUE"
  | "DIV"
  | "NA"
  | "NUM"
  | "ERROR"
  | "NIMPL"
  | "SPILL"
  | "CALC"
  | "CIRC";

type OpCompareType =
  | "LessThan"
  | "GreaterThan"
  | "Equal"
  | "LessOrEqualThan"
  | "GreaterOrEqualThan"
  | "NonEqual";

type OpSumType = "Add" | "Minus";

type OpProductType = "Times" | "Divide";

interface ReferenceType {
  sheet: string | null;
  row: number;
  column: number;
  absolute_column: boolean;
  absolute_row: boolean;
}

interface ParsedReferenceType {
  column: number;
  row: number;
  absolute_column: boolean;
  absolute_row: boolean;
}

interface Reference {
  Reference: ReferenceType;
}

interface Range {
  Range: {
    sheet: string | null;
    left: ParsedReferenceType;
    right: ParsedReferenceType;
  };
}

export type TokenType =
  | "Illegal"
  | "EOF"
  | { Ident: string }
  | { String: string }
  | { Boolean: boolean }
  | { Number: number }
  | { Error: ErrorType }
  | { Compare: OpCompareType }
  | { Sum: OpSumType }
  | { Product: OpProductType }
  | "Power"
  | "LeftParenthesis"
  | "RightParenthesis"
  | "Colon"
  | "Semicolon"
  | "LeftBracket"
  | "RightBracket"
  | "LeftBrace"
  | "RightBrace"
  | "Comma"
  | "Bang"
  | "Percent"
  | "And"
  | "Spill"
  | "Backslash"
  | Reference
  | Range;

export interface MarkedToken {
  token: TokenType;
  start: number;
  end: number;
}

// What the grammar accepts at a cursor position while typing a formula.
// `{ FunctionName }` carries the partial name typed so far; `{ Argument }`
// carries the function name and the 1-based argument index.
export type ExpectedTokens =
  | "Range"
  | "Other"
  | { FunctionName: string }
  | { Argument: [string, number] };

export interface CompletionContext {
  expecting: ExpectedTokens[];
  // The span [replace_from, cursor) the UI should replace when inserting a
  // completion (e.g. the partial name being typed).
  replace_from: number;
}

export type CellArrayStructure =
  | "SingleCell"
  | { DynamicChild: [number, number, number, number] }
  | { DynamicAnchor: [number, number] }
  | { ArrayAnchor: [number, number] }
  | { ArrayChild: [number, number, number, number] };

export interface WorksheetProperties {
  name: string;
  /** Tab color. Absent when Color::None. */
  color?: Color;
  sheet_id: number;
  state: string;
}

/**
 * A cell color value. Matches the Rust `Color` enum serialized with `#[serde(untagged)]`:
 * - `string`           → `Color::Rgb("#RRGGBB")`
 * - `[number, number]` → `Color::Theme(index, tint)`
 * - absent/undefined   → `Color::None` (field omitted via skip_serializing_if)
 *
 * Pass to `model.resolveColor(color)` to get the final CSS hex string.
 */
export type Color = string | [number, number] | undefined;

interface CellStyleFill {
  color?: Color;
}

interface CellStyleFont {
  u: boolean;
  b: boolean;
  i: boolean;
  strike: boolean;
  sz: number;
  color?: Color;
  name: string;
  family: number;
  scheme: string;
}

export interface BorderOptions {
  color?: Color;
  style: BorderStyle;
  border: BorderType;
}

export enum BorderStyle {
  Thin = "thin",
  Medium = "medium",
  Thick = "thick",
  Double = "double",
  Dotted = "dotted",
  SlantDashDot = "slantdashdot",
  MediumDashed = "mediumdashed",
  MediumDashDotDot = "mediumdashdotdot",
  MediumDashDot = "mediumdashdot",
}

interface BorderItem {
  style: BorderStyle;
  color?: Color;
}

interface CellStyleBorder {
  diagonal_up?: boolean;
  diagonal_down?: boolean;
  left?: BorderItem;
  right?: BorderItem;
  top?: BorderItem;
  bottom?: BorderItem;
  diagonal?: BorderItem;
}

export type VerticalAlignment =
  | "bottom"
  | "center"
  | "distributed"
  | "justify"
  | "top";

export type HorizontalAlignment =
  | "left"
  | "center"
  | "right"
  | "general"
  | "centerContinuous"
  | "distributed"
  | "fill"
  | "justify";

interface Alignment {
  horizontal: HorizontalAlignment;
  vertical: VerticalAlignment;
  wrap_text: boolean;
}

export interface CellStyle {
  read_only: boolean;
  quote_prefix: boolean;
  fill: CellStyleFill;
  font: CellStyleFont;
  border: CellStyleBorder;
  num_fmt: string;
  alignment?: Alignment;
}

export type ValueOperator =
  | "Equal"
  | "GreaterThan"
  | "GreaterThanOrEqual"
  | "LessThan"
  | "LessThanOrEqual"
  | "NotEqual"
  | "Between"
  | "NotBetween";

export type TextOperator =
  | "Contains"
  | "DoesNotContain"
  | "BeginsWith"
  | "EndsWith"
  | "Equals";

export type PeriodType =
  | "Between"
  | "NotBetween"
  | "Yesterday"
  | "Today"
  | "Tomorrow"
  | "Last7Days"
  | "Next7Days"
  | "LastWeek"
  | "ThisWeek"
  | "NextWeek"
  | "LastMonth"
  | "ThisMonth"
  | "NextMonth"
  | "LastYear"
  | "ThisYear"
  | "NextYear";

export type Icon =
  | "ArrowUp"
  | "ArrowRight"
  | "ArrowDown"
  | "ArrowAngleUp"
  | "ArrowAngleDown"
  | "Circle"
  | "TriangleUp"
  | "TriangleDown"
  | "FlatRectangle"
  | "Rhombus"
  | "Flag"
  | "Check"
  | "Cross"
  | "Exclamation"
  | "Star"
  | "Heart"
  | "ThumbsUp"
  | "ThumbsDown"
  | "TriangleUpFilled"
  | "TriangleDownFilled";

export type Cfvo =
  | "Min"
  | "Max"
  | { Number: number }
  | { Percent: number }
  | { Percentile: number }
  | { Formula: string };

export interface ColorScaleThreshold {
  cfvo: Cfvo;
  color: Color;
}

export interface IconThreshold {
  icon: Icon;
  cfvo: Cfvo;
  color: Color;
  is_strict: boolean;
}

/** Stored CF rule returned by getConditionalFormattingList (no format field — use getDxfForConditionalFormatting to retrieve it). */
export type CfRule =
  | { type: "ColorScale"; thresholds: ColorScaleThreshold[] }
  | { type: "CellIs"; operator: ValueOperator; formula: string; formula2: string | null; stop_if_true: boolean }
  | { type: "Formula"; formula: string; stop_if_true: boolean }
  | { type: "Text"; operator: TextOperator; value: string; stop_if_true: boolean }
  | { type: "TimePeriod"; time_period: PeriodType; date1: string | null; date2: string | null; stop_if_true: boolean }
  | { type: "DuplicateValues"; stop_if_true: boolean }
  | { type: "UniqueValues"; stop_if_true: boolean }
  | { type: "Blanks"; stop_if_true: boolean }
  | { type: "NotBlanks"; stop_if_true: boolean }
  | { type: "Errors"; stop_if_true: boolean }
  | { type: "NoErrors"; stop_if_true: boolean }
  | { type: "AboveAverage"; stop_if_true: boolean }
  | { type: "BelowAverage"; stop_if_true: boolean }
  | { type: "Top10"; rank: number; percent: boolean; stop_if_true: boolean }
  | { type: "Bottom10"; rank: number; percent: boolean; stop_if_true: boolean }
  | { type: "DataBar"; min: Cfvo | null; max: Cfvo | null; positive_color: Color; negative_color: Color; is_gradient: boolean; show_value: boolean }
  | { type: "IconSet"; thresholds: IconThreshold[]; show_value: boolean }
  | { type: "IconRating"; icon: Icon; color: Color; thresholds: [Cfvo, boolean][]; show_value: boolean };

/** Input CF rule for addConditionalFormatting / updateConditionalFormatting.
 *  Dxf-based variants carry an inline `format` and a `stop_if_true` flag. */
export type CfRuleInput =
  | { type: "ColorScale"; thresholds: ColorScaleThreshold[] }
  | { type: "CellIs"; operator: ValueOperator; formula: string; formula2: string | null; format: Dxf; stop_if_true: boolean }
  | { type: "Formula"; formula: string; format: Dxf; stop_if_true: boolean }
  | { type: "Text"; operator: TextOperator; value: string; format: Dxf; stop_if_true: boolean }
  | { type: "TimePeriod"; time_period: PeriodType; date1: string | null; date2: string | null; format: Dxf; stop_if_true: boolean }
  | { type: "DuplicateValues"; format: Dxf; stop_if_true: boolean }
  | { type: "UniqueValues"; format: Dxf; stop_if_true: boolean }
  | { type: "Blanks"; format: Dxf; stop_if_true: boolean }
  | { type: "NotBlanks"; format: Dxf; stop_if_true: boolean }
  | { type: "Errors"; format: Dxf; stop_if_true: boolean }
  | { type: "NoErrors"; format: Dxf; stop_if_true: boolean }
  | { type: "AboveAverage"; format: Dxf; stop_if_true: boolean }
  | { type: "BelowAverage"; format: Dxf; stop_if_true: boolean }
  | { type: "Top10"; rank: number; percent: boolean; format: Dxf; stop_if_true: boolean }
  | { type: "Bottom10"; rank: number; percent: boolean; format: Dxf; stop_if_true: boolean }
  | { type: "DataBar"; min: Cfvo | null; max: Cfvo | null; positive_color: Color; negative_color: Color; is_gradient: boolean; show_value: boolean }
  | { type: "IconSet"; thresholds: IconThreshold[]; show_value: boolean }
  | { type: "IconRating"; icon: Icon; color: Color; thresholds: [Cfvo, boolean][]; show_value: boolean };

export type FontScheme = "minor" | "major" | "none";

export interface DxfFont {
  strike?: boolean;
  u?: boolean;
  b?: boolean;
  i?: boolean;
  sz?: number;
  color?: Color;
  name?: string;
  family?: number;
  scheme?: FontScheme;
}

export interface DxfFill {
  color?: Color;
}

export interface DxfBorderItem {
  style: BorderStyle;
  color?: Color;
}

export interface DxfBorder {
  diagonal_up?: boolean;
  diagonal_down?: boolean;
  left?: DxfBorderItem;
  right?: DxfBorderItem;
  top?: DxfBorderItem;
  bottom?: DxfBorderItem;
  diagonal?: DxfBorderItem;
}

export interface DxfNumFmt {
  num_fmt_id: number;
  format_code: string;
}

export interface DxfAlignment {
  horizontal?: HorizontalAlignment;
  vertical?: VerticalAlignment;
  wrap_text?: boolean;
}

export interface Dxf {
  font?: DxfFont;
  fill?: DxfFill;
  border?: DxfBorder;
  num_fmt?: DxfNumFmt;
  alignment?: DxfAlignment;
}

export interface ConditionalFormatting {
  range: string;
  cf_rule: CfRule;
  priority: number;
}

/** A CF rule plus its storage `index` in the worksheet's rule list, returned by
 * getConditionalFormattingList. The list is sorted by priority (descending), so
 * `index` — not the array position — must be used to address a rule in
 * getDxfForConditionalFormatting / updateConditionalFormatting /
 * deleteConditionalFormatting / raiseConditionalFormattingPriority /
 * lowerConditionalFormattingPriority. */
export interface ConditionalFormattingView {
  index: number;
  range: string;
  cf_rule: CfRule;
  priority: number;
}

export type IconSetType =
  | "Arrows3"
  | "ArrowsGray3"
  | "Arrows4"
  | "ArrowsGray4"
  | "Arrows5"
  | "ArrowsGray5"
  | "Triangles3"
  | "TrafficLights3"
  | "TrafficLights3Rimmed"
  | "TrafficLights4"
  | "Signs3"
  | "RedToBlack4"
  | "Symbols3Circled"
  | "Symbols3Uncircled"
  | "Flags3";

/** MACRO: one cell's conditional formatting, from getConditionalFormattingOverlay.
 *  Colors are #RRGGBB; absent fields leave the cell's own style. */
export interface CfOverlay {
  row: number;
  column: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  color?: string;
  fill?: string;
  num_fmt?: string;
  data_bar?: CfDataBar;
  icon?: CfIcon;
  rating?: CfRating;
}

export interface CfIcon {
  icon: Icon;
  color: Color;
  show_value: boolean;
}

export interface CfDataBar {
  positive_color: Color;
  negative_color: Color;
  is_gradient: boolean;
  value: number;
  axis_position: number;
  show_value: boolean;
}

export interface CfRating {
  icon: Icon;
  count: number;
  max: number;
  color: Color;
  show_value: boolean;
}

export interface ExtendedCellStyle {
  style: CellStyle;
  icon: CfIcon | null;
  data_bar: CfDataBar | null;
  rating: CfRating | null;
}

export interface SelectedView {
  sheet: number;
  row: number;
  column: number;
  range: [number, number, number, number];
  top_row: number;
  left_column: number;
}

// type ClipboardData = {
//   [row: number]: {
//       [column: number]: ClipboardCell;
//   };
// };

// type ClipboardData = Record<string, Record <string, ClipboardCell>>;
type ClipboardData = Map<number, Map <number, ClipboardCell>>;

export interface ClipboardCell {
  text: string;
  style: CellStyle;
  /** The link attached to the cell, when present */
  link?: Link | null;
}

export interface Clipboard {
  csv: string;
  data: ClipboardData;
  range: [number, number, number, number];
}

export interface DefinedName {
  name: string;
  scope?: number;
  formula: string;
}

/**
 * A cell hyperlink. The link is cell metadata: the text displayed in the cell
 * is the cell content, not part of the link.
 * External links point to a resource outside the workbook (an URL, a mailto:
 * URI or a file). Internal links point to a location in this workbook: a cell
 * reference like "Sheet1!A30" or a defined name.
 */
export type Link =
  | { type: "External"; target: string; tooltip?: string | null }
  | { type: "Internal"; location: string; tooltip?: string | null };

/** A link together with the cell (row, column) it is attached to. A dynamic
 * link is created by a formula like HYPERLINK: it cannot be edited or deleted,
 * only the formula can change it. */
export type CellLink = { row: number; column: number; dynamic: boolean } & Link;

export interface FmtSettings {
  currency: string;
  currency_format: string;
  short_date: string;
  short_date_example: string;
  long_date: string;
  long_date_example: string;
  number_fmt: string;
  number_example: string;
}

/** The formatting categories a named style includes. */
export interface StyleIncludes {
  number_format: boolean;
  font: boolean;
  fill: boolean;
  border: boolean;
  alignment: boolean;
  protection: boolean;
}

/** A named cell style (e.g. "Normal", "Heading 1", or a custom style). */
export interface NamedStyle {
  /** The style name. */
  name: string;
  /** The full style definition. */
  style: CellStyle;
}

/** A builtin workbook color theme returned by `getThemeList`. */
export interface IronCalcTheme {
  /** Display name, e.g. "Office", "Retrospect". */
  name: string;
  /** Dark 1 (text/background). */
  dk1: string;
  /** Light 1 (text/background). */
  lt1: string;
  /** Dark 2 (text/background). */
  dk2: string;
  /** Light 2 (text/background). */
  lt2: string;
  accent1: string;
  accent2: string;
  accent3: string;
  accent4: string;
  accent5: string;
  accent6: string;
  /** Hyperlink color. */
  hlink: string;
  /** Followed-hyperlink color. */
  fol_hlink: string;
}


export class Model {
    free(): void;
    [Symbol.dispose](): void;
    addConditionalFormatting(sheet: number, range: string, rule: CfRuleInput): void;
    applyExternalDiffs(diffs: Uint8Array): void;
    autoFillColumns(source_area: Area, to_column: number): void;
    autoFillRows(source_area: Area, to_row: number): void;
    canRedo(): boolean;
    canUndo(): boolean;
    copyToClipboard(): Clipboard;
    /**
     * Creates a new named style. `includes` selects which formatting
     * categories the style carries.
     */
    createNamedStyle(name: string, style: CellStyle, includes: StyleIncludes): void;
    /**
     * Cycles the references touched by the cursor through the four
     * absolute/relative states, Excel F4 style: A1 -> $A$1 -> A$1 -> $A1 -> A1.
     * Returns the new text together with the new cursor start and end.
     * `start` and `end` are char offsets into `value`.
     */
    cycleReference(value: string, start: number, end: number): [string, number, number];
    /**
     * Removes the link attached to the cell. It is not an error if the cell has no link.
     */
    deleteCellLink(sheet: number, row: number, column: number): void;
    deleteColumns(sheet: number, column: number, column_count: number): void;
    deleteConditionalFormatting(sheet: number, index: number): void;
    deleteDefinedName(name: string, scope?: number | null): void;
    deleteNamedStyle(name: string): void;
    deleteRows(sheet: number, row: number, row_count: number): void;
    deleteSheet(sheet: number): void;
    duplicateSheet(sheet: number): void;
    evaluate(): void;
    flushSendQueue(): Uint8Array;
    static fromBytes(bytes: Uint8Array, language_id: string): Model;
    /**
     * Returns all Excel built-in named styles as a `NamedStyle[]`.
     * These are always available regardless of whether the workbook uses them.
     */
    getBuiltinNamedStyles(): NamedStyle[];
    getCellArrayStructure(sheet: number, row: number, column: number): CellArrayStructure;
    getCellContent(sheet: number, row: number, column: number): string;
    /**
     * Returns the link attached to the cell or undefined if there isn't one.
     */
    getCellLink(sheet: number, row: number, column: number): Link | undefined;
    getCellStyle(sheet: number, row: number, column: number): ExtendedCellStyle;
    getCellType(sheet: number, row: number, column: number): number;
    getColumnWidth(sheet: number, column: number): number;
    getColumnsWithData(sheet: number, row: number): Int32Array;
    getConditionalFormattingList(sheet: number): ConditionalFormattingView[];
    /**
     * MACRO: the conditional formatting of every cell of `sheet` that a rule
     * matched in the last evaluation, in one call.
     */
    getConditionalFormattingOverlay(sheet: number): CfOverlay[];
    getDefinedNameList(): DefinedName[];
    getDxfForConditionalFormatting(sheet: number, index: number): Dxf | null;
    getFirstNonEmptyInRowAfterColumn(sheet: number, row: number, column: number): number | undefined;
    /**
     * Gets Settings format info
     */
    getFmtSettings(): FmtSettings;
    getFormattedCellValue(sheet: number, row: number, column: number): string;
    /**
     * Returns completion information for a formula being edited in a cell.
     * `formula` is the raw cell input (it may start with `=`) and `cursor` is a
     * char offset into it.
     */
    getFormulaCompletion(sheet: number, row: number, column: number, formula: string, cursor: number): CompletionContext;
    getFrozenColumnsCount(sheet: number): number;
    getFrozenRowsCount(sheet: number): number;
    /**
     * Gets the language of the model
     */
    getLanguage(): string;
    getLastNonEmptyInRowBeforeColumn(sheet: number, row: number, column: number): number | undefined;
    /**
     * Returns all the links in the worksheet sorted by (row, column).
     */
    getLinks(sheet: number): CellLink[];
    /**
     * Gets the locale of the model
     */
    getLocale(): string;
    getMergedCells(sheet: number): MergedCell[];
    getName(): string;
    getNamedStyle(name: string): CellStyle;
    /**
     * Returns which formatting categories the named style includes.
     */
    getNamedStyleIncludes(name: string): StyleIncludes;
    getNamedStyleList(): string[];
    getRowHeight(sheet: number, row: number): number;
    getRowsWithData(sheet: number, column: number): Int32Array;
    getScrollX(): number;
    getScrollY(): number;
    getSelectedCell(): Int32Array;
    getSelectedSheet(): number;
    getSelectedView(): SelectedView;
    getShowGridLines(sheet: number): boolean;
    /**
     * Returns the current workbook theme.
     */
    getTheme(): IronCalcTheme;
    /**
     * Gets the timezone of the model
     */
    getTimezone(): string;
    getWorksheetsProperties(): WorksheetProperties[];
    hideSheet(sheet: number): void;
    insertColumns(sheet: number, column: number, column_count: number): void;
    insertRows(sheet: number, row: number, row_count: number): void;
    isValidDefinedName(name: string, scope: number | null | undefined, formula: string): void;
    lowerConditionalFormattingPriority(sheet: number, index: number): void;
    mergeCells(range: Area): void;
    mergeCellsAcross(range: Area): void;
    mergeCellsCenter(range: Area): void;
    mergeCellsDown(range: Area): void;
    moveColumns(sheet: number, column: number, column_count: number, delta: number): void;
    moveRows(sheet: number, row: number, row_count: number, delta: number): void;
    moveSheet(sheet: number, new_index: number): void;
    constructor(name: string, locale: string, timezone: string, language_id: string);
    newDefinedName(name: string, scope: number | null | undefined, formula: string): void;
    newSheet(): void;
    /**
     * Applies a named style to the current selection.
     * If the style is a built-in not yet in the workbook, it is added first.
     */
    onApplyNamedStyle(name: string): void;
    onAreaSelecting(target_row: number, target_column: number): void;
    onArrowDown(): void;
    onArrowLeft(): void;
    onArrowRight(): void;
    onArrowUp(): void;
    onExpandSelectedRange(key: string): void;
    onNavigateToEdgeInDirection(direction: string): void;
    onPageDown(): void;
    onPageUp(): void;
    onPasteStyles(styles: CellStyle[][]): void;
    pasteCsvText(area: Area, csv: string): void;
    pasteFromClipboard(source_sheet: number, source_range: [number, number, number, number], clipboard: ClipboardData, is_cut: boolean): void;
    pauseEvaluation(): void;
    raiseConditionalFormattingPriority(sheet: number, index: number): void;
    rangeClearAll(sheet: number, start_row: number, start_column: number, end_row: number, end_column: number): void;
    rangeClearContents(sheet: number, start_row: number, start_column: number, end_row: number, end_column: number): void;
    rangeClearFormatting(sheet: number, start_row: number, start_column: number, end_row: number, end_column: number): void;
    redo(): void;
    renameSheet(sheet: number, name: string): void;
    /**
     * Resolves a `Color` value to a CSS hex string using the current workbook theme.
     * Accepts `Color`; returns `""` for absent/None colors.
     */
    resolveColor(color: Color): string;
    resumeEvaluation(): void;
    setAreaWithBorder(area: Area, border_area: BorderArea): void;
    /**
     * Attaches a link to a cell, replacing the existing one if there was one.
     * If `label` is given it becomes the content of the cell (the displayed text).
     * A new link also applies the link style (underline + theme hyperlink color)
     * to the cell. The whole operation is a single undo step.
     */
    setCellLink(sheet: number, row: number, column: number, link: Link, label?: string | null): void;
    setColumnsHidden(sheet: number, column_start: number, column_end: number, hidden: boolean): void;
    setColumnsWidth(sheet: number, column_start: number, column_end: number, width: number): void;
    setFrozenColumnsCount(sheet: number, count: number): void;
    setFrozenRowsCount(sheet: number, count: number): void;
    /**
     * Sets the language of the model
     */
    setLanguage(language: string): void;
    setLocale(locale: string): void;
    setName(name: string): void;
    setRowsHeight(sheet: number, row_start: number, row_end: number, height: number): void;
    setRowsHidden(sheet: number, row_start: number, row_end: number, hidden: boolean): void;
    setSelectedCell(row: number, column: number): void;
    setSelectedRange(start_row: number, start_column: number, end_row: number, end_column: number): void;
    setSelectedSheet(sheet: number): void;
    setSheetColor(sheet: number, color: Color): void;
    setShowGridLines(sheet: number, show_grid_lines: boolean): void;
    /**
     * Sets the workbook theme.
     */
    setTheme(theme: IronCalcTheme): void;
    setTimezone(timezone: string): void;
    setTopLeftVisibleCell(top_row: number, top_column: number): void;
    setUserArrayFormula(sheet: number, row: number, column: number, width: number, height: number, formula: string): void;
    setUserInput(sheet: number, row: number, column: number, input: string): void;
    setWindowHeight(window_height: number): void;
    setWindowWidth(window_width: number): void;
    toBytes(): Uint8Array;
    undo(): void;
    unhideSheet(sheet: number): void;
    unmergeCells(range: Area): void;
    updateConditionalFormatting(sheet: number, index: number, new_range: string, new_rule: CfRuleInput): void;
    updateDefinedName(name: string, scope: number | null | undefined, new_name: string, new_scope: number | null | undefined, new_formula: string): void;
    updateNamedStyle(name: string, new_name: string, style: CellStyle, includes: StyleIncludes): void;
    updateRangeStyle(range: Area, style_path: string, value: string): void;
}

export function columnNameFromNumber(column: number): string;

export function columnNumberFromName(column: string): number;

/**
 * Gets all timezones
 */
export function getAllTimezones(): string[];

/**
 * MACRO: the icons and colors of an Excel icon set such as `3Arrows` or
 * `3TrafficLights1`, lowest bucket first; `null` for sets it does not know.
 */
export function getIconSetIcons(name: string): [Icon, Color][] | null;

/**
 * Gets all supported locales
 */
export function getSupportedLocales(): string[];

/**
 * Returns the list of builtin themes with their color slots.
 */
export function getThemeList(): IronCalcTheme[];

/**
 * Return an array with a list of all the tokens from a formula
 * This is used by the UI to color them according to a theme.
 */
export function getTokens(formula: string): MarkedToken[];

/**
 * Tint algorithm
 */
export function hexWithTintToRgb(hex: string, tint: number): string;

export function quoteName(name: string): string;

/**
 * MACRO: fixes the time NOW and TODAY read, in milliseconds since January 1,
 * 1970, for every model; `undefined` returns to the system clock.
 */
export function setFixedTime(milliseconds?: number | null): void;

/**
 * MACRO: makes RAND, RANDBETWEEN and RANDARRAY repeat the sequence of `seed`
 * in every model; `undefined` returns to `Math.random`.
 */
export function setRandomSeed(seed?: number | null): void;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_model_free: (a: number, b: number) => void;
    readonly columnNameFromNumber: (a: number) => [number, number, number, number];
    readonly columnNumberFromName: (a: number, b: number) => [number, number, number];
    readonly getAllTimezones: () => [number, number];
    readonly getIconSetIcons: (a: number, b: number) => [number, number, number];
    readonly getSupportedLocales: () => [number, number];
    readonly getThemeList: () => any;
    readonly getTokens: (a: number, b: number) => [number, number, number];
    readonly hexWithTintToRgb: (a: number, b: number, c: number) => [number, number];
    readonly model_addConditionalFormatting: (a: number, b: number, c: number, d: number, e: any) => [number, number];
    readonly model_applyExternalDiffs: (a: number, b: number, c: number) => [number, number];
    readonly model_autoFillColumns: (a: number, b: any, c: number) => [number, number];
    readonly model_autoFillRows: (a: number, b: any, c: number) => [number, number];
    readonly model_canRedo: (a: number) => number;
    readonly model_canUndo: (a: number) => number;
    readonly model_copyToClipboard: (a: number) => [number, number, number];
    readonly model_createNamedStyle: (a: number, b: number, c: number, d: any, e: any) => [number, number];
    readonly model_cycleReference: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly model_deleteCellLink: (a: number, b: number, c: number, d: number) => [number, number];
    readonly model_deleteColumns: (a: number, b: number, c: number, d: number) => [number, number];
    readonly model_deleteConditionalFormatting: (a: number, b: number, c: number) => [number, number];
    readonly model_deleteDefinedName: (a: number, b: number, c: number, d: number) => [number, number];
    readonly model_deleteNamedStyle: (a: number, b: number, c: number) => [number, number];
    readonly model_deleteRows: (a: number, b: number, c: number, d: number) => [number, number];
    readonly model_deleteSheet: (a: number, b: number) => [number, number];
    readonly model_duplicateSheet: (a: number, b: number) => [number, number];
    readonly model_evaluate: (a: number) => void;
    readonly model_flushSendQueue: (a: number) => [number, number];
    readonly model_fromBytes: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly model_getBuiltinNamedStyles: (a: number) => [number, number, number];
    readonly model_getCellArrayStructure: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly model_getCellContent: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly model_getCellLink: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly model_getCellStyle: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly model_getCellType: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly model_getColumnWidth: (a: number, b: number, c: number) => [number, number, number];
    readonly model_getColumnsWithData: (a: number, b: number, c: number) => [number, number, number, number];
    readonly model_getConditionalFormattingList: (a: number, b: number) => [number, number, number];
    readonly model_getConditionalFormattingOverlay: (a: number, b: number) => [number, number, number];
    readonly model_getDefinedNameList: (a: number) => [number, number, number];
    readonly model_getDxfForConditionalFormatting: (a: number, b: number, c: number) => [number, number, number];
    readonly model_getFirstNonEmptyInRowAfterColumn: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly model_getFmtSettings: (a: number) => [number, number, number];
    readonly model_getFormattedCellValue: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly model_getFormulaCompletion: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number];
    readonly model_getFrozenColumnsCount: (a: number, b: number) => [number, number, number];
    readonly model_getFrozenRowsCount: (a: number, b: number) => [number, number, number];
    readonly model_getLanguage: (a: number) => [number, number];
    readonly model_getLastNonEmptyInRowBeforeColumn: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly model_getLinks: (a: number, b: number) => [number, number, number];
    readonly model_getLocale: (a: number) => [number, number];
    readonly model_getMergedCells: (a: number, b: number) => [number, number, number];
    readonly model_getName: (a: number) => [number, number];
    readonly model_getNamedStyle: (a: number, b: number, c: number) => [number, number, number];
    readonly model_getNamedStyleIncludes: (a: number, b: number, c: number) => [number, number, number];
    readonly model_getNamedStyleList: (a: number) => [number, number];
    readonly model_getRowHeight: (a: number, b: number, c: number) => [number, number, number];
    readonly model_getRowsWithData: (a: number, b: number, c: number) => [number, number, number, number];
    readonly model_getScrollX: (a: number) => [number, number, number];
    readonly model_getScrollY: (a: number) => [number, number, number];
    readonly model_getSelectedCell: (a: number) => [number, number];
    readonly model_getSelectedSheet: (a: number) => number;
    readonly model_getSelectedView: (a: number) => any;
    readonly model_getShowGridLines: (a: number, b: number) => [number, number, number];
    readonly model_getTheme: (a: number) => [number, number, number];
    readonly model_getTimezone: (a: number) => [number, number];
    readonly model_getWorksheetsProperties: (a: number) => any;
    readonly model_hideSheet: (a: number, b: number) => [number, number];
    readonly model_insertColumns: (a: number, b: number, c: number, d: number) => [number, number];
    readonly model_insertRows: (a: number, b: number, c: number, d: number) => [number, number];
    readonly model_isValidDefinedName: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly model_lowerConditionalFormattingPriority: (a: number, b: number, c: number) => [number, number];
    readonly model_mergeCells: (a: number, b: any) => [number, number];
    readonly model_mergeCellsAcross: (a: number, b: any) => [number, number];
    readonly model_mergeCellsCenter: (a: number, b: any) => [number, number];
    readonly model_mergeCellsDown: (a: number, b: any) => [number, number];
    readonly model_moveColumns: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly model_moveRows: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly model_moveSheet: (a: number, b: number, c: number) => [number, number];
    readonly model_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number];
    readonly model_newDefinedName: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly model_newSheet: (a: number) => [number, number];
    readonly model_onApplyNamedStyle: (a: number, b: number, c: number) => [number, number];
    readonly model_onAreaSelecting: (a: number, b: number, c: number) => [number, number];
    readonly model_onArrowDown: (a: number) => [number, number];
    readonly model_onArrowLeft: (a: number) => [number, number];
    readonly model_onArrowRight: (a: number) => [number, number];
    readonly model_onArrowUp: (a: number) => [number, number];
    readonly model_onExpandSelectedRange: (a: number, b: number, c: number) => [number, number];
    readonly model_onNavigateToEdgeInDirection: (a: number, b: number, c: number) => [number, number];
    readonly model_onPageDown: (a: number) => [number, number];
    readonly model_onPageUp: (a: number) => [number, number];
    readonly model_onPasteStyles: (a: number, b: any) => [number, number];
    readonly model_pasteCsvText: (a: number, b: any, c: number, d: number) => [number, number];
    readonly model_pasteFromClipboard: (a: number, b: number, c: any, d: any, e: number) => [number, number];
    readonly model_pauseEvaluation: (a: number) => void;
    readonly model_raiseConditionalFormattingPriority: (a: number, b: number, c: number) => [number, number];
    readonly model_rangeClearAll: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly model_rangeClearContents: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly model_rangeClearFormatting: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly model_redo: (a: number) => [number, number];
    readonly model_renameSheet: (a: number, b: number, c: number, d: number) => [number, number];
    readonly model_resolveColor: (a: number, b: any) => [number, number];
    readonly model_resumeEvaluation: (a: number) => void;
    readonly model_setAreaWithBorder: (a: number, b: any, c: any) => [number, number];
    readonly model_setCellLink: (a: number, b: number, c: number, d: number, e: any, f: number, g: number) => [number, number];
    readonly model_setColumnsHidden: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly model_setColumnsWidth: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly model_setFrozenColumnsCount: (a: number, b: number, c: number) => [number, number];
    readonly model_setFrozenRowsCount: (a: number, b: number, c: number) => [number, number];
    readonly model_setLanguage: (a: number, b: number, c: number) => [number, number];
    readonly model_setLocale: (a: number, b: number, c: number) => [number, number];
    readonly model_setName: (a: number, b: number, c: number) => void;
    readonly model_setRowsHeight: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly model_setRowsHidden: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly model_setSelectedCell: (a: number, b: number, c: number) => [number, number];
    readonly model_setSelectedRange: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly model_setSelectedSheet: (a: number, b: number) => [number, number];
    readonly model_setSheetColor: (a: number, b: number, c: any) => [number, number];
    readonly model_setShowGridLines: (a: number, b: number, c: number) => [number, number];
    readonly model_setTheme: (a: number, b: any) => [number, number];
    readonly model_setTimezone: (a: number, b: number, c: number) => [number, number];
    readonly model_setTopLeftVisibleCell: (a: number, b: number, c: number) => [number, number];
    readonly model_setUserArrayFormula: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number];
    readonly model_setUserInput: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly model_setWindowHeight: (a: number, b: number) => void;
    readonly model_setWindowWidth: (a: number, b: number) => void;
    readonly model_toBytes: (a: number) => [number, number];
    readonly model_undo: (a: number) => [number, number];
    readonly model_unhideSheet: (a: number, b: number) => [number, number];
    readonly model_unmergeCells: (a: number, b: any) => [number, number];
    readonly model_updateConditionalFormatting: (a: number, b: number, c: number, d: number, e: number, f: any) => [number, number];
    readonly model_updateDefinedName: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => [number, number];
    readonly model_updateNamedStyle: (a: number, b: number, c: number, d: number, e: number, f: any, g: any) => [number, number];
    readonly model_updateRangeStyle: (a: number, b: any, c: number, d: number, e: number, f: number) => [number, number];
    readonly quoteName: (a: number, b: number) => [number, number];
    readonly setFixedTime: (a: number, b: number) => void;
    readonly setRandomSeed: (a: number, b: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __externref_drop_slice: (a: number, b: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
