import { createSignal, untrack } from 'solid-js';
import { createPanes } from '../panes/panes';
import { createRoutesManifest, resolveBranch } from '../routes/manifest';
import type {
  Entry,
  PaneId,
  PreloadIntent,
  SplitLocation,
} from '../routes/types';
import { UNCANCELLABLE } from '../utils';
import { createClaims } from './claims';
import { createLeaveGuards } from './leave-guards';
import { createPaneList } from './pane-list';
import { createPaneNavigation } from './pane-navigation';
import { createPhaseScopes } from './phases';
import { preloadLocation } from './preload';
import { createRunner } from './runner';
import type { RouteMatchInfo, SplitRouterOptions } from './types';
import { createUrl } from './url';
import { createUrlNavigation } from './url-navigation';

export function createSplitRouter(options: SplitRouterOptions) {
  const routes = createRoutesManifest(options.routes);
  const { history } = options;
  const [ready, setReady] = createSignal(false);
  let disposed = false;

  const guards = createLeaveGuards();

  const panes = createPanes<Entry, SplitLocation>({
    store: options.paneStore,
    policy: options.policy,
    createPaneId: options.createPaneId,
    onRemove: guards.forget,
  });

  const url = createUrl({ routes, history, panes });

  const phaseOptions = {
    routes,
    middleware: options.middleware ?? [],
    guards,
    current: (pane: PaneId) => untrack(() => panes.current(pane)),
    preloadBudgetMs: options.preloadBudgetMs ?? 150,
  };

  const runner = createRunner({
    phases: (waiting) => createPhaseScopes(phaseOptions, waiting),
    live: () => untrack(panes.ids),
  });

  const claims = createClaims({
    routes,
    panes,
    runner,
    carrySearch: (pane, destination, mode) =>
      paneNavigation.carrySearch(pane, destination, mode),
  });

  const paneNavigation = createPaneNavigation({
    routes,
    panes,
    url,
    runner,
    claims,
  });

  const paneList = createPaneList({
    routes,
    panes,
    url,
    runner,
    claims,
    navigation: paneNavigation,
  });

  const urlNavigation = createUrlNavigation({
    routes,
    history,
    panes,
    url,
    runner,
    guards,
    markReady: () => setReady(true),
  });

  const disconnect = urlNavigation.connect();

  const matches = (pane: PaneId): RouteMatchInfo[] => {
    const entry = panes.current(pane);
    if (!entry) return [];

    const { route } = entry.location;

    return resolveBranch(routes, route).map((node, depth) => ({
      id: node.definition.id,
      params: route.matches[depth]!.params,
      info: node.definition.info,
    }));
  };

  const preload = (
    location: SplitLocation,
    intent: PreloadIntent = 'hover'
  ): Promise<unknown> | undefined => {
    const context = { location, intent, signal: UNCANCELLABLE };

    return untrack(() => preloadLocation(routes, context));
  };

  const dispose = (): void => {
    if (disposed) return;

    disposed = true;
    disconnect();
    runner.dispose();
    claims.dispose();
  };

  return {
    routes,
    claims: claims.registry,
    ready,
    panes: panes.ids,
    navigate: paneNavigation.navigate,
    updateSearch: paneNavigation.updateSearch,
    goBackTo: paneNavigation.goBackTo,
    removeEntries: paneNavigation.removeEntries,
    rewriteCurrent: paneNavigation.rewriteCurrent,
    canGo: paneNavigation.canGo,
    open: paneList.open,
    close: paneList.close,
    move: paneList.move,
    entry: panes.current,
    arrival: panes.arrival,
    pending: runner.pending,
    matches,
    preload,
    href: url.href,
    activatePane: panes.activate,
    registerGuard: guards.register,
    settled: runner.settled,
    dispose,
  };
}

export type SplitRouter = ReturnType<typeof createSplitRouter>;
