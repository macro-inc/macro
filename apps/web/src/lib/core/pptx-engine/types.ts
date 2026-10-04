/**
 * The JSON shapes exchanged with `pptx_engine` (crates/pptx_engine). They
 * mirror `inspect::{DeckOutline, SlideOutline, ShapeOutline, TextLayoutInfo}`
 * and `edit::{EditOp, EditResult}`; field names are the serde camelCase
 * spellings. Lengths are in points (1/72 inch) in slide coordinates.
 */

export type ShapeKind =
  | 'text'
  | 'shape'
  | 'connector'
  | 'picture'
  | 'table'
  | 'chart'
  | 'diagram'
  | 'object'
  | 'group'
  | 'other';

export interface ParagraphOutline {
  /** Paragraph text; `\u000b` marks a line break. */
  text: string;
  level: number;
}

export interface TableOutline {
  /** Cell text by row (`\n` between paragraphs; merged-over cells are empty). */
  rows: string[][];
  columnWidths: number[];
  /** Minimum row heights as stored (rows grow to fit their text). */
  rowHeights: number[];
  /** Cells by row and grid column. */
  cells: CellOutline[][];
  /**
   * Row heights as drawn, after rows grew to fit their text. Cell `(r, c)`
   * starts at the frame's top-left corner plus the sums of the first `c`
   * column widths and the first `r` of these heights.
   */
  laidOutRowHeights: number[];
  /** The table style, when one is set. */
  style?: TableStyleOutline;
}

export type CellAnchor = 'top' | 'middle' | 'bottom';

/** One grid cell of a table. Mirrors `inspect::CellOutline`. */
export interface CellOutline {
  /** Rows the cell spans (1 unless merged). */
  rowSpan: number;
  /** Grid columns the cell spans (1 unless merged). */
  colSpan: number;
  /** Covered by another cell's span: not drawn, and edits go to that cell. */
  merged: boolean;
  /** Solid fill as `#RRGGBB`, from the cell or its table style. */
  fill?: string;
  anchor: CellAnchor;
  /** `[left, top, right, bottom]` margins. */
  margins: [number, number, number, number];
}

/** A table's style and the parts it emphasizes. */
export interface TableStyleOutline {
  /** Style id (a GUID). */
  id: string;
  name: string;
  firstRow: boolean;
  lastRow: boolean;
  firstCol: boolean;
  lastCol: boolean;
  bandRow: boolean;
  bandCol: boolean;
}

/** A table style the deck's tables can use (`DeckOutline.tableStyles`). */
export interface TableStyleInfo {
  id: string;
  name: string;
  /** `custom` styles are defined by the deck; the rest are PowerPoint's built-in ones. */
  category: 'custom' | 'light' | 'medium' | 'dark';
}

export type ChartKind =
  | 'bar'
  | 'column'
  | 'line'
  | 'pie'
  | 'doughnut'
  | 'area'
  | 'scatter'
  | 'radar'
  | 'bubble'
  | 'stock'
  | 'surface'
  | 'other';

export type ChartGrouping =
  | 'clustered'
  | 'stacked'
  | 'percentStacked'
  | 'standard';

export type LegendPosition = 'right' | 'left' | 'top' | 'bottom' | 'topRight';

export interface ChartSeriesOutline {
  name: string;
  /** Values per category (`null` for blanks). */
  values: (number | null)[];
  /** Explicit series color as `#RRGGBB`. */
  color?: string;
}

export interface ChartOutline {
  kind: ChartKind;
  grouping?: ChartGrouping;
  title?: string;
  /** Legend position; absent when there is no legend. */
  legend?: LegendPosition;
  dataLabels: boolean;
  categories: string[];
  series: ChartSeriesOutline[];
  /** Whether setChartData/setChartType can rewrite it. */
  editable: boolean;
}

/** A chart type new charts and setChartType accept. */
export type EditableChartKind =
  | 'bar'
  | 'column'
  | 'line'
  | 'pie'
  | 'doughnut'
  | 'area';

