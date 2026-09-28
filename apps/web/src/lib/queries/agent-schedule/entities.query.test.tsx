import type { ScheduledAction } from '@service-scheduled-action/generated/schemas';
import { cleanup, render, screen, waitFor } from '@solidjs/testing-library';
import { QueryClient, type UseQueryResult } from '@tanstack/solid-query';
import { type JSX, Suspense } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAutomationEntities } from './entities';

const mocks = vi.hoisted(() => ({
  query: undefined as UseQueryResult<ScheduledAction[]> | undefined,
  client: undefined as QueryClient | undefined,
  fetch: vi.fn<() => Promise<ScheduledAction[]>>(),
}));
vi.mock('./schedules', async () => {
  const { useQuery } = await import('@tanstack/solid-query');
  return {
    useSchedulesQuery: () => {
      mocks.query = useQuery(
        () => ({
          queryKey: ['schedules'],
          queryFn: mocks.fetch,
          retry: false,
          reconcile: 'id',
          placeholderData: (previous: ScheduledAction[] | undefined) =>
            previous,
        }),
        () => mocks.client!
      );
      return mocks.query;
    },
  };
});

function Entities(): JSX.Element {
  const entities = useAutomationEntities();
  return (
    <div data-testid="entities">
      {entities()
        .map((entity) => entity.name)
        .join(',')}
    </div>
  );
}

function mount(): void {
  mocks.client = new QueryClient();
  render(() => (
    <Suspense fallback={<div>Suspended</div>}>
      <Entities />
    </Suspense>
  ));
}

afterEach(() => {
  cleanup();
  mocks.client?.clear();
  vi.resetAllMocks();
});

describe('installed Solid Query resource behavior', () => {
  it('does not suspend pending entities and reads undefined safely after an initial error', async () => {
    let reject!: (error: Error) => void;
    mocks.fetch.mockReturnValue(
      new Promise((_, fail) => {
        reject = fail;
      })
    );
    mount();
    expect(mocks.query?.isPending).toBe(true);
    expect(screen.getByTestId('entities').textContent).toBe('');
    expect(screen.queryByText('Suspended')).toBeNull();
    reject(new Error('Unavailable'));
    await waitFor(() => expect(mocks.query?.isError).toBe(true));
    expect(mocks.query?.data).toBeUndefined();
    expect(screen.getByTestId('entities').textContent).toBe('');
  });

  it('retains actual cached data and entity nodes after a failed background refetch', async () => {
    const action: ScheduledAction = {
      id: 'cron',
      name: 'Cached cron',
      owner: 'macro|owner@example.com',
      kind: 'Agent',
      trigger: { type: 'cron', schedule: '0 0 9 * * 2', timezone: 'UTC' },
      task: {},
      enabled: true,
      configuration_revision: 1,
      created_at: '2026-09-22T12:00:00Z',
      updated_at: '2026-09-22T12:00:00Z',
      next_run_at: null,
    };
    mocks.fetch
      .mockResolvedValueOnce([action])
      .mockRejectedValue(new Error('Unavailable'));
    mount();
    await waitFor(() => expect(mocks.query?.isSuccess).toBe(true));
    const node = screen.getByTestId('entities');
    expect(node.textContent).toBe('Cached cron');
    await mocks.query!.refetch();
    await waitFor(() => expect(mocks.query?.isRefetchError).toBe(true));
    expect(mocks.query?.isSuccess).toBe(false);
    expect(mocks.query?.isPending).toBe(false);
    expect(mocks.query?.data).toEqual([action]);
    expect(screen.getByTestId('entities')).toBe(node);
    expect(node.textContent).toBe('Cached cron');
    expect(screen.queryByText('Suspended')).toBeNull();
  });
});
