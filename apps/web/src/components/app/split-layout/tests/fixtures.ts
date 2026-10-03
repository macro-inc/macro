import { paneRoute } from '@app/routes/app-route';
import {
  appRoute,
  channelDetailRoute,
  channelsSplitRoute,
  homeSplitRoute,
  legacyContentRoute,
  notFoundRoute,
} from '@app/routes/routes';
import {
  createMemoryHistory,
  createMemoryPaneStore,
  createSplitRouter,
  type Entry,
  type SplitLocation,
  type SplitRoutes,
} from '@app/split-router';
import type { BlockOrchestrator } from '@core/orchestrator';
import { createSplitLayout, type SplitManager } from '../layoutManager';
import { createAppPanePolicy } from '../split-router/app-pane-policy';
import {
  resolveContentLocation,
  splitContentFromLocation,
} from '../split-router/legacy-route';

const homeLocation: SplitLocation = {
  route: paneRoute({ id: 'view-home', params: {} }),
};

const routes: SplitRoutes = {
  definitions: [
    {
      ...appRoute,
      children: [
        homeSplitRoute,
        { ...channelsSplitRoute, children: [channelDetailRoute] },
        legacyContentRoute,
        notFoundRoute,
      ],
    },
  ],
  defaultRoute: () => homeLocation.route,
};

/**
 * A split manager over a router with a few of the app's pane routes, loaded
 * from `url` (panes joined by `/~/`). Call it inside a reactive root.
 */
export function createRoutedSplitLayout(
  orchestrator: BlockOrchestrator,
  url: string
): SplitManager {
  let manager: SplitManager | undefined;
  const router = createSplitRouter({
    routes,
    history: createMemoryHistory(url),
    paneStore: createMemoryPaneStore<Entry>(),
    policy: createAppPanePolicy({
      manager: () => manager,
      toContent: splitContentFromLocation,
      defaultLocation: () => homeLocation,
      singlePane: () => false,
    }),
  });
  manager = createSplitLayout(orchestrator, {
    router,
    toLocation: (content) => resolveContentLocation(router.routes, content),
    toContent: splitContentFromLocation,
  });
  return manager;
}
