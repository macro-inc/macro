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
  rows: string[][];
  columnWidths: number[];
  rowHeights: number[];
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
  | { kind: 'table'; cells: string[][] };

export type ZOrder = 'front' | 'back' | 'forward' | 'backward';

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
  | { op: 'setBackground'; slide: number; fill?: FillSpec };

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
