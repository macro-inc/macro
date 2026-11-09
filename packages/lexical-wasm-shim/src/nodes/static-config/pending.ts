/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * Licensed under the MIT license in the upstream Lexical source tree.
 */
import type { LexicalNode } from '../base';

let pendingNodeToClone: LexicalNode | null = null;

export function setPendingNodeToClone(node: LexicalNode | null): void {
  pendingNodeToClone = node;
}

/** Consume once; constructor authorization belongs to the actual runtime. */
export function getPendingNodeToClone(): LexicalNode | null {
  const node = pendingNodeToClone;
  pendingNodeToClone = null;
  return node;
}
