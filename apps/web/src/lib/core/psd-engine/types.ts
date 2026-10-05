/**
 * The JSON the Photoshop engine (`crates/psd_engine`) reads and writes,
 * as TypeScript types. Names and shapes follow the engine's serde
 * attributes: camelCase fields, enums tagged by `type` (operations by
 * `op`), tuples as arrays. Colors are straight sRGB in `0..=1`; positions
 * are canvas pixels.
 */

/** An integer rectangle (`raster::IRect`). */
export interface IRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A straight sRGB color, each component in `0..=1` (`model::Rgb`). */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export type ColorMode =
  | 'bitmap'
  | 'grayscale'
  | 'indexed'
  | 'rgb'
  | 'cmyk'
  | 'multichannel'
  | 'duotone'
  | 'lab';

/** Photoshop's blend modes, in its menu order. */
export const BLEND_MODES = [
  'passThrough',
  'normal',
  'dissolve',
  'darken',
  'multiply',
  'colorBurn',
  'linearBurn',
  'darkerColor',
  'lighten',
  'screen',
  'colorDodge',
  'linearDodge',
  'lighterColor',
  'overlay',
  'softLight',
  'hardLight',
  'vividLight',
  'linearLight',
  'pinLight',
  'hardMix',
  'difference',
  'exclusion',
  'subtract',
  'divide',
  'hue',
  'saturation',
  'color',
  'luminosity',
] as const;

export type BlendMode = (typeof BLEND_MODES)[number];

export interface Guide {
  /** A vertical line (at an x position) rather than a horizontal one. */
  vertical: boolean;
  position: number;
}

export interface Locks {
  transparency: boolean;
  pixels: boolean;
  position: boolean;
  artboard: boolean;
}

/** The document as the editor first needs it (`inspect::Summary`). */
export interface Summary {
  width: number;
  height: number;
  mode: ColorMode;
  depth: number;
  resolution: number;
  layerCount: number;
  /** RGB or grayscale at 8 or 16 bits: layers can be edited and saved. */
  editable: boolean;
  guides: Guide[];
  /** A large document (`.psb`). */
  large: boolean;
}

export type LayerKindName =
  | 'pixel'
  | 'group'
  | 'text'
  | 'fill'
  | 'shape'
  | 'adjustment'
  | 'smartObject';

/** A layers panel row, top to bottom (`inspect::LayerRow`). */
export interface LayerRow {
  id: number;
  name: string;
  kind: LayerKindName;
  /** Nesting depth (0 at the top level). */
  depth: number;
  parent: number | null;
  visible: boolean;
  /** Visible with every group it is in. */
  shown: boolean;
  /** `0..=255`. */
  opacity: number;
  /** `0..=255`. */
  fillOpacity: number;
  blend: BlendMode;
  clipping: boolean;
  locks: Locks;
  colorTag: number;
  background: boolean;
  hasMask: boolean;
  maskDisabled: boolean;
  hasVectorMask: boolean;
  hasEffects: boolean;
  /** A group is expanded. */
  open: boolean;
  children: number;
  /** Canvas bounds of what it draws. */
  bounds: IRect | null;
}

// ---- paint ------------------------------------------------------------

export type GradientKind =
  | 'linear'
  | 'radial'
  | 'angle'
  | 'reflected'
  | 'diamond';

export interface ColorStop {
  location: number;
  midpoint: number;
  color: Rgb;
}

export interface OpacityStop {
  location: number;
  midpoint: number;
  opacity: number;
}

export interface Gradient {
  name: string;
  kind: GradientKind;
  /** Degrees, counter-clockwise from pointing right. */
  angle: number;
  scale: number;
  reverse: boolean;
  dither: boolean;
  alignWithLayer: boolean;
  offset: [number, number];
  smoothness: number;
  colors: ColorStop[];
  opacities: OpacityStop[];
}

export interface PatternFill {
  pattern: string;
  name: string;
  scale: number;
  angle: number;
  alignWithLayer: boolean;
  phase: [number, number];
}

export type Fill =
  | { type: 'solid'; color: Rgb }
  | { type: 'gradient'; gradient: Gradient }
  | { type: 'pattern'; pattern: PatternFill };

