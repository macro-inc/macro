export * from './affine';
export { resolveAppearance } from './appearance';
export type { GraphicsBackend } from './backend';
export {
  fitImageCamera,
  INITIAL_CAMERA,
  MAX_SCALE,
  MIN_SCALE,
  screenToWorld,
  worldToScreen,
  zoomAt,
} from './camera';
export * from './commands';
export {
  createGraphicsEditor,
  createGraphicsEditorFromBackend,
  type EditingSession,
  type GraphicsEditor,
} from './editor';
export * from './fragments';
export { type LayerOperation, reorderNodes } from './layering';
export type {
  Appearance,
  Bounds,
  Camera,
  EllipseItem,
  GraphicsDocument,
  GraphicsItem,
  GroupItem,
  ImageSurface,
  Placement,
  Point,
  RectangleItem,
  ShapeGeometryMap,
  ShapeItem,
  ShapeKind,
  SurfaceItem,
} from './model';
export {
  isSortKey,
  type LayerPosition,
  type SortKey,
  sortKeysBetween,
} from './ordering';
export * from './scene';
export type { TransformHandle, TransformModifiers } from './selection';
export {
  createSelection,
  type ResizeCorner,
  type ResizeEdge,
  type ResizeHandle,
  type ResizeModifiers,
  type SelectionHost,
  type SelectionState,
} from './selection';
export {
  type SelectionFrame,
  selectionContainsPoint,
  selectionFrame,
} from './selection-frame';
export type { HitTestContext, ShapeDefinition } from './shapes/definition';
export { ellipseDefinition } from './shapes/ellipse';
export { rectangleDefinition } from './shapes/rectangle';
export {
  isShape,
  isShapeKind,
  shapeDefinition,
  shapeDefinitions,
  shapeKinds,
} from './shapes/registry';
export { selectedShapeIds } from './style-selection';