export interface ChartSeriesData {
  name: string;
  values: (number | null)[];
}

export interface ShapeOutline {
  id: number;
  name: string;
  kind: ShapeKind;
  placeholder?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  flipH: boolean;
  flipV: boolean;
  hidden: boolean;
  altText?: string;
  geometry?: string;
  /** Solid fill as `#RRGGBB`. */
  fill?: string;
  /** Whether text operations apply to this shape. */
  textEditable: boolean;
  paragraphs?: ParagraphOutline[];
  table?: TableOutline;
  /** Chart content, for charts. */
  chart?: ChartOutline;
  /**
   * Group members, back to front. Their box, rotation, and flips are in
   * slide space (what `setTransform` takes and ungrouping gives them).
   */
  children?: ShapeOutline[];
}

export interface SlideOutline {
  /** Stable slide id (survives reordering). */
  id: number;
  index: number;
  layout: string;
  hidden: boolean;
  title?: string;
  shapes: ShapeOutline[];
  notes?: string;
  /** The transition into the slide. */
  transition?: TransitionOutline;
}

export interface LayoutInfo {
  part: string;
  name: string;
  kind: string;
  master: string;
}

export interface DeckOutline {
  width: number;
  height: number;
  slides: SlideOutline[];
  layouts: LayoutInfo[];
  /** `[slot, '#RRGGBB']` pairs of the first master's theme (`dk1`, `accent1`...). */
  themeColors: [string, string][];
  /** The theme's heading (major) and body (minor) Latin fonts. */
  themeFonts?: { major: string; minor: string };
  /** Table styles to offer: the deck's own, then the built-in ones in gallery order. */
  tableStyles: TableStyleInfo[];
}

export interface CaretStop {
  /** Character index within the paragraph. */
  index: number;
  x: number;
}

export interface LineBox {
  paragraph: number;
  top: number;
  baseline: number;
  bottom: number;
  stops: CaretStop[];
}

export interface RunStyle {
  start: number;
  end: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  size: number;
  /** `#RRGGBB` for solid text fills. */
  color?: string;
  font: string;
  /** Baseline shift in percent (positive = superscript). */
  baseline?: number;
  /** Highlight color as `#RRGGBB`. */
  highlight?: string;
}

export interface ParagraphStyle {
  align: 'left' | 'center' | 'right' | 'justify' | 'distributed';
  level: number;
  bullet: boolean;
  runs: RunStyle[];
  /** Formatting of the paragraph end mark (new text typed at the end). */
  end: RunStyle;
}

export interface TextLayoutInfo {
  /** Layout space → slide space, `[a, b, c, d, e, f]`. */
  transform: [number, number, number, number, number, number];
  size: [number, number];
  /** Paragraph texts indexed like caret stops (`\u000b` = line break). */
  paragraphs: string[];
  lines: LineBox[];
  /** Resolved paragraph and run formatting, indexed like `paragraphs`. */
  styles: ParagraphStyle[];
}

export interface TextPos {
  paragraph: number;
  offset: number;
}

export interface CellRef {
  row: number;
  col: number;
}

export interface RunPatch {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  size?: number;
  /** `RRGGBB` or a theme color name (`accent1`, `tx1`...). */
  color?: string;
  font?: string;
  highlight?: string;
  baseline?: number;
  link?: string;
}

export type BulletSpec =
  | { kind: 'none' }
  | { kind: 'inherit' }
  | { kind: 'char'; char: string }
  | { kind: 'number'; scheme: string; start?: number };

export interface ParaPatch {
  align?: 'left' | 'center' | 'right' | 'justify' | 'distributed';
  level?: number;
  bullet?: BulletSpec;
  lineSpacing?: number;
  spaceBefore?: number;
  spaceAfter?: number;
  marginLeft?: number;
  indent?: number;
}

