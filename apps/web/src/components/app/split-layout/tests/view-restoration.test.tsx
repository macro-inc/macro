import {
  createMemoryHistory,
  createMemoryPaneStore,
  createSplitRouter,
  type Entry,
  SplitRouter,
  type SplitRouterMiddleware,
  type SplitRoutes,
} from '@app/lib/split-router';
import { SplitRouterProvider } from '@app/lib/split-router/solid/context';
import { paneRoute } from '@app/routes/app-route';
import {
  agentsRoute,
  agentsViewRoute,
  appRoute,
  calendarSplitRoute,
  channelDetailRoute,
  channelsSplitRoute,
  driveSplitRoute,
  driveTabRoute,
  homeSplitRoute,
  notFoundRoute,
  searchRoute,
} from '@app/routes/routes';
import type { BlockOrchestrator } from '@core/orchestrator';
import { cleanup, render } from '@solidjs/testing-library';
import { createSignal, For, type Setter, Show } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SplitLayoutContext } from '../context';
import { useEntryState } from '../entry-state';
import { createSplitLayout, type SplitManager } from '../layoutManager';
import { createAppPanePolicy } from '../split-router/app-pane-policy';
import {
  resolveContentLocation,
  splitContentFromLocation,
} from '../split-router/legacy-route';
import { useViewRestoration } from '../view-restoration';

const mocks = vi.hoisted(() => ({
  manager: undefined as SplitManager | undefined,
  account: (): string | undefined => 'account-one',
  selection: (): string[] => [],
  setSelection: undefined as Setter<string[]> | undefined,
  retaining: (): boolean => true,
}));

