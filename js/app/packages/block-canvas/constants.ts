export const OPERATION_LOGGING = false;

// Padding between nodes and their selection handles
export const SELECTION_PADDING = 0;

// The size of the handles that appear when a Node is selected.
export const HANDLE_SIZE = 8;

// The number of screen space pixels the use has to move the mouse before
// a click type event becomes a drag gesture like move.
export const DRAG_THRESHOLD = 3;

export const TOOLTIP_FONTSIZE = 14;

// Zoom bounds for the canvas.
export const MAX_ZOOM = 8;
export const MIN_ZOOM = 0.05;

// The maximum allowable flick speed when us touch to pan
export const MAX_PAN_FLICK_SPEED = 300;

// The pre-selected zoom level when interacting with +/- zoom buttons.
export const ZOOM_TARGETS = [
  0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 5, 6, 8,
];

export const ARROW_SIZE = 12;
export const ARROW_OFFSET = 36;

// Export types for UI and rectangle calculations to use.
export const ReorderOperations = {
  Forward: 'Forward',
  Backward: 'Backward',
  BringToFront: 'BringToFront',
  SendToBack: 'SendToBack',
} as const;

export type ReorderOperation =
  (typeof ReorderOperations)[keyof typeof ReorderOperations];

export const Corners = {
  TopLeft: 'TopLeft',
  TopRight: 'TopRight',
  BottomRight: 'BottomRight',
  BottomLeft: 'BottomLeft',
} as const;

export type Corner = (typeof Corners)[keyof typeof Corners];

export const Edges = {
  Top: 'top',
  Right: 'right',
  Bottom: 'bottom',
  Left: 'left',
} as const;

export type Edge = (typeof Edges)[keyof typeof Edges];

export type Anchor = Corner | Edge;

export const Directions = {
  Up: 'Up',
  Down: 'Down',
  Left: 'Left',
  Right: 'Right',
} as const;

export type Direction = (typeof Directions)[keyof typeof Directions];

export const RenderModes = {
  Basic: 'Basic',
  Preview: 'Preview',
  Selection: 'Selection',
} as const;

export type RenderMode = (typeof RenderModes)[keyof typeof RenderModes];

export const Tools = {
  Select: 'Select',
  SelectBox: 'SelectBox',
  Resize: 'Resize',
  Move: 'Move',
  Grab: 'Grab',
  ZoomIn: 'ZoomIn',
  ZoomOut: 'ZoomOut',
  Shape: 'Shape',
  Image: 'Image',
  File: 'File',
  Pencil: 'Pencil',
  Text: 'Text',
  Line: 'Line',
  Typing: 'Typing',
  // TODO: Comment
  // TODO: Crop
} as const;

export type Tool = (typeof Tools)[keyof typeof Tools];
export const ViewOnlyTools: Tool[] = [Tools.Grab, Tools.ZoomIn, Tools.ZoomOut];

export const URL_PARAMS = {
  x: 'canvas_x',
  y: 'canvas_y',
  s: 'canvas_scale',
} as const;
