import deepEqual from 'fast-deep-equal';
import { createClaimReservations } from './claims';
import { createSplitRouterHistories } from './history';
import { createLayoutAdapter } from './layout';
import { createLocationSync } from './location-sync';
import { prepareEntries, prepareEntry } from './middleware';
import { resolveNavigation } from './navigation';
import {
  assertRouteEntry,
  assertSearchNamespacesAllowed,
  createRoutesManifest,
  getRouteClaim,
} from './routes';
import { assertSafeSearchName, updateSearchState } from './search';
import { createTransitionManager } from './transitions';
import type {
  BrowserHistoryIntent,
  SplitNavigateOptions,
  SplitNavigateTo,
  SplitRouteClaim,
  SplitRouter,
  SplitRouterEntry,
  SplitRouterExternalLocationValue,
  SplitRouterOptions,
} from './types';
import { decodeSplitRouterLocation, serializeSplitRouterLocation } from './url';
import { isPromise, throwIfAborted } from './utils';

type CommitOptions = {
  history: BrowserHistoryIntent;
  preserveHash: boolean;
  preserveExternalSearch?: boolean;
};

type LayoutTransition = {
  entries: SplitRouterEntry[];
  cause: 'initial' | 'external' | 'layout';
  externalSearch?: string;
  apply: (entries: SplitRouterEntry[]) => void;
};

type ApplyOptions<TSplitId> = {
  entry: SplitRouterEntry;
  target: TSplitId | 'new-split';
  replace: boolean;
  history: BrowserHistoryIntent;
  preserveHash: boolean;
  requireTarget?: boolean;
  recordHistory?: boolean;
};

type EntryTransition<TSplitId> = {
  key: unknown;
  splitId?: TSplitId;
  entry: SplitRouterEntry;
  from: SplitRouterEntry | undefined;
  cause: 'navigate' | 'history' | 'search';
  allowDuplicate?: boolean;
  apply: (entry: SplitRouterEntry) => boolean;
};

const GLOBAL_TRANSITION = Symbol('split-router-global-transition');

