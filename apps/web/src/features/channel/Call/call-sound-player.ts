import {
  DEFAULT_NOTIFICATION_SOUND_SETTINGS,
  soundForCallEvent,
} from '@app/features/notification-sounds/core/settings';
import { createSoundPlayer } from '@app/features/notification-sounds/primitives/sound-player';
import { readNotificationSoundSettings } from '@app/features/notification-sounds/primitives/sound-settings';
import { createSoundUnlock } from '@app/features/notification-sounds/primitives/sound-unlock';
import { fireAndForget } from '@core/util/fireAndForget';
import { type Accessor, createEffect, on, onCleanup } from 'solid-js';
import type { CallPresenceEvent } from './call-presence';

/** Playback policy shared by signed-in channel calls and guest browser calls. */
export function createCallSoundPlayer(
  userId: Accessor<string | undefined>,
  outputDeviceId: Accessor<string | null> = () => null
) {
  const player = createSoundPlayer(outputDeviceId);
  createSoundUnlock(player.unlock);
  createEffect(
    on(outputDeviceId, () => fireAndForget(player.syncOutput(), 'call-sounds'))
  );
  onCleanup(() => fireAndForget(player.dispose(), 'call-sounds'));
  const settings = () => {
    const id = userId();
    return id
      ? readNotificationSoundSettings(id)
      : DEFAULT_NOTIFICATION_SOUND_SETTINGS;
  };

  return (event: CallPresenceEvent) => {
    const current = settings();
    const sound = soundForCallEvent(event, current);
    if (sound) fireAndForget(player.play(sound, current.volume), 'call-sounds');
  };
}
