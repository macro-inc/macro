import {
  DEFAULT_NOTIFICATION_SOUND_SETTINGS,
  soundForCallEvent,
} from '@app/features/notification-sounds/core/settings';
import { createSoundPlayer } from '@app/features/notification-sounds/primitives/sound-player';
import { createSavedNotificationSoundSettings } from '@app/features/notification-sounds/primitives/sound-settings';
import { createSoundUnlock } from '@app/features/notification-sounds/primitives/sound-unlock';
import { fireAndForget } from '@core/util/fireAndForget';
import { Telemetry } from '@macro-inc/observability';
import {
  type Accessor,
  createEffect,
  createMemo,
  on,
  onCleanup,
} from 'solid-js';
import type { CallPresenceEvent } from './call-presence';

/**
 * Playback policy shared by signed-in channel calls and guest browser calls.
 * `callActive` is true while a browser call is starting or running: audio
 * unlocks only then, so ordinary taps outside calls never start it.
 */
export function createCallSoundPlayer(
  userId: Accessor<string | undefined>,
  callActive: Accessor<boolean>,
  outputDeviceId: Accessor<string | null> = () => null
) {
  const player = createSoundPlayer(outputDeviceId);
  const saved = createSavedNotificationSoundSettings(userId);
  // Guests have no saved settings and use the defaults.
  const settings = () => saved() ?? DEFAULT_NOTIFICATION_SOUND_SETTINGS;
  const wanted = createMemo(() => callActive() && settings().callSoundsEnabled);
  createSoundUnlock(player, wanted);
  createEffect(
    on(outputDeviceId, () => fireAndForget(player.syncOutput(), 'call-sounds'))
  );
  onCleanup(() => fireAndForget(player.dispose(), 'call-sounds'));

  return (event: CallPresenceEvent) => {
    const current = settings();
    const sound = soundForCallEvent(event, current);
    if (!sound) return;
    fireAndForget(
      Telemetry.span('call.sound.play', async (span) => {
        span.setAttr('call.sound.kind', event);
        span.setAttr('call.sound.count', 1);
        await player.play(sound, current.volume);
      }),
      'call-sounds'
    );
  };
}
