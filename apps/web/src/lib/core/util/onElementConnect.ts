import * as lifecycle from '@solid-primitives/lifecycle';
import { createCallback } from '@solid-primitives/rootless';

/**
 * Calls `callback` once `element` is in the document, under the caller's
 * Solid owner. A ref runs before its element is attached, so the
 * solid-primitives version almost always calls back from a ResizeObserver
 * with no owner: `onCleanup` there never runs, and computations created
 * there (including reads of `cond && value` props) are never disposed.
 */
export function onElementConnect(element: Element, callback: () => void) {
  lifecycle.onElementConnect(element, createCallback(callback));
}
