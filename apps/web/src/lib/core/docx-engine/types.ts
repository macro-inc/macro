/**
 * Types of the DOCX engine's JSON API. They mirror the Rust serde shapes in
 * `crates/docx_engine` (`edit`, `collab`); positions and sizes are points.
 */

/** A position in the body: a paragraph and a UTF-16 offset in its text. */
export type Pos = {
  block: string;
  offset: number;
  /** At a line wrap, show the caret at the end of the earlier line. */
  upstream?: boolean;
};

export type Selection = { anchor: Pos; focus: Pos };

export type Unit =
  | 'char'
  | 'word'
  | 'line'
  | 'lineBoundary'
  | 'paragraph'
  | 'document';

export type BreakKind = 'line' | 'page' | 'column';

export type ListKind = 'bullet' | 'number';

export type Toggle =
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strike'
  | 'superscript'
  | 'subscript'
  | 'smallCaps'
  | 'allCaps';

export type Alignment = 'left' | 'center' | 'right' | 'justify';

export type Spacing = { rule: 'auto' | 'exact' | 'atLeast'; value: number };

/** Character formatting: a present field sets (or with `null` clears) it. */
export type RunPatch = {
  font?: string | null;
  size?: number | null;
  /** `RRGGBB`. */
  color?: string | null;
  /** A Word highlight name (`yellow`, `green`, ...). */
  highlight?: string | null;
};

export type ParaPatch = {
  align?: Alignment;
  indentLeft?: number;
  indentRight?: number;
  /** Negative for a hanging indent. */
  firstLine?: number;
  spaceBefore?: number;
  spaceAfter?: number;
  lineSpacing?: Spacing;
  keepNext?: boolean;
  keepLines?: boolean;
  pageBreakBefore?: boolean;
  widowControl?: boolean;
};

export type EditOp =
  | { op: 'select'; anchor: Pos; focus: Pos }
  | { op: 'move'; unit?: Unit; forward: boolean; extend?: boolean }
  | { op: 'selectAll' }
  | { op: 'selectWord'; at: Pos }
  | { op: 'selectParagraph'; at: Pos }
  | { op: 'insertText'; text: string }
  | { op: 'insertParagraph' }
  | { op: 'insertBreak'; kind: BreakKind }
  | { op: 'delete'; forward: boolean; unit?: Unit }
  | { op: 'toggleFormat'; format: Toggle }
  | ({ op: 'setFormat' } & RunPatch)
  | { op: 'clearFormat' }
  | ({ op: 'setParagraph' } & ParaPatch)
  | { op: 'setStyle'; style: string }
  | { op: 'toggleList'; kind: ListKind }
  | { op: 'indent'; forward: boolean }
  | { op: 'insertTable'; rows: number; cols: number }
  | { op: 'insertRow'; below: boolean }
  | { op: 'insertColumn'; right: boolean }
  | { op: 'deleteRow' }
  | { op: 'deleteColumn' }
  | { op: 'deleteTable' }
  /** Edit the header, footer or body at a point on a page (points). */
  | { op: 'enterStory'; page: number; x: number; y: number }
  /** Back from a header or footer to the body. */
  | { op: 'exitStory' }
  /** Turn tracking changes on or off for the document. */
  | { op: 'setTracking'; on: boolean }
  /** Accept the changes in the selection (the one at a caret), or all. */
  | { op: 'acceptChanges'; all?: boolean }
  /** Reject the changes in the selection (the one at a caret), or all. */
  | { op: 'rejectChanges'; all?: boolean }
  /** Paste paragraphs over the selection. */
  | { op: 'paste'; paragraphs: ClipParagraph[]; sameDocument?: boolean };

export type CaretRect = { page: number; x: number; y: number; height: number };

export type PageRect = {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
};

/** A page's header or footer area (points). */
export type PageArea = {
  top: number;
  bottom: number;
  /** Whether the section has a header or footer part there to edit. */
  editable: boolean;
};

