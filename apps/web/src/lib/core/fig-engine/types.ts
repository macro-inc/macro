/**
 * The JSON shapes the `.fig` engine (`crates/fig_engine`) returns. Mirrors
 * the serde types in `inspect.rs` and `wasm.rs`.
 */

export interface Vec2 {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PageSummary {
  index: number;
  id: string;
  name: string;
  /** Canvas color, straight RGBA in 0..1. */
  background: [number, number, number, number];
}

export interface FileSummary {
  /** The document node's id (pages are its children). */
  rootId: string;
  fileName: string | null;
  version: number;
  nodeCount: number;
  pages: PageSummary[];
}

/** A top-level layer of a page. */
export interface FrameRow {
  id: string;
  name: string;
  type: NodeType;
  bounds: Rect;
}

export interface PageLayout {
  /** Bounds of everything on the page (empty pages have infinite bounds). */
  bounds: Rect;
  frames: FrameRow[];
  layerCount: number;
}

export type NodeType =
  | 'DOCUMENT'
  | 'CANVAS'
  | 'GROUP'
  | 'FRAME'
  | 'BOOLEAN_OPERATION'
  | 'VECTOR'
  | 'STAR'
  | 'LINE'
  | 'ELLIPSE'
  | 'RECTANGLE'
  | 'REGULAR_POLYGON'
  | 'ROUNDED_RECTANGLE'
  | 'TEXT'
  | 'SLICE'
  | 'SYMBOL'
  | 'INSTANCE'
  | 'STICKY'
  | 'SHAPE_WITH_TEXT'
  | 'CONNECTOR'
  | 'CODE_BLOCK'
  | 'WIDGET'
  | 'STAMP'
  | 'MEDIA'
  | 'HIGHLIGHT'
  | 'SECTION'
  | 'SECTION_OVERLAY'
  | 'WASHI_TAPE'
  | 'TABLE'
  | 'TABLE_CELL'
  | 'SLIDE'
  | 'TEXT_PATH'
  | 'OTHER';

/** One row of the layers panel. */
export interface LayerRow {
  id: string;
  name: string;
  type: NodeType;
  visible: boolean;
  locked: boolean;
  childCount: number;
  isMask: boolean;
  /** A sublayer of an instance. */
  inInstance: boolean;
}

export interface StopInfo {
  color: string;
  alpha: number;
  position: number;
}

export interface PaintInfo {
  type: string;
  visible: boolean;
  opacity: number;
  blendMode: string;
  /** `RRGGBB`. */
  color: string | null;
  alpha: number | null;
  stops: StopInfo[] | null;
  /** Gradient start and end, node coordinates. */
  handles: [Vec2, Vec2] | null;
  scaleMode: string | null;
  imageHash: string | null;
}

export interface EffectInfo {
  type:
    | 'DROP_SHADOW'
    | 'INNER_SHADOW'
    | 'LAYER_BLUR'
    | 'BACKGROUND_BLUR'
    | 'OTHER';
  visible: boolean;
  color: string;
  alpha: number;
  x: number;
  y: number;
  radius: number;
  spread: number;
}

export interface TextInfo {
  characters: string;
  truncated: boolean;
  fontFamily: string | null;
  fontStyle: string | null;
  fontSize: number | null;
  lineHeight: [number, string] | null;
  letterSpacing: [number, string] | null;
  paragraphSpacing: number | null;
  alignHorizontal: string | null;
  alignVertical: string | null;
  decoration: string | null;
  case: string | null;
  autoResize: string | null;
  fonts: string[];
}

export interface CornerRadii {
  top_left: number;
  top_right: number;
  bottom_right: number;
  bottom_left: number;
}

export type Sizing = 'FIXED' | 'HUG' | 'FILL';

export interface AutoLayout {
  mode: string;
  spacing: number;
  paddingTop: number;
  paddingRight: number;
  paddingBottom: number;
  paddingLeft: number;
  primaryAlign: string | null;
  counterAlign: string | null;
  wrap: boolean;
  /** `FIXED`, or hugging (`RESIZE_TO_FIT…`, the default) along the flow. */
  primarySizing: string | null;
  /** Hugging across the flow when `RESIZE_TO_FIT…`; fixed by default. */
  counterSizing: string | null;
  counterSpacing: number;
  reverseZ: boolean;
}

export interface ExportSetting {
  format: string;
  suffix: string;
  constraint: string;
  value: number;
}

export interface PropDef {
  name: string;
  kind: string;
}

/** A layer's properties for the inspector. */
export interface NodeInfo {
  id: string;
  name: string;
  type: NodeType;
  typeLabel: string;
  /** Relative to the containing frame (or the page). */
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  bounds: Rect;
  opacity: number;
  blendMode: string;
  visible: boolean;
  locked: boolean;
  cornerRadius: CornerRadii | null;
  cornerSmoothing: number | null;
  clipsContent: boolean;
  fills: PaintInfo[];
  strokes: PaintInfo[];
  strokeWeight: number | null;
  strokeAlign: 'CENTER' | 'INSIDE' | 'OUTSIDE' | null;
  dashPattern: number[] | null;
  effects: EffectInfo[];
  text: TextInfo | null;
  autoLayout: AutoLayout | null;
  /** How width and height follow auto layout (layers outside instances). */
  sizing: [Sizing, Sizing] | null;
  /** Set when the layer is in an auto layout frame. */
  layoutParent: 'AUTO' | 'ABSOLUTE' | null;
  /** In a frame whose resizing the layer's constraints follow. */
  constrained: boolean;
  constraints: [string, string] | null;
  exportSettings: ExportSetting[];
  mainComponent: string | null;
  description: string | null;
  componentProperties: PropDef[];
  booleanOperation: string | null;
  isMask: boolean;
  childCount: number;
}

export interface SearchHit {
  id: string;
  name: string;
  type: NodeType;
  text: string | null;
}

export interface NodeGeometry {
  id: string;
  /** Frame corners in page coordinates, clockwise from the top left. */
  corners: [Vec2, Vec2, Vec2, Vec2];
  bounds: Rect;
}

/** A component, for the assets list. */
export interface ComponentInfo {
  id: string;
  name: string;
  /** The component set a variant belongs to. */
  set: string | null;
  page: number;
  width: number;
  height: number;
}
