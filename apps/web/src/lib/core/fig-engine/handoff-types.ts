/**
 * Export presets, layout grids, and guides as the engine describes them
 * (`fig_engine::model::handoff`, `fig_engine::inspect::handoff`).
 */

export type ExportFormat = 'PNG' | 'JPEG' | 'SVG' | 'PDF';
export type ExportConstraint =
  | 'CONTENT_SCALE'
  | 'CONTENT_WIDTH'
  | 'CONTENT_HEIGHT';

/** A layer's export preset (Figma's `exportSettings`). */
export interface ExportSetting {
  format: ExportFormat;
  suffix: string;
  constraint: ExportConstraint;
  value: number;
  /** SVG: text as outlines rather than `<text>`. */
  svgOutlineText: boolean;
  /** SVG: an `id` on every layer. */
  svgIncludeId: boolean;
  contentsOnly: boolean;
  useAbsoluteBounds: boolean;
  /** JPEG quality, 1–100. */
  quality: number;
}

/** What to export: layers with presets (their own when `settings` is null). */
export interface ExportRequest {
  items: { id: string; settings: ExportSetting[] | null }[];
  zipName?: string;
}

/** A file an export made. */
export interface ExportedFile {
  name: string;
  mime: string;
  blob: Blob;
}

export type GridPattern = 'GRID' | 'STRIPES';
export type Axis = 'X' | 'Y';
export type GridAlign = 'MIN' | 'CENTER' | 'STRETCH' | 'MAX';

/** A frame's layout grid. */
export interface LayoutGridInfo {
  pattern: GridPattern;
  /** `X`: columns; `Y`: rows. */
  axis: Axis;
  align: GridAlign;
  visible: boolean;
  /** 0 for "Auto" (as many as fit). */
  count: number;
  offset: number;
  sectionSize: number;
  gutter: number;
  /** `RRGGBB`. */
  color: string;
  alpha: number;
}

/** A guide: a vertical line at x = `offset` (`X`) or a horizontal one. */
export interface GuideInfo {
  axis: Axis;
  offset: number;
}

/** A frame with grids or guides, and where it is. */
export interface FrameAids {
  id: string;
  /** Frame → page, `[a, b, c, d, e, f]`. */
  transform: [number, number, number, number, number, number];
  width: number;
  height: number;
  grids: LayoutGridInfo[];
  guides: GuideInfo[];
}

/** The page's guides and its frames' grids and guides. */
export interface LayoutAids {
  guides: GuideInfo[];
  frames: FrameAids[];
}

/** A layer with export presets (Dev Mode's assets). */
export interface Exportable {
  id: string;
  name: string;
  settings: ExportSetting[];
}