// ---- vectors ----------------------------------------------------------

export type PathOp = 'combine' | 'subtract' | 'intersect' | 'exclude';

export interface Knot {
  before: [number, number];
  anchor: [number, number];
  after: [number, number];
  linked: boolean;
}

export interface Subpath {
  closed: boolean;
  op: PathOp;
  knots: Knot[];
  nonzero?: boolean;
  shape?: number;
}

export interface VectorMask {
  subpaths: Subpath[];
  invert: boolean;
  disabled: boolean;
  unlinked: boolean;
  fillAll: boolean;
}

export interface VectorStroke {
  enabled: boolean;
  fillEnabled: boolean;
  width: number;
  align: 'inside' | 'center' | 'outside';
  cap: 'butt' | 'round' | 'square';
  join: 'miter' | 'round' | 'bevel';
  miterLimit: number;
  dashes: number[];
  dashOffset: number;
  opacity: number;
  blend: BlendMode;
  fill: Fill;
}

// ---- text -------------------------------------------------------------

export type TextAlign =
  | 'left'
  | 'right'
  | 'center'
  | 'justifyLeft'
  | 'justifyRight'
  | 'justifyCenter'
  | 'justifyAll';

export interface TextStyle {
  /** The font's PostScript name ("MyriadPro-Regular"). */
  font: string;
  /** Points (pixels at the text's own scale). */
  size: number;
  color: Rgb;
  /** Thousandths of an em. */
  tracking: number;
  /** Points; `null` is auto (120% of the size). */
  leading: number | null;
  fauxBold: boolean;
  fauxItalic: boolean;
  underline: boolean;
  strikethrough: boolean;
  case: 'normal' | 'smallCaps' | 'allCaps';
  baselineShift: number;
  horizontalScale: number;
  verticalScale: number;
}

export interface TextRun {
  /** UTF-16 code units. */
  length: number;
  style: TextStyle;
}

export interface ParagraphRun {
  length: number;
  align: TextAlign;
}

export interface TextLayer {
  /** Paragraphs end with `\r`, as Photoshop stores them. */
  text: string;
  runs: TextRun[];
  paragraphs: ParagraphRun[];
  /** Text space to canvas: `[xx, xy, yx, yy, tx, ty]`. */
  transform: [number, number, number, number, number, number];
  /** Area text's box `[left, top, right, bottom]`; point text has none. */
  area: [number, number, number, number] | null;
  orientation: 'horizontal' | 'vertical';
  antiAlias: 'none' | 'sharp' | 'crisp' | 'strong' | 'smooth';
  warped: boolean;
}

// ---- adjustments ------------------------------------------------------

export interface LevelsChannel {
  inBlack: number;
  inWhite: number;
  outBlack: number;
  outWhite: number;
  gamma: number;
}

export interface HueRange {
  range: [number, number, number, number];
  hue: number;
  saturation: number;
  lightness: number;
}

export type Adjustment =
  | {
      type: 'brightnessContrast';
      brightness: number;
      contrast: number;
      legacy: boolean;
    }
  | { type: 'levels'; channels: LevelsChannel[] }
  /** `[channel, [input, output][]]`: channel 0 is the composite. */
  | { type: 'curves'; channels: [number, [number, number][]][] }
  | { type: 'exposure'; exposure: number; offset: number; gamma: number }
  | { type: 'vibrance'; vibrance: number; saturation: number }
  | {
      type: 'hueSaturation';
      colorize: boolean;
      colorization: [number, number, number];
      master: [number, number, number];
      ranges: HueRange[];
    }
  | {
      type: 'colorBalance';
      shadows: [number, number, number];
      midtones: [number, number, number];
      highlights: [number, number, number];
      preserveLuminosity: boolean;
    }
  | {
      type: 'blackWhite';
      weights: [number, number, number, number, number, number];
      tint: Rgb | null;
    }
  | {
      type: 'photoFilter';
      color: Rgb;
      density: number;
      preserveLuminosity: boolean;
    }
  | {
      type: 'channelMixer';
      monochrome: boolean;
      rows: [
        [number, number, number, number],
        [number, number, number, number],
        [number, number, number, number],
      ];
    }
  | { type: 'invert' }
  | { type: 'posterize'; levels: number }
  | { type: 'threshold'; level: number }
  | {
      type: 'gradientMap';
      gradient: Gradient;
      dither: boolean;
      reverse: boolean;
    }
  | { type: 'selectiveColor'; absolute: boolean; colors: number[][] }
  | { type: 'other'; key: string };

