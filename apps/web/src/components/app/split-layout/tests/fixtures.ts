import {
  createMemoryHistory,
  createMemoryPaneStore,
  createSplitRouter,
  type Entry,
  type SplitLocation,
  type SplitRoutes,
} from '@app/lib/split-router';
import { paneRoute } from '@app/routes/app-route';
import {
  appRoute,
  channelDetailRoute,
  channelsSplitRoute,
  externalChatRoute,
  externalRoute,
  homeSplitRoute,
  legacyContentRoute,
  notFoundRoute,
} from '@app/routes/routes';
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
        { ...externalRoute, children: [externalChatRoute] },
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
  url: string,
  stacked = false
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
      stacked: () => stacked,
    }),
  });
  manager = createSplitLayout(orchestrator, {
    router,
    toLocation: (content) => resolveContentLocation(router.routes, content),
    toContent: splitContentFromLocation,
    stacked: () => stacked,
  });
  return manager;
}
