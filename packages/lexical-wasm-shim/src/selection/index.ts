export type {
  BaseSelection,
  ElementPoint,
  ElementPoint as ElementPointType,
  PointType,
  TextPoint,
  TextPoint as TextPointType,
} from 'lexical';
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
export { $createPoint, Point } from './point';
export { RangeSelection } from './range';
export { type SelectionRuntime, withSelectionRuntime } from './runtime';
