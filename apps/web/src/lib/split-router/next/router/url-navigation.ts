import { untrack } from 'solid-js';
import type {
  ExternalChange,
  HistoryAdapter,
  InterceptHandler,
} from '../history/types';
import { type ChangedPane, changedPanes } from '../panes/diff';
import { decodePanes, sameExternalLocation } from '../routes/codec';
import type { SplitRoutesManifest } from '../routes/manifest';
import type { Entry, ExternalLocation, WriteMode } from '../routes/types';
import { type MaybePromise, UNCANCELLABLE } from '../utils';
import { sameVisit } from './entries';
import {
  checksFor,
  PANE_LEVEL,
  type LeaveGuards,
  runChecks,
} from './leave-guards';
import type { Runner } from './runner';
import type {
  PaneTarget,
  Navigation,
  NavigationCause,
  NavigationResult,
  RouterPanes,
} from './types';
import type { Url } from './url';

type UrlNavigationOptions = {
  cause: NavigationCause;
  /** How applying it writes the URL back. */
  mode: WriteMode;
  revert?: () => MaybePromise<void>;
};

// The URL owns the location and history state owns route state; the stored
// entry keeps its in-memory props and metadata.
const adopt = (stored: Entry, incoming: Entry): Entry => ({
  ...stored,
  location: incoming.location,
  state: incoming.state,
});

function toTarget(change: ChangedPane<Entry>): PaneTarget {
  if (change.kind === 'change') {
    return { pane: change.pane, from: change.from, to: change.to };
  }

  return { pane: change.pane, to: change.entry };
}

/** The panes following the URL: the first load, Back/Forward, and links from outside. */
export function createUrlNavigation(options: {
  routes: SplitRoutesManifest;
  history: HistoryAdapter;
  panes: RouterPanes;
  url: Url;
  runner: Runner;
  guards: LeaveGuards;
  markReady(): void;
}) {
  const { routes, history, panes, url, runner, guards } = options;

  /** Makes every pane show `location`. */
  const navigationTo = (
    location: ExternalLocation,
    { cause, mode, revert }: UrlNavigationOptions
  ): Navigation => {
    const decoded = decodePanes(routes, location);
    const diff = panes.diff(decoded.panes, { same: sameVisit, adopt });

    const apply = (entries: readonly Entry[]): NavigationResult => {
      panes.applyDiff(diff, entries);
      url.write(mode, { landed: location });
      options.markReady();

      const [first] = diff.panes;

      return { status: 'committed', pane: first!.pane };
    };

    return {
      cause,
      externalSearch: location.search,
      targets: changedPanes(diff).map(toTarget),
      removed: diff.removed,
      revert,
      apply,
    };
  };

  /** The first load; pane actions wait for it. */
  const load = (location: ExternalLocation) => {
    const navigation = navigationTo(location, {
      cause: 'initial',
      mode: 'replace',
    });

    return runner.startUrl(navigation, true);
  };

  /** Back/Forward, or any URL change the router didn't make; it can be put back. */
  const follow = (change: ExternalChange) => {
    // Adapters may report our own writes and reverts landing; those match what we show.
    const alreadyShown = sameExternalLocation(change.location, url.lastKnown());
    if (alreadyShown) return;

    const previous = url.lastKnown();
    url.remember(change.location);

    const revert = () => {
      url.remember(previous);

      return change.revert();
    };

    const navigation = navigationTo(change.location, {
      cause: 'external',
      mode: 'replace',
      revert,
    });

    void runner.startUrl(navigation, false);
  };

  /** A link into the router's routes, handled before it lands; the router writes the URL itself. */
  const takeOver = (location: ExternalLocation) => {
    const navigation = navigationTo(location, {
      cause: 'external',
      mode: 'push',
    });

    void runner.startUrl(navigation, false);

    return false;
  };

  /** Whether every pane's guards let the host leave the router's routes. */
  const canLeave = () => {
    const checks = untrack(panes.ids).flatMap((pane) => {
      const from = untrack(() => panes.current(pane));
      if (!from) return [];

      const context = {
        pane,
        from,
        cause: 'external' as const,
        signal: UNCANCELLABLE,
      };

      return checksFor(guards.select(pane, PANE_LEVEL), context);
    });

    return runChecks(checks);
  };

  const intercept: InterceptHandler = (location) => {
    const leavingRouter = !location;
    if (leavingRouter) return canLeave();

    return takeOver(location);
  };

  return {
    /** Loads the URL and follows the history adapter until the returned stop is called. */
    connect(): () => void {
      const unsubscribe = history.subscribe(follow);
      const stopIntercept = history.intercept?.(intercept);

      void load(url.lastKnown());

      return () => {
        unsubscribe();
        stopIntercept?.();
      };
    },
  };
}
