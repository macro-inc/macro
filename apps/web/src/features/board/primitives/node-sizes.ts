import { makeResizeObserver } from '@solid-primitives/resize-observer';
import { batch, onCleanup } from 'solid-js';
import { createStore } from 'solid-js/store';
import type { Size } from '../core/camera';

/**
 * Rendered node sizes in world units, so layouts can pack real heights
 * instead of estimates. One observer serves every node; layout sizes ignore
 * the board's zoom transform.
 */
export function createNodeSizes() {
  const [sizes, setSizes] = createStore<Record<string, Size>>({});
  const keys = new WeakMap<Element, string>();

  const { observe, unobserve } = makeResizeObserver<HTMLElement>((entries) => {
    batch(() => {
      for (const entry of entries) {
        const key = keys.get(entry.target);
        if (!key) continue;
        const element = entry.target as HTMLElement;
        const width = element.offsetWidth;
        const height = element.offsetHeight;
        const current = sizes[key];
        if (current?.width === width && current.height === height) continue;
        setSizes(key, { width, height });
      }
    });
  });

  return {
    size: (key: string): Size | undefined => sizes[key],
    /** Measures `element` as node `key` until the calling component unmounts. */
    measure(element: HTMLElement, key: string) {
      keys.set(element, key);
      observe(element);
      onCleanup(() => unobserve(element));
    },
  };
}

export type NodeSizes = ReturnType<typeof createNodeSizes>;
