import type { SplitRouter } from '@app/lib/split-router';
import { createEffect, on, onCleanup } from 'solid-js';
import { recordDocumentNavigation } from './document-lifecycle';

/** One small local checkpoint after a router commit, with no IPC or export. */
export function trackNavigationLifecycle(
  router: SplitRouter,
  savedEntryStateCount: () => number
): void {
  let disposed = false;
  let queued = false;
  onCleanup(() => {
    disposed = true;
  });
  createEffect(
    on(
      () => router.panes().map((pane) => router.history(pane)),
      () => {
        if (queued) return;
        queued = true;
        // Let every pane finish pruning its saved state before counting it.
        queueMicrotask(() => {
          queued = false;
          if (disposed) return;
          const panes = router.panes();
          recordDocumentNavigation({
            paneCount: panes.length,
            historyEntryCount: panes.reduce(
              (count, pane) =>
                count + (router.history(pane)?.entries.length ?? 0),
              0
            ),
            savedEntryStateCount: savedEntryStateCount(),
          });
        });
      }
    )
  );
}
