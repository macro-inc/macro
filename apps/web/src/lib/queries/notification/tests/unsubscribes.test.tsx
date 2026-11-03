import { cleanup, render, waitFor } from '@solidjs/testing-library';
import {
  focusManager,
  onlineManager,
  QueryClientProvider,
} from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryClient } from '../../client';
import { notificationKeys } from '../keys';
import {
  useBulkNotificationPreferencesMutation,
  useMutedEntitiesQuery,
  useMuteItemMutation,
  useUnmuteItemMutation,
} from '../unsubscribes';

const user = vi.hoisted(() => ({ id: 'viewer' }));
vi.mock('@core/context/user', () => ({ useUserId: () => () => user.id }));
const client = vi.hoisted(() => ({
  unsubscribeItem: vi.fn(),
  removeUnsubscribeItem: vi.fn(),
  getUnsubscribes: vi.fn(),
  unsubscribeItems: vi.fn(),
  removeUnsubscribeItems: vi.fn(),
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
  let bulk!: ReturnType<typeof useBulkNotificationPreferencesMutation>;
  function Test() {
    mute = useMuteItemMutation();
    unmute = useUnmuteItemMutation();
    bulk = useBulkNotificationPreferencesMutation();
    return null;
  }
  render(() => (
    <QueryClientProvider client={queryClient}>
      <Test />
    </QueryClientProvider>
  ));
  queryClient.setQueryData(key, [original]);
  return { mute, unmute, bulk };
}

beforeEach(() => {
  user.id = 'viewer';
  client.unsubscribeItems.mockReset().mockResolvedValue(ok({}));
  client.removeUnsubscribeItems.mockReset().mockResolvedValue(ok({}));
});
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

describe('offline mute writes', () => {
  afterEach(() => onlineManager.setOnline(true));

  it.each(['mute', 'unmute'] as const)(
    'settles an offline %s instead of waiting for the network',
    async (kind) => {
      onlineManager.setOnline(false);
      const networkDown = new TypeError('Failed to fetch');
      client.unsubscribeItem.mockRejectedValue(networkDown);
      client.removeUnsubscribeItem.mockRejectedValue(networkDown);
      const mutations = setup();

      await expect(mutations[kind].mutateAsync(item)).rejects.toBe(networkDown);
      expect(queryClient.getQueryData(key)).toEqual([original]);
    }
  );
});

describe('bulk notification preferences', () => {
  it('sends one snooze request and updates the cache once after confirmation', async () => {
    const { bulk } = setup();
    const write = vi.spyOn(queryClient, 'setQueryData');
    const until = '2030-10-01T09:00:00.000Z';
    const items = [item, { item_type: 'channel', item_id: 'two' }];
    const result = await bulk.mutateAsync({
      actorId: 'viewer',
      items,
      muted: true,
      snoozedUntil: until,
    });

    expect(client.unsubscribeItems).toHaveBeenCalledExactlyOnceWith(
      items,
      until
    );
    expect(write).toHaveBeenCalledOnce();
    expect(result.failed).toEqual([]);
    expect(queryClient.getQueryData(key)).toEqual(
      items.map((entry) => ({
        ...entry,
        snoozed_until: until,
      }))
    );
    write.mockRestore();
  });

  it('keeps confirmed chunks and returns only the failed chunk for retry', async () => {
    const { bulk } = setup();
    const items = Array.from({ length: 501 }, (_, index) => ({
      item_type: 'channel',
      item_id: `channel-${index}`,
    }));
    client.unsubscribeItems.mockResolvedValueOnce(ok({}));
    client.unsubscribeItems.mockResolvedValueOnce(
      err([{ message: 'Offline', code: 'FETCH_ERROR' }])
    );
    const result = await bulk.mutateAsync({
      actorId: 'viewer',
      items,
      muted: true,
    });

    expect(client.unsubscribeItems).toHaveBeenCalledTimes(2);
    expect(
      client.unsubscribeItems.mock.calls.map(([batch]) => batch.length)
    ).toEqual([500, 1]);
    expect(result.succeeded).toHaveLength(500);
    expect(result.failed).toEqual([items[500]]);
    expect(queryClient.getQueryData(key)).toEqual([
      original,
      ...items
        .slice(0, 500)
        .map((entry) => ({ ...entry, snoozed_until: null })),
    ]);
  });

  it('preserves unrelated preferences added while a bulk request is pending', async () => {
    const { bulk } = setup();
    let finish!: (result: unknown) => void;
    client.removeUnsubscribeItems.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const pending = bulk.mutateAsync({
      actorId: 'viewer',
      items: [item],
      muted: false,
    });
    await waitFor(() =>
      expect(client.removeUnsubscribeItems).toHaveBeenCalledOnce()
    );
    const unrelated = { item_id: 'unrelated', item_type: 'channel' };
    queryClient.setQueryData(key, [original, unrelated]);
    finish(ok({}));
    await pending;

    expect(queryClient.getQueryData(key)).toEqual([unrelated]);
  });

  it('stops later chunks and ignores late cache updates after an account change', async () => {
    const { bulk } = setup();
    const items = Array.from({ length: 501 }, (_, index) => ({
      item_type: 'channel',
      item_id: `channel-${index}`,
    }));
    let finish!: (result: unknown) => void;
    client.unsubscribeItems.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const pending = bulk.mutateAsync({ actorId: 'viewer', items, muted: true });
    await waitFor(() => expect(client.unsubscribeItems).toHaveBeenCalledOnce());
    user.id = 'another-viewer';
    const current = [{ item_id: 'current', item_type: 'channel' }];
    queryClient.setQueryData(key, current);
    finish(ok({}));
    await pending;

    expect(client.unsubscribeItems).toHaveBeenCalledOnce();
    expect(queryClient.getQueryData(key)).toEqual(current);
  });
});
