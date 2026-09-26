import { cleanup, render, waitFor } from '@solidjs/testing-library';
import { QueryClientProvider } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { queryClient } from '../../client';
import { notificationKeys } from '../keys';
import { useMuteItemMutation, useUnmuteItemMutation } from '../unsubscribes';

const client = vi.hoisted(() => ({
  unsubscribeItem: vi.fn(),
  removeUnsubscribeItem: vi.fn(),
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
  vi.clearAllMocks();
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
