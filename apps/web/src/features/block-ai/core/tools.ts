/** Illustrator's tools, as the toolbar lists them. */

export type Tool =
  | 'select'
  | 'direct'
  | 'pen'
  | 'rectangle'
  | 'ellipse'
  | 'polygon'
  | 'star'
  | 'line'
  | 'type'
  | 'eyedropper'
  | 'artboard'
  | 'hand'
  | 'zoom';

/** Tools that draw a shape by dragging out its box. */
export type ShapeTool = 'rectangle' | 'ellipse' | 'polygon' | 'star' | 'line';

export interface ToolInfo {
  tool: Tool;
  label: string;
  /** The key that picks it, as shown (none for some, as in Illustrator). */
  key?: string;
  /** Only offered when the document is editable. */
  edit: boolean;
}

export const TOOLS: readonly ToolInfo[] = [
  { tool: 'select', label: 'Selection', key: 'V', edit: false },
  { tool: 'direct', label: 'Direct Selection', key: 'A', edit: false },
  { tool: 'pen', label: 'Pen', key: 'P', edit: true },
  { tool: 'type', label: 'Type', key: 'T', edit: true },
  { tool: 'line', label: 'Line Segment', key: '\\', edit: true },
  { tool: 'rectangle', label: 'Rectangle', key: 'M', edit: true },
  { tool: 'ellipse', label: 'Ellipse', key: 'L', edit: true },
  { tool: 'polygon', label: 'Polygon', edit: true },
  { tool: 'star', label: 'Star', edit: true },
  { tool: 'eyedropper', label: 'Eyedropper', key: 'I', edit: true },
  { tool: 'artboard', label: 'Artboard', key: '⇧O', edit: true },
  { tool: 'hand', label: 'Hand', key: 'H', edit: false },
  { tool: 'zoom', label: 'Zoom', key: 'Z', edit: false },
];

export function isShapeTool(tool: Tool): tool is ShapeTool {
  return (
    tool === 'rectangle' ||
    tool === 'ellipse' ||
    tool === 'polygon' ||
    tool === 'star' ||
    tool === 'line'
  );
}

/** Sides of a new polygon and points of a new star, as Illustrator starts. */
export const POLYGON_SIDES = 6;
export const STAR_POINTS = 5;
/** A new star's inner radius, as a fraction of its outer radius. */
export const STAR_INNER = 0.5;
