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
import { setGlobalTabManager } from '@app/signal/tabLayout';
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
import { createBlockOrchestrator } from '@core/orchestrator';
import { render } from 'solid-js/web';
import { openInNewTab } from '../open-in-new-tab';
import { openInNewTabMiddleware } from '../open-in-tab-middleware';
import { createTabManager } from '../tab-manager';

let mounts = 0;

// A stand-in document: enough state to tell two instances apart.
Reflect.set(blocks, 'md', {
  name: 'md',
  component: () => (
    <div data-document data-mount={++mounts}>
      <textarea aria-label="Document draft" />
    </div>
  ),
});

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
  let manager!: SplitManager;
  const router = createSplitRouter({
    routes,
    history: createMemoryHistory('/md/doc-one'),
    paneStore: createMemoryPaneStore<Entry>(),
    middleware: [openInNewTabMiddleware],
    policy: createAppPanePolicy({
      manager: () => manager,
      toContent: splitContentFromLocation,
      defaultLocation: () => ({ route: routes.defaultRoute() }),
      stacked: () => false,
    }),
  });
  const orchestrator = createBlockOrchestrator();
  manager = createSplitLayout(orchestrator, {
    router,
    toLocation: (content) => resolveContentLocation(router.routes, content),
    toContent: splitContentFromLocation,
    stacked: () => false,
  });
  const tabManager = createTabManager({ router, manager, userId: 'fixture' });
  setGlobalTabManager(tabManager);
  orchestrator.setBlockScope(tabManager.blockScope);

  Reflect.set(window, 'tabsFixture', {
    newTab: () => tabManager.newTab(),
    activate: (index: number) =>
      tabManager.activateTab(tabManager.tabs()[index]!.id),
    close: (index: number) => tabManager.closeTab(tabManager.tabs()[index]!.id),
    openDocument: () =>
      manager.openWithSplit({ type: 'md', id: 'doc-one' }).status,
    // A menu's "Open in new tab" over the ordinary current-split open.
    openInNewTab: (id: string) =>
      openInNewTab(() =>
        manager.openWithSplit({ type: 'md', id }, { preferNewSplit: false })
      ),
    openInCurrentSplit: (id: string) =>
      manager.openWithSplit({ type: 'md', id }, { preferNewSplit: false })
        .status,
    tabCount: () => tabManager.tabs().length,
    activeIndex: () =>
      tabManager.tabs().findIndex((tab) => tab.id === tabManager.activeTabId()),
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
