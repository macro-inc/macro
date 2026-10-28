import type { QueryRevalidation } from '@graphql-cache/exchange/optimistic';
import { type Client, gql } from '@urql/core';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  channelNotificationRefresh,
  delegateChannelNotificationRefresh,
  disposeChannelNotificationRefresh,
} from './notification-refresh';
import { registerChannelNotificationRefresh } from './register-notification-refresh';

const document = gql`query Channel($id: ID!) { channel(id: $id) { id } }`;
const descriptor: QueryRevalidation = { document, variables: { id: 'a' } };
const cleanups: (() => void)[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(globalThis.document, 'hidden', 'get').mockReturnValue(false);
});
afterEach(() => {
  cleanups.splice(0).forEach((dispose) => dispose());
  vi.restoreAllMocks();
  vi.useRealTimers();
});
function client() {
  const query = vi.fn(() => ({ toPromise: async () => ({}) }));
  const client = { query } as unknown as Client;
  cleanups.push(() => disposeChannelNotificationRefresh(client));
  return { client, query };
}
it('reactively waits for initial load, unregisters old clients, and cleans up readers', async () => {
  const first = client();
  const second = client();
  const root = createRoot((dispose) => {
    const [current, setClient] = createSignal(first.client);
    const [fetching, setFetching] = createSignal(true);
    const [enabled, setEnabled] = createSignal(true);
    registerChannelNotificationRefresh(() => ({
      client: current(),
      queries: [descriptor],
      reader: {
        enabled: enabled(),
        fetching: fetching(),
        filtered: false,
        channelId: 'a',
        notificationIds: [],
      },
    }));
    return { dispose, setClient, setFetching, setEnabled };
  });
  cleanups.push(root.dispose);
  expect(delegateChannelNotificationRefresh(first.client, descriptor)).toBe(
    true
  );
  await vi.advanceTimersByTimeAsync(100);
  expect(first.query).not.toHaveBeenCalled();
  root.setFetching(false);
  await vi.advanceTimersByTimeAsync(100);
  expect(first.query).toHaveBeenCalledOnce();
  root.setEnabled(false);
  expect(delegateChannelNotificationRefresh(first.client, descriptor)).toBe(
    false
  );
  root.setClient(() => second.client);
  root.setEnabled(true);
  expect(delegateChannelNotificationRefresh(first.client, descriptor)).toBe(
    false
  );
  expect(delegateChannelNotificationRefresh(second.client, descriptor)).toBe(
    true
  );
  await vi.advanceTimersByTimeAsync(100);
  expect(second.query).toHaveBeenCalledOnce();
  root.dispose();
  expect(delegateChannelNotificationRefresh(second.client, descriptor)).toBe(
    false
  );
  channelNotificationRefresh(first.client).reconnect();
  channelNotificationRefresh(second.client).reconnect();
  await vi.advanceTimersByTimeAsync(100);
  expect(first.query).toHaveBeenCalledOnce();
  expect(second.query).toHaveBeenCalledOnce();
});
