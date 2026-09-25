import deepEqual from 'fast-deep-equal';
import { createClaimReservations } from './claims';
import { createEntryKey } from './entry-state';
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
  parseRouteEntryState,
  type SplitRouteNode,
  type SplitRoutesManifest,
} from './routes';
import { assertSafeSearchName, updateSearchState } from './search';
import { createTransitionManager, type Transition } from './transitions';
import type {
  BrowserHistoryIntent,
  SplitNavigateOptions,
  SplitNavigateTo,
  SplitRouteClaim,
  SplitRouter,
  SplitRouterEntry,
  SplitRouterEntryState,
  SplitRouterExternalLocationValue,
  SplitRouterLayoutSnapshot,
  SplitRouterOptions,
  SplitRouterStateUpdate,
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

function resolveNavigationEntryState(
  routes: SplitRoutesManifest,
  route: SplitRouterEntry['location']['route'],
  current: SplitRouterEntry | undefined,
  update: SplitRouterStateUpdate
): SplitRouterEntryState | undefined {
  const destinationRouteId = route.matches.at(-1)!.id;
  const destinationSchema = routes.byId.get(destinationRouteId)?.state;
  let currentSchema: SplitRouteNode['state'];
  if (current) {
    const currentRouteId = current.location.route.matches.at(-1)!.id;
    currentSchema = routes.byId.get(currentRouteId)?.state;
  }

  let currentState: SplitRouterEntryState;
  if (current && currentSchema === destinationSchema) {
    currentState = current.state;
  }

  let value = update;
  if (typeof update === 'function') value = update(currentState);
  const parsed = parseRouteEntryState(routes, route, value);
  if (!parsed.success) {
    const routeId = route.matches.at(-1)?.id ?? 'unknown';
    throw new Error(`Split route "${routeId}" rejected navigation state`);
  }
  if (parsed.value === undefined) return;

  try {
    return structuredClone(parsed.value);
  } catch (error) {
    console.warn(
      'Split route state could not be cloned; continuing without state',
      error
    );
    return;
  }
}

export function createSplitRouter<TSplitId>(
  options: SplitRouterOptions<TSplitId>
): SplitRouter<TSplitId> {
  let routes: SplitRoutesManifest;
  if ('definitions' in options.routes) {
    routes = createRoutesManifest(options.routes);
  } else {
    routes = options.routes;
  }

  const middleware = options.middleware ?? [];
  const claims = createClaimReservations();
  const entryControllers = new Map<unknown, AbortController>();
  const subscribers = new Set<(splitId: TSplitId | undefined) => void>();
  let accepted: SplitRouterEntry[] = [];
  let acceptedIds: TSplitId[] = [];
  let expectedLayout: SplitRouterLayoutSnapshot<TSplitId> | undefined;
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
    layout.entryEquals,
    layout.entryIdentityEquals
  );

  const reconcileHistories = (
    intent: BrowserHistoryIntent,
    mode: 'move' | 'write'
  ) => {
    histories.reconcile(
      accepted.map((entry, index) => ({ id: acceptedIds[index]!, entry })),
      intent,
      mode
    );
  };

  const notify = (splitId?: TSplitId) => {
    for (const listener of subscribers) listener(splitId);
  };

  const normalizeEntry = (
    entry: SplitRouterEntry,
    previous?: SplitRouterEntry
  ): SplitRouterEntry => {
    const preservePrevious =
      !entry.key &&
      previous !== undefined &&
      deepEqual(previous.location, entry.location);
    const hasEntryState = Object.hasOwn(entry, 'state');
    let parsedState: SplitRouterEntry['state'];
    if (!hasEntryState && preservePrevious && previous) {
      parsedState = previous.state;
    } else {
      const state = hasEntryState ? entry.state : undefined;
      const parsed = parseRouteEntryState(routes, entry.location.route, state);
      if (parsed.success && parsed.value !== undefined) {
        try {
          parsedState = structuredClone(parsed.value);
        } catch {
          parsedState = undefined;
        }
      }
    }
    let key = entry.key;
    if (!key && preservePrevious && previous) key = previous.key;
    if (!key) key = createEntryKey();

    const { state: _state, ...rest } = entry;
    const normalized: SplitRouterEntry = { ...rest, key };
    if (parsedState !== undefined) normalized.state = parsedState;
    return normalized;
  };

  const normalizeEntries = (
    entries: SplitRouterEntry[],
    previous: readonly (SplitRouterEntry | undefined)[] = []
  ) => entries.map((entry, index) => normalizeEntry(entry, previous[index]));

  const acceptedById = () => {
    const entries = new Map<TSplitId, SplitRouterEntry>();
    accepted.forEach((entry, index) => {
      entries.set(acceptedIds[index] as TSplitId, entry);
    });
    return entries;
  };

  const acceptedInLayoutOrder = () => {
    const byId = acceptedById();
    return layout.snapshot().entries.map(({ splitId, location }) => {
      const entry = byId.get(splitId);
      if (!entry || !deepEqual(entry.location, location)) return;
      return entry;
    });
  };

  const bindAccepted = (entries: SplitRouterEntry[]) => {
    const snapshot = layout.snapshot().entries;
    accepted = snapshot.map(({ location }, index) => {
      const entry = entries[index];
      if (entry && deepEqual(entry.location, location)) return entry;
      return normalizeEntry({ location });
    });
    acceptedIds = snapshot.map(({ splitId }) => splitId);
  };

  const validateRedirectedState = (
    entry: SplitRouterEntry,
    proposed: SplitRouterEntry
  ) => {
    const entryRouteId = entry.location.route.matches.at(-1)!.id;
    const proposedRouteId = proposed.location.route.matches.at(-1)!.id;
    const entrySchema = routes.byId.get(entryRouteId)?.state;
    const proposedSchema = routes.byId.get(proposedRouteId)?.state;

    if (entrySchema === proposedSchema) return entry;
    return normalizeEntry(entry);
  };

  const transitions = createTransitionManager<TSplitId, SplitRouterEntry>({
    onError(error) {
      console.error('Split router transition failed', error);
    },
    onSettled(splitId, publicStateChanged) {
      const becameReady = !ready;
      ready = true;
      if (becameReady) {
        notify();
      } else if (publicStateChanged) {
        notify(splitId);
      }
    },
  });
  const findEntry = (splitId: TSplitId) => {
    const pending = transitions.pending(splitId);
    if (pending) return pending;

    const index = acceptedIds.findIndex((id) => Object.is(id, splitId));
    if (index < 0) return;
    return accepted[index];
  };
  // A settled destination with the same URL and route state needs no new key,
  // transition, history entry, or middleware run.
  const isCurrentDestination = (splitId: TSplitId, entry: SplitRouterEntry) => {
    if (transitions.has(GLOBAL_TRANSITION) || transitions.pending(splitId))
      return false;
    const current = findEntry(splitId);
    return (
      current !== undefined &&
      deepEqual(current.location, entry.location) &&
      Object.is(current.state, entry.state)
    );
  };

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
    let current: SplitRouterEntry | undefined;
    if (config.splitId !== undefined) current = layout.find(config.splitId);
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
    expectedLayout = layout.snapshot();
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
    locationSync.commit(accepted, commit);
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
    bindAccepted(entries);
    reconcileHistories('replace', 'move');
    commitLayout({ history: 'replace', preserveHash: true });
    const becameReady = !ready;
    ready = true;
    if (layoutChanged || becameReady) notify();
  };

  const transitionLayout = (transition: LayoutTransition) => {
    abortAllTransitions();
    let previous: Array<SplitRouterEntry | undefined> = [];
    if (transition.cause === 'layout') {
      previous = acceptedInLayoutOrder();
    } else if (transition.cause === 'external') {
      previous = accepted.map((entry) => {
        if (Object.hasOwn(entry, 'state')) return;
        return entry;
      });
    }
    const entries = normalizeEntries(transition.entries, previous);
    if (middleware.length === 0) {
      transition.apply(entries);
      return;
    }

    const controller = new AbortController();
    const validatePrepared = (prepared: SplitRouterEntry[]) =>
      prepared.map((entry, index) =>
        validateRedirectedState(entry, entries[index]!)
      );
    let from: SplitRouterEntry[] | undefined = accepted;
    if (transition.cause === 'initial') from = undefined;

    const prepared = prepareEntries(middlewareConfig, {
      from,
      to: entries,
      cause: transition.cause,
      externalSearch: transition.externalSearch,
      signal: controller.signal,
    });

    if (!isPromise(prepared)) {
      transition.apply(validatePrepared(prepared));
      return;
    }

    void transitions.start(GLOBAL_TRANSITION, {
      controller,
      async run() {
        const result = await prepared;
        throwIfAborted(controller.signal);
        transition.apply(validatePrepared(result));
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

  bindAccepted(normalizeEntries(layout.entries()));

  const applyPrepared = (
    original: SplitRouterEntry[],
    prepared: SplitRouterEntry[],
    history: BrowserHistoryIntent
  ) => {
    const before = accepted;

    reconcileEntries(original, prepared);
    bindAccepted(prepared);
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

    const snapshot = layout.snapshot();
    const entries = snapshot.entries.map(
      ({ splitId: _splitId, ...entry }) => entry
    );
    if (
      expectedLayout &&
      layout.snapshotsEqual(expectedLayout.entries, snapshot.entries)
    ) {
      expectedLayout = undefined;
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
    const previousById = acceptedById();
    const result = layout.apply({
      entry: config.entry,
      target: config.target,
      replace: config.replace,
      requireExistingTarget: config.requireTarget,
    });
    if (!result.changed) return false;

    if (result.layoutChanged) expectLayoutEcho();

    const snapshot = layout.snapshot().entries;
    accepted = snapshot.map(({ splitId, location }) => {
      if (Object.is(result.splitId, splitId)) return config.entry;

      const previous = previousById.get(splitId);
      if (previous && deepEqual(previous.location, location)) return previous;
      return normalizeEntry({ location });
    });
    acceptedIds = snapshot.map(({ splitId }) => splitId);
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
    let pending: SplitRouterEntry | undefined;
    let onSettled:
      | ((transition: Transition<SplitRouterEntry>) => boolean)
      | undefined;
    if (splitId !== undefined) {
      pending = config.entry;
      onSettled = (transition) =>
        !layout.entryEquals(transition.pending, layout.find(splitId));
    }

    void transitions.start(config.key, {
      controller,
      target: splitId,
      pending,
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
      onSettled,
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
      const normalized = validateRedirectedState(entry, config.entry);
      const claim = claimToAcquire(normalized, config);
      reservation.move(claim);
      if (claim && findClaimedSplit(claim, config.splitId)) {
        return reuseOrAccept(normalized, claim);
      }
      const turn = reservation.wait(controller.signal);
      if (!isPromise(turn)) return reuseOrAccept(normalized, claim);
      return waitForClaim(turn, normalized, claim);
    };
    try {
      reservation.move(claimToAcquire(config.entry, config));
      let prepared: SplitRouterEntry | Promise<SplitRouterEntry> = config.entry;
      if (middleware.length > 0) {
        prepared = prepareEntry(middlewareConfig, {
          from: config.from,
          to: config.entry,
          cause: config.cause,
          signal: controller.signal,
        });
      }

      let resolved:
        | SplitRouterEntry
        | Promise<SplitRouterEntry | undefined>
        | undefined;
      if (isPromise(prepared)) {
        resolved = (async () => accept(await prepared))();
      } else {
        resolved = accept(prepared);
      }
      if (isPromise(resolved)) {
        assertRouteEntry(routes, config.entry);
        startAsyncEntry(config, controller, resolved, finish, (entry) =>
          reuseOrAccept(entry, claimToAcquire(entry, config))
        );
      } else {
        try {
          let changed = false;
          if (resolved) changed = publishEntry(config, resolved);
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
      navigateOptions.target !== undefined &&
      navigateOptions.target !== 'current'
    ) {
      return;
    }
    if (navigateOptions.search !== undefined) return;

    const history = histories.get(splitId);
    if (!history) return;
    const historical = history.peek(delta);
    if (!historical) return;

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
    entry: (splitId) => findEntry(splitId),

    route(splitId) {
      const entry = findEntry(splitId);
      return entry?.location.route;
    },

    location: (splitId) => findEntry(splitId)?.location,

    search(splitId, namespace) {
      assertSafeSearchName(namespace, 'namespace');

      const search = findEntry(splitId)?.location.search;
      if (!search || !Object.hasOwn(search, namespace)) return;
      return search[namespace];
    },

    canGo(splitId, delta) {
      return histories.get(splitId)?.canGo(delta) ?? false;
    },

    history(splitId) {
      const history = histories.get(splitId);
      if (!history) return;

      return {
        entries: history.entries(),
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

      let target: TSplitId | 'new-split' = splitId;
      if (
        navigateOptions.target !== undefined &&
        navigateOptions.target !== 'current'
      ) {
        target = navigateOptions.target;
      }

      let targetEntry: SplitRouterEntry | undefined;
      if (target !== 'new-split') targetEntry = findEntry(target);
      const decoded = resolveNavigation(routes, current, targetEntry, to);

      if (!decoded) return;

      assertSearchNamespacesAllowed(
        routes,
        decoded.location.route,
        Object.keys(navigateOptions.search ?? {})
      );

      let history: BrowserHistoryIntent = 'push';
      if (navigateOptions.replace) history = 'replace';

      let state: SplitRouterEntryState;
      if (Object.hasOwn(navigateOptions, 'state')) {
        state = resolveNavigationEntryState(
          routes,
          decoded.location.route,
          targetEntry,
          navigateOptions.state
        );
      }

      const next: SplitRouterEntry = {
        key: createEntryKey(),
        location: updateSearchState(decoded.location, navigateOptions.search),
      };
      if (state !== undefined) next.state = state;

      const targetId =
        target === 'new-split' ? undefined : (target as TSplitId);
      if (targetId !== undefined && isCurrentDestination(targetId, next)) {
        return;
      }
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

      const history = updateOptions.history ?? 'push';
      let key = entry.key;
      if (history !== 'replace' || !key) key = createEntryKey();

      const next: SplitRouterEntry = {
        ...entry,
        key,
        location: updateSearchState(entry.location, {
          [namespace]: update,
        }),
      };
      if (isCurrentDestination(splitId, next)) return;

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
