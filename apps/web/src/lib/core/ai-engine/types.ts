/**
 * The values the Illustrator engine (`ai_engine`) exchanges as JSON:
 * documents, layers, properties, edit operations, and shared entries.
 * Names and shapes mirror the Rust types' serde forms.
 */

/** A point on the canvas (points, y down). */
export interface Point {
  x: number;
  y: number;
}

/** A rectangle by its edges (`ai_engine::geom::Rect`). */
export interface EdgeRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** An affine map `[a, b, c, d, e, f]`: `(a·x + c·y + e, b·x + d·y + f)`. */
export type Affine = [number, number, number, number, number, number];

/** A path segment. */
export type Seg =
  | { type: 'move'; p: Point }
  | { type: 'line'; p: Point }
  | { type: 'cubic'; c1: Point; c2: Point; p: Point }
  | { type: 'close' };

/** Subpaths of lines and cubic curves. */
export interface PathData {
  segs: Seg[];
}

/** A color in the space it was given in (components `0..=1`). */
export type Color =
  | { space: 'gray'; g: number }
  | { space: 'rgb'; r: number; g: number; b: number }
  | { space: 'cmyk'; c: number; m: number; y: number; k: number }
  | {
      space: 'spot';
      name: string;
      tint: number;
      rgb: [number, number, number];
    };

export interface GradientStop {
  offset: number;
  color: Color;
  opacity: number;
}

export interface Gradient {
  /** Gradient space to the object's space. */
  transform: Affine;
  radial: boolean;
  start: Point;
  end: Point;
  startRadius: number;
  endRadius: number;
  stops: GradientStop[];
  extend: [boolean, boolean];
}

export type Paint =
  | { type: 'solid'; color: Color }
  | { type: 'gradient'; gradient: Gradient };

export type LineCap = 'butt' | 'round' | 'square';
export type LineJoin = 'miter' | 'round' | 'bevel';

export interface Stroke {
  paint: Paint;
  /** In the object's units. */
  width: number;
  cap: LineCap;
  join: LineJoin;
  miterLimit: number;
  /** Dash and gap lengths; empty for a solid stroke. */
  dash: number[];
  dashOffset: number;
}

export const BLEND_MODES = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'colorDodge',
  'colorBurn',
  'hardLight',
  'softLight',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
] as const;

export type BlendMode = (typeof BLEND_MODES)[number];

export type TextAlign = 'left' | 'center' | 'right';

/** What a node is, as the layers panel names it. */
export type NodeKind =
  | 'layer'
  | 'group'
  | 'clipGroup'
  | 'path'
  | 'text'
  | 'image'
  | 'artwork';

/** An artboard: a page of the file on the canvas. */
export interface Artboard {
  id: number;
  name: string;
  rect: EdgeRect;
  /** The page of the opened file it came from. */
  page: number | null;
  removed: boolean;
}

/** `ai_engine::inspect::Summary`. */
export interface Summary {
  artboards: Artboard[];
  /** The canvas around every artboard. */
  canvas: EdgeRect;
  /** Objects (not layers or groups). */
  objects: number;
  /** Illustrator kept its own copy of the artwork (saving leaves it out). */
  illustrator: boolean;
  creator: string | null;
}

/** A row of the layers panel, top to bottom (`inspect::Row`). */
export interface Row {
  id: number;
  parent: number | null;
  /** Nesting depth (layers are 0). */
  depth: number;
  kind: NodeKind;
  name: string;
  hidden: boolean;
  locked: boolean;
  /** Children listed in the panel. */
  children: number;
  /** A layer's color. */
  color: [number, number, number] | null;
}

/** A text object's settings (`inspect::TextInfo`). */
export interface TextInfo {
  text: string;
  family: string;
  style: string;
  /** Size in the text's own space. */
  size: number;
  /** Size as shown on the canvas. */
  shownSize: number;
  align: TextAlign;
  /** Distance between baselines, in sizes. */
  lineHeight: number;
  /** Thousandths of an em. */
  tracking: number;
  /** Area text's width (point text: `null`). */
  width: number | null;
  /** Still the glyphs the file placed. */
  fromFile: boolean;
}

/** A node's properties (`inspect::Info`). */
export interface Info {
  id: number;
  kind: NodeKind;
  name: string;
  hidden: boolean;
  /** Locked, or in something locked. */
  locked: boolean;
  opacity: number;
  blend: BlendMode;
  /** Canvas bounds. */
  bounds: EdgeRect | null;
  /**
   * Canvas bounds of the outlines alone, strokes left out (the geometric
   * bounds Illustrator's Transform panel measures).
   */
  shapeBounds: EdgeRect | null;
  /** Object space to canvas. */
  transform: Affine;
  fill: Paint | null;
  stroke: Stroke | null;
  evenOdd: boolean;
  /** Paths: the outline in object space. */
  path: PathData | null;
  text: TextInfo | null;
  imageSize: [number, number] | null;
  clipped: boolean;
  artboard: number;
}

