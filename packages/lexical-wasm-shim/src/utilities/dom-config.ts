/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * Licensed under the MIT license in the repository root.
 * Ported from pinned lexical v0.45.0.
 */
import type { ElementNode } from '../nodes';

export function setNodeIndentFromDOM(
  elementDom: HTMLElement,
  elementNode: ElementNode
) {
  // Prefer the authoritative attribute Lexical writes in exportDOM, since the
  // padding-inline-start fallback can't recover a custom
  // `--lexical-indent-base-value` or the reconciler's `calc(...)` form.
  const indentAttr = elementDom.getAttribute('data-lexical-indent');
  if (indentAttr !== null) {
    const parsed = parseInt(indentAttr, 10);
    if (Number.isFinite(parsed) && parsed >= 0) {
      elementNode.setIndent(parsed);
      return;
    }
  }
  const indentSize = parseInt(elementDom.style.paddingInlineStart, 10) || 0;
  const indent = Math.round(indentSize / 40);
  elementNode.setIndent(indent);
}

export function $setDirectionFromDOM<T extends ElementNode>(
  node: T,
  domNode: HTMLElement
): T {
  const dir = domNode.getAttribute('dir');
  return dir === 'ltr' || dir === 'rtl' ? node.setDirection(dir) : node;
}