export type PageInfo = {
  width: number;
  height: number;
  fingerprint: string;
  header?: PageArea;
  footer?: PageArea;
};

/** The story the selection is in. */
export type StoryState = {
  kind: 'body' | 'header' | 'footer';
  /** The page whose header or footer is being edited. */
  page?: number;
};

/** A horizontal strip of a page that changed. */
export type Band = { page: number; top: number; bottom: number };

export type FormatState = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  superscript: boolean;
  subscript: boolean;
  font: string | null;
  size: number | null;
  color: string | null;
  style: string | null;
  styleName: string | null;
  align: Alignment | null;
  list: boolean;
  /** The document records everyone's edits as tracked changes. */
  tracking: boolean;
  /** The selection (or the caret) touches a tracked change. */
  revision: boolean;
  canUndo: boolean;
  canRedo: boolean;
};

/** One op of a rich-text delta (Quill's format, as Loro reads and writes it). */
export type DeltaOp =
  | { insert: string; attributes?: Record<string, string> }
  | { delete: number }
  | { retain: number; attributes?: Record<string, string | null> };

/** A block as the shared maps store it. */
export type BlockRecord = {
  id: string;
  /** Kind: `p`, `tbl`, `tr`, `tc`, `sdt` or `x`. */
  k: string;
  /** Parent block id (`''` at the top level). */
  p: string;
  /** Position key among siblings. */
  o: string;
  /** Element attributes. */
  a: string;
  /** Property XML. */
  x: string;
  /** Paragraph text (paragraphs only). */
  t?: DeltaOp[];
};

/** A change the engine made, for the shared maps. */
export type Change =
  | { t: 'block'; block: BlockRecord }
  | { t: 'fields'; id: string; fields: Record<string, string> }
  | { t: 'text'; id: string; delta: DeltaOp[] }
  | { t: 'remove'; id: string }
  | { t: 'entry'; container: string; key: string; value: string | null };

/** A run of copied or pasted text. */
export type ClipRun = {
  text: string;
  /** The run's attributes, from a copy in this editor. */
  attrs?: Record<string, string>;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  superscript?: boolean;
  subscript?: boolean;
};

/** A copied or pasted paragraph. */
export type ClipParagraph = {
  runs: ClipRun[];
  /** Paragraph properties (`w:pPr`), from a copy in this editor. */
  props?: string;
  /** Heading level, 1 to 9. */
  heading?: number;
  list?: ListKind;
  /** List level, 0 for the outermost. */
  level?: number;
};

/** What a selection copies. */
export type Clip = { paragraphs: ClipParagraph[]; html: string; text: string };

/** A change other peers made, as the shared maps now hold it. */
export type RemoteChange =
  | {
      t: 'block';
      block: BlockRecord;
      /**
       * The text changes from the engine's copy of the paragraph to this
       * one, in order, when known: carets follow them exactly.
       */
      deltas?: DeltaOp[][];
    }
  | { t: 'remove'; id: string }
  | { t: 'entry'; container: string; key: string; value: string | null };

export type EditResult = {
  changed: boolean;
  changes: Change[];
  selection: Selection;
  /** The selection's ends in document order. */
  range: { from: Pos; to: Pos };
  caret: CaretRect | null;
  rects: PageRect[];
  /** Present when the layout changed. */
  pages?: PageInfo[];
  /** Strips of pages that changed since the previous result. */
  bands?: Band[];
  format: FormatState;
  story: StoryState;
};

/** The whole shared state of a document. */
export type CollabState = {
  parts: Record<string, string>;
  types: Record<string, string>;
  rels: Record<string, string>;
  blocks: BlockRecord[];
};

/** A document in the first shared format. */
export type V1State = {
  order: string[];
  blocks: Record<string, string>;
  parts: Record<string, string>;
};

export type ParagraphText = { id: string; text: string };

export type StyleInfo = {
  id: string;
  name: string;
  /** Shown in the quick style gallery. */
  quick: boolean;
  priority: number;
};
