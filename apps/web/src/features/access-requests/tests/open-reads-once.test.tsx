import { cleanup, render } from '@solidjs/testing-library';
import { okAsync } from 'neverthrow';
import { createSignal, Show } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { AccessRequestVisitProvider } from '../context/visit';
import type { RequestState } from '../core/types';
import { useSharedAccessUpdates } from '../queries/access-updates';
import { useShareRequestTrigger } from '../share-request-trigger';

const state = vi.hoisted(() => vi.fn());
vi.mock('@core/auth', () => ({ useIsAuthenticated: () => () => true }));
vi.mock('@service-storage/access-requests', () => ({
  accessRequestsClient: { state },
}));
vi.mock('@queries/client', async () => {
  const { QueryClient } = await import('@tanstack/solid-query');
  return {
    queryClient: new QueryClient({
      defaultOptions: { queries: { retry: false } },
    }),
  };
});
vi.stubGlobal(
  'IntersectionObserver',
  class {
    constructor(
      private callback: (entries: { isIntersecting: boolean }[]) => void
    ) {}
    observe() {
      this.callback([{ isIntersecting: true }]);
    }
    disconnect() {}
  }
);
afterEach(cleanup);

const snapshot: RequestState = {
  accessLevel: 'owner',
  canReview: true,
  pendingCount: 0,
  supportedLevels: ['view', 'edit'],
  requests: [],
};

it('reads access requests once when an item opens with its Share button', async () => {
  const { queryClient } = await import('@queries/client');
  state.mockImplementation(() => okAsync(snapshot));
  const entity = { entityType: 'database', entityId: 'db' } as const;
  const [loaded, setLoaded] = createSignal(false);
  function ShareButton() {
    const trigger = useShareRequestTrigger({
      entity: () => entity,
      active: () => true,
      open: () => {},
    });
    return <button ref={trigger.ref}>Share</button>;
  }
  // The block loader confirms access as the item opens; the header's Share
  // button mounts once the item has loaded.
  function Item() {
    useSharedAccessUpdates(
      () => entity,
      () => {}
    );
    return (
      <Show when={loaded()}>
        <ShareButton />
      </Show>
    );
  }
  const { QueryClientProvider } = await import('@tanstack/solid-query');
  render(() => (
    <QueryClientProvider client={queryClient}>
      <AccessRequestVisitProvider visit="database:db">
        <Item />
      </AccessRequestVisitProvider>
    </QueryClientProvider>
  ));
  await vi.waitFor(() => expect(queryClient.isFetching()).toBe(0));
  setLoaded(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await vi.waitFor(() => expect(queryClient.isFetching()).toBe(0));
  expect(state).toHaveBeenCalledTimes(1);
});
