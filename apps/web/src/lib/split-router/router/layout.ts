import { batch, untrack } from 'solid-js';
import { type ChangedPane, changedPanes, type PanesDiff } from '../panes/diff';
import type { PaneId } from '../panes/types';
import {
  decodePanes,
  encodePanes,
  formatLocation,
  parseLocation,
} from '../routes/codec';
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

export type ShowLayoutOptions = {
  /** Remove the open panes, through their leave guards, instead of parking them. */
  closeOpen?: boolean;
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
 *
 * A host can also park layouts: `openLayout` and `showLayout` take the open
 * panes out of the URL without removing them, so their views can stay mounted
 * (hidden) and come back with `showLayout` without remounting.
 */
export function createLayout(options: {
  routes: SplitRoutesManifest;
  panes: RouterPanes;
  url: Url;
  runner: Runner;
}) {
  const { routes, panes, url, runner } = options;

  /** The open (or the given retained) panes with their histories; entries are shared, not copied. */
  const snapshot = (only?: readonly PaneId[]): LayoutSnapshot => ({
    panes: (only ?? untrack(panes.ids)).flatMap((pane) => {
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

    return runner.startUrl(
      applyLayout(layout, diff, restoreOptions.replace ? 'replace' : 'push'),
      false
    );
  };

  /** A navigation applying `diff` and putting each captured history back. */
  const applyLayout = (
    layout: LayoutSnapshot,
    diff: PanesDiff<Entry>,
    mode: 'push' | 'replace'
  ): Navigation => {
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
      url.write(mode);

      const [first] = diff.panes;

      return { status: 'committed', pane: first!.pane };
    };

    return {
      cause: 'navigate',
      targets: changedPanes(diff).map(toTarget),
      removed: diff.removed,
      apply,
    };
  };

  /**
   * Shows a captured layout in new panes, with the ids it names, and parks
   * the open panes instead of removing them: nothing leaves, so no leave
   * guard runs (with `closeOpen`, they are removed through their guards).
   * The layout's pane ids must not be retained already.
   */
  const open = (
    layout: LayoutSnapshot,
    openOptions: ShowLayoutOptions = {}
  ): MaybePromise<NavigationResult> => {
    const retained = untrack(panes.retained);
    const reused = layout.panes.some((pane) => retained.includes(pane.pane));
    if (layout.panes.length === 0 || reused) return CANCELLED_RESULT;

    const diff: PanesDiff<Entry> = {
      panes: layout.panes.map((pane) => ({
        kind: 'create',
        pane: pane.pane,
        entry: shownEntry(pane),
      })),
      removed: openOptions.closeOpen ? untrack(panes.ids) : [],
    };

    return runner.startUrl(applyLayout(layout, diff, 'replace'), false);
  };

  /**
   * Makes retained (parked) panes the open ones, as they were: nothing
   * remounts. The open panes are parked, or removed through their leave
   * guards with `closeOpen`.
   */
  const show = (
    next: readonly PaneId[],
    showOptions: ShowLayoutOptions = {}
  ): MaybePromise<NavigationResult> => {
    const retained = untrack(panes.retained);
    const missing = next.some((pane) => !retained.includes(pane));
    if (next.length === 0 || missing) return CANCELLED_RESULT;

    const open = untrack(panes.ids);
    const removed = showOptions.closeOpen
      ? open.filter((pane) => !next.includes(pane))
      : [];

    const navigation: Navigation = {
      cause: 'navigate',
      targets: [],
      removed,
      apply: () => {
        batch(() => {
          panes.show(next);
          for (const pane of removed) panes.discard(pane);
        });
        url.write('replace');

        return { status: 'committed', pane: next[0]! };
      },
    };

    return runner.startUrl(navigation, false);
  };

  /** Forgets parked panes and their histories; open panes are left alone. */
  const discard = (parked: readonly PaneId[]): void => {
    batch(() => {
      for (const pane of parked) panes.discard(pane);
    });
  };

  /** The layout a mount-relative URL shows, in new panes, for `open`. */
  const fromHref = (href: string): LayoutSnapshot => {
    const decoded = decodePanes(routes, parseLocation(href));

    return {
      panes: decoded.panes.map(({ entry }) => ({
        pane: panes.createPaneId(),
        entries: [entry],
        index: 0,
      })),
    };
  };

  /** The mount-relative URL a captured layout shows, for saving or sharing. */
  const href = (layout: LayoutSnapshot): string => {
    const shown = layout.panes.map((pane) => ({
      paneId: pane.pane,
      entry: shownEntry(pane),
    }));

    return formatLocation(encodePanes(routes, shown, untrack(url.lastKnown)));
  };

  return { snapshot, restore, open, show, discard, fromHref, href };
}
