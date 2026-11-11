import {
  DEFAULT_NOTIFICATION_SOUND_SETTINGS,
  soundForCallEvent,
} from '@app/features/notification-sounds/core/settings';
import {
  playNotificationSound,
  unlockNotificationSounds,
} from '@app/features/notification-sounds/primitives/sound-player';
import { readNotificationSoundSettings } from '@app/features/notification-sounds/primitives/sound-settings';
import { fireAndForget } from '@core/util/fireAndForget';
import { makeEventListener } from '@solid-primitives/event-listener';
import type { Accessor } from 'solid-js';
import type { CallPresenceEvent } from './call-presence';

/** Playback policy shared by signed-in channel calls and guest browser calls. */
export function createCallSoundPlayer(userId: Accessor<string | undefined>) {
  const settings = () => {
    const id = userId();
    return id
      ? readNotificationSoundSettings(id)
      : DEFAULT_NOTIFICATION_SOUND_SETTINGS;
  };

  // Unlock during the Join gesture, not after token or media awaits. Guest
  // call pages do not mount the authenticated notification-sound listener.
  makeEventListener(
    window,
    'pointerdown',
    () => {
      if (settings().callSoundsEnabled) {
        fireAndForget(unlockNotificationSounds(), 'call-sounds');
      }
    },
    { capture: true, passive: true }
  );

  return (event: CallPresenceEvent) => {
    const current = settings();
    const sound = soundForCallEvent(event, current);
    if (sound)
      fireAndForget(
        playNotificationSound(sound, current.volume),
        'call-sounds'
      );
  };
}
