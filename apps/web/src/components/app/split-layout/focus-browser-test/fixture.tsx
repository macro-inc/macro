import {
  createMemoryHistory,
  createMemoryPaneStore,
  createSplitRouter,
  type Entry,
  type SplitRoutes,
} from '@app/lib/split-router';
import { SplitRouterProvider } from '@app/lib/split-router/solid/context';
import { paneRoute } from '@app/routes/app-route';
import {
  appRoute,
  homeSplitRoute,
  legacyContentRoute,
  notFoundRoute,
} from '@app/routes/routes';
import { setGlobalSplitManager } from '@app/signal/splitLayout';
import { SplitLayoutContext } from '@components/app/split-layout/context';
import {
  createSplitLayout,
  type SplitManager,
} from '@components/app/split-layout/layoutManager';
import { SplitLayout } from '@components/app/split-layout/SplitLayout';
import { createAppPanePolicy } from '@components/app/split-layout/split-router/app-pane-policy';
import {
  resolveContentLocation,
  splitContentFromLocation,
} from '@components/app/split-layout/split-router/legacy-route';
import { blocks } from '@core/constant/allBlocks';
import { attachGlobalDOMScope, useHotKeyRoot } from '@core/hotkey/hotkeys';
import { createBlockOrchestrator } from '@core/orchestrator';
import { render } from 'solid-js/web';

Reflect.set(blocks, 'md', { name: 'md', component: () => null });

const routes: SplitRoutes = {
  definitions: [
    {
      ...appRoute,
      children: [homeSplitRoute, legacyContentRoute, notFoundRoute],
    },
  ],
  defaultRoute: () => paneRoute({ id: 'view-home', params: {} }),
};

function App() {
  // As the app's root and layout set up hotkeys.
  useHotKeyRoot();
  attachGlobalDOMScope(document.body);

  let manager!: SplitManager;
  const router = createSplitRouter({
    routes,
    history: createMemoryHistory('/md/l1'),
    paneStore: createMemoryPaneStore<Entry>(),
    policy: createAppPanePolicy({
      manager: () => manager,
      toContent: splitContentFromLocation,
      defaultLocation: () => ({ route: routes.defaultRoute() }),
      stacked: () => false,
    }),
  });
  manager = createSplitLayout(createBlockOrchestrator(), {
    router,
    toLocation: (content) => resolveContentLocation(router.routes, content),
    toContent: splitContentFromLocation,
    stacked: () => false,
  });
  setGlobalSplitManager(manager);

  const splitShowing = (document: string) =>
    manager.splits().find((split) => split.content.id === document)?.id;

  Reflect.set(window, 'splitFocus', {
    // A document in a new full-height column, or stacked below another.
    open: (document: string, below?: string) => {
      const split = below ? splitShowing(below) : undefined;
      manager.openWithSplit(
        { type: 'md', id: document },
        {
          preferNewSplit: true,
          beside: split && { split, side: 'below' },
        }
      );
    },
    activate: (document: string) => {
      const split = splitShowing(document);
      if (!split) return;
      manager.activateSplit(split);
      manager.returnFocus();
    },
  });

  return (
    <SplitRouterProvider router={router}>
      <SplitLayoutContext.Provider value={{ manager }}>
        <div style={{ position: 'relative', width: '1200px', height: '800px' }}>
          <SplitLayout />
        </div>
      </SplitLayoutContext.Provider>
    </SplitRouterProvider>
  );
}

render(() => <App />, document.getElementById('root')!);