vi.mock('../layoutUtils', async () => {
  const { usePane } = await import('@app/lib/split-router');
  return {
    useSplitPanelOrThrow() {
      const pane = usePane()();
      const manager = mocks.manager;
      const id = manager
        ?.splits()
        .find((split) => split.id.toString() === pane.toString())?.id;
      const handle = id && manager?.getSplit(id);
      if (!handle) throw new Error('Missing test split');
      return { handle };
    },
  };
});
vi.mock('../componentRegistry', () => ({
  resolveComponent: () => ({ element: () => null, initialMeta: {} }),
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

function RememberedView() {
  useViewRestoration();
  const [selection, setSelection] = useEntryState<string[]>('view.selection', {
    default: [],
  });
  mocks.selection = selection;
  mocks.setSelection = setSelection;
  return null;
}

function AuthenticatedView() {
  return (
    <Show when={mocks.account() && mocks.retaining()}>
      <RememberedView />
    </Show>
  );
}

function setup(
  url = '/channels/channel-one',
  options: {
    stacked?: boolean;
    retainChannels?: boolean;
    account?: string | null;
    middleware?: readonly SplitRouterMiddleware[];
  } = {}
) {
  let router!: ReturnType<typeof createSplitRouter>;
  let manager!: SplitManager;
  const [account, setAccount] = createSignal<string | undefined>(
    options.account === null ? undefined : (options.account ?? 'account-one')
  );
  mocks.account = account;
  const [retaining, setRetaining] = createSignal(true);
  mocks.retaining = retaining;
  render(() => {
    const routes: SplitRoutes = {
      definitions: [
        {
          ...appRoute,
          component: () => <SplitRouter.Outlet />,
          children: [
            homeSplitRoute,
            { ...agentsRoute, component: AuthenticatedView },
            { ...agentsViewRoute, component: AuthenticatedView },
            { ...calendarSplitRoute, component: AuthenticatedView },
            {
              ...channelsSplitRoute,
              component:
                options.retainChannels === false
                  ? () => null
                  : AuthenticatedView,
              children: [channelDetailRoute],
            },
            {
              ...driveSplitRoute,
              component: AuthenticatedView,
              children: [driveTabRoute],
            },
            { ...searchRoute, component: AuthenticatedView },
            notFoundRoute,
          ],
        },
      ],
      defaultRoute: () => paneRoute({ id: 'view-home', params: {} }),
    };
    router = createSplitRouter({
      routes,
      history: createMemoryHistory(url),
      paneStore: createMemoryPaneStore<Entry>(),
      middleware: options.middleware,
      policy: createAppPanePolicy({
        manager: () => manager,
        toContent: splitContentFromLocation,
        defaultLocation: () => ({ route: routes.defaultRoute() }),
        stacked: () => options.stacked ?? false,
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
      stacked: () => options.stacked ?? false,
      sessionKey: account,
    });
    mocks.manager = manager;
    return (
      <SplitRouterProvider router={router}>
        <SplitLayoutContext.Provider value={{ manager }}>
          <For each={router.panes()}>
            {(pane) => <SplitRouter.Outlet pane={pane} />}
          </For>
        </SplitLayoutContext.Provider>
      </SplitRouterProvider>
    );
  });
  return { router, manager, setAccount, setRetaining };
}

afterEach(() => {
  cleanup();
  mocks.manager = undefined;
  mocks.setSelection = undefined;
});

describe('opt-in view restoration', () => {
  it('restores nested location, search, and UI state through existing layout navigation', async () => {
    const { router, manager } = setup();
    const pane = router.panes()[0]!;
    await router.updateSearch(pane, 'channels', { tab: ['unread'] });
    mocks.setSelection?.(['message-one']);
    manager.openWithSplit({ type: 'component', id: 'home' }, { resume: true });
    await router.settled();
    manager.openWithSplit(
      { type: 'component', id: 'channels' },
      { resume: true }
    );
    await router.settled();
    expect(router.entry(pane)?.location.route.matches.at(-1)).toMatchObject({
      id: 'channels-channel',
      params: { channelId: 'channel-one' },
    });
    expect(router.entry(pane)?.location.search).toEqual({
      channels: { tab: ['unread'] },
    });
    expect(mocks.selection()).toEqual(['message-one']);
    expect(manager.activeSplit()?.canGoBack()).toBe(true);
  });

  it('does not retain a view without the hook', async () => {
    const { router, manager } = setup('/channels/channel-one', {
      retainChannels: false,
    });
    const pane = router.panes()[0]!;
    await router.navigatePane(pane, '/home');
    manager.openWithSplit(
      { type: 'component', id: 'channels' },
      { resume: true }
    );
    await router.settled();
    expect(router.entry(pane)?.location.route.matches.at(-1)?.id).toBe(
      'view-channels'
    );
  });

  it('captures direct departures but keeps explicit links and new splits fresh', async () => {
    const { router, manager } = setup();
    const pane = router.panes()[0]!;
    await router.navigatePane(pane, '/home');
    manager.openWithSplit(
      { type: 'component', id: 'channels' },
      { resume: true }
    );
    await router.settled();
    expect(
      router.entry(pane)?.location.route.matches.at(-1)?.params.channelId
    ).toBe('channel-one');
    await router.navigatePane(pane, '/channels/channel-two');
    expect(
      router.entry(pane)?.location.route.matches.at(-1)?.params.channelId
    ).toBe('channel-two');
    await router.navigatePane(pane, '/home');
    manager.openWithSplit(
      { type: 'component', id: 'channels' },
      { resume: true, preferNewSplit: true, allowDuplicate: true }
    );
    await router.settled();
    expect(
      router.entry(router.panes()[1]!)?.location.route.matches.at(-1)?.id
    ).toBe('view-channels');
  });

  it('retains a closed detail as the root, not the previous detail', async () => {
    const { router, manager } = setup();
    const pane = router.panes()[0]!;
    await router.navigatePane(pane, '/channels');
    await router.navigatePane(pane, '/home');
    manager.openWithSplit(
      { type: 'component', id: 'channels' },
      { resume: true }
    );
    await router.settled();
    expect(router.entry(pane)?.location.route.matches.at(-1)?.id).toBe(
      'view-channels'
    );
  });

  it('keeps route schema state separate from runtime state', async () => {
    const { router, manager } = setup('/drive/recent');
    const pane = router.panes()[0]!;
    await router.navigatePane(pane, '/home');
    manager.openWithSplit(
      { type: 'component', id: 'documents' },
      { resume: true }
    );
    await router.settled();
    expect(router.entry(pane)?.location.route.matches.at(-1)?.params.tab).toBe(
      'recent'
    );
    await router.navigatePane(pane, '/search', {
      state: { sessionId: 'search-one' },
    });
    await router.navigatePane(pane, '/home');
    manager.openWithSplit(
      { type: 'component', id: 'search' },
      { resume: true }
    );
    await router.settled();
    expect(router.entry(pane)?.state).toEqual({ sessionId: 'search-one' });
  });

  it('resumes Calendar focus and Agents conversations with the same hook', async () => {
    const { router, manager } = setup('/calendar/month');
    const pane = router.panes()[0]!;
    await router.updateSearch(pane, 'calendar', { eventId: ['event-one'] });
    await router.navigatePane(pane, '/agents/session-one');
    manager.openWithSplit(
      { type: 'component', id: 'calendar' },
      { resume: true }
    );
    await router.settled();
    expect(
      router.entry(pane)?.location.route.matches.at(-1)?.params.period
    ).toBe('dayGridMonth');
    expect(router.entry(pane)?.location.search?.calendar?.eventId).toEqual([
      'event-one',
    ]);
    manager.openWithSplit(
      { type: 'component', id: 'agents' },
      { resume: true }
    );
    await router.settled();
    expect(router.entry(pane)?.location.route.matches.at(-1)?.params.id).toBe(
      'session-one'
    );
  });

  it('resumes a live native view before replacing its pane stack', async () => {
    const { router, manager } = setup('/channels/channel-one', {
      stacked: true,
    });
    mocks.setSelection?.(['message-one']);
    manager.openWithSplit(
      { type: 'component', id: 'home' },
      { preferNewSplit: true }
    );
    await router.settled();
    const oldPanes = [...router.panes()];
    manager.replaceAllSplits(
      { type: 'component', id: 'channels' },
      { resume: true }
    );
    await router.settled();
    expect(router.panes()).toHaveLength(1);
    const pane = router.panes()[0]!;
    expect(
      router.entry(pane)?.location.route.matches.at(-1)?.params.channelId
    ).toBe('channel-one');
    expect(mocks.selection()).toEqual(['message-one']);
    expect(oldPanes.some((oldPane) => !router.panes().includes(oldPane))).toBe(
      true
    );
  });

  it('prefers the last focused view over another live instance', async () => {
    const { router, manager } = setup();
    const firstPane = router.panes()[0]!;
    await router.open('/channels/channel-two', { newPane: true });
    const firstSplit = manager
      .splits()
      .find((split) => split.id.toString() === firstPane.toString())!;
    manager.activateSplit(firstSplit.id);
    await router.navigatePane(firstPane, '/home');
    manager.openWithSplit(
      { type: 'component', id: 'channels' },
      { resume: true }
    );
    await router.settled();
    expect(
      router.entry(firstPane)?.location.route.matches.at(-1)?.params.channelId
    ).toBe('channel-one');
  });

  it('retains an opted-in view when its pane closes', async () => {
    const { router, manager } = setup();
    const pane = router.panes()[0]!;
    await router.open('/home', { newPane: true });
    await router.remove(pane);
    manager.openWithSplit(
      { type: 'component', id: 'channels' },
      { resume: true }
    );
    await router.settled();
    expect(
      router.entry(router.panes()[0]!)?.location.route.matches.at(-1)?.params
        .channelId
    ).toBe('channel-one');
  });

  it('never publishes a snapshot when a later guard refuses navigation', async () => {
    const { router, manager, setRetaining } = setup();
    const pane = router.panes()[0]!;
    router.registerGuard(pane, Number.MAX_SAFE_INTEGER, () => false);
    const previous = router.entry(pane);
    await router.navigatePane(pane, '/home');
    expect(router.entry(pane)).toBe(previous);
    setRetaining(false);
    expect(manager.viewState.get('channels')).toBeUndefined();
  });

  it('never publishes a snapshot when middleware cancels navigation', async () => {
    const { router, manager, setRetaining } = setup('/channels/channel-one', {
      middleware: [
        ({ to, cancel }) =>
          to.location.route.matches.at(-1)?.id === 'view-home'
            ? cancel()
            : undefined,
      ],
    });
    const pane = router.panes()[0]!;
    const previous = router.entry(pane);
    await router.navigatePane(pane, '/home');
    expect(router.entry(pane)).toBe(previous);
    setRetaining(false);
    expect(manager.viewState.get('channels')).toBeUndefined();
  });

  it('discards a staged snapshot if the account changes before commit', async () => {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const { router, manager, setAccount } = setup('/channels/channel-one', {
      middleware: [
        ({ to }) => {
          if (to.location.route.matches.at(-1)?.id !== 'view-home') return;
          entered.resolve();
          return release.promise;
        },
      ],
    });
    const pane = router.panes()[0]!;
    const pending = router.navigatePane(pane, '/home');
    await entered.promise;
    setAccount('account-two');
    release.resolve();
    await pending;
    expect(manager.viewState.get('channels')).toBeUndefined();
  });

  it('keeps an initial URL eligible after authentication resolves', async () => {
    const { router, manager, setAccount } = setup('/channels/channel-one', {
      account: null,
    });
    const pane = router.panes()[0]!;
    setAccount('account-one');
    await router.navigatePane(pane, '/home');
    manager.openWithSplit(
      { type: 'component', id: 'channels' },
      { resume: true }
    );
    await router.settled();
    expect(
      router.entry(pane)?.location.route.matches.at(-1)?.params.channelId
    ).toBe('channel-one');
  });

  it('does not share retained or live entries across account changes', async () => {
    const { router, manager, setAccount } = setup();
    const pane = router.panes()[0]!;
    setAccount('account-two');
    await router.navigatePane(pane, '/home');
    manager.openWithSplit(
      { type: 'component', id: 'channels' },
      { resume: true }
    );
    await router.settled();
    expect(router.entry(pane)?.location.route.matches.at(-1)?.id).toBe(
      'view-channels'
    );
  });

  it('keeps rewritten entries owned by their original account', async () => {
    const { router, manager, setAccount } = setup();
    const pane = router.panes()[0]!;
    const entryId = router.entry(pane)?.id;
    setAccount('account-two');
    await router.updateSearch(
      pane,
      'channels',
      { tab: ['unread'] },
      { history: 'replace' }
    );
    expect(router.entry(pane)?.id).toBe(entryId);
    await router.navigatePane(pane, '/home');
    manager.openWithSplit(
      { type: 'component', id: 'channels' },
      { resume: true }
    );
    await router.settled();
    expect(router.entry(pane)?.location.route.matches.at(-1)?.id).toBe(
      'view-channels'
    );
  });

  it('retains new entries after an account change without remounting the view', async () => {
    const { router, manager, setAccount } = setup();
    const pane = router.panes()[0]!;
    setAccount('account-two');
    await router.navigatePane(pane, '/channels/channel-two');
    await router.navigatePane(pane, '/home');
    manager.openWithSplit(
      { type: 'component', id: 'channels' },
      { resume: true }
    );
    await router.settled();
    expect(
      router.entry(pane)?.location.route.matches.at(-1)?.params.channelId
    ).toBe('channel-two');
  });

  it('clears a saved snapshot on sign-out', async () => {
    const { router, manager, setAccount } = setup();
    const pane = router.panes()[0]!;
    await router.navigatePane(pane, '/home');
    expect(manager.viewState.get('channels')).toBeDefined();
    setAccount(undefined);
    expect(manager.viewState.get('channels')).toBeUndefined();
    setAccount('account-one');
    manager.openWithSplit(
      { type: 'component', id: 'channels' },
      { resume: true }
    );
    await router.settled();
    expect(router.entry(pane)?.location.route.matches.at(-1)?.id).toBe(
      'view-channels'
    );
  });
});
