/**
 * Slide thumbnails, rendered in the background (never ahead of the slide on
 * screen) and re-rendered when a slide's version changes.
 */

import type { SlideOutline } from '@core/pptx-engine/types';
import { type Accessor, createSignal, onCleanup } from 'solid-js';
import type { PresentationEngine } from '../context/pptx-editor-context';
import type { PresentationSession } from './create-presentation-session';
import type { RenderQueue } from './create-render-queue';

interface Entry {
  version: number;
  bitmap?: ImageBitmap;
  pending: boolean;
}

export function createThumbnails(options: {
  engine: PresentationEngine;
  session: PresentationSession;
  queue: RenderQueue;
  /** Pixel width of a thumbnail. */
  width: Accessor<number>;
}) {
  const [entries, setEntries] = createSignal<ReadonlyMap<number, Entry>>(
    new Map()
  );

  const update = (id: number, entry: Entry) =>
    setEntries((m) => {
      const next = new Map(m);
      const old = next.get(id);
      if (old?.bitmap && old.bitmap !== entry.bitmap) old.bitmap.close();
      next.set(id, entry);
      return next;
    });

  function request(slide: SlideOutline) {
    const version = options.session.slideVersion(slide.id);
    const entry = entries().get(slide.id);
    if (entry && (entry.version === version || entry.pending)) return;
    update(slide.id, { version, bitmap: entry?.bitmap, pending: true });
    const wanted = () =>
      options.session.outline()?.slides.some((s) => s.id === slide.id) ?? false;
    void options.queue
      .background(async () => {
        // The slide may have moved since it was queued.
        const index =
          options.session
            .outline()
            ?.slides.findIndex((s) => s.id === slide.id) ?? -1;
        if (index < 0) return undefined;
        return options.engine.render(index, options.width());
      }, wanted)
      .then((bitmap) => {
        const current = entries().get(slide.id);
        update(slide.id, {
          version,
          bitmap: bitmap ?? current?.bitmap,
          pending: false,
        });
        // Changed again while rendering: go round once more.
        if (options.session.slideVersion(slide.id) !== version) {
          const latest = options.session
            .outline()
            ?.slides.find((s) => s.id === slide.id);
          if (latest) request(latest);
        }
      })
      .catch(() => {
        const current = entries().get(slide.id);
        update(slide.id, { version, bitmap: current?.bitmap, pending: false });
      });
  }

  onCleanup(() => {
    for (const e of entries().values()) e.bitmap?.close();
  });

  return {
    /** The latest thumbnail of a slide; requests a fresh one when stale. */
    thumbnail(slide: SlideOutline): ImageBitmap | undefined {
      const entry = entries().get(slide.id);
      if (!entry || entry.version !== options.session.slideVersion(slide.id)) {
        queueMicrotask(() => request(slide));
      }
      return entry?.bitmap;
    },
  };
}

export type Thumbnails = ReturnType<typeof createThumbnails>;
