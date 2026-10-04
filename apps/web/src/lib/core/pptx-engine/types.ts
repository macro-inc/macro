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
  /**
   * Placeholder index (`p:ph/@idx`, 0 when absent), for placeholders. Slide
   * placeholders inherit from the layout placeholder with the same index.
   */
  placeholderIndex?: number;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  flipH: boolean;
  flipV: boolean;
  hidden: boolean;
  altText?: string;
  /** The shape's own hyperlink, as `setShapeLink` takes it. */
  link?: string;
  /** The shape link's ScreenTip. */
  linkTip?: string;
  /** The clip a video or audio shape plays. */
  media?: MediaOutline;
  geometry?: string;
  /** Solid fill as `#RRGGBB`. */
  fill?: string;
  /** Whether text operations apply to this shape. */
  textEditable: boolean;
  paragraphs?: ParagraphOutline[];
  table?: TableOutline;
  /** Chart content, for charts. */
  chart?: ChartOutline;
  /** Crop and adjustments, for pictures. */
  picture?: PictureOutline;
  /** Shadow, glow, soft edges, and reflection, when the shape has any. */
  effects?: EffectsOutline;
  /**
   * Group members, back to front. Their box, rotation, and flips are in
   * slide space (what `setTransform` takes and ungrouping gives them).
   */
  children?: ShapeOutline[];
}

/**
 * Fractions of the original image cropped off each edge (negative = empty
 * padding). The whole image spans the picture's box grown by these
 * fractions of the image: in the box's own (unrotated) coordinates its width
 * is `w / (1 - left - right)`, its left edge `x - left × that width`, and
 * likewise vertically; rotation and flips then apply about the box center.
 */