export function createSplitRouter<TSplitId>(
  options: SplitRouterOptions<TSplitId>
): SplitRouter<TSplitId> {
  const routes =
    'definitions' in options.routes
      ? createRoutesManifest(options.routes)
      : options.routes;

  const middleware = options.middleware ?? [];
  const claims = createClaimReservations();
  const entryControllers = new Map<unknown, AbortController>();
  const subscribers = new Set<(splitId: TSplitId | undefined) => void>();
  let accepted: SplitRouterEntry[] = [];
  let expectedLayout: SplitRouterEntry[] | undefined;
  let layoutChangeQueued = false;
  let queuedHistory: BrowserHistoryIntent = 'push';
  let ready = false;
  let disposed = false;

  const locationSync = createLocationSync({
    routes,
    location: options.location,
  });
  const middlewareConfig = { routes, handlers: middleware };
  const layout = createLayoutAdapter(options.layout, routes);
  const histories = createSplitRouterHistories<TSplitId, SplitRouterEntry>(
    layout.entryEquals
  );

  const reconcileHistories = (
    intent: BrowserHistoryIntent,
    mode: 'move' | 'write'
  ) => {
    histories.reconcile(
      layout.snapshot().entries.map(({ splitId, location }) => ({
        id: splitId,
        entry: { location },
      })),
      intent,
      mode
    );
  };

  const notify = (splitId?: TSplitId) => {
    for (const listener of subscribers) listener(splitId);
  };

  const transitions = createTransitionManager<TSplitId, SplitRouterEntry>({
    onError(error) {
      console.error('Split router transition failed', error);
    },
    onSettled(splitId, publicStateChanged) {
      const becameReady = !ready;
      ready = true;
      if (becameReady) notify();
      else if (publicStateChanged) notify(splitId);
    },
  });
  const findEntry = (splitId: TSplitId) =>
    transitions.pending(splitId) ?? layout.find(splitId);

  const findClaimedSplit = (
    claim: SplitRouteClaim,
    targetId: TSplitId | undefined
  ) =>
    layout
      .snapshot()
      .entries.find(
        (candidate) =>
          !Object.is(candidate.splitId, targetId) &&
          deepEqual(getRouteClaim(routes, candidate.location.route), claim)
      );

  const claimToAcquire = (
    entry: SplitRouterEntry,
    config: EntryTransition<TSplitId>
  ) => {
    if (config.allowDuplicate) return;
    const claim = getRouteClaim(routes, entry.location.route);
    const current =
      config.splitId === undefined ? undefined : layout.find(config.splitId);
    // Updating an existing owner is not a new acquisition. In particular,
    // search/parameter updates must not collapse restored duplicate panes.
    if (
      current &&
      deepEqual(getRouteClaim(routes, current.location.route), claim)
    )
      return;
    return claim;
  };

  const notifyLayoutChanges = (
    before: SplitRouterEntry[],
    after: SplitRouterEntry[]
  ) => {
    for (const splitId of layout.changedIds(before, after)) {
      notify(splitId);
    }
  };

  const expectLayoutEcho = () => {
    expectedLayout = layout.entries();
  };

  const reconcileEntries = (
    current: SplitRouterEntry[],
    requested: SplitRouterEntry[]
  ): boolean => {
    if (!layout.reconcile(current, requested)) {
      return false;
    }

    expectLayoutEcho();
    return true;
  };

  const commitLayout = (commit: CommitOptions) => {
    locationSync.commit(layout.entries(), commit);
  };

  const abortAllTransitions = (publish = true) => {
    for (const controller of [...entryControllers.values()]) controller.abort();
    const hadPendingEntries = transitions.abortAll();
    if (publish && hadPendingEntries) notify();
  };

  const cancelTargetTransition = (key: unknown) => {
    if (transitions.has(GLOBAL_TRANSITION)) abortAllTransitions();
    entryControllers.get(key)?.abort();
    transitions.cancel(key);
  };

  const applyDecoded = (entries: SplitRouterEntry[]) => {
    const layoutChanged = reconcileEntries(layout.entries(), entries);
    accepted = layout.entries();
    reconcileHistories('replace', 'move');
    commitLayout({ history: 'replace', preserveHash: true });
    const becameReady = !ready;
    ready = true;
    if (layoutChanged || becameReady) notify();
  };

  const transitionLayout = (transition: LayoutTransition) => {
    abortAllTransitions();
    if (middleware.length === 0) {
      transition.apply(transition.entries);
      return;
    }

    const controller = new AbortController();
    const prepared = prepareEntries(middlewareConfig, {
      from: transition.cause === 'initial' ? undefined : accepted,
      to: transition.entries,
      cause: transition.cause,
      externalSearch: transition.externalSearch,
      signal: controller.signal,
    });

    if (!isPromise(prepared)) {
      transition.apply(prepared);
      return;
    }

    void transitions.start(GLOBAL_TRANSITION, {
      controller,
      async run() {
        const result = await prepared;
        throwIfAborted(controller.signal);
        transition.apply(result);
      },
    });
  };

  const applyInbound = (
    external: SplitRouterExternalLocationValue,
    cause: 'initial' | 'external'
  ) => {
    if (cause === 'external' && locationSync.acknowledge(external)) return;

    const decoded = decodeSplitRouterLocation({
      routes,
      location: external,
    });

    transitionLayout({
      entries: decoded.entries,
      cause,
      externalSearch: decoded.externalLocation.search,
      apply: applyDecoded,
    });
  };

  accepted = layout.entries();

  const applyPrepared = (
    original: SplitRouterEntry[],
    prepared: SplitRouterEntry[],
    history: BrowserHistoryIntent
  ) => {
    const before = accepted;

    reconcileEntries(original, prepared);
    accepted = layout.entries();
    reconcileHistories(history, 'move');
    commitLayout({
      history,
      preserveHash: false,
      preserveExternalSearch: false,
    });
    const becameReady = !ready;
    ready = true;
    if (becameReady) notify();
    else notifyLayoutChanges(before, accepted);
  };

  const onLayoutChange = (history: BrowserHistoryIntent) => {
    if (disposed) return;

    const entries = layout.entries();
    if (expectedLayout && layout.layoutsEqual(expectedLayout, entries)) {
      expectedLayout = undefined;
      accepted = entries;
      return;
    }
    expectedLayout = undefined;

    transitionLayout({
      entries,
      cause: 'layout',
      apply: (prepared) => applyPrepared(entries, prepared, history),
    });
  };

  const applyEntry = (config: ApplyOptions<TSplitId>): boolean => {
    const changed = layout.apply({
      entry: config.entry,
      target: config.target,
      replace: config.replace,
      requireExistingTarget: config.requireTarget,
    });
    if (!changed) return false;

    expectLayoutEcho();
    accepted = layout.entries();
    if (config.recordHistory !== false) {
      reconcileHistories(config.history, 'write');
    }
    commitLayout({
      history: config.history,
      preserveHash: config.preserveHash,
      preserveExternalSearch: false,
    });
    return true;
  };

  const publishEntry = (
    transition: EntryTransition<TSplitId>,
    entry: SplitRouterEntry
  ) => {
    const changed = transition.apply(entry);
    if (changed) notify(transition.splitId);
    return changed;
  };

  const startAsyncEntry = (
    config: EntryTransition<TSplitId>,
    controller: AbortController,
    prepared: Promise<SplitRouterEntry | undefined>,
    finish: () => void,
    checkClaim: (entry: SplitRouterEntry) => SplitRouterEntry | undefined
  ) => {
    const { splitId } = config;

    void transitions.start(config.key, {
      controller,
      target: splitId,
      pending: splitId === undefined ? undefined : config.entry,
      async run(transition) {
        try {
          const entry = await prepared;
          throwIfAborted(controller.signal);
          if (!entry) return;
          assertRouteEntry(routes, entry);

          if (
            splitId !== undefined &&
            !layout.entryEquals(transition.pending, entry)
          ) {
            transition.pending = entry;
            notify(splitId);
          }

          // Pending-state subscribers may navigate or create another owner.
          // Recheck synchronously at the actual commit boundary.
          throwIfAborted(controller.signal);
          if (!checkClaim(entry)) return;
          throwIfAborted(controller.signal);
          const changed = config.apply(entry);
          if (changed && splitId === undefined) notify();
        } finally {
          finish();
        }
      },
      onSettled:
        splitId === undefined
          ? undefined
          : (transition) =>
              !layout.entryEquals(transition.pending, layout.find(splitId)),
    });

    if (splitId !== undefined) notify(splitId);
  };

  const transitionEntry = (config: EntryTransition<TSplitId>) => {
    const hadPending = transitions.pending(config.key) !== undefined;
    cancelTargetTransition(config.key);
    const controller = new AbortController();
    const reservation = claims.reserve(undefined);
    entryControllers.set(config.key, controller);
    const finish = () => {
      reservation.release();
      controller.signal.removeEventListener('abort', finish);
      if (entryControllers.get(config.key) === controller) {
        entryControllers.delete(config.key);
      }
    };
    controller.signal.addEventListener('abort', finish, { once: true });

    const reuseOrAccept = (
      entry: SplitRouterEntry,
      claim: SplitRouteClaim | undefined
    ) => {
      throwIfAborted(controller.signal);
      const owner = claim && findClaimedSplit(claim, config.splitId);
      if (!owner) return entry;
      // Keep the accepted owner on the requested resource rather than allowing
      // an in-flight departure to replace it immediately after activation.
      const hadPending = transitions.pending(owner.splitId) !== undefined;
      cancelTargetTransition(owner.splitId);
      layout.activate(owner.splitId);
      if (hadPending) notify(owner.splitId);
    };
    const waitForClaim = async (
      turn: Promise<void>,
      entry: SplitRouterEntry,
      claim: SplitRouteClaim | undefined
    ) => {
      await turn;
      // The earlier request may have committed, redirected, or failed.
      return reuseOrAccept(entry, claim);
    };
    const accept = (entry: SplitRouterEntry) => {
      throwIfAborted(controller.signal);
      assertRouteEntry(routes, entry);
      const claim = claimToAcquire(entry, config);
      reservation.move(claim);
      if (claim && findClaimedSplit(claim, config.splitId)) {
        return reuseOrAccept(entry, claim);
      }
      const turn = reservation.wait(controller.signal);
      if (!isPromise(turn)) return reuseOrAccept(entry, claim);
      return waitForClaim(turn, entry, claim);
    };
    const acceptPrepared = async (prepared: Promise<SplitRouterEntry>) =>
      accept(await prepared);

    try {
      reservation.move(claimToAcquire(config.entry, config));
      const prepared =
        middleware.length === 0
          ? config.entry
          : prepareEntry(middlewareConfig, {
              from: config.from,
              to: config.entry,
              cause: config.cause,
              signal: controller.signal,
            });
      const resolved = isPromise(prepared)
        ? acceptPrepared(prepared)
        : accept(prepared);
      if (isPromise(resolved)) {
        assertRouteEntry(routes, config.entry);
        startAsyncEntry(config, controller, resolved, finish, (entry) =>
          reuseOrAccept(entry, claimToAcquire(entry, config))
        );
      } else {
        try {
          const changed = resolved ? publishEntry(config, resolved) : false;
          if (!changed && hadPending) notify(config.splitId);
        } finally {
          finish();
        }
      }
    } catch (error) {
      finish();
      if (hadPending) notify(config.splitId);
      throw error;
    }
  };

  const navigateHistory = (
    splitId: TSplitId,
    delta: number,
    current: SplitRouterEntry,
    navigateOptions: SplitNavigateOptions<TSplitId>
  ) => {
    if (
      (navigateOptions.target !== undefined &&
        navigateOptions.target !== 'current') ||
      navigateOptions.search !== undefined
    ) {
      return;
    }

    const history = histories.get(splitId);
    const historical = history?.peek(delta);
    if (!history || !historical) return;

    transitionEntry({
      key: splitId,
      splitId,
      entry: historical,
      from: current,
      cause: 'history',
      allowDuplicate: navigateOptions.allowDuplicate,
      apply: (entry) => {
        if (!layout.find(splitId)) return false;

        const changed = applyEntry({
          entry,
          target: splitId,
          replace: true,
          history: 'replace',
          preserveHash: true,
          requireTarget: true,
          recordHistory: false,
        });
        const moved = history.go(delta);
        if (moved && !layout.entryEquals(history.current(), entry)) {
          history.replace(entry);
        }
        reconcileHistories('replace', 'write');

        return changed || moved;
      },
    });
  };

  const unsubscribeLayout = options.layout.subscribe((change) => {
    queuedHistory = change.history;
    if (layoutChangeQueued) return;

    layoutChangeQueued = true;
    queueMicrotask(() => {
      layoutChangeQueued = false;
      onLayoutChange(queuedHistory);
    });
  });
  const unsubscribeLocation = options.location.subscribe((external) =>
    applyInbound(external, 'external')
  );

  const router: SplitRouter<TSplitId> = {
    routes,
    route(splitId) {
      const entry = findEntry(splitId);
      return entry?.location.route;
    },

    location: (splitId) => findEntry(splitId)?.location,

    search(splitId, namespace) {
      assertSafeSearchName(namespace, 'namespace');

      const search = findEntry(splitId)?.location?.search;
      return search && Object.hasOwn(search, namespace)
        ? search[namespace]
        : undefined;
    },

    canGo(splitId, delta) {
      return histories.get(splitId)?.canGo(delta) ?? false;
    },

    history(splitId) {
      const history = histories.get(splitId);
      if (!history) return;

      return {
        entries: history.entries().map((entry) => entry.location),
        index: history.index(),
      };
    },

    navigate(
      splitId: TSplitId,
      to: SplitNavigateTo,
      navigateOptions: SplitNavigateOptions<TSplitId> = {}
    ) {
      if (disposed) return;
      const current = findEntry(splitId);

      if (!current) return;

      if (typeof to === 'number') {
        navigateHistory(splitId, to, current, navigateOptions);
        return;
      }

      const target =
        navigateOptions.target === undefined ||
        navigateOptions.target === 'current'
          ? splitId
          : navigateOptions.target;
      const targetEntry =
        target === 'new-split' ? undefined : findEntry(target);
      const decoded = resolveNavigation(routes, current, targetEntry, to);

      if (!decoded) return;

      assertSearchNamespacesAllowed(
        routes,
        decoded.location.route,
        Object.keys(navigateOptions.search ?? {})
      );

      const next: SplitRouterEntry = {
        location: updateSearchState(decoded.location, navigateOptions.search),
      };
      const history = navigateOptions.replace ? 'replace' : 'push';
      const targetId =
        target === 'new-split' ? undefined : (target as TSplitId);
      transitionEntry({
        key: targetId ?? Symbol('new-split-transition'),
        splitId: targetId,
        entry: next,
        from: targetEntry,
        cause: 'navigate',
        allowDuplicate: navigateOptions.allowDuplicate,
        apply: (entry) =>
          applyEntry({
            entry,
            target,
            replace: navigateOptions.replace ?? false,
            history,
            preserveHash: false,
          }),
      });
    },

    updateSearch(splitId, namespace, update, updateOptions = {}) {
      if (disposed) return;
      assertSafeSearchName(namespace, 'namespace');
      const entry = findEntry(splitId);
      if (!entry) return;
      assertSearchNamespacesAllowed(routes, entry.location.route, [namespace]);

      const next: SplitRouterEntry = {
        location: updateSearchState(entry.location, {
          [namespace]: update,
        }),
      };
      const history = updateOptions.history ?? 'push';

      transitionEntry({
        key: splitId,
        splitId,
        entry: next,
        from: entry,
        cause: 'search',
        apply: (prepared) =>
          applyEntry({
            entry: prepared,
            target: splitId,
            replace: history === 'replace',
            history,
            preserveHash: true,
            requireTarget: true,
          }),
      });
    },

    href(splitId) {
      const entry = findEntry(splitId);

      if (!entry) return '';

      return serializeSplitRouterLocation({
        routes,
        entries: [entry],
        previous: options.location.read(),
        preserveHash: true,
      });
    },

    isReady: () => ready,

    async settled() {
      do {
        await Promise.resolve();
        await Promise.all(transitions.promises());
      } while (layoutChangeQueued || transitions.size > 0);
    },

    subscribe(listener) {
      subscribers.add(listener);

      return () => subscribers.delete(listener);
    },

    dispose() {
      if (disposed) return;

      disposed = true;
      subscribers.clear();
      abortAllTransitions(false);
      unsubscribeLayout();
      unsubscribeLocation();
    },
  };

  // Observe synchronous canonicalization writes during initialization, so their
  // echoes cannot later be mistaken for a browser Back navigation.
  applyInbound(options.location.read(), 'initial');
  return router;
}