export type AdjustmentType = Adjustment['type'];

// ---- effects ----------------------------------------------------------

export interface Contour {
  name: string;
  points: [number, number][];
}

export interface Shadow {
  enabled: boolean;
  blend: BlendMode;
  color: Rgb;
  opacity: number;
  angle: number;
  useGlobalLight: boolean;
  distance: number;
  spread: number;
  size: number;
  noise: number;
  contour: Contour;
  knocksOut: boolean;
}

export interface Glow {
  enabled: boolean;
  blend: BlendMode;
  color: Rgb;
  gradient: Gradient | null;
  opacity: number;
  noise: number;
  technique: 'softer' | 'precise';
  spread: number;
  size: number;
  contour: Contour;
  range: number;
  jitter: number;
  source: 'edge' | 'center';
}

export interface Bevel {
  enabled: boolean;
  style: 'outerBevel' | 'innerBevel' | 'emboss' | 'pillowEmboss' | 'strokeEmboss';
  technique: 'smooth' | 'chiselHard' | 'chiselSoft';
  depth: number;
  up: boolean;
  size: number;
  soften: number;
  angle: number;
  altitude: number;
  useGlobalLight: boolean;
  highlightBlend: BlendMode;
  highlightColor: Rgb;
  highlightOpacity: number;
  shadowBlend: BlendMode;
  shadowColor: Rgb;
  shadowOpacity: number;
  gloss: Contour;
  contour: Contour | null;
}

export interface Satin {
  enabled: boolean;
  blend: BlendMode;
  color: Rgb;
  opacity: number;
  angle: number;
  distance: number;
  size: number;
  invert: boolean;
  contour: Contour;
}

export interface Overlay {
  enabled: boolean;
  blend: BlendMode;
  opacity: number;
  fill: Fill;
}

export interface StrokeEffect {
  enabled: boolean;
  blend: BlendMode;
  opacity: number;
  size: number;
  position: 'outside' | 'inside' | 'center';
  fill: Fill;
}

/** A layer style (`model::Effects`). */
export interface Effects {
  enabled: boolean;
  scale: number;
  dropShadows: Shadow[];
  innerShadows: Shadow[];
  outerGlows: Glow[];
  innerGlows: Glow[];
  bevels: Bevel[];
  satins: Satin[];
  colorOverlays: Overlay[];
  gradientOverlays: Overlay[];
  patternOverlays: Overlay[];
  strokes: StrokeEffect[];
}

export interface BlendRanges {
  channels: [
    [number, number, number, number],
    [number, number, number, number],
  ][];
}

export interface MaskInfo {
  rect: IRect;
  defaultColor: number;
  disabled: boolean;
  linked: boolean;
  density: number;
  feather: number;
}

export interface SmartObject {
  id: string;
  fileName: string | null;
  corners: number[];
  linked: boolean;
}

/** One layer's properties (`inspect::LayerInfo`). */
export interface LayerInfo extends LayerRow {
  text: TextLayer | null;
  fill: Fill | null;
  stroke: VectorStroke | null;
  adjustment: Adjustment | null;
  smartObject: SmartObject | null;
  effects: Effects | null;
  mask: MaskInfo | null;
  vectorMask: VectorMask | null;
  blendRanges: BlendRanges | null;
  knockout: number;
  blendClippedAsGroup: boolean;
  blendInteriorAsGroup: boolean;
  transparencyShapes: boolean;
}

export type FontStatus = 'AVAILABLE' | 'STYLE_MISSING' | 'MISSING';

export interface FontUse {
  postscript: string;
  family: string;
  style: string;
  status: FontStatus;
}

export interface RegisteredFace {
  family: string;
  style: string;
  weight: number;
  maxWeight: number;
  italic: boolean;
  variable: boolean;
}

