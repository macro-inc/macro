import { cleanup, render, screen } from '@solidjs/testing-library';
import { createSignal, Suspense } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AgentsRouteView } from './route-views';

const state = vi.hoisted(() => ({
  flag: (): { enabled: boolean; loading: boolean } => ({
    enabled: false,
    loading: true,
  }),
  routeId: 'agents',
  agentPage: 'connections',
  redirect: vi.fn(),
  updateMeta: vi.fn(),
=======
  restore: vi.fn(),
>>>>>>> c95a8422df (fix(agents): retain connections under the agents workspace)
  touch: false,
}));

vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => state.flag,
}));
vi.mock('@app/lib/split-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@app/lib/split-router')>()),
  defineRoute: (route: unknown) => route,
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanelOrThrow: () => ({
    handle: {
      content: () => ({
        type: 'component',
        id: state.routeId,
        params: { agentPage: state.agentPage },
      }),
      updateMeta: state.updateMeta,
    },
  }),
}));
vi.mock('@components/app/split-layout/view-restoration', () => ({
  useViewRestoration: (key?: string) => state.restore(key),
}));
vi.mock('@components/app/split-layout/split-router/app-route-shell', () => ({
  withAuth: (view: unknown) => view,
  usePageViewTracking: () => {},
  RedirectSplit: (props: { to: unknown; mergeHistory?: boolean }) => {
    state.redirect(props.to, props.mergeHistory);
    return null;
  },
}));
vi.mock('@core/component/LoadingBlock', () => ({ LoadingBlock: () => null }));
vi.mock('./agents-view-skeleton', () => ({ AgentsViewSkeleton: () => null }));
vi.mock('@core/constant/featureFlags', () => ({
  enableChatV3Agents: { key: 'enable-chat-v3-agents' },
}));
vi.mock('@core/context/user', () => ({}));
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => state.touch,
}));
vi.mock('@app/features/routines/queries/entities', () => ({}));
vi.mock('../next-soup/sidebar/soup-filter-presets', () => ({}));
vi.mock('./views/AgentsView', () => ({ AgentsView: () => null }));
vi.mock('../settings/IntegrationsPage', () => ({
  IntegrationsPage: () => <p>Integrations page</p>,
}));
vi.mock('../artifacts/artifacts-page', () => ({
  ArtifactsPage: () => <p>Artifacts page</p>,
}));

beforeEach(() => {
  vi.clearAllMocks();
  state.touch = false;
  state.routeId = 'agents';
  state.agentPage = 'connections';
});
afterEach(cleanup);

<<<<<<< HEAD
it('updates Agents layout metadata after the remote flag loads and changes', () => {
  const [flag, setFlag] = createSignal({ enabled: false, loading: true });
  state.flag = flag;
  render(() => (
    <Suspense fallback={null}>
      <AgentsRouteView />
    </Suspense>
  ));

  expect(state.updateMeta).not.toHaveBeenCalled();

  setFlag({ enabled: true, loading: false });
  expect(state.updateMeta).toHaveBeenLastCalledWith({
    splitPanelLayout: 'composable',
  });

  setFlag({ enabled: false, loading: false });
  expect(state.updateMeta).toHaveBeenLastCalledWith({
    splitPanelLayout: 'legacy',
  });
});

it('uses the new Agents layout on touch devices when enabled', () => {
  state.touch = true;
  state.flag = () => ({ enabled: true, loading: false });
  render(() => (
    <Suspense fallback={null}>
      <AgentsRouteView />
    </Suspense>
  ));

  expect(state.updateMeta).toHaveBeenCalledWith({
    splitPanelLayout: 'composable',
  });
});

it('remembers a directly opened Connections page as part of the Agents workspace', () => {
  state.routeId = 'connections';
  render(() => (
    <Suspense>
      <AgentsRouteView />
    </Suspense>
  ));
  expect(state.restore).toHaveBeenCalledWith('agents');
});

it('replaces the mobile conversation alias instead of trapping Back in a redirect', () => {
  state.touch = true;
  state.routeId = 'agents-session~agents~session-id';
  state.flag = () => ({ enabled: true, loading: false });
  render(() => (
    <Suspense fallback={null}>
      <AgentsRouteView />
    </Suspense>
  ));
  expect(state.redirect).toHaveBeenCalledWith(
    { type: 'agent', id: 'session-id' },
    true
  );
});

it('opens the requested Artifacts or Connections page on the legacy Agents layout', async () => {
  state.flag = () => ({ enabled: false, loading: false });
  state.agentPage = 'artifacts';
  render(() => (
    <Suspense fallback={null}>
      <AgentsRouteView />
    </Suspense>
  ));
  expect(await screen.findByText('Artifacts page')).toBeTruthy();
  expect(screen.queryByText('Integrations page')).toBeNull();
  cleanup();

  state.agentPage = 'connections';
  render(() => (
    <Suspense fallback={null}>
      <AgentsRouteView />
    </Suspense>
  ));
  expect(await screen.findByText('Integrations page')).toBeTruthy();
  expect(screen.queryByText('Artifacts page')).toBeNull();
});

it.each(['connections', 'artifacts'])(
  'opens a direct %s route on the legacy Agents layout',
  async (page) => {
    state.flag = () => ({ enabled: false, loading: false });
    state.routeId = page;
    state.agentPage = 'new';
    render(() => (
      <Suspense fallback={null}>
        <AgentsRouteView />
      </Suspense>
    ));
    expect(
      await screen.findByText(
        page === 'connections' ? 'Integrations page' : 'Artifacts page'
      )
    ).toBeTruthy();
  }
);
