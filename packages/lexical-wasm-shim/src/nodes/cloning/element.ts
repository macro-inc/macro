/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * Licensed under the MIT license in the upstream Lexical source tree.
 */
import type { ElementNode } from '../index';
import { getCloneRuntime } from './runtime';

/** Field portion only; the public wrapper retains its real super dispatch. */
export function afterCloneElementFields(
  target: ElementNode,
  previous: ElementNode
): void {
  const runtime = getCloneRuntime();
  if (target.__key === previous.__key) {
    runtime.writeElementField(target, previous, '__first', previous.__first);
    runtime.writeElementField(target, previous, '__last', previous.__last);
    runtime.writeElementField(target, previous, '__size', previous.__size);
  }
  runtime.writeElementField(target, previous, '__indent', previous.__indent);
  runtime.writeElementField(target, previous, '__format', previous.__format);
  runtime.writeElementField(target, previous, '__style', previous.__style);
  runtime.writeElementField(target, previous, '__dir', previous.__dir);
  runtime.writeElementField(
    target,
    previous,
    '__textFormat',
    previous.__textFormat
  );
  runtime.writeElementField(
    target,
    previous,
    '__textStyle',
    previous.__textStyle
  );
}
