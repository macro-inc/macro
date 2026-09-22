import type { NotificationSource } from '@notifications/notification-source';
import { cleanup, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AgentSessionReadMarker } from './AgentSessionReadMarker';

const mocks = vi.hoisted(() => ({ markRead: vi.fn(async () => {}) }));
vi.mock('@notifications/notification-helpers', () => ({
  markNotificationsForEntityAsRead: mocks.markRead,
}));
vi.mock('@queries/email/link', () => ({
  useNonPrimaryEmailLinkIdHeader: vi.fn(),
}));
vi.mock('@queries/email/thread', () => ({
  useMarkThreadAsSeenMutation: vi.fn(),
}));

const notificationSource = {} as NotificationSource;

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it('marks the loaded active session only, including a direct route', async () => {
  const [id, setId] = createSignal<string>();
  const [active, setActive] = createSignal(false);
  render(() => (
    <AgentSessionReadMarker
      sessionId={id()}
      active={active()}
      notificationSource={notificationSource}
    />
  ));
  await vi.advanceTimersByTimeAsync(2_000);
  setId('opened-session');
  await vi.advanceTimersByTimeAsync(2_000);
  expect(mocks.markRead).not.toHaveBeenCalled();

  setActive(true);
  await vi.advanceTimersByTimeAsync(2_000);
  expect(mocks.markRead).toHaveBeenCalledExactlyOnceWith(notificationSource, {
    type: 'agent_session',
    id: 'opened-session',
  });
});

it('does not mark a previous session when navigation happens during the debounce', async () => {
  const [id, setId] = createSignal('first-session');
  render(() => (
    <AgentSessionReadMarker
      sessionId={id()}
      active
      notificationSource={notificationSource}
    />
  ));
  await vi.advanceTimersByTimeAsync(1_000);
  setId('second-session');
  await vi.advanceTimersByTimeAsync(2_000);
  expect(mocks.markRead).toHaveBeenCalledExactlyOnceWith(notificationSource, {
    type: 'agent_session',
    id: 'second-session',
  });
});

it('cancels the read marker when the split loses focus before it is viewed', async () => {
  const [active, setActive] = createSignal(true);
  render(() => (
    <AgentSessionReadMarker
      sessionId="opened-session"
      active={active()}
      notificationSource={notificationSource}
    />
  ));
  setActive(false);
  await vi.advanceTimersByTimeAsync(2_000);
  expect(mocks.markRead).not.toHaveBeenCalled();
});