export interface CropOutline {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** A recolor (`formatPicture`); colors are `RRGGBB` or theme names. */
export type PictureRecolor =
  | 'none'
  | 'grayscale'
  | 'sepia'
  | 'washout'
  /** 50% threshold. */
  | 'blackWhite'
  | 'blackWhite25'
  | 'blackWhite75'
  /** `duotone:<color>`: dark shades of the color on white (PowerPoint's Dark Variations); `duotone:<dark>,<light>`: black and white become these colors. */
  | `duotone:${string}`
  /** Light shades of the color on black (PowerPoint's Light Variations). */
  | `duotoneLight:${string}`;

/** A picture's crop and adjustments (`inspect::PictureOutline`). */
export interface PictureOutline {
  crop: CropOutline;
  /** -1 to 1 (0 = unchanged). */
  brightness: number;
  /** -1 to 1 (0 = unchanged). */
  contrast: number;
  recolor: PictureRecolor;
  /** 0 (opaque) to 1. */
  transparency: number;
  /** Pixel size of the image, when its header gives it. */
  naturalWidth?: number;
  naturalHeight?: number;
}

/** Shadow presets of PowerPoint's Shadow gallery (`setShapeEffects`). */
export type ShadowPreset =
  | 'outerBottomRight'
  | 'outerBottom'
  | 'outerBottomLeft'
  | 'outerRight'
  | 'outerCenter'
  | 'outerLeft'
  | 'outerTopRight'
  | 'outerTop'
  | 'outerTopLeft'
  | 'innerTopLeft'
  | 'innerTop'
  | 'innerTopRight'
  | 'innerLeft'
  | 'innerCenter'
  | 'innerRight'
  | 'innerBottomLeft'
  | 'innerBottom'
  | 'innerBottomRight'
  | 'perspectiveUpperLeft'
  | 'perspectiveUpperRight'
  | 'perspectiveBelow'
  | 'perspectiveLowerLeft'
  | 'perspectiveLowerRight';

/** Reflection presets: how much is reflected, and the gap (touching, 4 pt, 8 pt). */
export type ReflectionPreset =
  | 'tightTouching'
  | 'halfTouching'
  | 'fullTouching'
  | 'tight4pt'
  | 'half4pt'
  | 'full4pt'
  | 'tight8pt'
  | 'half8pt'
  | 'full8pt';

/** A shadow (`inspect::ShadowOutline`). */
export interface ShadowOutline {
  kind: 'outer' | 'inner';
  /** The gallery preset these values match, if any. */
  preset?: ShadowPreset;
  /** `#RRGGBB`. */
  color: string;
  /** 0 (opaque) to 1. */
  transparency: number;
  /** Percent of the shape (100 for inner shadows). */
  sizePct: number;
  blurPt: number;
  distancePt: number;
  /** Degrees clockwise from the right (45 = toward the bottom right). */
  angleDeg: number;
}

export interface GlowOutline {
  /** `#RRGGBB`. */
  color: string;
  /** 0 (opaque) to 1. */
  transparency: number;
  sizePt: number;
}

export interface SoftEdgeOutline {
  sizePt: number;
}

export interface ReflectionOutline {
  /** The gallery preset these values match, if any. */
  preset?: ReflectionPreset;
  /** Where the reflection starts, 0 (opaque) to 1. */
  transparency: number;
  /** How much of the shape is reflected, in percent of its height. */
  sizePct: number;
  distancePt: number;
  blurPt: number;
}

/** A shape's (or text run's) effects (`inspect::EffectsOutline`). */
export interface EffectsOutline {
  /** An outer shadow when the shape has both kinds. */
  shadow?: ShadowOutline;
  glow?: GlowOutline;
  softEdge?: SoftEdgeOutline;
  reflection?: ReflectionOutline;
  /**
   * The effects come from the theme's effect style (or a layout
   * placeholder); `setShapeEffects` copies them onto the shape first.
   */
  inherited: boolean;
}

export interface SlideOutline {
  /** Stable slide id (survives reordering); a master's or layout's id for those. */
  id: number;
  /** 0-based position (in Slide Master view order for a master or layout). */
  index: number;
  /** Layout name (a master's or layout's own name for those). */
  layout: string;
  /** The layout's id (`DeckOutline.masters`); absent for a master. */
  layoutId?: number;
  hidden: boolean;
  title?: string;
  shapes: ShapeOutline[];
  notes?: string;
  /** The transition into the slide. */
  transition?: TransitionOutline;
  /** Animations of the main sequence, in playback order (index = playback position). */
  animations?: AnimationOutline[];
  /** The slide number, date, and footer the slide shows (absent: none). */
  headerFooter?: HeaderFooterOutline;
}

/** An automatic date format of the Header & Footer dialog (`setHeaderFooter`). */
export type DateFormat =
  | 'datetime1'
  | 'datetime2'
  | 'datetime3'
  | 'datetime4'
  | 'datetime5'
  | 'datetime6'
  | 'datetime7'
  | 'datetime8'
  | 'datetime9'
  | 'datetime10'
  | 'datetime11'
  | 'datetime12'
  | 'datetime13';

/**
 * What a slide shows of Header & Footer (`inspect::HeaderFooterOutline`):
 * the slide number, date, and footer placeholders it carries.
 */
export interface HeaderFooterOutline {
  slideNumber: boolean;
  date: boolean;
  /** The fixed date text, when the date is fixed. */
  dateText?: string;
  /**
   * The format of an automatic date (a `DateFormat`, or another `datetime*`
   * field type a deck may carry).
   */
  dateFormat?: DateFormat | (string & {});
  footer: boolean;
  /** The footer text (`\n` between paragraphs), when it shows a footer. */
  footerText?: string;
}

/** A named run of consecutive slides (`inspect::SectionOutline`). */
export interface SectionOutline {
  /** A GUID such as `{8D2E61C4-0B1F-4E6A-9C3B-2A1D5F7E9B10}`. */
  id: string;
  name: string;
  /** The section's slides in deck order (may be empty). */
  slideIds: number[];
}

export interface LayoutInfo {
  part: string;
  name: string;
  kind: string;
  master: string;
}

/** A slide layout of a master (`inspect::MasterLayoutOutline`). */
export interface MasterLayoutOutline {
  /** Layout id (≥ 2147483648); addresses the layout like a slide id. */
  id: number;
  name: string;
  /** Layout type (`title`, `obj`, `titleOnly`, `blank`, `cust`...). */
  kind: string;
  /** Slides using it, in deck order (a used layout cannot be deleted). */
  slideIds: number[];
  /** Placeholder types in z-order (`title`, `body`, `obj`, `pic`, `dt`, `ftr`, `sldNum`...). */
  placeholders: string[];
  /** The master's background graphics are hidden on it. */
  hideBackgroundGraphics: boolean;
}

/** A slide master and its layouts (`inspect::MasterOutline`). */
export interface MasterOutline {
  /** Master id (≥ 2147483648); addresses the master like a slide id. */
  id: number;
  /** Its own name, else its theme's ("Office Theme"). */
  name: string;
  /** Placeholder types on the master, in z-order. */
  placeholders: string[];
  layouts: MasterLayoutOutline[];
}

/**
 * The smallest master or layout id; slide ids are smaller. Reads that take a
 * slide index (`render`, `slideOutline`, `textLayout`...) take a master's or
 * layout's id in its place, and ops take it in place of a slide id.
 */
export const MASTER_ID_BASE = 2147483648;

export interface DeckOutline {
  width: number;
  height: number;
  slides: SlideOutline[];
  layouts: LayoutInfo[];
  /** Slide masters with their layouts (Slide Master view), in order. */
  masters?: MasterOutline[];
  /** `[slot, '#RRGGBB']` pairs of the first master's theme (`dk1`, `accent1`...). */
  themeColors: [string, string][];
  /** The theme's heading (major) and body (minor) Latin fonts. */
  themeFonts?: { major: string; minor: string };
  /** Table styles to offer: the deck's own, then the built-in ones in gallery order. */
  tableStyles: TableStyleInfo[];
  /** Sections in order; absent when the deck has none. Every slide is in exactly one. */
  sections?: SectionOutline[];
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
  /** Character spacing in points (0 = normal). */
  spacing?: number;
  /** Text shadow and glow (WordArt effects). */
  effects?: EffectsOutline;
  /** Hyperlink, as `RunPatch.link` takes it. */
  link?: string;
  /** The hyperlink's ScreenTip. */
  linkTip?: string;
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
  /** Character spacing in points (negative condenses; 0 = normal). */
  spacing?: number;
  /**
   * Hyperlink, or `""` to remove: an address, `#slide=<id>`, or a slide
   * show jump (`#nextslide`, `#previousslide`, `#firstslide`, `#lastslide`,
   * `#lastslideviewed`, `#endshow`).
   */
  link?: string;
  /** The link's ScreenTip. */
  linkTip?: string;
  /** Text shadow, as `setShapeEffects` takes it. */
  shadow?: ShadowSpec;
  /** Text glow, as `setShapeEffects` takes it. */
  glow?: GlowSpec;
}

/**
 * Shadow options. Omitted fields keep the current shadow's values (or those
 * of `preset`, or of `outerBottomRight` for a shape without a shadow).
 */
export interface ShadowOptions {
  preset?: ShadowPreset;
  /** `RRGGBB` or a theme color name (presets use black). */
  color?: string;
  /** 0 (opaque) to 1. */
  transparency?: number;
  /** Percent of the shape, 1-200 (outer shadows only). */
  sizePct?: number;
  /** 0-100. */
  blurPt?: number;
  /** 0-200. */
  distancePt?: number;
  /** Degrees clockwise from the right. */
  angleDeg?: number;
}

/** Glow options; a new glow defaults to accent1, 10 pt, 0.6 transparency. */
export interface GlowOptions {
  /** `RRGGBB` or a theme color name (theme colors get PowerPoint's 175% saturation). */
  color?: string;
  /** 0-150; 0 removes the glow. */
  sizePt?: number;
  /** 0 (opaque) to 1. */
  transparency?: number;
}

/** Soft edge options; a new soft edge defaults to 5 pt. */
export interface SoftEdgeOptions {
  /** 0-100; 0 removes it. */
  sizePt?: number;
}

/**
 * Reflection options. Omitted fields keep the current reflection's values
 * (or those of `preset`, or of `tightTouching`).
 */
export interface ReflectionOptions {
  preset?: ReflectionPreset;
  /** Where it starts, 0 (opaque) to 1. */
  transparency?: number;
  /** Percent of the shape's height, 1-100. */
  sizePct?: number;
  /** 0-100. */
  distancePt?: number;
  /** 0-100. */
  blurPt?: number;
}

/** `'none'` removes the effect; a preset or options set it. */
export type ShadowSpec = 'none' | ShadowPreset | ShadowOptions;
export type GlowSpec = 'none' | GlowOptions;
export type SoftEdgeSpec = 'none' | SoftEdgeOptions;
export type ReflectionSpec = 'none' | ReflectionPreset | ReflectionOptions;

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
  /** A clip played when clicked in a show; `poster` is shown until then. */
  | {
      kind: 'video' | 'audio';
      data: string;
      contentType: string;
      poster: string;
      description?: string;
    }
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
  /**
   * Replaces the slide's animations (its main sequence), in playback order;
   * `[]` removes them all. An entry matching an existing animation (same
   * shape, class, effect, and paragraph, and direction when given) keeps it
   * and its other settings unless given, so reordering is listing them anew.
   * Trigger (click-a-shape) sequences are kept.
   */
  | { op: 'setAnimations'; slide: number; animations: AnimationSpec[] }
  /** Adds a new animation at a playback position (the end when omitted). */
  | {
      op: 'addAnimation';
      slide: number;
      animation: AnimationSpec;
      index?: number;
    }
  /** Removes the listed shapes' animations and those at the listed positions (give one). */
  | {
      op: 'removeAnimations';
      slide: number;
      shapeIds?: number[];
      indexes?: number[];
    }
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
  /** Links whole shapes (followed on click in a slide show); `""` removes. */
  | {
      op: 'setShapeLink';
      slide: number;
      shapes: number[];
      link: string;
      tip?: string;
    }
  /** Format painter: gives `shapes` the look (fill, line, effects, style) of another shape. */
  | {
      op: 'pasteFormat';
      slide: number;
      shapes: number[];
      fromSlide: number;
      fromShape: number;
    }
  /**
   * Crops a picture: edges are fractions of the original image (negative =
   * padding; omitted edges keep their crop), and the frame moves so the
   * image stays put. `mode` (without edges) crops (`fill`) or pads (`fit`)
   * to the frame's aspect ratio, keeping the frame.
   */
  | ({
      op: 'cropPicture';
      left?: number;
      top?: number;
      right?: number;
      bottom?: number;
      mode?: 'fill' | 'fit';
    } & ShapeTarget)
  /** Picture corrections, recolor, and transparency; omitted fields stay. */
  | {
      op: 'formatPicture';
      slide: number;
      shapes: number[];
      /** -1 to 1. */
      brightness?: number;
      /** -1 to 1. */
      contrast?: number;
      recolor?: PictureRecolor;
      /** 0 (opaque) to 1. */
      transparency?: number;
      /** First remove the crop (the frame grows back) and every adjustment. */
      reset?: boolean;
    }
  /** Shape effects; omitted = keep, `'none'` = remove. */
  | {
      op: 'setShapeEffects';
      slide: number;
      shapes: number[];
      shadow?: ShadowSpec;
      glow?: GlowSpec;
      softEdge?: SoftEdgeSpec;
      reflection?: ReflectionSpec;
    }
  /** Recolors the deck's theme (slots: dk1, lt1, dk2, lt2, accent1-6, hlink, folHlink). */
  | {
      op: 'setThemeColors';
      colors: { slot: string; color: string }[];
      name?: string;
    }
  /** Sets the theme's heading and body fonts. */
  | { op: 'setThemeFonts'; major?: string; minor?: string; name?: string }
  | ({ op: 'setHeaderFooter' } & HeaderFooterPatch)
  /**
   * Changes the slide size (points, 72-4032 each: 960×540 widescreen,
   * 720×540 4:3, 720×405 16:9 on-screen show, 780×540 A4). Every slide
   * redraws; notes keep their size.
   */
  | { op: 'setSlideSize'; width: number; height: number; scale?: SlideScale }
  /**
   * Starts a section at `beforeSlide` (taking the rest of the section it was
   * in; in a deck without sections, earlier slides go into "Default
   * Section"). The new section's id is in `created[].section`.
   */
  | { op: 'addSection'; name: string; beforeSlide: number }
  | { op: 'renameSection'; id: string; name: string }
  /**
   * Removes a section: its slides join the previous section (the next one for
   * the first), or are deleted with `deleteSlides`. Removing the only section
   * leaves the deck without sections.
   */
  | { op: 'removeSection'; id: string; deleteSlides?: boolean }
  /** Moves a section and its slides to a 0-based index among the sections. */
  | { op: 'moveSection'; id: string; toIndex: number }
  /**
   * Slide Master ▸ Insert Layout (a title and the master's footers), or a
   * copy of `duplicate`; after `after` (a master id: first), else after the
   * copied layout, else last. The new layout's id is in `created[].slide`.
   */
  | {
      op: 'addLayout';
      master?: number;
      after?: number;
      duplicate?: number;
      name?: string;
    }
  /** Renames a layout, or a master (its theme name). */
  | { op: 'renameLayout'; layout: number; name: string }
  /**
   * Deletes a layout no slide uses (a master keeps one), or with a master id
   * a master none of whose layouts is used (another must remain).
   */
  | { op: 'deleteLayout'; layout: number }
  /** Slide Master ▸ Insert Placeholder; the new shape's id is in `created[].shape`. */
  | {
      op: 'insertPlaceholder';
      layout: number;
      kind: PlaceholderKind;
      x: number;
      y: number;
      w: number;
      h: number;
      /** Content and text placeholders only. */
      vertical?: boolean;
    }
  /** Slide Master ▸ Title, Footers, and Hide Background Graphics of a layout. */
  | {
      op: 'setLayoutOptions';
      layout: number;
      title?: boolean;
      footers?: boolean;
      hideBackgroundGraphics?: boolean;
    };

/** What a placeholder inserted on a layout holds (Insert Placeholder). */
export type PlaceholderKind =
  | 'content'
  | 'text'
  | 'picture'
  | 'chart'
  | 'table'
  | 'smartArt'
  | 'media';

/**
 * How content follows a new slide size: `none` keeps it as is; `fit`
 * (PowerPoint's Ensure Fit) scales content, text, and lines by the smaller of
 * the width and height ratios and centers it; `maximize` uses the larger
 * ratio (content may run off the slide).
 */
export type SlideScale = 'none' | 'fit' | 'maximize';

/**
 * The fields of a `setHeaderFooter` op (Insert ▸ Header & Footer); omitted
 * ones keep each slide's state. Shown elements are placeholders copied from
 * the slide's layout (a layout without one cannot show it).
 */
export interface HeaderFooterPatch {
  /** Slides to change; omit for every slide ("Apply to All", which new slides then follow). */
  slides?: number[];
  slideNumber?: boolean;
  date?: boolean;
  /**
   * Fixed date text; `''` makes the date automatic. Only changes slides that
   * show a date (pass `date: true` to turn it on).
   */
  dateText?: string;
  /** Automatic date format (default `datetime1`); without `dateText` it makes the date automatic. */
  dateFormat?: DateFormat;
  footer?: boolean;
  /** Footer text; only changes slides that show a footer (pass `footer: true`). */
  footerText?: string;
  /** Remove the elements from slides with a Title Slide layout. */
  notOnTitle?: boolean;
}

export interface Created {
  /** The slide (a new section's first slide). */
  slide: number;
  shape?: number;
  /** The id of a section `addSection` created. */
  section?: string;
}

/** What a batch (or an undo/redo) changed. */
export interface EditResult {
  created: Created[];
  /** Ids of slides whose rendering changed. */
  changedSlides: number[];
  /** Ids of slide masters and layouts whose own rendering changed (Slide Master view). */
  changedLayouts?: number[];
  /**
   * Slides were added, removed, or reordered, the slide size or sections
   * changed, or masters or layouts were added, removed, reordered, or renamed.
   */
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

/** An animation's effect group (`edit::AnimationClass`); `media` and `other` are only kept, never created. */
export type AnimationClass =
  | 'entrance'
  | 'emphasis'
  | 'exit'
  | 'path'
  | 'media'
  | 'other';

/** When an animation starts. */
export type AnimationStart = 'onClick' | 'withPrevious' | 'afterPrevious';

/** How often an animation plays: a count (`1` = once; fractions allowed) or until an event. */
export type AnimationRepeat = number | 'untilNextClick' | 'untilEndOfSlide';

/** Entrance effects `setAnimations` creates (PowerPoint's gallery). */
export type EntranceEffect =
  | 'appear'
  | 'fade'
  | 'flyIn'
  | 'floatIn'
  | 'split'
  | 'wipe'
  | 'shape'
  | 'wheel'
  | 'randomBars'
  | 'growTurn'
  | 'zoom'
  | 'swivel'
  | 'bounce';

/** Emphasis effects `setAnimations` creates. */
export type EmphasisEffect =
  | 'pulse'
  | 'colorPulse'
  | 'teeter'
  | 'spin'
  | 'growShrink'
  | 'desaturate'
  | 'darken'
  | 'lighten'
  | 'transparency'
  | 'boldFlash'
  | 'wave';

/** Exit effects `setAnimations` creates. */
export type ExitEffect =
  | 'disappear'
  | 'fadeOut'
  | 'flyOut'
  | 'floatOut'
  | 'split'
  | 'wipe'
  | 'shape'
  | 'wheel'
  | 'randomBars'
  | 'shrinkTurn'
  | 'zoom'
  | 'swivel'
  | 'bounce';

/** One animation of a slide's main sequence (`inspect::AnimationOutline`). */
export interface AnimationOutline {
  /** The animated shape (a group member's own id when it targets a member). */
  shapeId: number;
  class: AnimationClass;
  /**
   * An effect `setAnimations` creates, a preset the engine only names
   * (`blinds`, `boomerang`, `basicZoom`, `play`...), or `custom`.
   */
  effect: EntranceEffect | EmphasisEffect | ExitEffect | 'path' | (string & {});
  /** PowerPoint's `presetID`. */
  presetId: number;
  /** PowerPoint's `presetSubtype`. */
  presetSubtype: number;
  start: AnimationStart;
  /** One play, in milliseconds; 0 for instant effects (`appear`, `disappear`). */
  durationMs: number;
  /** Wait after its start (click, previous start, or previous end) before it plays. */
  delayMs: number;
  /** Effect option (see `AnimationSpec.direction`), when it has one. */
  direction?: string;
  /** The paragraph it animates (0-based), for paragraph builds. */
  paragraph?: number;
  repeat?: AnimationRepeat;
  /**
   * Motion paths: PowerPoint's path syntax (`M 0 0 L 0 0.25 E`), with
   * coordinates as fractions of the slide's width and height, relative to
   * the shape's position.
   */
  path?: string;
}

/**
 * One animation for `setAnimations` and `addAnimation`. Omitted fields take
 * the effect's defaults, or keep those of the existing animation it matches.
 */
export interface AnimationSpec {
  shapeId: number;
  class: AnimationClass;
  /** Names only kept (read-only presets, `custom`) must match an existing animation. */
  effect: EntranceEffect | EmphasisEffect | ExitEffect | 'path' | (string & {});
  /** Default `onClick`. */
  start?: AnimationStart;
  /** 10-60000; default per effect (fade/fly/wipe/zoom 500, float/teeter 1000, spin/shape/wheel/paths 2000). */
  durationMs?: number;
  /** 0-60000; default 0. */
  delayMs?: number;
  /**
   * Effect option (default: the first listed). flyIn/flyOut (edge it flies
   * from/to): bottom|left|right|top|bottomLeft|bottomRight|topLeft|topRight;
   * wipe (edge it starts from): bottom|left|right|top; split:
   * verticalOut|horizontalOut|verticalIn|horizontalIn (exit: the In ones
   * first); shape: circleOut|circleIn|boxOut|boxIn|diamondOut|diamondIn|
   * plusOut|plusIn (exit: circleIn first); wheel: spokes1|spokes2|spokes3|
   * spokes4|spokes8; randomBars: horizontal|vertical; zoom:
   * objectCenter|slideCenter; floatIn: up|down; floatOut: down|up; spin:
   * clockwise|counterclockwise; path: down|left|right|up.
   */
  direction?: string;
  /** Animate one paragraph (0-based) instead of the whole shape. */
  paragraph?: number;
  repeat?: AnimationRepeat;
  /** `path` class only: a motion path of its own (see `AnimationOutline.path`). */
  path?: string;
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

/** A clickable area of a slide (`linkRegions`). */
export interface LinkRegion {
  shape: number;
  /** As `RunPatch.link` takes it. */
  link: string;
  tip?: string;
  /** Corners in slide points, clockwise from the top left. */
  quad: [number, number, number, number, number, number, number, number];
}

/** The clip of a video or audio shape. */
export interface MediaOutline {
  kind: 'video' | 'audio';
  /** The embedded media part (`mediaBytes`). */
  part?: string;
  /** The address of a linked clip. */
  url?: string;
}
