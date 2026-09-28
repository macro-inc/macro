import { cleanup, render } from '@solidjs/testing-library';
import { createSignal, Suspense } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AgentsRouteView } from './route';

const state = vi.hoisted(() => ({
  flag: (): { enabled: boolean; loading: boolean } => ({
    enabled: false,
    loading: true,
  }),
  updateMeta: vi.fn(),
  touch: false,
}));

vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => state.flag,
}));
vi.mock('@app/lib/split-router', () => ({
  defineRoute: (route: unknown) => route,
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanelOrThrow: () => ({
    handle: {
      content: () => ({
        type: 'component',
        id: 'agents',
        params: { agentPage: 'connections' },
      }),
      updateMeta: state.updateMeta,
    },
  }),
}));
vi.mock('@components/app/split-layout/split-router/app-route-shell', () => ({
  withAuth: (view: unknown) => view,
  usePageViewTracking: () => {},
  RedirectSplit: () => null,
}));
vi.mock('@core/component/LoadingBlock', () => ({ LoadingBlock: () => null }));
vi.mock('@core/constant/featureFlags', () => ({
  enableChatV3Agents: { key: 'enable-chat-v3-agents' },
}));
vi.mock('@core/context/user', () => ({}));
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => state.touch,
}));
vi.mock('@queries/agent-schedule/entities', () => ({}));
vi.mock('../next-soup/sidebar/soup-filter-presets', () => ({}));
vi.mock('./views/AgentsView', () => ({ AgentsView: () => null }));
vi.mock('../settings/McpConnections', () => ({ McpConnections: () => null }));

beforeEach(() => {
  vi.clearAllMocks();
  state.touch = false;
});
afterEach(cleanup);

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

it('keeps the legacy layout on touch devices when Agents is enabled', () => {
  state.touch = true;
  state.flag = () => ({ enabled: true, loading: false });
  render(() => (
    <Suspense fallback={null}>
      <AgentsRouteView />
    </Suspense>
  ));

  expect(state.updateMeta).toHaveBeenCalledWith({
    splitPanelLayout: 'legacy',
  });
});
