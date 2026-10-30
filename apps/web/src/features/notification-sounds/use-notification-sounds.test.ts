import type { UnifiedNotification } from '@notifications/types';
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { playNotificationSound } from './primitives/sound-player';
import { useNotificationSounds } from './use-notification-sounds';

vi.mock('./primitives/sound-player', () => ({
  playNotificationSound: vi.fn().mockResolvedValue(undefined),
  unlockNotificationSounds: vi.fn().mockResolvedValue(undefined),
}));

const USER_ID = 'user-1';
const SETTINGS_KEY = `macro:notification-sounds:${USER_ID}`;
const TAB_KEY = 'macro:notification-sounds:tab';

function notification(
  tag: 'channel_mention' | 'new_email',
  state: UnifiedNotification['state'] = 'unseen'
): UnifiedNotification {
  return {
    id: crypto.randomUUID(),
    entity_id: 'entity-1',
    entity_type: 'channel',
    created_at: '2026-10-29T12:00:00Z',
    updated_at: '2026-10-29T12:00:00Z',
    state,
    sent: true,
    notification_event_type: tag,
    notification_metadata: { tag, content: {} },
  } as unknown as UnifiedNotification;
}

function mountSounds() {
  let deliver: (notification: UnifiedNotification) => void = () => {};
  const dispose = createRoot((dispose) => {
    useNotificationSounds(
      {
        subscribe: (handler) => {
          deliver = handler;
          return () => {};
        },
      },
      () => USER_ID
    );
    return dispose;
  });
  return { deliver: (n: UnifiedNotification) => deliver(n), dispose };
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  vi.mocked(playNotificationSound).mockClear();
});

afterEach(() => vi.useRealTimers());

it('stays silent until sounds are turned on', () => {
  const { deliver, dispose } = mountSounds();
  deliver(notification('channel_mention'));
  expect(playNotificationSound).not.toHaveBeenCalled();
  dispose();
});

it('plays the chosen sound once for a burst of notifications', () => {
  localStorage.setItem(
    SETTINGS_KEY,
    JSON.stringify({
      enabled: true,
      volume: 0.5,
      categories: { mentions: { enabled: true, sound: 'chime' } },
    })
  );
  const { deliver, dispose } = mountSounds();

  deliver(notification('channel_mention'));
  deliver(notification('channel_mention'));
  expect(playNotificationSound).toHaveBeenCalledTimes(1);
  expect(playNotificationSound).toHaveBeenCalledWith('chime', 0.5);

  vi.advanceTimersByTime(2_000);
  deliver(notification('channel_mention'));
  expect(playNotificationSound).toHaveBeenCalledTimes(2);
  dispose();
});

it('skips read notifications, muted categories, and tabs not in use', () => {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ enabled: true }));
  const { deliver, dispose } = mountSounds();

  deliver(notification('channel_mention', 'seen'));
  deliver(notification('new_email'));
  localStorage.setItem(TAB_KEY, 'another-tab');
  deliver(notification('channel_mention'));
  expect(playNotificationSound).not.toHaveBeenCalled();

  window.dispatchEvent(new Event('focus'));
  deliver(notification('channel_mention'));
  expect(playNotificationSound).toHaveBeenCalledTimes(1);
  dispose();
});

it('hands sound to the other tabs when the playing tab closes', () => {
  const { dispose } = mountSounds();
  window.dispatchEvent(new Event('focus'));
  expect(localStorage.getItem(TAB_KEY)).not.toBeNull();

  window.dispatchEvent(new Event('pagehide'));
  expect(localStorage.getItem(TAB_KEY)).toBeNull();
  dispose();
});

it('leaves another tab playing when a background tab closes', () => {
  const { dispose } = mountSounds();
  localStorage.setItem(TAB_KEY, 'another-tab');

  window.dispatchEvent(new Event('pagehide'));
  expect(localStorage.getItem(TAB_KEY)).toBe('another-tab');
  dispose();
});

it('reclaims sound when a focused page returns from the back/forward cache', () => {
  const { dispose } = mountSounds();
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  window.dispatchEvent(
    new PageTransitionEvent('pageshow', { persisted: true })
  );
  expect(localStorage.getItem(TAB_KEY)).not.toBeNull();
  vi.mocked(document.hasFocus).mockRestore();
  dispose();
});
