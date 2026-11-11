/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * Licensed under the MIT license in the upstream Lexical source tree.
 */
import type { TextNode } from '../index';
import { getCloneRuntime } from './runtime';

/** Field portion only; the public wrapper retains its real super dispatch. */
export function afterCloneTextFields(
  target: TextNode,
  previous: TextNode
): void {
  const runtime = getCloneRuntime();
  runtime.writeTextField(target, previous, '__text', previous.__text);
  runtime.writeTextField(target, previous, '__format', previous.__format);
  runtime.writeTextField(target, previous, '__style', previous.__style);
  runtime.writeTextField(target, previous, '__mode', previous.__mode);
  runtime.writeTextField(target, previous, '__detail', previous.__detail);
}
