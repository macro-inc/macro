import {
  createMemoryHistory,
  createMemoryPaneStore,
  createSplitRouter,
  type Entry,
  SplitRouter,
  type SplitRoutes,
} from '@app/lib/split-router';
import { SplitRouterProvider } from '@app/lib/split-router/solid/context';
import { paneRoute } from '@app/routes/app-route';
import {
  appRoute,
  callsRoute,
  channelsSplitRoute,
  companiesRoute,
} from '@app/routes/routes';
import type { BlockOrchestrator } from '@core/orchestrator';
import { cleanup, render, screen } from '@solidjs/testing-library';
import {
  createContext,
  For,
  onMount,
  type ParentProps,
  Show,
  untrack,
  useContext,
} from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SplitPanel } from '../components/SplitPanel';
import { SplitLayoutContext, SplitPanelContext } from '../context';
import { createSplitLayout, type SplitManager } from '../layoutManager';
import { createAppPanePolicy } from '../split-router/app-pane-policy';
import {
  resolveContentLocation,
  splitContentFromLocation,
} from '../split-router/legacy-route';

const collection = vi.hoisted(() => ({ mounts: 0 }));
const CollectionContext = createContext<boolean>();

// Exercise the production router, layout mirror, panel and provider boundary.
// Stand-in collection state avoids backend reads; Calls still requires its
// ancestor provider exactly as useSoupView does in the real view.
vi.mock('@app/features/access-requests/context/visit', () => ({
  AccessRequestVisitProvider: (props: ParentProps) => props.children,
}));
vi.mock('@app/features/next-soup/create-soup-state', () => ({
  createSoupState: () => ({}),
}));
vi.mock('@app/features/next-soup/soup-context', () => ({
  SoupContextProvider: (props: ParentProps) => props.children,
}));
vi.mock('@app/features/next-soup/soup-view/soup-view-context', () => ({
  SoupViewContextProvider: (props: ParentProps) => (
    <CollectionContext.Provider value={true}>
      {props.children}
    </CollectionContext.Provider>
  ),
}));
vi.mock('../componentRegistry', () => ({
  resolveComponent: (name: string) => ({
    element: () => null,
    initialMeta: {
      ownsCollectionState: name === 'companies',
      splitPanelLayout: 'composable',
    },
  }),
}));
vi.mock('@core/constant/allBlocks', () => ({
  isBlockAlias: () => false,
  resolveBlockAlias: (type: string) => type,
}));
vi.mock('@service-storage/websocket', () => ({
  storageWS: { reconnectIfDisconnected: vi.fn() },
  createWebSocketJob: vi.fn(),
}));
vi.mock('@service-connection/websocket', () => ({
  ws: { addEventListener: vi.fn(), send: vi.fn() },
  state: () => 'closed',
  createConnectionBlockWebsocketEffect: vi.fn(),
  createConnectionWebsocketEffect: vi.fn(),
}));
vi.mock('@app/signal/splitLayout', () => ({
  globalSplitManager: () => undefined,
}));
vi.mock('@components/app/mobile/MobileEdgeFade', () => ({
  MobileTopEdgeFade: () => null,
}));
vi.mock('@components/app/mobile/MobilePageActionRow', () => ({
  MobilePageActionRow: () => null,
}));
vi.mock('@components/app/split-panel', () => ({
  SplitPanelControllerProvider: (props: ParentProps) => props.children,
}));
vi.mock('@core/hotkey/hotkeys', () => ({
  useHotkeyDOMScope: () => [() => {}, 'test-split'],
}));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => false }));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));
vi.mock('@core/mobile/safeAreaInsets', () => ({ getSafeAreaInset: () => 0 }));
vi.mock('../registerSplitHotkeys', () => ({ registerSplitHotkeys: () => {} }));
vi.mock('../utils/createSplitAutofocus', () => ({
  createSplitAutofocus: () => {},
}));
vi.mock('../components/SplitHeader', () => ({ SplitHeader: () => null }));
vi.mock('../components/SplitToolbar', () => ({ SplitToolbar: () => null }));
vi.mock('../components/SplitDrawerContext', () => ({
  SplitDrawerGroup: (props: ParentProps) => props.children,
}));
vi.mock('@ui', () => {
  const Container = (props: ParentProps) => <div>{props.children}</div>;
  return {
    Panel: Object.assign(Container, {
      Header: Container,
      Toolbar: Container,
      Body: Container,
    }),
    Button: Container,
    cn: () => '',
  };
});

function Calls() {
  if (!useContext(CollectionContext)) {
    throw new Error('Calls mounted without its collection provider');
  }
  onMount(() => collection.mounts++);
  return <p data-testid="calls">Calls collection</p>;
}

function Customers() {
  return <p data-testid="crm">CRM collection</p>;
}

function Chat() {
  const navigation = useContext(SplitPanelContext)?.navigationCollapsed;
  return (
    <p data-testid="chat">
      {navigation?.[0]() ? 'Navigation hidden' : 'Navigation shown'}
    </p>
  );
}

