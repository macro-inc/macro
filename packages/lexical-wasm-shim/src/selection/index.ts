export {
  bindSelectionReference,
  captureReplySelections,
  selectionFromSnapshot,
  selectionToSnapshot,
} from './codec';
export * from './helpers';
export { $normalizeSelection as $normalizeSelection__EXPERIMENTAL } from './helpers';
export { NodeSelection } from './node';
export { $createPoint, Point } from './point';
export { RangeSelection } from './range';
export { type SelectionRuntime, withSelectionRuntime } from './runtime';
