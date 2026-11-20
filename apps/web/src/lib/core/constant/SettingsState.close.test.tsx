import {
  createSplitLayout,
  type SplitManager,
} from '@app/components/app/split-layout/layoutManager';
import { createAppPanePolicy } from '@app/components/app/split-layout/split-router/app-pane-policy';
import {
  resolveContentLocation,
  splitContentFromLocation,
} from '@app/components/app/split-layout/split-router/legacy-route';
import { MobileSettingsProvider } from '@app/features/settings/context/mobile-settings';
import {
  createMemoryHistory,
  createMemoryPaneStore,
  createSplitRouter,
  type Entry,
  type SplitRouter,
  type SplitRoutes,
} from '@app/lib/split-router';
import { paneRoute } from '@app/routes/app-route';
import {
  appRoute,
  homeSplitRoute,
  notFoundRoute,
  settingsRoute,
} from '@app/routes/routes';
import { createBlockOrchestrator } from '@core/orchestrator';
import { cleanup, render } from '@solidjs/testing-library';
import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSettingsState } from './SettingsState';

// A real split router and layout manager hold the settings pane's history;
// only the app-wide singletons and the browser router are stood in for.
const mocks = vi.hoisted(() => ({
  manager: undefined as SplitManager | undefined,
  navigate: vi.fn(),
}));
vi.mock('@app/signal/splitLayout', () => ({
  globalSplitManager: () => mocks.manager,
}));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({ openWithSplit: vi.fn() }),
}));
vi.mock('@solidjs/router', () => ({
  useNavigate: () => mocks.navigate,
}));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => true }));
vi.mock('@app/components/app/split-layout/componentRegistry', () => ({
  resolveComponent: () => ({ initialMeta: {} }),
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

const routes: SplitRoutes = {
  definitions: [
    {
      ...appRoute,
      children: [homeSplitRoute, settingsRoute, notFoundRoute],
    },
  ],
  defaultRoute: () => paneRoute({ id: 'view-home', params: {} }),
};

let disposeRoot: (() => void) | undefined;

function setup(url: string) {
  const router: SplitRouter = createRoot((dispose) => {
    disposeRoot = dispose;
    let manager: SplitManager | undefined;
    const splitRouter = createSplitRouter({
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
    manager = createSplitLayout(createBlockOrchestrator(), {
      router: splitRouter,
      toLocation: (content) =>
        resolveContentLocation(splitRouter.routes, content),
      toContent: splitContentFromLocation,
    });
    mocks.manager = manager;
    return splitRouter;
  });

  let state!: ReturnType<typeof useSettingsState>;
  function Probe() {
    state = useSettingsState();
    return null;
  }
  render(() => (
    <MobileSettingsProvider>
      <Probe />
    </MobileSettingsProvider>
  ));

  const pane = router.panes()[0]!;
  const currentRoute = () => router.entry(pane)?.location.route.matches.at(-1);

  return { router, pane, state, currentRoute };
}

afterEach(() => {
  cleanup();
  disposeRoot?.();
  disposeRoot = undefined;
  mocks.manager = undefined;
  mocks.navigate.mockReset();
});

describe('closing desktop settings', () => {
  it('returns to the view open before settings after visiting several settings pages', async () => {
    const { router, pane, state, currentRoute } = setup('/home');
    await router.navigatePane(pane, '/settings/account');
    await router.navigatePane(pane, '/settings/appearance');
    await router.navigatePane(pane, '/settings/notifications');

    state.closeSettings();
    await router.settled();

    expect(currentRoute()?.id).toBe('view-home');
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('falls back to the default route when settings was the first view', async () => {
    const { router, pane, state, currentRoute } = setup('/settings/account');
    await router.navigatePane(pane, '/settings/appearance');

    state.closeSettings();
    await router.settled();

    expect(currentRoute()?.id).toBe('settings');
    expect(mocks.navigate).toHaveBeenCalledWith('/home', { replace: true });
  });
});
