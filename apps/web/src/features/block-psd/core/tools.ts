/**
 * The toolbar's tools, grouped as Photoshop groups them: a letter selects
 * a group's current tool, and Shift with the letter cycles through the
 * group (M: rectangular and elliptical marquee, L: lasso and polygonal
 * lasso, B: brush and pencil, G: gradient and paint bucket, U: rectangle
 * and ellipse).
 */

export type Tool =
  | 'move'
  | 'marqueeRect'
  | 'marqueeEllipse'
  | 'lasso'
  | 'polygonLasso'
  | 'wand'
  | 'crop'
  | 'eyedropper'
  | 'brush'
  | 'pencil'
  | 'eraser'
  | 'gradient'
  | 'bucket'
  | 'type'
  | 'rectangle'
  | 'ellipse'
  | 'hand'
  | 'zoom';

export interface ToolGroup {
  /** The shortcut letter (`KeyX` code without the prefix). */
  key: string;
  tools: Tool[];
}

export const TOOL_GROUPS: ToolGroup[] = [
  { key: 'V', tools: ['move'] },
  { key: 'M', tools: ['marqueeRect', 'marqueeEllipse'] },
  { key: 'L', tools: ['lasso', 'polygonLasso'] },
  { key: 'W', tools: ['wand'] },
  { key: 'C', tools: ['crop'] },
  { key: 'I', tools: ['eyedropper'] },
  { key: 'B', tools: ['brush', 'pencil'] },
  { key: 'E', tools: ['eraser'] },
  { key: 'G', tools: ['gradient', 'bucket'] },
  { key: 'T', tools: ['type'] },
  { key: 'U', tools: ['rectangle', 'ellipse'] },
  { key: 'H', tools: ['hand'] },
  { key: 'Z', tools: ['zoom'] },
];

export const TOOL_LABELS: Record<Tool, string> = {
  move: 'Move',
  marqueeRect: 'Rectangular Marquee',
  marqueeEllipse: 'Elliptical Marquee',
  lasso: 'Lasso',
  polygonLasso: 'Polygonal Lasso',
  wand: 'Magic Wand',
  crop: 'Crop',
  eyedropper: 'Eyedropper',
  brush: 'Brush',
  pencil: 'Pencil',
  eraser: 'Eraser',
  gradient: 'Gradient',
  bucket: 'Paint Bucket',
  type: 'Type',
  rectangle: 'Rectangle',
  ellipse: 'Ellipse',
  hand: 'Hand',
  zoom: 'Zoom',
};

/** Tools that change the document (hidden from people who can't edit). */
export const EDIT_TOOLS: ReadonlySet<Tool> = new Set<Tool>([
  'move',
  'crop',
  'brush',
  'pencil',
  'eraser',
  'gradient',
  'bucket',
  'type',
  'rectangle',
  'ellipse',
]);

/** Tools that paint into a layer's pixels (or its mask). */
export const PAINT_TOOLS: ReadonlySet<Tool> = new Set<Tool>([
  'brush',
  'pencil',
  'eraser',
  'gradient',
  'bucket',
]);

/** Tools that change the selection. */
export const SELECTION_TOOLS: ReadonlySet<Tool> = new Set<Tool>([
  'marqueeRect',
  'marqueeEllipse',
  'lasso',
  'polygonLasso',
  'wand',
]);

export const groupOf = (tool: Tool): ToolGroup =>
  TOOL_GROUPS.find((g) => g.tools.includes(tool)) ?? TOOL_GROUPS[0];

/**
 * The tool a letter selects: the group's last used tool, or with Shift the
 * next one in the group (from the current tool when it is in the group).
 * `remembered` maps a group's key to the tool last used in it.
 */
export function toolForKey(
  key: string,
  shift: boolean,
  current: Tool,
  remembered: Partial<Record<string, Tool>>
): Tool | undefined {
  const group = TOOL_GROUPS.find((g) => g.key === key.toUpperCase());
  if (!group) return undefined;
  const last = remembered[group.key] ?? group.tools[0];
  if (!shift) return last;
  const from = group.tools.includes(current) ? current : last;
  const at = group.tools.indexOf(from);
  return group.tools[(at + 1) % group.tools.length];
}
