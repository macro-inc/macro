import { fireAndForget } from '@core/util/fireAndForget';
import { GRAPHICS_METADATA_ORIGIN } from '@macro-inc/graphics/loro';
import type { LoroDoc } from 'loro-crdt';
import { onCleanup } from 'solid-js';
import type { CanvasReferenceSource } from '../context/reference-source';
import { readSharedCanvas } from '../core/collaboration';
import { canvasReferenceTargets } from '../core/references';

/** Track mentions in shared maps, including every concurrently created mention. */
export function createSharedReferenceTracking(
  doc: LoroDoc,
  documentId: string,
  canEdit: () => boolean,
  delivered: () => Promise<boolean>,
  references: CanvasReferenceSource
) {
  const mentions = doc.getMap(`canvasMentions:${documentId}`);
  const retiring = doc.getMap(`canvasRetiring:${documentId}`);
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  const targets = () => canvasReferenceTargets(readSharedCanvas(doc).document);
  const writable = () => !disposed && canEdit();
  async function reconcile() {
    if (!writable() || running) return;
    running = true;
    try {
      for (const target of targets()) {
        if (!writable()) return;
        if (Object.values(mentions.toJSON()).includes(target)) continue;
        const id = await references.create(target);
        if (!writable()) return;
        mentions.set(id, target);
        doc.commit({ origin: GRAPHICS_METADATA_ORIGIN });
      }
      for (const [id, target] of Object.entries(mentions.toJSON())) {
        if (!writable()) return;
        if (typeof target === 'string' && targets().has(target)) continue;
        retiring.set(id, true);
        mentions.delete(id);
        doc.commit({ origin: GRAPHICS_METADATA_ORIGIN });
      }
      if (!writable() || !retiring.keys().length || !(await delivered()))
        return;
      if (!writable()) return;
      // Never untrack a reference until its scene deletion and retirement are durable.
      for (const id of retiring.keys()) {
        if (!writable()) return;
        await references.remove(id);
        if (!writable()) return;
        retiring.delete(id);
        doc.commit({ origin: GRAPHICS_METADATA_ORIGIN });
      }
    } finally {
      running = false;
    }
  }
  const schedule = () => {
    if (!writable()) return;
    clearTimeout(timer);
    timer = setTimeout(
      () => fireAndForget(reconcile(), 'canvas-references'),
      500
    );
  };
  const unsubscribe = doc.subscribe(schedule);
  schedule();
  onCleanup(() => {
    disposed = true;
    clearTimeout(timer);
    unsubscribe();
  });
}
