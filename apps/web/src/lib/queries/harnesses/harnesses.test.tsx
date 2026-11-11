import { render, screen } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useHarnessDirectoryQuery, useHarnessesQuery } from './harnesses';

const mocks = vi.hoisted(() => ({
  getHarnesses: vi.fn(),
  getHarnessDirectory: vi.fn(),
}));

vi.mock('@service-storage/client', () => ({
  storageServiceClient: {
    getHarnesses: mocks.getHarnesses,
    getHarnessDirectory: mocks.getHarnessDirectory,
  },
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
  mocks.getHarnessDirectory.mockReset();
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

it('fetches the runtime directory only after its caller enables sharing', async () => {
  const [enabled, setEnabled] = createSignal(false);
  mocks.getHarnessDirectory.mockResolvedValue(ok([]));
  function Probe() {
    useHarnessDirectoryQuery(enabled);
    return null;
  }
  unmount = render(() => (
    <QueryClientProvider client={queryClient}>
      <Probe />
    </QueryClientProvider>
  )).unmount;
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.getHarnessDirectory).not.toHaveBeenCalled();
  setEnabled(true);
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.getHarnessDirectory).toHaveBeenCalledOnce();
});

it('refreshes remote access grants and revocations without focus or remount', async () => {
  mocks.getHarnessDirectory
    .mockResolvedValueOnce(ok([{ id: 'runtime', access: 'none' }]))
    .mockResolvedValueOnce(ok([{ id: 'runtime', access: 'read' }]))
    .mockResolvedValue(ok([{ id: 'runtime', access: 'none' }]));
  function Probe() {
    const directory = useHarnessDirectoryQuery();
    return (
      <p role="status">
        {directory.isPending ? 'loading' : directory.data?.[0]?.access}
      </p>
    );
  }
  unmount = render(() => (
    <QueryClientProvider client={queryClient}>
      <Probe />
    </QueryClientProvider>
  )).unmount;
  await vi.advanceTimersByTimeAsync(0);
  expect(screen.getByRole('status').textContent).toBe('none');
  await vi.advanceTimersByTimeAsync(15_000);
  expect(screen.getByRole('status').textContent).toBe('read');
  await vi.advanceTimersByTimeAsync(15_000);
  expect(screen.getByRole('status').textContent).toBe('none');
  expect(mocks.getHarnessDirectory).toHaveBeenCalledTimes(3);
});

it('stops directory polling after a dead session and resumes after login invalidation', async () => {
  mocks.getHarnessDirectory.mockResolvedValue(
    err([{ code: 'UNAUTHORIZED', message: 'Unauthorized' }])
  );
  function Probe() {
    useHarnessDirectoryQuery();
    return null;
  }
  unmount = render(() => (
    <QueryClientProvider client={queryClient}>
      <Probe />
    </QueryClientProvider>
  )).unmount;
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.getHarnessDirectory).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(mocks.getHarnessDirectory).toHaveBeenCalledOnce();
  mocks.getHarnessDirectory.mockResolvedValue(ok([]));
  await queryClient.invalidateQueries();
  expect(mocks.getHarnessDirectory).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(15_000);
  expect(mocks.getHarnessDirectory).toHaveBeenCalledTimes(3);
});
