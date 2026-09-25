import type { NotificationSource } from '@notifications/notification-source';
import type { UnifiedNotification } from '@notifications/types';
import { cleanup, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AgentSessionReadMarker } from './AgentSessionReadMarker';

const mocks = vi.hoisted(() => ({ markRead: vi.fn(async () => {}) }));
vi.mock('@notifications/notification-helpers', () => ({
  markNotificationsForEntityAsRead: mocks.markRead,
}));
const notificationSource = {
  notificationsByEntity: () => ({}),
  isLoading: () => false,
} as NotificationSource;

function notification(id: string): UnifiedNotification {
  return {
    id,
    entity_id: 'opened-session',
    entity_type: 'agent_session',
    state: 'unseen',
    created_at: '2026-09-22T00:00:00.000Z',
    updated_at: '2026-09-22T00:00:00.000Z',
    viewed_at: null,
    sent: true,
    notification_event_type: 'channel_message_send',
    notification_metadata: {
      tag: 'channel_message_send',
      content: { messageId: id },
    },
  } as UnifiedNotification;
}

beforeEach(() => {
  vi.useFakeTimers();
  mocks.markRead.mockReset();
  mocks.markRead.mockResolvedValue(undefined);
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

it('waits for the initial notification feed even when it takes longer than the viewing debounce', async () => {
  const [loading, setLoading] = createSignal(true);
  const source = { ...notificationSource, isLoading: loading };
  render(() => (
    <AgentSessionReadMarker
      sessionId="opened-session"
      active
      notificationSource={source}
    />
  ));
  await vi.advanceTimersByTimeAsync(5_000);
  expect(mocks.markRead).not.toHaveBeenCalled();
  setLoading(false);
  await vi.advanceTimersByTimeAsync(2_000);
  expect(mocks.markRead).toHaveBeenCalledExactlyOnceWith(source, {
    type: 'agent_session',
    id: 'opened-session',
  });
});

it('marks new notifications while the conversation stays active without repeating successful reads', async () => {
  const [notifications, setNotifications] = createSignal([
    notification('first'),
  ]);
  const source = {
    ...notificationSource,
    notificationsByEntity: () => ({
      'agent_session@opened-session': notifications(),
    }),
  };
  render(() => (
    <AgentSessionReadMarker
      sessionId="opened-session"
      active
      notificationSource={source}
    />
  ));
  await vi.advanceTimersByTimeAsync(2_000);
  expect(mocks.markRead).toHaveBeenCalledOnce();

  setNotifications([{ ...notification('first'), state: 'seen' }]);
  await vi.advanceTimersByTimeAsync(2_000);
  expect(mocks.markRead).toHaveBeenCalledOnce();

  setNotifications((previous) => [...previous, notification('second')]);
  await vi.advanceTimersByTimeAsync(2_000);
  expect(mocks.markRead).toHaveBeenCalledTimes(2);
});

it('does not retry a failed mark indefinitely when the notification cache rolls back', async () => {
  const [notifications, setNotifications] = createSignal([
    notification('first'),
  ]);
  const source = {
    ...notificationSource,
    notificationsByEntity: () => ({
      'agent_session@opened-session': notifications(),
    }),
  };
  const error = new Error('Notification write failed');
  const logError = vi.spyOn(console, 'error').mockImplementation(() => {});
  mocks.markRead.mockRejectedValue(error);
  try {
    render(() => (
      <AgentSessionReadMarker
        sessionId="opened-session"
        active
        notificationSource={source}
      />
    ));
    await vi.advanceTimersByTimeAsync(2_000);
    setNotifications([{ ...notification('first'), state: 'seen' }]);
    setNotifications([notification('first')]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mocks.markRead).toHaveBeenCalledOnce();
    expect(logError).toHaveBeenCalledWith(
      'Failed to mark agent session notifications as read',
      error
    );
  } finally {
    logError.mockRestore();
  }
});