// ---- editing ----------------------------------------------------------

/** What a step changed (`EditResult` in `psd_engine::wasm`). */
export interface EditResult {
  /** Ids of layers it created. */
  created: number[];
  /** Canvas area whose pixels may have changed. */
  dirty: IRect | null;
  /** Everything may have changed (canvas size, mode, resampling). */
  all: boolean;
  /** Layers were added, removed, moved, or regrouped. */
  structure: boolean;
  canUndo: boolean;
  canRedo: boolean;
  undoStep: number | null;
  redoStep: number | null;
  /**
   * Tile key prefixes (other people's changes only): every `psdTiles`
   * entry whose key starts with one goes back through `applyCollab`.
   */
  wants: string[];
}

/** One shared-map entry written (`value`) or deleted (`null`). */
export interface EntryChange {
  container: string;
  key: string;
  value?: string | null;
}

/** Where in a stack a layer goes (`edit::Position`). */
export type Position =
  | { type: 'top' }
  | { type: 'bottom' }
  | { type: 'above'; id: number }
  | { type: 'below'; id: number };

/** What a pixel operation changes. */
export type Target = 'pixels' | 'mask';

export type MaskInit =
  | 'revealAll'
  | 'hideAll'
  | 'revealSelection'
  | 'hideSelection'
  | 'transparency';

export type Interpolation = 'nearest' | 'bilinear' | 'bicubic';

/** A brush (`edit::paint::Brush`). */
export interface Brush {
  /** Diameter in canvas pixels (up to 5000). */
  size: number;
  /** `0..=1`; 1 is a hard edge. */
  hardness: number;
  /** Most a stroke can cover, `0..=1`. */
  opacity: number;
  /** How much each dab adds, `0..=1`. */
  flow: number;
  /** Distance between dabs as a fraction of the size. */
  spacing: number;
  color: Rgb;
  mode: 'paint' | 'erase';
  /** Hard, aliased dabs. */
  pencil: boolean;
  pressureSize: boolean;
  pressureOpacity: boolean;
}

export type FilterSpec =
  | { type: 'gaussianBlur'; radius: number }
  | {
      type: 'unsharpMask';
      amount: number;
      radius: number;
      threshold: number;
    }
  | {
      type: 'addNoise';
      amount: number;
      gaussian: boolean;
      monochrome: boolean;
      seed: number;
    }
  | { type: 'mosaic'; cell: number }
  | { type: 'motionBlur'; angle: number; distance: number }
  | { type: 'adjust'; adjustment: Adjustment }
  | { type: 'desaturate' };

export type NewLayer =
  | { type: 'pixel' }
  | { type: 'group' }
  | {
      type: 'fill';
      fill: Fill;
      path: VectorMask | null;
      stroke: VectorStroke | null;
    }
  | { type: 'adjustment'; adjustment: Adjustment }
  | { type: 'text'; text: TextLayer };

/** Changes to layers' simple properties; absent fields stay. */
export interface LayerPatch {
  name?: string;
  visible?: boolean;
  opacity?: number;
  fillOpacity?: number;
  blend?: BlendMode;
  clipping?: boolean;
  locks?: Locks;
  colorTag?: number;
  open?: boolean;
  knockout?: number;
  blendClippedAsGroup?: boolean;
  blendInteriorAsGroup?: boolean;
  transparencyShapes?: boolean;
}

export interface MaskPatch {
  disabled?: boolean;
  linked?: boolean;
  density?: number;
  feather?: number;
}

/** An affine map `[a, b, c, d, e, f]`: `(x, y)` to `(ax + cy + e, bx + dy + f)`. */
export type Matrix = [number, number, number, number, number, number];