export interface BodyPatch {
  anchor?: 'top' | 'middle' | 'bottom';
  wrap?: boolean;
  autofit?: 'none' | 'shrink' | 'resize';
  insets?: [number, number, number, number];
  columns?: number;
}

export type FillSpec =
  | { kind: 'none' }
  | { kind: 'solid'; color: string; alpha?: number }
  | { kind: 'gradient'; colors: string[]; angle?: number };

export interface LinePatch {
  none?: boolean;
  color?: string;
  width?: number;
  dash?: string;
  tail?: string;
  head?: string;
}

export type NewShape =
  | { kind: 'textBox'; text?: string }
  | { kind: 'shape'; preset: string; text?: string }
  | { kind: 'line'; arrow?: boolean }
  | { kind: 'image'; data: string; description?: string }
  | { kind: 'table'; cells: string[][] }
  | {
      kind: 'chart';
      chartType: EditableChartKind;
      grouping?: ChartGrouping;
      categories: string[];
      series: ChartSeriesData[];
      title?: string;
    };

export type ZOrder = 'front' | 'back' | 'forward' | 'backward';

/** Which borders of a cell range `formatCells` changes. */
export type BorderEdges =
  | 'all'
  | 'outside'
  | 'inside'
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'insideHorizontal'
  | 'insideVertical';

/**
 * A table border change (omitted = unchanged). A border that did not exist
 * becomes a solid 1 pt `tx1` line unless the change says otherwise.
 */
export interface BorderLine {
  /** Remove the border. */
  none?: boolean;
  color?: string;
  width?: number;
  dash?: string;
}

export interface CellBorders {
  edges: BorderEdges;
  line: BorderLine;
}

interface ShapeTarget {
  slide: number;
  shape: number;
}

interface TextTarget extends ShapeTarget {
  /** A table cell, when the shape is a table. */
  cell?: CellRef;
}

