import {
  SplitPanelContext,
  type SplitPanelContextType,
} from '@components/app/split-layout/context';
import { cleanup, render, waitFor } from '@solidjs/testing-library';
import { Suspense } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AgentsRouteView as RouteView } from './route-views';

function AgentsRouteView() {
  const panel = {
    panelSize: {
      get width() {
        return state.width;
      },
    },
  } as SplitPanelContextType;
  return (
    <SplitPanelContext.Provider value={panel}>
      <RouteView />
    </SplitPanelContext.Provider>
  );
}

const state = vi.hoisted(() => ({
  routeId: 'agents',
  redirect: vi.fn(),
  touch: false,
  width: 390,
  workspace: vi.fn(),
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
        params: { agentPage: 'connections' },
      }),
    },
  }),
}));
vi.mock('@components/app/split-layout/view-restoration', () => ({
  useViewRestoration: () => {},
}));
vi.mock('@components/app/split-layout/split-router/app-route-shell', () => ({
  withAuth: (view: unknown) => view,
  usePageViewTracking: () => {},
  RedirectSplit: (props: { to: unknown; mergeHistory?: boolean }) => {
    state.redirect(props.to, props.mergeHistory);
    return null;
  },
}));
vi.mock('./agents-view-skeleton', () => ({ AgentsViewSkeleton: () => null }));
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => state.touch,
}));
vi.mock('./views/AgentsView', () => ({
  AgentsView: (props: { route?: unknown }) => {
    state.workspace(props.route);
    return null;
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  state.touch = false;
  state.width = 390;
  state.routeId = 'agents';
});
afterEach(cleanup);

it('replaces the mobile conversation alias instead of trapping Back in a redirect', () => {
  state.touch = true;
  state.routeId = 'agents-session~agents~session-id';
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

it('keeps a wide touch conversation in the Agents workspace instead of redirecting to a split', async () => {
  state.touch = true;
  state.width = 1000;
  state.routeId = 'agents-session~agents~session-id';
  render(() => (
    <Suspense fallback={null}>
      <AgentsRouteView />
    </Suspense>
  ));
  await waitFor(() =>
    expect(state.workspace).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation: { type: 'agent_session', id: 'session-id' },
      })
    )
  );
  expect(state.redirect).not.toHaveBeenCalled();
});
