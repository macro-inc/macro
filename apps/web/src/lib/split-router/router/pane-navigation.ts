import { untrack } from 'solid-js';
import { match, P } from 'ts-pattern';
import {
  currentEntry,
  findBack,
  findStep,
  removeEntries,
} from '../panes/history';
import type { HistoryTarget, PaneChange } from '../panes/types';
import type { SplitRoutesManifest } from '../routes/manifest';
import { filterRouteSearch, ownsNamespace } from '../routes/queries';
import {
  assertSafeSearchName,
  locationOf,
  SearchValueTooLongError,
  updateSearchState,
} from '../routes/search';
import { resolveTarget } from '../routes/targets';
import type {
  Entry,
  PaneArrival,
  PaneId,
  SplitLocation,
  SplitNavigationTarget,
  SplitSearchUpdate,
  WriteMode,
} from '../routes/types';
import {
  CANCELLED,
  type Cancelled,
  type MaybePromise,
  mapMaybe,
} from '../utils';
import type { Claims } from './claims';
import {
  createEntry,
  mergeDestinationSearch,
  sameVisit,
  searchVisitEntry,
} from './entries';
import type { Runner } from './runner';
import {
  CANCELLED_RESULT,
  type Navigation,
  type NavigationCause,
  type NavigationResult,
  type PaneTarget,
  type RouterPanes,
  type SplitNavigateOptions,
  type VisitHistory,
} from './types';
import type { Url } from './url';

type Visit = { history: VisitHistory; arrival?: PaneArrival };

type VisitOptions = Visit & {
  target: PaneTarget;
  cause?: NavigationCause;
  /** Commit even when another pane or preview already shows the destination. */
  allowDuplicate?: boolean;
};

export type PaneNavigation = ReturnType<typeof createPaneNavigation>;

const PUSH: Visit = { history: 'push', arrival: 'fresh' };

const REPLACE: Visit = { history: 'replace', arrival: 'replace' };

const isCommitted = (result: NavigationResult) => result.status === 'committed';

function stepVisit(index: number, arrival: PaneArrival): Visit {
  return { history: { go: index }, arrival };
}

/** A push adds a URL entry; replace, go and reset rewrite the current one. */
function visitWriteMode(history: VisitHistory): WriteMode {
  if (history === 'push') return 'push';

  return 'replace';
}

const historyChange = (
  history: VisitHistory,
  entry: Entry
): PaneChange<Entry> =>
  match(history)
    .with('push', 'replace', (type) => ({ type, entry }))
    .with({ go: P.number }, ({ go }) => ({
      type: 'go' as const,
      index: go,
      entry,
    }))
    .with({ reset: P.array() }, ({ reset, index }) => ({
      type: 'reset' as const,
      entries: reset.with(index, entry),
      index,
    }))
    .exhaustive();

function searchLocation(
  routes: SplitRoutesManifest,
  from: Entry,
  namespace: string,
  update: SplitSearchUpdate
): SplitLocation {
  const updated = updateSearchState(from.location, { [namespace]: update });
  const search = filterRouteSearch(routes, updated.route, updated.search);

  return locationOf(updated.route, search);
}

function warnUnownedSearch(
  routes: SplitRoutesManifest,
  location: SplitLocation,
  search: SplitNavigateOptions['search']
) {
  if (!import.meta.env.DEV) return;
  if (!search) return;

  const { route } = location;
  const leaf = route.matches.at(-1)!;
  const unowned = Object.keys(search).filter(
    (namespace) => !ownsNamespace(routes, route, namespace)
  );

  for (const namespace of unowned) {
    console.warn(
      `Split route "${leaf.id}" does not own search namespace "${namespace}"`
    );
  }
}

/** Builds a location from caller input; a search value the URL can't hold refuses it instead of throwing. */
function withinSearchLimits<T>(build: () => T): T | Cancelled {
  try {
    return build();
  } catch (error) {
    if (!(error instanceof SearchValueTooLongError)) throw error;

    console.error('Split router refused a navigation', error);
    return CANCELLED;
  }
}

/**
 * What callers do within one pane: navigate, go back, change search, and
 * edit its history. Each verb waits until pane actions may run (see
 * `runner.act`), then navigates or, for changes that need no guards or
 * middleware, commits at once.
 */
