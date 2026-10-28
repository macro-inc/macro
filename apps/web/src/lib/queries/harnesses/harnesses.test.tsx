import { render } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useHarnessesQuery } from './harnesses';

const mocks = vi.hoisted(() => ({
  getHarnesses: vi.fn(),
}));

vi.mock('@service-storage/client', () => ({
  storageServiceClient: { getHarnesses: mocks.getHarnesses },
}));
vi.mock('@queries/client', () => ({ queryClient: {} }));
vi.mock('@queries/agents/agents', () => ({ invalidateAgents: vi.fn() }));

let queryClient: QueryClient;
let unmount: (() => void) | undefined;

function mountHarnesses() {
  function Probe() {
    useHarnessesQuery();
    return null;
  }
  unmount = render(() => (
    <QueryClientProvider client={queryClient}>
      <Probe />
    </QueryClientProvider>
  )).unmount;
}

beforeEach(() => {
  vi.useFakeTimers();
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  mocks.getHarnesses.mockReset();
});

afterEach(() => {
  unmount?.();
  unmount = undefined;
  queryClient.clear();
  vi.useRealTimers();
});

it('stops polling after a 401 and resumes once a fetch succeeds again', async () => {
  mocks.getHarnesses.mockResolvedValue(
    err([{ code: 'UNAUTHORIZED', message: 'Unauthorized' }])
  );
  mountHarnesses();
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.getHarnesses).toHaveBeenCalledOnce();

  await vi.advanceTimersByTimeAsync(60_000);
  expect(mocks.getHarnesses).toHaveBeenCalledOnce();

  // Login invalidates every query.
  mocks.getHarnesses.mockResolvedValue(ok([]));
  await queryClient.invalidateQueries();
  expect(mocks.getHarnesses).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(15_000);
  expect(mocks.getHarnesses).toHaveBeenCalledTimes(3);
});

it('keeps polling through errors that are not a dead session', async () => {
  mocks.getHarnesses.mockResolvedValue(
    err([{ code: 'NETWORK_ERROR', message: 'offline' }])
  );
  mountHarnesses();
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(mocks.getHarnesses).toHaveBeenCalledTimes(3);
});
