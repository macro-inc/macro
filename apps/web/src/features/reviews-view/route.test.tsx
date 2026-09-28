import { cleanup, render, waitFor } from '@solidjs/testing-library';
import { createSignal, Suspense } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ReviewsRouteView } from './route';

const state = vi.hoisted(() => ({
  flag: (): { enabled: boolean; loading: boolean } => ({
    enabled: false,
    loading: true,
  }),
  params: { foreignEntityId: undefined as string | undefined },
  navigate: vi.fn(),
}));

vi.mock('@app/features/tasks-view/route', () => ({
  tasksSplitRoute: { id: 'view-tasks' },
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => state.flag,
}));
vi.mock('@app/lib/split-router', () => ({
  defineRoute: (route: unknown) => route,
  createSearchParamsCodec: () => ({}),
  useNavigate: () => state.navigate,
  useParams: () => state.params,
}));
vi.mock('@components/app/split-layout/split-router/app-route-shell', () => ({
  withAuth: (view: unknown) => view,
  usePageViewTracking: () => {},
}));
vi.mock('@core/component/LoadingBlock', () => ({
  LoadingBlock: () => <div>Loading flag</div>,
}));
vi.mock('./reviews-view', () => ({
  ReviewsView: () => <div>Reviews content</div>,
}));

beforeEach(() => {
  vi.clearAllMocks();
  state.params.foreignEntityId = undefined;
});
afterEach(cleanup);

it('waits for the flag before replacing a disabled Reviews list with Tasks', () => {
  const [flag, setFlag] = createSignal({ enabled: false, loading: true });
  state.flag = flag;
  const view = render(() => (
    <Suspense fallback={null}>
      <ReviewsRouteView />
    </Suspense>
  ));

  expect(view.getByText('Loading flag')).toBeTruthy();
  expect(state.navigate).not.toHaveBeenCalled();

  setFlag({ enabled: false, loading: false });
  expect(state.navigate).toHaveBeenCalledExactlyOnceWith(
    { route: { id: 'view-tasks' }, params: {} },
    { replace: true }
  );
  expect(view.queryByText('Reviews content')).toBeNull();
});

it('renders Reviews without redirecting when the flag is enabled', async () => {
  state.flag = () => ({ enabled: true, loading: false });
  const view = render(() => (
    <Suspense fallback={null}>
      <ReviewsRouteView />
    </Suspense>
  ));

  await waitFor(() => expect(view.getByText('Reviews content')).toBeTruthy());
  expect(state.navigate).not.toHaveBeenCalled();
});

it('keeps direct PR detail links accessible when the flag is disabled', async () => {
  state.flag = () => ({ enabled: false, loading: false });
  state.params.foreignEntityId = 'pr-1';
  const view = render(() => (
    <Suspense fallback={null}>
      <ReviewsRouteView />
    </Suspense>
  ));

  await waitFor(() => expect(view.getByText('Reviews content')).toBeTruthy());
  expect(state.navigate).not.toHaveBeenCalled();
});
