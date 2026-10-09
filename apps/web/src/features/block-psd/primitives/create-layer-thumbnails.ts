/**
 * Layer thumbnails for the layers panel: each layer drawn alone by the
 * engine (PNG), loaded when a row asks for it and again when the layer's
 * pixels may have changed (`version`), a few at a time so a large
 * document does not hold up edits. Object URLs are revoked when replaced
 * and on cleanup.
 */

import type { PsdEngine } from '@core/psd-engine/client';
import { createSignal, onCleanup } from 'solid-js';

/** Thumbnails rendered at once. */
const CONCURRENCY = 2;
/** Device pixels of a thumbnail's longest side. */
const SIZE = 64;

export function createLayerThumbnails(options: {
  engine: Pick<PsdEngine, 'thumbnail'>;
  /** Bumped when a layer's pixels may have changed. */
  version: (id: number) => number;
}) {
  const [urls, setUrls] = createSignal(new Map<number, string | null>());
  /** The version each layer's thumbnail shows (or is loading). */
  const loaded = new Map<number, number>();
  const queue: number[] = [];
  let running = 0;
  let disposed = false;

  const pump = () => {
    while (running < CONCURRENCY && queue.length > 0) {
      const id = queue.shift();
      if (id === undefined) break;
      running++;
      void load(id);
    }
  };

  const load = async (id: number) => {
    const version = options.version(id);
    try {
      const blob = await options.engine.thumbnail(id, SIZE);
      if (disposed) return;
      const url = blob ? URL.createObjectURL(blob) : null;
      setUrls((current) => {
        const next = new Map(current);
        const old = next.get(id);
        if (old) URL.revokeObjectURL(old);
        next.set(id, url);
        return next;
      });
      loaded.set(id, version);
    } catch {
      // The layer is gone; its row goes with it.
    } finally {
      running--;
      pump();
    }
  };

  onCleanup(() => {
    disposed = true;
    for (const url of urls().values()) if (url) URL.revokeObjectURL(url);
  });

  return {
    /** The layer's thumbnail URL (`null` when it draws nothing). */
    url(id: number): string | null | undefined {
      const version = options.version(id);
      if (loaded.get(id) !== version && !queue.includes(id)) {
        loaded.set(id, version);
        queue.push(id);
        queueMicrotask(pump);
      }
      return urls().get(id);
    },
  };
}
