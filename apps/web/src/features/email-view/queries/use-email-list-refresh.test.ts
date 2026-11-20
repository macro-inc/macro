/** @vitest-environment jsdom */
import type { QueryAccount } from '@queries/auth/account-scope';
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useEmailListRefresh } from './use-email-list-refresh';

type Frame = { type: string; data: unknown };
const auth: { current?: QueryAccount } = vi.hoisted(() => ({}));
const socket = vi.hoisted(() => ({
  receivers: new Set<(message: Frame) => void>(),
  reconnect: new Set<() => void>(),
}));
vi.mock('@queries/auth/account-scope', () => ({
  currentQueryAccount: () => auth.current,
  isCurrentQueryAccount: (account: QueryAccount) =>
    account.userId === auth.current?.userId &&
    account.session === auth.current?.session,
}));
vi.mock('@service-connection/websocket', async () => ({
  ...(await import('@service-connection/websocket-payload')),
  createConnectionWebsocketEffect: (callback: (message: Frame) => void) =>
    socket.receivers.add(callback),
  ws: {
    addEventListener: (_event: string, callback: () => void) =>
      socket.reconnect.add(callback),
    removeEventListener: (_event: string, callback: () => void) =>
      socket.reconnect.delete(callback),
  },
}));

let dispose: (() => void) | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  auth.current = { userId: 'viewer', session: 1 };
});
afterEach(() => {
  dispose?.();
  socket.receivers.clear();
  socket.reconnect.clear();
  vi.runOnlyPendingTimers();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const push = (
  linkId = 'inbox-a',
  event = 'upsert_message',
  status?: string
) => {
  for (const receive of socket.receivers) {
    receive({
      type: 'refresh_email',
      data: JSON.stringify({ event, link_id: linkId, status }),
    });
  }
};

function mount() {
  let enabled = true;
  let scope = 'selected-inbox-a';
  let selected = 'inbox-a';
  const refresh = vi.fn<() => Promise<void>>().mockResolvedValue();
  createRoot((cleanup) => {
    dispose = cleanup;
    useEmailListRefresh({
      enabled: () => enabled,
      scope: () => scope,
      matchesLink: (link) => link === selected,
      refresh,
    });
  });
  return {
    refresh,
    setEnabled: (value: boolean) => {
      enabled = value;
    },
    select: (link: string) => {
      selected = link;
      scope = `selected-${link}`;
    },
  };
}

it('refreshes a mounted empty reader for existing imports and ordinary new mail without a notification', async () => {
  const view = mount();
  push();
  await vi.waitFor(() => expect(view.refresh).toHaveBeenCalledTimes(1));
  push();
  push();
  await vi.advanceTimersByTimeAsync(5_000);
  expect(view.refresh).toHaveBeenCalledTimes(2);
  push('inbox-a', 'backfill', 'complete');
  await vi.waitFor(() => expect(view.refresh).toHaveBeenCalledTimes(3));
});

it('keeps unrelated, disabled and changed inbox readers untouched', async () => {
  const view = mount();
  push('inbox-b');
  expect(view.refresh).not.toHaveBeenCalled();
  view.setEnabled(false);
  push();
  expect(view.refresh).not.toHaveBeenCalled();
  view.setEnabled(true);
  push();
  await vi.waitFor(() => expect(view.refresh).toHaveBeenCalledTimes(1));
  push();
  view.select('inbox-b');
  await vi.advanceTimersByTimeAsync(5_000);
  expect(view.refresh).toHaveBeenCalledTimes(1);
});

it('drops delayed work when the login session changes, even for the same user', async () => {
  const view = mount();
  push();
  await vi.waitFor(() => expect(view.refresh).toHaveBeenCalledTimes(1));
  push();
  auth.current = { userId: 'viewer', session: 2 };
  await vi.advanceTimersByTimeAsync(5_000);
  expect(view.refresh).toHaveBeenCalledTimes(1);
});

it('coalesces an in-flight import burst into one fresh follow-up', async () => {
  const view = mount();
  const first = Promise.withResolvers<void>();
  view.refresh.mockReturnValueOnce(first.promise);
  push();
  for (let i = 0; i < 20; i++) push();
  await vi.advanceTimersByTimeAsync(5_000);
  expect(view.refresh).toHaveBeenCalledTimes(1);
  first.resolve();
  await vi.advanceTimersByTimeAsync(5_000);
  expect(view.refresh).toHaveBeenCalledTimes(2);
});

it('defers hidden mail and catches up on visibility or reconnection', async () => {
  const view = mount();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  push();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(view.refresh).not.toHaveBeenCalled();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  document.dispatchEvent(new Event('visibilitychange'));
  await vi.waitFor(() => expect(view.refresh).toHaveBeenCalledTimes(1));
  for (const reconnect of socket.reconnect) reconnect();
  await vi.waitFor(() => expect(view.refresh).toHaveBeenCalledTimes(2));
});
