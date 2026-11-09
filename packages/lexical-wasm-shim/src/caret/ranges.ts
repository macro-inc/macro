/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import { invariant } from '../../../lexical-wasm-view/src/compat/support';
import { $getRoot } from '../editor';
import type { TextNode } from '../nodes';
import {
  $getAdjacentChildCaret,
  $getSiblingCaret,
  $getTextNodeOffset,
  $getTextPointCaret,
  $isTextPointCaret,
  flipDirection,
} from './node-carets';
import type {
  CaretDirection,
  CaretRange,
  NodeCaret,
  PointCaret,
  RootMode,
  StepwiseIteratorConfig,
  TextPointCaret,
  TextPointCaretSlice,
  TextPointCaretSliceTuple,
} from './types';

/**
 * Construct a TextPointCaretSlice given a TextPointCaret and a signed distance. The
 * distance should be negative to slice text before the caret's offset, and positive
 * to slice text after the offset. The direction of the caret itself is not
 * relevant to the string coordinates when working with a TextPointCaretSlice
 * but mutation operations will preserve the direction.
 *
 * @param caret
 * @param distance
 * @returns TextPointCaretSlice
 */
export function $getTextPointCaretSlice<
  T extends TextNode,
  D extends CaretDirection,
>(caret: TextPointCaret<T, D>, distance: number): TextPointCaretSlice<T, D> {
  return new TextPointCaretSliceImpl(caret, distance);
}

class CaretRangeImpl<D extends CaretDirection> implements CaretRange<D> {
  readonly type = 'node-caret-range';
  readonly direction: D;
  anchor: PointCaret<D>;
  focus: PointCaret<D>;
  constructor(anchor: PointCaret<D>, focus: PointCaret<D>, direction: D) {
    this.anchor = anchor;
    this.focus = focus;
    this.direction = direction;
  }
  getLatest(): CaretRange<D> {
    const anchor = this.anchor.getLatest();
    const focus = this.focus.getLatest();
    return anchor === this.anchor && focus === this.focus
      ? this
      : new CaretRangeImpl(anchor, focus, this.direction);
  }
  isCollapsed(): boolean {
    return this.anchor.isSamePointCaret(this.focus);
  }
  getTextSlices(): TextPointCaretSliceTuple<D> {
    const getSlice = (k: 'anchor' | 'focus') => {
      const caret = this[k].getLatest();
      return $isTextPointCaret(caret)
        ? $getSliceFromTextPointCaret(caret, k)
        : null;
    };
    const anchorSlice = getSlice('anchor');
    const focusSlice = getSlice('focus');
    if (anchorSlice && focusSlice) {
      const { caret: anchorCaret } = anchorSlice;
      const { caret: focusCaret } = focusSlice;
      if (anchorCaret.isSameNodeCaret(focusCaret)) {
        return [
          $getTextPointCaretSlice(
            anchorCaret,
            focusCaret.offset - anchorCaret.offset
          ),
          null,
        ];
      }
    }
    return [anchorSlice, focusSlice];
  }
  iterNodeCarets(rootMode: RootMode = 'root'): IterableIterator<NodeCaret<D>> {
    const anchor = $isTextPointCaret(this.anchor)
      ? this.anchor.getSiblingCaret()
      : this.anchor.getLatest();
    const focus = this.focus.getLatest();
    const isTextFocus = $isTextPointCaret(focus);
    const step = (state: NodeCaret<D>) =>
      state.isSameNodeCaret(focus)
        ? null
        : $getAdjacentChildCaret(state) || state.getParentCaret(rootMode);
    return makeStepwiseIterator({
      hasNext: (state: null | NodeCaret<D>): state is NodeCaret<D> =>
        state !== null && !(isTextFocus && focus.isSameNodeCaret(state)),
      initial: anchor.isSameNodeCaret(focus) ? null : step(anchor),
      map: (state) => state,
      step,
    });
  }
  [Symbol.iterator](): IterableIterator<NodeCaret<D>> {
    return this.iterNodeCarets('root');
  }
}

