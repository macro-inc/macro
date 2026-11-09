/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import type { TextNode } from '../nodes';
import { $getCaretRange } from './ranges';
import type {
  CaretDirection,
  CaretRange,
  NodeCaret,
  PointCaret,
  TextPointCaret,
} from './types';

/**
 * Return the caret if it's in the given direction, otherwise return
 * caret.getFlipped().
 *
 * @param caret Any PointCaret
 * @param direction The desired direction
 * @returns A PointCaret in direction
 */
export function $getCaretInDirection<
  Caret extends PointCaret<CaretDirection>,
  D extends CaretDirection,
>(
  caret: Caret,
  direction: D
):
  | NodeCaret<D>
  | (Caret extends TextPointCaret<TextNode, CaretDirection>
      ? TextPointCaret<TextNode, D>
      : never);
export function $getCaretInDirection(
  caret: PointCaret<CaretDirection>,
  direction: CaretDirection
): PointCaret<CaretDirection> {
  return caret.direction === direction ? caret : caret.getFlipped();
}
/**
 * Return the range if it's in the given direction, otherwise
 * construct a new range using a flipped focus as the anchor
 * and a flipped anchor as the focus. This transformation
 * preserves the section of the document that it's working
 * with, but reverses the order of iteration.
 *
 * @param range Any CaretRange
 * @param direction The desired direction
 * @returns A CaretRange in direction
 */
export function $getCaretRangeInDirection<D extends CaretDirection>(
  range: CaretRange<CaretDirection>,
  direction: D
): CaretRange<D>;
export function $getCaretRangeInDirection(
  range: CaretRange<CaretDirection>,
  direction: CaretDirection
): CaretRange<CaretDirection> {
  if (range.direction === direction) {
    return range;
  }
  return $getCaretRange(
    // focus and anchor get flipped here
    $getCaretInDirection(range.focus, direction),
    $getCaretInDirection(range.anchor, direction)
  );
}
