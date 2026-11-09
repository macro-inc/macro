/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * Licensed under the MIT license in the upstream Lexical source tree.
 */
import type {
  DOMConversion,
  DOMConversionFn,
  DOMConversionMap,
  DOMConversionProp,
} from '../nodes/dom-types';
import type { NodeClass, RegisteredNodes } from '../nodes/replacement/types';

export type DOMConversionCache = Map<string, DOMConversionProp<HTMLElement>[]>;

export function initializeConversionCache(
  nodes: RegisteredNodes,
  additionalConversions?: DOMConversionMap
): DOMConversionCache {
  const cache: DOMConversionCache = new Map();
  const handled = new Set<NonNullable<NodeClass['importDOM']>>();
  const add = (map: DOMConversionMap): void => {
    Object.keys(map).forEach((key) => {
      let entries = cache.get(key);
      if (entries === undefined) {
        entries = [];
        cache.set(key, entries);
      }
      entries.push(map[key]);
    });
  };
  nodes.forEach((row) => {
    const importDOM = row.klass.importDOM;
    if (importDOM == null || handled.has(importDOM)) return;
    handled.add(importDOM);
    const map = importDOM.call(row.klass);
    if (map !== null) add(map);
  });
  if (additionalConversions) add(additionalConversions);
  return cache;
}

/** Sound HTMLElement subset; the upstream Node/#text invocation boundary is separate. */
export function getHTMLElementConversionFunction(
  domNode: HTMLElement,
  cache: ReadonlyMap<string, readonly DOMConversionProp<HTMLElement>[]>
): DOMConversionFn | null {
  const { nodeName } = domNode;
  const conversions = cache.get(nodeName.toLowerCase());
  let current: DOMConversion | null = null;
  if (conversions !== undefined) {
    for (const convert of conversions) {
      const next = convert(domNode);
      if (
        next !== null &&
        (current === null || (current.priority || 0) <= (next.priority || 0))
      )
        current = next;
    }
  }
  return current !== null ? current.conversion : null;
}
