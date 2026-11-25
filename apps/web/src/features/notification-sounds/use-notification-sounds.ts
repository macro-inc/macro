import { fireAndForget } from '@core/util/fireAndForget';
import type { NotificationSource } from '@notifications/notification-source';
import type { UnifiedNotification } from '@notifications/types';
import { makeEventListener } from '@solid-primitives/event-listener';
import { type Accessor, createMemo, onCleanup } from 'solid-js';
import {
  NOTIFICATION_SOUND_MIN_GAP_MS,
  soundForNotification,
} from './core/settings';
import type { NotificationSoundId } from './core/sounds';
import {
  NOTIFICATION_SOUND_PLAYER,
  playNotificationSound,
} from './primitives/sound-player';
import {
  createSavedNotificationSoundSettings,
  readNotificationSoundSettings,
} from './primitives/sound-settings';
import {
  claimNotificationSoundTab,
  isNotificationSoundTab,
  releaseNotificationSoundTab,
} from './primitives/sound-tab';
import { createSoundUnlock } from './primitives/sound-unlock';

/**
 * The sound Macro plays for an incoming notification, if any. System alerts
 * for it stay silent so the person hears one sound, not two.
 */
export function notificationSoundFor(
  notification: Pick<UnifiedNotification, 'state' | 'notification_metadata'>,
  userId: string | undefined
): { id: NotificationSoundId; volume: number } | null {
  if (!userId || notification.state !== 'unseen') return null;
  const settings = readNotificationSoundSettings(userId);
  const id = soundForNotification(
    notification.notification_metadata.tag,
    settings
  );
  return id ? { id, volume: settings.volume } : null;
}

/** Plays the chosen sound for each incoming notification, when turned on. */
export function useNotificationSounds(
  notificationSource: Pick<NotificationSource, 'subscribe'>,
  userId: Accessor<string | undefined>
) {
  let lastPlayedAt = Number.NEGATIVE_INFINITY;

  // Audio unlocks only for someone who turned notification sounds on here.
  const saved = createSavedNotificationSoundSettings(userId);
  const enabled = createMemo(() => saved()?.enabled === true);
  createSoundUnlock(NOTIFICATION_SOUND_PLAYER, enabled);

  if (document.hasFocus()) claimNotificationSoundTab();
  makeEventListener(window, 'focus', claimNotificationSoundTab);
  makeEventListener(window, 'pagehide', releaseNotificationSoundTab);
  // A page restored from the back/forward cache released its claim on hide.
  makeEventListener(window, 'pageshow', (event) => {
    if (event.persisted && document.hasFocus()) claimNotificationSoundTab();
  });
  makeEventListener(window, 'pointerdown', claimNotificationSoundTab, {
    capture: true,
    passive: true,
  });

  const unsubscribe = notificationSource.subscribe((notification) => {
    if (!isNotificationSoundTab()) return;
    const sound = notificationSoundFor(notification, userId());
    if (!sound) return;
    const now = Date.now();
    if (now - lastPlayedAt < NOTIFICATION_SOUND_MIN_GAP_MS) return;
    lastPlayedAt = now;
    fireAndForget(
      playNotificationSound(sound.id, sound.volume),
      'notification-sounds'
    );
  });
  onCleanup(unsubscribe);
}
