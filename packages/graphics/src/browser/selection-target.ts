import type { GraphicsDocument, Point } from '../core/model';
import { hitTestWithin } from '../core/scene';
import {
  selectionContainsPoint,
  selectionFrame,
} from '../core/selection-frame';

/** Hover and pointer-down share the same selection policy, including box interiors. */
export function selectionTarget(
  document: GraphicsDocument,
  selectedIds: readonly string[],
  point: Point,
  options: {
    deep: boolean;
    additive: boolean;
    handle: boolean;
    tolerance: number;
    /** Searched only when nothing is within `tolerance`: a finger's reach. */
    reach?: number;
  }
) {
  const frame = selectionFrame(document, selectedIds);
  return options.handle ||
    (!options.additive &&
      !options.deep &&
      !(
        selectedIds.length === 1 &&
        document.items[selectedIds[0]!]?.type === 'connector'
      ) &&
      frame &&
      selectionContainsPoint(frame, point))
    ? selectedIds[0]
    : hitTestWithin(
        document,
        point,
        options.deep,
        options.tolerance,
        options.reach ?? options.tolerance
      );
}
