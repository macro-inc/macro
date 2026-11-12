import { cleanup, render } from '@solidjs/testing-library';
import { Suspense } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AgentsRouteView } from './route-views';

const state = vi.hoisted(() => ({
  routeId: 'agents',
  redirect: vi.fn(),
  touch: false,
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
vi.mock('./views/AgentsView', () => ({ AgentsView: () => null }));

beforeEach(() => {
  vi.clearAllMocks();
  state.touch = false;
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
