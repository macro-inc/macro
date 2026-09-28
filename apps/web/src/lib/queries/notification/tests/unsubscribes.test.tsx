import { cleanup, render, waitFor } from '@solidjs/testing-library';
import { focusManager, QueryClientProvider } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { queryClient } from '../../client';
import { notificationKeys } from '../keys';
import {
  useMutedEntitiesQuery,
  useMuteItemMutation,
  useUnmuteItemMutation,
} from '../unsubscribes';

const client = vi.hoisted(() => ({
  unsubscribeItem: vi.fn(),
  removeUnsubscribeItem: vi.fn(),
  getUnsubscribes: vi.fn(),
}));
vi.mock('@service-notification/client', () => ({
  notificationServiceClient: client,
}));
vi.mock('../../client', async () => {
  const { QueryClient } = await import('@tanstack/solid-query');
  return {
    queryClient: new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    }),
  };
});

const item = { item_id: 'one', item_type: 'document' };
const original = { ...item, snoozed_until: '2030-09-28T09:00:00.000Z' };
const key = notificationKeys.unsubscribes.queryKey;

function setup() {
  let mute!: ReturnType<typeof useMuteItemMutation>;
  let unmute!: ReturnType<typeof useUnmuteItemMutation>;
  function Test() {
    mute = useMuteItemMutation();
    unmute = useUnmuteItemMutation();
    return null;
  }
  render(() => (
    <QueryClientProvider client={queryClient}>
      <Test />
    </QueryClientProvider>
  ));
  queryClient.setQueryData(key, [original]);
  return { mute, unmute };
}

afterEach(() => {
  cleanup();
  queryClient.clear();
  focusManager.setFocused(undefined);
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('snooze query refresh', () => {
  function setupQuery() {
    function Test() {
      useMutedEntitiesQuery();
      return null;
    }
    render(() => (
      <QueryClientProvider client={queryClient}>
        <Test />
      </QueryClientProvider>
    ));
  }

  it.each([
    { items: [] },
    { items: [item] },
    { items: [original] },
    { items: [{ ...item, snoozed_until: '2000-01-01T00:00:00.000Z' }] },
  ])('does not poll: $items', async ({ items }) => {
    vi.useFakeTimers();
    client.getUnsubscribes.mockResolvedValue(ok({ data: items }));
    setupQuery();
    await vi.advanceTimersByTimeAsync(1);
    expect(client.getUnsubscribes).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(180_000);
    expect(client.getUnsubscribes).toHaveBeenCalledTimes(1);
  });

  it('refreshes expired snoozes when the window regains focus', async () => {
    vi.useFakeTimers();
    const until = new Date(Date.now() + 90_000).toISOString();
    client.getUnsubscribes.mockImplementation(async () =>
      ok({
        data:
          Date.parse(until) > Date.now()
            ? [{ ...item, snoozed_until: until }]
            : [],
      })
    );
    setupQuery();
    await vi.advanceTimersByTimeAsync(90_100);
    expect(client.getUnsubscribes).toHaveBeenCalledTimes(1);
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(client.getUnsubscribes).toHaveBeenCalledTimes(2);
    expect(queryClient.getQueryData(key)).toEqual([]);
    await vi.advanceTimersByTimeAsync(180_000);
    expect(client.getUnsubscribes).toHaveBeenCalledTimes(2);
  });
});

describe('item snooze mutations', () => {
  it('replaces a cached deadline and sends it to the server', async () => {
    client.unsubscribeItem.mockResolvedValueOnce(ok({}));
    const { mute } = setup();
    const updated = { ...item, snoozed_until: '2030-10-01T09:00:00.000Z' };
    await mute.mutateAsync(updated);
    expect(client.unsubscribeItem).toHaveBeenCalledWith(updated);
    expect(queryClient.getQueryData(key)).toEqual([updated]);
  });

  it('restores the previous deadline when rescheduling fails', async () => {
    let reject!: (error: Error) => void;
    client.unsubscribeItem.mockImplementationOnce(
      () =>
        new Promise((_, fail) => {
          reject = fail;
        })
    );
    const { mute } = setup();
    const updated = { ...item, snoozed_until: '2030-10-01T09:00:00.000Z' };
    const result = mute.mutateAsync(updated);
    const rejected = expect(result).rejects.toThrow('offline');
    await waitFor(() =>
      expect(queryClient.getQueryData(key)).toEqual([updated])
    );
    reject(new Error('offline'));
    await rejected;
    expect(queryClient.getQueryData(key)).toEqual([original]);
  });

  it('restores the deadline when an early resume fails, even from a bare entity reference', async () => {
    client.removeUnsubscribeItem.mockRejectedValueOnce(new Error('offline'));
    const { unmute } = setup();
    await expect(unmute.mutateAsync(item)).rejects.toThrow('offline');
    expect(queryClient.getQueryData(key)).toEqual([original]);
  });
});
