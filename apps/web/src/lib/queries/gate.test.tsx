import { cleanup, render, screen, waitFor } from '@solidjs/testing-library';
import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
  type UseQueryResult,
  useQuery,
} from '@tanstack/solid-query';
import { Suspense } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { queryReadyGate } from './gate';

const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
  onlineManager.setOnline(true);
});

function mount(options: {
  enabled?: boolean;
  initialData?: string;
  queryFn?: () => Promise<string>;
}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  const request = options.queryFn ?? vi.fn(() => new Promise<string>(() => {}));
  let query: UseQueryResult<string> | undefined;
  function View() {
    query = useQuery(() => ({
      queryKey: ['gate-test'],
      queryFn: request,
      enabled: options.enabled,
      initialData: options.initialData,
    }));
    const result = query;
    return (
      <div data-testid="content">
        {queryReadyGate(result) ? result.data : 'pending'}
      </div>
    );
  }
  render(() => (
    <QueryClientProvider client={client}>
      <Suspense fallback={<div data-testid="suspended" />}>
        <View />
      </Suspense>
    </QueryClientProvider>
  ));
  return { client, request, query: () => query! };
}

function expectContent(text: string) {
  expect(screen.queryByTestId('suspended')).toBeNull();
  expect(screen.getByTestId('content').textContent).toBe(text);
}

describe('queryReadyGate', () => {
  it('does not suspend for an initially disabled query', () => {
    const h = mount({ enabled: false });
    expect(h.query().isPending).toBe(true);
    expect(h.query().isLoading).toBe(false);
    expectContent('pending');
    expect(h.request).not.toHaveBeenCalled();
  });

  it('does not suspend for an offline/paused initial query', () => {
    onlineManager.setOnline(false);
    const h = mount({});
    expect(h.query().fetchStatus).toBe('paused');
    expect(h.query().isLoading).toBe(false);
    expectContent('pending');
    expect(h.request).not.toHaveBeenCalled();
  });

  it('renders immediately while loading, then updates when data arrives', async () => {
    const response = Promise.withResolvers<string>();
    mount({ queryFn: () => response.promise });
    expectContent('pending');
    response.resolve('loaded');
    await waitFor(() => expectContent('loaded'));
  });

  it('keeps cached data visible during background refetch and after refetch failure', async () => {
    const response = Promise.withResolvers<string>();
    const h = mount({ initialData: 'cached', queryFn: () => response.promise });
    expectContent('cached');
    response.reject(new Error('Offline'));
    await waitFor(() => expect(h.query().isError).toBe(true));
    expectContent('cached');
  });

  it('returns no data after an initial failure without suspending the caller', async () => {
    const h = mount({
      queryFn: async () => {
        throw new Error('Offline');
      },
    });
    await waitFor(() => expect(h.query().isError).toBe(true));
    expectContent('pending');
  });

  it('recognizes falsy cached values as available', () => {
    mount({ enabled: false, initialData: '' });
    expectContent('');
  });
});
