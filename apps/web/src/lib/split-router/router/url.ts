import { untrack } from 'solid-js';
import type { HistoryAdapter } from '../history/types';
import { encodePanes, sameExternalLocation } from '../routes/codec';
import type { SplitRoutesManifest } from '../routes/manifest';
import type { ExternalLocation, PaneId, WriteMode } from '../routes/types';
import type { RouterPanes } from './types';

export type Url = ReturnType<typeof createUrl>;

/** Writes the panes to the URL, and remembers the URL they were last known to show. */
export function createUrl(options: {
  routes: SplitRoutesManifest;
  history: HistoryAdapter;
  panes: RouterPanes;
}) {
  const { routes, history, panes } = options;
  let lastKnown: ExternalLocation = history.read();

  const shownPanes = () =>
    untrack(panes.ids).flatMap((pane) => {
      const entry = untrack(() => panes.current(pane));
      if (!entry) return [];

      return [{ paneId: pane, entry }];
    });

  return {
    lastKnown: () => lastKnown,

    /** The URL shows `location` now, though the router didn't write it. */
    remember(location: ExternalLocation) {
      lastKnown = location;
    },

    /** `landed` is the URL a URL navigation landed on; its hash and global keys carry over. */
    write(mode: WriteMode, writeOptions: { landed?: ExternalLocation } = {}) {
      const shown = shownPanes();
      if (shown.length === 0) return;

      const { landed } = writeOptions;
      const basis = landed ?? lastKnown;
      const keepHash = landed !== undefined;
      const next = encodePanes(routes, shown, basis, { keepHash });
      if (sameExternalLocation(next, lastKnown)) return;

      // A write that throws never reached the URL, so it isn't known yet.
      history.write(next, { mode });
      lastKnown = next;
    },

    /** An href for one pane's current entry, for copying or a new tab. */
    href(pane: PaneId): string {
      const entry = untrack(() => panes.current(pane));
      if (!entry) return '';

      const single = [{ paneId: pane, entry }];

      return history.href(encodePanes(routes, single, lastKnown));
    },
  };
}
