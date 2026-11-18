import type { NotificationSource } from '@notifications/notification-source';
import { cleanup, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AgentSessionReadMarker } from './AgentSessionReadMarker';

const mocks = vi.hoisted(() => ({
  markRead: vi.fn(async () => {}),
}));
vi.mock('@notifications/notification-helpers', () => ({
  markNotificationsForEntityAsRead: mocks.markRead,
}));

function createSource() {
  return {
    notificationsByEntity: vi.fn(() => ({})),
    isLoading: vi.fn(() => false),
  } as unknown as NotificationSource;
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
  const notificationSource = createSource();
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
  const notificationSource = createSource();
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
      notificationSource={createSource()}
    />
  ));
  setActive(false);
  await vi.advanceTimersByTimeAsync(2_000);
  expect(mocks.markRead).not.toHaveBeenCalled();
});

it('marks the session once without reading the notification feed', async () => {
  const source = createSource();
  render(() => (
    <AgentSessionReadMarker
      sessionId="opened-session"
      active
      notificationSource={source}
    />
  ));
  await vi.advanceTimersByTimeAsync(1_999);
  expect(mocks.markRead).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(mocks.markRead).toHaveBeenCalledExactlyOnceWith(source, {
    type: 'agent_session',
    id: 'opened-session',
  });
  await vi.advanceTimersByTimeAsync(10_000);
  expect(mocks.markRead).toHaveBeenCalledOnce();
  expect(source.notificationsByEntity).not.toHaveBeenCalled();
  expect(source.isLoading).not.toHaveBeenCalled();
});

it('logs a failed mark once without retrying', async () => {
  const error = new Error('Notification write failed');
  const logError = vi.spyOn(console, 'error').mockImplementation(() => {});
  mocks.markRead.mockRejectedValue(error);
  try {
    render(() => (
      <AgentSessionReadMarker
        sessionId="opened-session"
        active
        notificationSource={createSource()}
      />
    ));
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