/** One edit, applied atomically within a batch. Mirrors `edit::EditOp`. */
export type EditOp =
  | ({ op: 'setText'; text: string } & TextTarget)
  | ({ op: 'insertText'; at: TextPos; text: string } & TextTarget)
  | ({ op: 'deleteText'; start: TextPos; end: TextPos } & TextTarget)
  | ({
      op: 'formatText';
      start?: TextPos;
      end?: TextPos;
      props: RunPatch;
    } & TextTarget)
  | ({
      op: 'formatParagraphs';
      from?: number;
      to?: number;
      props: ParaPatch;
    } & TextTarget)
  | ({ op: 'formatBody'; props: BodyPatch } & TextTarget)
  | ({
      op: 'setTransform';
      x?: number;
      y?: number;
      w?: number;
      h?: number;
      rotation?: number;
      flipH?: boolean;
      flipV?: boolean;
    } & ShapeTarget)
  | ({ op: 'setFill'; fill: FillSpec } & ShapeTarget)
  | ({ op: 'setLine'; line: LinePatch } & ShapeTarget)
  | ({ op: 'setGeometry'; preset: string } & ShapeTarget)
  | {
      op: 'addShape';
      slide: number;
      shape: NewShape;
      x: number;
      y: number;
      w: number;
      h: number;
    }
  | ({ op: 'deleteShape' } & ShapeTarget)
  | ({ op: 'duplicateShape'; dx?: number; dy?: number } & ShapeTarget)
  | ({ op: 'reorderShape'; to: ZOrder } & ShapeTarget)
  | ({ op: 'replaceImage'; data: string } & ShapeTarget)
  | ({
      op: 'setCellText';
      row: number;
      col: number;
      text: string;
    } & ShapeTarget)
  | ({ op: 'insertTableRow'; at: number } & ShapeTarget)
  | ({ op: 'deleteTableRow'; row: number } & ShapeTarget)
  | ({ op: 'insertTableColumn'; at: number } & ShapeTarget)
  | ({ op: 'deleteTableColumn'; col: number } & ShapeTarget)
  /** Merges the rectangle between two corner cells (text joins the top-left cell). */
  | ({ op: 'mergeCells'; from: CellRef; to: CellRef } & ShapeTarget)
  /** Splits the merged cell covering `cell` back into grid cells. */
  | ({ op: 'splitCell'; cell: CellRef } & ShapeTarget)
  /** Formats the cells between two corners (widened to whole merged cells). */
  | ({
      op: 'formatCells';
      from: CellRef;
      to: CellRef;
      /** `{ kind: 'none' }` = no fill (the table background shows). */
      fill?: FillSpec;
      borders?: CellBorders;
      anchor?: CellAnchor;
      /** `[left, top, right, bottom]` margins. */
      margins?: [number, number, number, number];
    } & ShapeTarget)
  /**
   * Sets the style (`''` = none) and emphasized parts; omitted fields stay.
   * A different style clears fills and borders set directly on cells.
   */
  | ({
      op: 'setTableStyle';
      style?: string;
      firstRow?: boolean;
      lastRow?: boolean;
      firstCol?: boolean;
      lastCol?: boolean;
      bandRow?: boolean;
      bandCol?: boolean;
    } & ShapeTarget)
  /** Column widths and minimum row heights (one per column/row); the frame follows. */
  | ({
      op: 'setTableGrid';
      columnWidths?: number[];
      rowHeights?: number[];
    } & ShapeTarget)
  | {
      op: 'addSlide';
      layout?: string;
      after?: number;
      title?: string;
      body?: string;
    }
  | { op: 'duplicateSlide'; slide: number }
  | { op: 'deleteSlide'; slide: number }
  | { op: 'moveSlide'; slide: number; to: number }
  | { op: 'setSlideHidden'; slide: number; hidden: boolean }
  | { op: 'setNotes'; slide: number; text: string }
  | { op: 'setBackground'; slide: number; fill?: FillSpec }
  | ({
      op: 'setChartData';
      categories: string[];
      series: ChartSeriesData[];
    } & ShapeTarget)
  | ({
      op: 'setChartType';
      kind: EditableChartKind;
      grouping?: ChartGrouping;
    } & ShapeTarget)
  | ({
      op: 'formatChart';
      /** `""` removes the title. */
      title?: string;
      legend?: LegendPosition | 'none';
      dataLabels?: boolean;
      seriesColors?: { series: number; color: string }[];
    } & ShapeTarget)
  /** Groups shapes sharing a parent (≥ 2); the group id is in `created`. */
  | { op: 'groupShapes'; slide: number; shapes: number[] }
  /** Ungroups; the members' ids are in `created`, back to front. */
  | ({ op: 'ungroupShape' } & ShapeTarget)
  /** Pastes a `copyShapes` payload on top of a slide; new ids in `created`. */
  | {
      op: 'pasteShapes';
      slide: number;
      payload: string;
      dx?: number;
      dy?: number;
    }
  /** Pastes a `copySlides` payload; new slide ids in `created`. */
  | { op: 'pasteSlides'; after?: number; payload: string }
  /** Changes a slide's layout (by name, as in `DeckOutline.layouts`). */
  | { op: 'setSlideLayout'; slide: number; layout: string }
  | ({ op: 'setTransition' } & TransitionPatch)
  /** Replaces text everywhere (or on one slide); the count is `replaced`. */
  | {
      op: 'replaceText';
      find: string;
      replace: string;
      matchCase?: boolean;
      wholeWord?: boolean;
      slide?: number;
    }
  | ({ op: 'setAltText'; text: string } & ShapeTarget)
  | ({ op: 'setShapeName'; name: string } & ShapeTarget)
  | ({ op: 'setShapeHidden'; hidden: boolean } & ShapeTarget)
  /** Format painter: gives `shapes` the look (fill, line, effects, style) of another shape. */
  | {
      op: 'pasteFormat';
      slide: number;
      shapes: number[];
      fromSlide: number;
      fromShape: number;
    }
  /** Recolors the deck's theme (slots: dk1, lt1, dk2, lt2, accent1-6, hlink, folHlink). */
  | {
      op: 'setThemeColors';
      colors: { slot: string; color: string }[];
      name?: string;
    }
  /** Sets the theme's heading and body fonts. */
  | { op: 'setThemeFonts'; major?: string; minor?: string; name?: string };

