import { useUserId } from '@core/context/user';
import { fireAndForget } from '@core/util/fireAndForget';
import { Show } from 'solid-js';
import { NotificationSoundSection } from '../components/NotificationSoundSection';
import { playNotificationSound } from '../primitives/sound-player';
import { createNotificationSoundSettings } from '../primitives/sound-settings';

/** The Sounds section of the Notifications settings page. */
export function NotificationSoundSettingsView() {
  const userId = useUserId();
  return (
    <Show when={userId()} keyed>
      {(id) => {
        const sounds = createNotificationSoundSettings(id);
        return (
          <NotificationSoundSection
            settings={sounds.settings()}
            onEnabledChange={sounds.setEnabled}
            onVolumeChange={sounds.setVolume}
            onCategoryChange={sounds.setCategory}
            onPreview={(sound) =>
              fireAndForget(
                playNotificationSound(sound, sounds.settings().volume),
                'notification-sounds'
              )
            }
          />
        );
      }}
    </Show>
  );
}
