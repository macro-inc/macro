export {
  bindSelectionReference,
  captureReplySelections,
  selectionFromNativeValue,
  selectionFromReference,
  selectionFromSnapshot,
  selectionToSnapshot,
} from './codec';
export type {
  SelectionObservableActual,
  SelectionObservableExpected,
} from './contract.type-test';
export * from './helpers';
export { $normalizeSelection as $normalizeSelection__EXPERIMENTAL } from './helpers';
export { NodeSelection } from './node';
export type {
  ElementPointType as ElementPoint,
  ElementPointType,
  PointType,
  TextPointType as TextPoint,
  TextPointType,
} from './point';
export { $createPoint, Point } from './point';
export { RangeSelection } from './range';
export type { BaseSelection } from './runtime';
export {
  type SelectionArgument,
  type SelectionRuntime,
  withSelectionRuntime,
} from './runtime';