/** An edit operation (`edit::Op`). */
export type Op =
  | ({ op: 'setLayer'; ids: number[] } & LayerPatch)
  | {
      op: 'newLayer';
      parent: number | null;
      position: Position;
      name: string | null;
      kind: NewLayer;
    }
  | { op: 'delete'; ids: number[] }
  | { op: 'duplicate'; ids: number[] }
  | {
      op: 'move';
      ids: number[];
      parent: number | null;
      position: Position;
    }
  | { op: 'group'; ids: number[]; name: string | null }
  | { op: 'ungroup'; id: number }
  | { op: 'merge'; ids: number[] }
  | { op: 'flatten' }
  | { op: 'rasterize'; ids: number[] }
  | { op: 'translate'; ids: number[]; dx: number; dy: number }
  | {
      op: 'transform';
      ids: number[];
      matrix: Matrix;
      interpolation: Interpolation;
    }
  | { op: 'flip'; ids: number[]; horizontal: boolean }
  | { op: 'rotate'; ids: number[]; quarters: number }
  | {
      op: 'paint';
      id: number;
      target: Target;
      stroke: number;
      brush: Brush;
      /** Canvas x, y, and pen pressure `0..=1`. */
      points: [number, number, number][];
      done: boolean;
    }
  | { op: 'fill'; id: number; target: Target; color: Rgb; opacity: number }
  | {
      op: 'bucket';
      id: number;
      target: Target;
      x: number;
      y: number;
      color: Rgb;
      opacity: number;
      tolerance: number;
      contiguous: boolean;
      antialias: boolean;
      sampleAll: boolean;
    }
  | {
      op: 'gradient';
      id: number;
      target: Target;
      gradient: Gradient;
      from: [number, number];
      to: [number, number];
      opacity: number;
    }
  | { op: 'clear'; id: number; target: Target }
  | { op: 'filter'; id: number; target: Target; filter: FilterSpec }
  | { op: 'copyToLayer'; id: number; cut: boolean }
  | { op: 'addMask'; id: number; init: MaskInit }
  | { op: 'deleteMask'; id: number; apply: boolean }
  | ({ op: 'setMask'; id: number } & MaskPatch)
  | { op: 'setVectorMask'; id: number; mask: VectorMask | null }
  | { op: 'setText'; id: number; text: TextLayer }
  | {
      op: 'setFill';
      id: number;
      fill: Fill;
      /** Absent keeps the stroke; `null` removes it. */
      stroke?: VectorStroke | null;
    }
  | { op: 'setAdjustment'; id: number; adjustment: Adjustment }
  | { op: 'setEffects'; id: number; effects: Effects | null }
  | { op: 'setBlendRanges'; id: number; ranges: BlendRanges | null }
  | { op: 'crop'; rect: IRect }
  | {
      op: 'canvasSize';
      width: number;
      height: number;
      anchor: [number, number];
    }
  | {
      op: 'imageSize';
      width: number;
      height: number;
      interpolation: Interpolation;
    }
  | { op: 'rotateCanvas'; quarters: number }
  | { op: 'flipCanvas'; horizontal: boolean }
  | { op: 'setGuides'; guides: Guide[] }
  | { op: 'setResolution'; ppi: number }
  | { op: 'convertToRgb' };

// ---- selections -------------------------------------------------------

export type SelectMode = 'replace' | 'add' | 'subtract' | 'intersect';

/** A selection request (`SelectSpec` in `psd_engine::wasm`). */
export type SelectSpec =
  | {
      type: 'rect';
      x: number;
      y: number;
      w: number;
      h: number;
      mode?: SelectMode;
      feather?: number;
    }
  | {
      type: 'ellipse';
      x: number;
      y: number;
      w: number;
      h: number;
      mode?: SelectMode;
      feather?: number;
      antialias?: boolean;
    }
  | {
      type: 'polygon';
      points: [number, number][];
      mode?: SelectMode;
      feather?: number;
      antialias?: boolean;
    }
  | {
      type: 'wand';
      x: number;
      y: number;
      tolerance: number;
      contiguous: boolean;
      antialias?: boolean;
      sampleAll?: boolean;
      layer?: number | null;
      mode?: SelectMode;
    }
  | { type: 'all' }
  | { type: 'none' }
  | { type: 'invert' }
  | { type: 'feather'; radius: number }
  | { type: 'expand'; pixels: number }
  | { type: 'layer'; id: number; mask?: boolean; mode?: SelectMode };

/** The selection for marching ants: its bounds and outline polygons. */
export interface SelectionInfo {
  bounds: IRect | null;
  /** Polygons in canvas pixels; nonzero filling gives the selection. */
  outline: [number, number][][];
}
