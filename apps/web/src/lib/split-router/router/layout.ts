import { batch, untrack } from 'solid-js';
import { type ChangedPane, changedPanes } from '../panes/diff';
import type { PaneId } from '../panes/types';
import { encodePanes, formatLocation } from '../routes/codec';
import type { SplitRoutesManifest } from '../routes/manifest';
import type { Entry } from '../routes/types';
import type { MaybePromise } from '../utils';
import { sameVisit } from './entries';
import type { Runner } from './runner';
import {
  CANCELLED_RESULT,
  type Navigation,
  type NavigationResult,
  type PaneTarget,
  type RouterPanes,
} from './types';
import type { Url } from './url';

/** One pane in a captured layout: its full history and cursor. */
export type LayoutPane = {
  pane: PaneId;
  entries: readonly Entry[];
  index: number;
};

/** A whole layout: every open pane with its history, in order. */
export type LayoutSnapshot = {
  panes: readonly LayoutPane[];
};

export type RestoreLayoutOptions = {
  replace?: boolean;
};

const shownEntry = (pane: LayoutPane): Entry => pane.entries[pane.index]!;

function toTarget(change: ChangedPane<Entry>): PaneTarget {
  if (change.kind === 'change') {
    return { pane: change.pane, from: change.from, to: change.to };
  }

  return { pane: change.pane, to: change.entry };
}

/**
 * Capturing the open panes as plain data and bringing a capture back, so a
 * host can keep several layouts (such as window tabs) and swap between them
 * without losing any pane's back/forward history.
 */
export function createLayout(options: {
  routes: SplitRoutesManifest;
  panes: RouterPanes;
  url: Url;
  runner: Runner;
}) {
  const { routes, panes, url, runner } = options;

  /** The open panes with their histories; entries are shared, not copied. */
  const snapshot = (): LayoutSnapshot => ({
    panes: untrack(panes.ids).flatMap((pane) => {
      const stored = untrack(() => panes.read(pane));
      if (!stored) return [];

      return [{ pane, entries: stored.entries, index: stored.index }];
    }),
  });

  /**
   * Makes the captured layout the open panes in one guarded navigation: leave
   * guards run for removed and changed panes, and each restored pane gets its
   * captured history back. A pane already showing its entry stays mounted.
   */
  const restore = (
    layout: LayoutSnapshot,
    restoreOptions: RestoreLayoutOptions = {}
  ): MaybePromise<NavigationResult> => {
    if (layout.panes.length === 0) return CANCELLED_RESULT;

    const incoming = layout.panes.map((pane) => ({
      paneId: pane.pane,
      entry: shownEntry(pane),
    }));
    const diff = panes.diff(incoming, { same: sameVisit });

    const apply = (entries: readonly Entry[]): NavigationResult => {
      batch(() => {
        panes.applyDiff(diff, entries);

        // Put each captured history back; the shown entry may have been
        // amended by middleware, so the live one replaces it at the cursor.
        layout.panes.forEach((pane, position) => {
          const landed = diff.panes[position]!.pane;
          const current = untrack(() => panes.current(landed));
          if (!current) return;

          const history = [...pane.entries];
          history[pane.index] = current;
          panes.commit(landed, {
            type: 'reset',
            entries: history,
            index: pane.index,
          });
        });
      });
      url.write(restoreOptions.replace ? 'replace' : 'push');

      const [first] = diff.panes;

      return { status: 'committed', pane: first!.pane };
    };

    const navigation: Navigation = {
      cause: 'navigate',
      targets: changedPanes(diff).map(toTarget),
      removed: diff.removed,
      apply,
    };

    return runner.startUrl(navigation, false);
  };

  /** The mount-relative URL a captured layout shows, for saving or sharing. */
  const href = (layout: LayoutSnapshot): string => {
    const shown = layout.panes.map((pane) => ({
      paneId: pane.pane,
      entry: shownEntry(pane),
    }));

    return formatLocation(encodePanes(routes, shown, untrack(url.lastKnown)));
  };

  return { snapshot, restore, href };
}