class TextPointCaretSliceImpl<T extends TextNode, D extends CaretDirection>
  implements TextPointCaretSlice<T, D>
{
  readonly type = 'slice';
  readonly caret: TextPointCaret<T, D>;
  readonly distance: number;
  constructor(caret: TextPointCaret<T, D>, distance: number) {
    this.caret = caret;
    this.distance = distance;
  }
  getSliceIndices(): [startIndex: number, endIndex: number] {
    const {
      distance,
      caret: { offset },
    } = this;
    const offsetB = offset + distance;
    return offsetB < offset ? [offsetB, offset] : [offset, offsetB];
  }

  getTextContent(): string {
    const [startIndex, endIndex] = this.getSliceIndices();
    return this.caret.origin.getTextContent().slice(startIndex, endIndex);
  }

  getTextContentSize(): number {
    return Math.abs(this.distance);
  }

  removeTextSlice(): TextPointCaret<T, D> {
    const {
      caret: { origin, direction },
    } = this;
    const [indexStart, indexEnd] = this.getSliceIndices();
    const text = origin.getTextContent();
    return $getTextPointCaret(
      origin.setTextContent(text.slice(0, indexStart) + text.slice(indexEnd)),
      direction,
      indexStart
    );
  }
}

function $getSliceFromTextPointCaret<
  T extends TextNode,
  D extends CaretDirection,
>(
  caret: TextPointCaret<T, D>,
  anchorOrFocus: 'anchor' | 'focus'
): TextPointCaretSlice<T, D> {
  const { direction, origin } = caret;
  const offsetB = $getTextNodeOffset(
    origin,
    anchorOrFocus === 'focus' ? flipDirection(direction) : direction
  );
  return $getTextPointCaretSlice(caret, offsetB - caret.offset);
}

/**
 * Guard to check for a TextPointCaretSlice
 *
 * @param caretOrSlice A caret or slice
 * @returns true if caretOrSlice is a TextPointCaretSlice
 */
export function $isTextPointCaretSlice<D extends CaretDirection>(
  caretOrSlice:
    | null
    | undefined
    | PointCaret<D>
    | TextPointCaretSlice<TextNode, D>
): caretOrSlice is TextPointCaretSlice<TextNode, D> {
  return caretOrSlice instanceof TextPointCaretSliceImpl;
}

/**
 * Construct a CaretRange that starts at anchor and goes to the end of the
 * document in the anchor caret's direction.
 */
export function $extendCaretToRange<D extends CaretDirection>(
  anchor: PointCaret<D>
): CaretRange<D> {
  return $getCaretRange(anchor, $getSiblingCaret($getRoot(), anchor.direction));
}

/**
 * Construct a collapsed CaretRange that starts and ends at anchor.
 */
export function $getCollapsedCaretRange<D extends CaretDirection>(
  anchor: PointCaret<D>
): CaretRange<D> {
  return $getCaretRange(anchor, anchor);
}

/**
 * Construct a CaretRange from anchor and focus carets pointing in the
 * same direction. In order to get the expected behavior,
 * the anchor must point towards the focus or be the same point.
 *
 * In the 'next' direction the anchor should be at or before the
 * focus in the document. In the 'previous' direction the anchor
 * should be at or after the focus in the document
 * (similar to a backwards RangeSelection).
 *
 * @param anchor
 * @param focus
 * @returns a CaretRange
 */
export function $getCaretRange<D extends CaretDirection>(
  anchor: PointCaret<D>,
  focus: PointCaret<D>
): CaretRange<D> {
  invariant(
    anchor.direction === focus.direction,
    '$getCaretRange: anchor and focus must be in the same direction'
  );
  return new CaretRangeImpl(anchor, focus, anchor.direction);
}

/**
 * A generalized utility for creating a stepwise iterator
 * based on:
 *
 * - an initial state
 * - a stop guard that returns true if the iteration is over, this
 *   is typically used to detect a sentinel value such as null or
 *   undefined from the state but may return true for other conditions
 *   as well
 * - a step function that advances the state (this will be called
 *   after map each time next() is called to prepare the next state)
 * - a map function that will be called that may transform the state
 *   before returning it. It will only be called once for each next()
 *   call when stop(state) === false
 *
 * @param config
 * @returns An IterableIterator
 */
export function makeStepwiseIterator<State, Stop, Value>(
  config: StepwiseIteratorConfig<State, Stop, Value>
): IterableIterator<Value> {
  const { initial, hasNext, step, map } = config;
  let state = initial;
  return {
    [Symbol.iterator]() {
      return this;
    },
    next(): IteratorResult<Value> {
      if (!hasNext(state)) {
        return { done: true, value: undefined };
      }
      const rval = { done: false, value: map(state) };
      state = step(state);
      return rval;
    },
  };
}
