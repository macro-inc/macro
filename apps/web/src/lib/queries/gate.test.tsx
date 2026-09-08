import { cleanup, render, waitFor } from '@solidjs/testing-library';
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from '@tanstack/solid-query';
import { createMemo, createSignal, onMount, Suspense } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { queryReadyGate } from './gate';

afterEach(cleanup);

describe('queryReadyGate', () => {
  it('does not suspend the workspace for disabled queries or their key changes', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const [key, setKey] = createSignal(0);
    const fetch = vi.fn(async () => 'loaded');
    const fallbackMounted = vi.fn();
    function Fallback() {
      onMount(fallbackMounted);
      return <div>Workspace loading</div>;
    }
    function Workspace() {
      const query = useQuery(() => ({
        queryKey: ['disabled', key()],
        queryFn: fetch,
        enabled: false,
      }));
      const data = createMemo(() =>
        queryReadyGate(query) ? query.data : 'No selection'
      );
      return <h1>{data()}</h1>;
    }
    const screen = render(() => (
      <QueryClientProvider client={client}>
        <Suspense fallback={<Fallback />}>
          <Workspace />
        </Suspense>
      </QueryClientProvider>
    ));
    await waitFor(() =>
      expect(screen.getByRole('heading').textContent).toBe('No selection')
    );
    expect(fallbackMounted).not.toHaveBeenCalled();
    setKey(1);
    await waitFor(() =>
      expect(screen.getByRole('heading').textContent).toBe('No selection')
    );
    expect(fallbackMounted).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    screen.unmount();
    client.clear();
  });

  it('updates local loading content when a pending query succeeds without suspending its parent', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    let resolve!: (value: string) => void;
    const response = new Promise<string>((done) => {
      resolve = done;
    });
    const fallbackMounted = vi.fn();
    function Fallback() {
      onMount(fallbackMounted);
      return <div>Workspace loading</div>;
    }
    function Workspace() {
      const query = useQuery(() => ({
        queryKey: ['pending'],
        queryFn: () => response,
      }));
      const data = createMemo(() =>
        queryReadyGate(query) ? query.data : 'Loading rows'
      );
      return <h1>{data()}</h1>;
    }
    const screen = render(() => (
      <QueryClientProvider client={client}>
        <Suspense fallback={<Fallback />}>
          <Workspace />
        </Suspense>
      </QueryClientProvider>
    ));
    expect(screen.getByRole('heading').textContent).toBe('Loading rows');
    resolve('Ready');
    await waitFor(() =>
      expect(screen.getByRole('heading').textContent).toBe('Ready')
    );
    expect(fallbackMounted).not.toHaveBeenCalled();
    screen.unmount();
    client.clear();
  });
});