/** A font text uses (`inspect::FontUse`). */
export interface FontUse {
  family: string;
  style: string;
  /** Laid out by the engine (needs the family registered to show right). */
  laidOut: boolean;
}

/** A face a registered font file holds. */
export interface RegisteredFace {
  family: string;
  style: string;
  weight: number;
  maxWeight: number;
  italic: boolean;
  variable: boolean;
}

/** One line of a text object, in its own space (y down). */
export interface CaretLine {
  /** Characters `start..end` (UTF-16 units, its line break included). */
  start: number;
  end: number;
  top: number;
  height: number;
  baseline: number;
  /** The caret's x before each character `start..=end`. */
  xs: number[];
}

/** A text object's lines and where it is on the canvas. */
export interface TextGeometry {
  /** Text space to canvas. */
  transform: Affine;
  lines: CaretLine[];
  length: number;
}

/** What an edit changed (`EditResult` in `ai_engine::wasm`). */
export interface EditResult {
  created: number[];
  /** Canvas area whose pixels may have changed. */
  dirty: EdgeRect | null;
  /** Layers, groups, or artboards changed. */
  structure: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** The steps undo and redo would act on next. */
  undoStep: number | null;
  redoStep: number | null;
}

/**
 * A change to one entry of the shared maps (`ai_engine::collab`):
 * `value` null deletes it.
 */
export interface EntryChange {
  container: string;
  key: string;
  value?: string | null;
}

// ---- edit operations (`ai_engine::edit::Op`) ------------------------------

/** Where in a stack a node goes. */
export type Position =
  | { type: 'top' }
  | { type: 'bottom' }
  | { type: 'above'; id: number }
  | { type: 'below'; id: number };

/** A new object (`edit::NewNode`); rectangles are canvas rectangles. */
export type NewNode =
  | {
      type: 'path';
      data: PathData;
      fill: Paint | null;
      stroke: Stroke | null;
      evenOdd?: boolean;
    }
  | {
      type: 'rect';
      rect: EdgeRect;
      radius?: number;
      fill: Paint | null;
      stroke: Stroke | null;
    }
  | {
      type: 'ellipse';
      rect: EdgeRect;
      fill: Paint | null;
      stroke: Stroke | null;
    }
  | {
      type: 'polygon';
      rect: EdgeRect;
      sides: number;
      /** A star's inner radius, as a fraction of the outer. */
      inner: number | null;
      fill: Paint | null;
      stroke: Stroke | null;
    }
  | {
      type: 'text';
      /** Where the first baseline starts. */
      at: Point;
      text: string;
      family: string;
      style: string;
      size: number;
      fill: Paint | null;
      /** Area text's width. */
      width: number | null;
      align?: TextAlign;
    };

export type BooleanMode = 'unite' | 'subtract' | 'intersect' | 'exclude';

/** An editing operation; a batch applies as one undo step. */
export type Op =
  | {
      op: 'setNode';
      ids: number[];
      name?: string;
      hidden?: boolean;
      locked?: boolean;
      opacity?: number;
      blend?: BlendMode;
      color?: [number, number, number];
    }
  | { op: 'setFill'; ids: number[]; fill: Paint | null }
  | { op: 'setStroke'; ids: number[]; stroke: Stroke | null }
  | { op: 'setPath'; id: number; data: PathData; evenOdd?: boolean }
  | {
      op: 'setText';
      id: number;
      text?: string;
      family?: string;
      style?: string;
      size?: number;
      align?: TextAlign;
      lineHeight?: number;
      tracking?: number;
      /** `null` makes it point text. */
      width?: number | null;
    }
  /** Canvas to canvas, applied after what the nodes have. */
  | { op: 'transform'; ids: number[]; matrix: Affine }
  | { op: 'setTransform'; id: number; transform: Affine }
  | { op: 'create'; node: NewNode; parent?: number; position?: Position }
  | { op: 'delete'; ids: number[] }
  | { op: 'duplicate'; ids: number[]; offset?: [number, number] }
  /** Copies nodes (deleted ones too) on top of a container. */
  | {
      op: 'paste';
      ids: number[];
      offset?: [number, number];
      parent?: number;
    }
  /** `parent` null: the nodes are layers, reordered. */
  | { op: 'move'; ids: number[]; parent: number | null; position: Position }
  | { op: 'group'; ids: number[] }
  | { op: 'ungroup'; ids: number[] }
  | { op: 'makeClip'; ids: number[] }
  | { op: 'releaseClip'; ids: number[] }
  | { op: 'newLayer'; name?: string; position?: Position }
  | { op: 'outline'; ids: number[] }
  | { op: 'boolean'; ids: number[]; mode: BooleanMode }
  | { op: 'setArtboard'; id: number; name?: string; rect?: EdgeRect }
  | { op: 'newArtboard'; rect: EdgeRect; name?: string }
  | { op: 'deleteArtboard'; id: number };