function setup(url: string, retainInitialMount = false) {
  let router!: ReturnType<typeof createSplitRouter>;
  let manager!: SplitManager;
  const Panels = () => (
    <For each={router.panes()}>
      {(pane, index) => {
        const initial = untrack(() =>
          manager.splits().find((split) => split.id.toString() === pane)
        )!;
        return (
          <Show when={manager.splitState(initial.id)}>
            {(split) => (
              <SplitPanel
                split={retainInitialMount ? initial : split()}
                handle={manager.getSplit(split().id)!}
                index={index()}
                active={manager.activeSplitId() === split().id}
                setPanelRef={() => {}}
              />
            )}
          </Show>
        );
      }}
    </For>
  );
  render(() => {
    const routes: SplitRoutes = {
      definitions: [
        {
          ...appRoute,
          component: Panels,
          children: [
            { ...companiesRoute, component: Customers },
            { ...callsRoute, component: Calls },
            { ...channelsSplitRoute, component: Chat },
          ],
        },
      ],
      defaultRoute: () => paneRoute({ id: companiesRoute.id, params: {} }),
    };
    router = createSplitRouter({
      routes,
      history: createMemoryHistory(url),
      paneStore: createMemoryPaneStore<Entry>(),
      policy: createAppPanePolicy({
        manager: () => manager,
        toContent: splitContentFromLocation,
        defaultLocation: () => ({ route: routes.defaultRoute() }),
        stacked: () => false,
      }),
    });
    const orchestrator = {
      isBlockMounted: () => false,
      createBlockInstance: vi.fn(),
    } as unknown as BlockOrchestrator;
    manager = createSplitLayout(orchestrator, {
      router,
      toLocation: (content) => resolveContentLocation(router.routes, content),
      toContent: splitContentFromLocation,
    });
    return (
      <SplitRouterProvider router={router}>
        <SplitLayoutContext.Provider value={{ manager }}>
          <SplitRouter.Outlet />
        </SplitLayoutContext.Provider>
      </SplitRouterProvider>
    );
  });
  return { router, manager };
}

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});

afterEach(() => {
  cleanup();
  collection.mounts = 0;
  vi.unstubAllGlobals();
});

describe('collection context across pane navigation', () => {
  it.each(['calls', 'tasks', 'notes'])(
    'opens Calls from the CRM %s tab and returns to the tab',
    async (tab) => {
      // The outlet may render the committed route before the legacy layout
      // mirror receives its new mount. Keep that prior mount throughout the
      // round trip so the route must establish its own provider boundary.
      const { router, manager } = setup(`/companies?s0.crm.tab=${tab}`, true);
      const pane = router.panes()[0]!;
      expect(screen.getByTestId('crm')).toBeTruthy();

      manager.openWithSplit({ type: 'component', id: 'calls' });

      expect(screen.getByTestId('calls')).toBeTruthy();
      expect(screen.queryByTestId('crm')).toBeNull();
      expect(collection.mounts).toBe(1);
      expect(router.entry(pane)?.location.search).toBeUndefined();

      await router.navigatePane(pane, -1);
      expect(screen.getByTestId('crm')).toBeTruthy();
      expect(router.entry(pane)?.location.search?.crm.tab).toEqual([tab]);

      await router.navigatePane(pane, 1);
      expect(screen.getByTestId('calls')).toBeTruthy();
      expect(collection.mounts).toBe(2);
    }
  );

  it('reuses Calls in another split and preserves the CRM tab', () => {
    const { router, manager } = setup('/companies/~/calls?s0.crm.tab=calls');
    const crm = manager.splits()[0]!;
    const calls = manager.splits()[1]!;
    manager.activateSplit(crm.id);

    manager.openWithSplit(
      { type: 'component', id: 'calls' },
      { resume: true, allowDuplicate: true }
    );

    expect(manager.activeSplitId()).toBe(calls.id);
    expect(router.panes()).toHaveLength(2);
    expect(screen.getByTestId('crm')).toBeTruthy();
    expect(screen.getAllByTestId('calls')).toHaveLength(1);
    expect(collection.mounts).toBe(1);
  });

  it('opens and focuses Calls beside CRM for a sidebar split request', () => {
    const { router, manager } = setup('/companies?s0.crm.tab=notes');
    manager.openWithSplit(
      { type: 'component', id: 'calls' },
      { preferNewSplit: true, allowDuplicate: true, resume: false }
    );

    expect(router.panes()).toHaveLength(2);
    expect(screen.getByTestId('crm')).toBeTruthy();
    expect(screen.getByTestId('calls')).toBeTruthy();
    expect(manager.activeSplitId()).toBe(manager.splits()[1]!.id);
    expect(collection.mounts).toBe(1);
  });
});

describe('split navigation', () => {
  it('opens a new split with its navigation shown', () => {
    const { router, manager } = setup('/companies');
    manager.openWithSplit(
      { type: 'component', id: 'channels' },
      { preferNewSplit: true, allowDuplicate: true, resume: false }
    );

    expect(router.panes()).toHaveLength(2);
    expect(screen.getByTestId('chat').textContent).toBe('Navigation shown');
  });
});
