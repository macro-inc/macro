/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * Licensed under the MIT license in the upstream Lexical source tree.
 */
import type { LexicalNode } from '../index';
import { getCloneRuntime } from './runtime';

export function afterCloneBase(
  target: LexicalNode,
  previous: LexicalNode
): void {
  const runtime = getCloneRuntime();
  if (target.__key === previous.__key) {
    runtime.writeBaseField(target, previous, '__parent', previous.__parent);
    runtime.writeBaseField(target, previous, '__next', previous.__next);
    runtime.writeBaseField(target, previous, '__prev', previous.__prev);
    runtime.setRawState(target, runtime.getRawState(previous));
  } else if (runtime.getRawState(previous)) {
    const state = runtime.getRawState(previous);
    if (state === undefined)
      throw new TypeError('Clone source state disappeared before getWritable');
    runtime.setRawState(target, state.getWritable(target));
  }
}

export function resetStateOnCopy(
  target: LexicalNode,
  _original: LexicalNode
): void {
  const runtime = getCloneRuntime();
  if (runtime.getRawState(target)) {
    const state = runtime.getRawState(target);
    if (state === undefined)
      throw new TypeError('Clone target state disappeared before getWritable');
    runtime.setRawState(target, state.getWritable(target).resetOnCopyNode());
  }
}