export function createPaneNavigation(options: {
  routes: SplitRoutesManifest;
  panes: RouterPanes;
  url: Url;
  runner: Runner;
  claims: Claims;
  /** Shows `location` as the only pane, for a destination the other panes can't share the URL with. */
  navigateToLocation(
    location: SplitLocation,
    navigateOptions: SplitNavigateOptions
  ): MaybePromise<NavigationResult>;
}) {
  const { routes, panes, url, runner, claims } = options;

  /** Panes share one top-level route; `location` under another can't join the panes besides `pane`. */
  const leavesSharedRoute = (
    pane: PaneId | undefined,
    location: SplitLocation
  ): boolean => {
    const root = location.route.matches[0].id;

    return untrack(panes.ids).some((other) => {
      if (other === pane) return false;

      const entry = untrack(() => panes.current(other));
      if (!entry) return false;

      return entry.location.route.matches[0].id !== root;
    });
  };

  /** Back and Forward skip entries shown elsewhere and entries under another top-level route. */
  const visitableIn =
    (pane: PaneId, allowDuplicate?: boolean) => (entry: Entry) => {
      const shownElsewhere = !claims.canVisit(pane, allowDuplicate)(entry);
      if (shownElsewhere) return false;

      return !leavesSharedRoute(pane, entry.location);
    };

  const applyVisit = (
    pane: PaneId,
    { history, arrival }: Visit,
    entry: Entry
  ): NavigationResult => {
    panes.commit(pane, historyChange(history, entry), arrival);
    url.write(visitWriteMode(history));

    return { status: 'committed', pane };
  };

  /** A visit to one pane; its claim is checked as it applies. */
  const visitNavigation = ({
    target,
    history,
    arrival,
    cause = 'navigate',
    allowDuplicate,
  }: VisitOptions): Navigation => {
    const { pane, from } = target;
    const check = {
      pane,
      from,
      allowDuplicate,
      mode: visitWriteMode(history),
    };

    const apply = ([entry]: readonly Entry[]) =>
      claims.applyUnlessHeld(check, entry!, () =>
        applyVisit(pane, { history, arrival }, entry!)
      );

    return { cause, targets: [target], apply };
  };

  const visit = (visitOptions: VisitOptions) =>
    runner.start(visitOptions.target.pane, visitNavigation(visitOptions));

  /** A pane action on the pane's current entry; `missing` when the pane has none. */
  const withCurrent = <T>(
    pane: PaneId,
    missing: T,
    run: (from: Entry) => MaybePromise<T>
  ) =>
    runner.act(missing, () => {
      const from = panes.current(pane);
      if (!from) return missing;

      return run(from);
    });

  const resolve = (
    base: Entry | undefined,
    to: SplitNavigationTarget,
    navigateOptions: SplitNavigateOptions
  ): SplitLocation | undefined => {
    const build = () =>
      resolveTarget(routes, base?.location, to, {
        depth: navigateOptions.depth,
        search: navigateOptions.search,
      });
    const location = withinSearchLimits(build);
    if (location === CANCELLED) return;

    if (!location) {
      console.error('Split router could not resolve navigation target', to);
      return;
    }

    warnUnownedSearch(routes, location, navigateOptions.search);

    return location;
  };

  /** The pane already shows `entry` and nothing is on its way; kept props aren't new. */
  const isUnchanged = (pane: PaneId, from: Entry, entry: Entry) => {
    const handsOverProps =
      entry.props !== undefined && entry.props !== from.props;
    const sameDestination = !handsOverProps && sameVisit(from, entry);

    return sameDestination && !runner.isRunning(pane);
  };

  function visitLocation(
    pane: PaneId,
    from: Entry,
    location: SplitLocation,
    navigateOptions: SplitNavigateOptions
  ): MaybePromise<NavigationResult> {
    const entry = createEntry(routes, location, from, navigateOptions);
    if (isUnchanged(pane, from, entry)) return { status: 'unchanged', pane };

    const history = navigateOptions.replace ? REPLACE : PUSH;
    const target = { pane, from, to: entry };
    const { allowDuplicate } = navigateOptions;

    return visit({ ...history, target, allowDuplicate });
  }

  function navigateToTarget(
    pane: PaneId,
    from: Entry,
    to: SplitNavigationTarget,
    navigateOptions: SplitNavigateOptions
  ): MaybePromise<NavigationResult> {
    const location = resolve(from, to, navigateOptions);
    if (!location) return CANCELLED_RESULT;

    if (leavesSharedRoute(pane, location)) {
      return options.navigateToLocation(location, navigateOptions);
    }

    return visitLocation(pane, from, location, navigateOptions);
  }

  function traverse(
    pane: PaneId,
    from: Entry,
    delta: number,
    navigateOptions: SplitNavigateOptions
  ): MaybePromise<NavigationResult> {
    const { allowDuplicate } = navigateOptions;
    const visitable = visitableIn(pane, allowDuplicate);

    const snapshot = panes.read(pane);
    if (!snapshot) return CANCELLED_RESULT;

    const step = findStep(snapshot, delta, visitable);
    if (!step) return CANCELLED_RESULT;

    const arrival = delta < 0 ? 'back' : 'forward';
    const target = { pane, from, to: step.entry };

    return visit({
      ...stepVisit(step.index, arrival),
      target,
      cause: 'history',
      allowDuplicate,
    });
  }

  /** The nearest earlier entry matching `predicate` the pane may go back to. */
  const backStep = (pane: PaneId, predicate: (entry: Entry) => boolean) => {
    const snapshot = panes.read(pane);
    if (!snapshot) return;

    return findBack(snapshot, predicate, visitableIn(pane));
  };

  /** False when the jump is turned down. */
  const jumpBack = (
    pane: PaneId,
    from: Entry,
    step: HistoryTarget<Entry>
  ): MaybePromise<boolean> => {
    const target = { pane, from, to: step.entry };
    const result = visit({
      ...stepVisit(step.index, 'back'),
      target,
      cause: 'history',
    });

    return mapMaybe(result, isCommitted);
  };

  function changeSearch(
    pane: PaneId,
    from: Entry,
    namespace: string,
    update: SplitSearchUpdate,
    mode: WriteMode
  ): MaybePromise<NavigationResult> {
    warnUnownedSearch(routes, from.location, { [namespace]: update });

    const build = () => searchLocation(routes, from, namespace, update);
    const location = withinSearchLimits(build);
    if (location === CANCELLED) return CANCELLED_RESULT;

    const to = searchVisitEntry(from, location, mode);
    if (isUnchanged(pane, from, to)) return { status: 'unchanged', pane };

    return visit({
      history: mode,
      target: { pane, from, to },
      cause: 'search',
    });
  }

  /** False when nothing matched or the change was turned down. */
  function removeFromHistory(
    pane: PaneId,
    predicate: (entry: Entry) => boolean
  ): MaybePromise<boolean> {
    const snapshot = panes.read(pane);
    if (!snapshot) return false;

    const next = removeEntries(snapshot, predicate);
    if (!next) return false;

    const removedAny = next.entries.length < snapshot.entries.length;
    if (!removedAny) return false;

    // Removing entries shifts history indexes an in-flight traversal relies on.
    runner.abort(pane);

    const from = currentEntry(snapshot);
    const to = currentEntry(next);
    const target = { pane, from, to };
    const history = { reset: next.entries, index: next.index };
    const currentStays = to.id === from.id;

    if (currentStays) {
      const navigation = visitNavigation({ history, target, cause: 'history' });

      return isCommitted(runner.commitNow(navigation));
    }

    const result = visit({ ...REPLACE, history, target, cause: 'history' });

    return mapMaybe(result, isCommitted);
  }

  return {
    navigate(
      pane: PaneId,
      to: SplitNavigationTarget | number,
      navigateOptions: SplitNavigateOptions = {}
    ): MaybePromise<NavigationResult> {
      return withCurrent(pane, CANCELLED_RESULT, (from) => {
        if (typeof to === 'number') {
          return traverse(pane, from, to, navigateOptions);
        }

        return navigateToTarget(pane, from, to, navigateOptions);
      });
    },

    updateSearch(
      pane: PaneId,
      namespace: string,
      update: SplitSearchUpdate,
      searchOptions: { history?: WriteMode } = {}
    ): MaybePromise<NavigationResult> {
      assertSafeSearchName(namespace, 'namespace');
      const mode = searchOptions.history ?? 'push';

      return withCurrent(pane, CANCELLED_RESULT, (from) =>
        changeSearch(pane, from, namespace, update, mode)
      );
    },

    /** Jump back to the nearest earlier entry matching `predicate`. False when none qualifies or the jump is turned down. */
    goBackTo(
      pane: PaneId,
      predicate: (entry: Entry) => boolean
    ): MaybePromise<boolean> {
      return withCurrent(pane, false, (from) => {
        const step = backStep(pane, predicate);
        if (!step) return false;

        return jumpBack(pane, from, step);
      });
    },

    /** Drops matching entries from the pane's history. False when none matched or it was turned down. */
    removeEntries(
      pane: PaneId,
      predicate: (entry: Entry) => boolean
    ): MaybePromise<boolean> {
      return runner.act(false, () => removeFromHistory(pane, predicate));
    },

    /** Point the current entry at a new location without a navigation or remount. */
    rewriteCurrent(
      pane: PaneId,
      to: SplitNavigationTarget
    ): MaybePromise<NavigationResult> {
      return withCurrent(pane, CANCELLED_RESULT, (from) => {
        const location = resolve(from, to, {});
        if (!location) return CANCELLED_RESULT;

        const target = { pane, from, to: { ...from, location } };

        return runner.commitNow(visitNavigation({ ...REPLACE, target }));
      });
    },

    canGo(pane: PaneId, delta: number): boolean {
      const snapshot = panes.read(pane);
      if (!snapshot) return false;

      return findStep(snapshot, delta, visitableIn(pane)) !== undefined;
    },

    /** Carries the search `destination` asked for to `pane`, which already shows it. */
    carrySearch(pane: PaneId, destination: Entry, mode: WriteMode): void {
      void withCurrent(pane, undefined, (from) => {
        const location = mergeDestinationSearch(routes, from, destination);
        if (!location) return;

        const to = searchVisitEntry(from, location, mode);
        void visit({
          history: mode,
          target: { pane, from, to },
          cause: 'search',
        });
      });
    },

    resolve,
    visitLocation,
    backStep,
    jumpBack,
    leavesSharedRoute,
    navigateToLocation: options.navigateToLocation,
  };
}