export interface Created {
  slide: number;
  shape?: number;
}

/** What a batch (or an undo/redo) changed. */
export interface EditResult {
  created: Created[];
  /** Ids of slides whose rendering changed. */
  changedSlides: number[];
  /** Slides were added, removed, or reordered. */
  structureChanged: boolean;
  /** Text replacements made by `replaceText` operations. */
  replaced: number;
}

/**
 * A collaborative presentation's shared maps: container → key → value
 * (`pptx_engine::collab::Entries`).
 */
export type CollabEntries = Record<string, Record<string, string>>;

/** One shared-map entry written, or deleted when `value` is absent or null. */
export interface EntryChange {
  container: string;
  key: string;
  value?: string | null;
}

/** One sub-path of a preset shape outline (SVG path data in points). */
export interface PresetPath {
  d: string;
  fill: boolean;
  stroke: boolean;
}

/** Effects `setTransition` writes. */
export type TransitionKind =
  | 'none'
  | 'cut'
  | 'fade'
  | 'push'
  | 'wipe'
  | 'split'
  | 'reveal'
  | 'randomBar'
  | 'shape'
  | 'uncover'
  | 'cover'
  | 'zoom'
  | 'dissolve'
  | 'flash'
  | 'morph';

/** A slide transition (`inspect::TransitionOutline`). */
export interface TransitionOutline {
  /**
   * A `TransitionKind` (`none` = advance settings only), or the element name
   * of an effect `setTransition` cannot write (`vortex`, `wheel`...).
   */
  kind: TransitionKind | (string & {});
  durationMs: number;
  /** Effect option (see `TransitionPatch.direction`), when the effect has one. */
  direction?: string;
  advanceOnClick: boolean;
  /** Automatic advance after this many milliseconds. */
  advanceAfterMs?: number;
}

/** The fields of a `setTransition` op; omitted ones keep the slide's value. */
export interface TransitionPatch {
  slide: number;
  kind: TransitionKind;
  /** At most 60000. */
  durationMs?: number;
  /**
   * `fade`: smooth|black; `push`, `wipe`: l|r|u|d; `cover`, `uncover`: those
   * or lu|ru|ld|rd; `split`: horzOut|horzIn|vertOut|vertIn; `reveal`: l|r;
   * `randomBar`: horz|vert; `shape`: circle|diamond|plus; `zoom`: in|out;
   * `morph`: byObject|byWord|byChar.
   */
  direction?: string;
  advanceOnClick?: boolean;
  /** `0` turns automatic advance off; omitted keeps it. */
  advanceAfterMs?: number;
  /** Give every slide the resulting transition. */
  applyToAll?: boolean;
}

/** How `findText` and `replaceText` match. */
export interface FindOptions {
  /** Default: ignore case. */
  matchCase?: boolean;
  /** No letter, digit, or `_` on either side of a match. */
  wholeWord?: boolean;
}

/** One occurrence of found text (`edit::TextMatch`); offsets as in `TextPos`. */
export interface TextMatch {
  slide: number;
  /** Shape id (the table's frame for cell text). */
  shape: number;
  cell?: CellRef;
  paragraph: number;
  start: number;
  /** Exclusive. */
  end: number;
}

/**
 * A `copyShapes` / `copySlides` result: self-contained JSON (format
 * `pptx-engine/clipboard`) to hand back verbatim to `pasteShapes` or
 * `pasteSlides`, in this or another presentation.
 */
export type ClipboardPayload = string;
